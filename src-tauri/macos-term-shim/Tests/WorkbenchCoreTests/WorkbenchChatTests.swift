import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchChatTests: XCTestCase {
    func testVoicePermissionAndTransportCallbacksCannotSurviveCancellationEditingOrReload() throws {
        var state = ChatState()
        XCTAssertThrowsError(try state.beginVoice(.permission))
        let generation = try bound(&state)
        _ = try state.settle(generation, environment: environment(), conversationID: "conv", payload: page([]))
        state.draft = "preserved"
        let cancelled = try state.beginVoice(.permission)
        XCTAssertThrowsError(try state.beginVoice(.synthesizing))
        state.cancelVoice()
        let active = try state.beginVoice(.permission)
        XCTAssertFalse(state.advanceVoice(cancelled, to: .recording))
        XCTAssertFalse(state.advanceVoice(active, to: .playing))
        XCTAssertTrue(state.advanceVoice(active, to: .recording))
        XCTAssertTrue(state.advanceVoice(active, to: .transcribing))
        state.draft = "new edit"
        XCTAssertFalse(state.voiceCurrent(active)); XCTAssertNil(state.voicePhase)
        XCTAssertEqual(state.draft, "new edit")
        let stale = try state.beginVoice(.permission)
        state.invalidate()
        XCTAssertFalse(state.advanceVoice(stale, to: .recording)); XCTAssertNil(state.voicePhase)
        XCTAssertThrowsError(try state.beginVoice(.permission))
    }
    func testVoicePlaybackUsesAssistantTextAndOnlyTheCurrentReceiptCanStartPlayback() throws {
        var state = ChatState(); let generation = try bound(&state)
        _ = try state.settle(generation, environment: environment(), conversationID: "conv", payload: page([turn(1)]))
        XCTAssertEqual(state.spokenReply, "Message 1.0")
        XCTAssertThrowsError(try state.beginVoice(.playing))
        let first = try state.beginVoice(.synthesizing)
        state.cancelVoice()
        let second = try state.beginVoice(.synthesizing)
        XCTAssertFalse(state.advanceVoice(first, to: .playing))
        XCTAssertTrue(state.advanceVoice(second, to: .playing))
        state.cancelVoice(); XCTAssertNil(state.voicePhase)
        XCTAssertFalse(state.voiceCurrent(second))
        state.draft = "new message"
        let pending = try state.beginVoice(.permission)
        _ = try state.send()
        XCTAssertFalse(state.voiceCurrent(pending))
        XCTAssertThrowsError(try state.beginVoice(.permission))
    }
    func testVoiceTranscriptCannotOverwriteAnEditOrAnotherConversationAndKeepsProvenance() throws {
        var state = ChatState(); let token = try bound(&state)
        _ = try state.settle(token, environment: environment(), conversationID: "conv", payload: page([]))
        state.draft = "saved draft"
        XCTAssertThrowsError(try state.transcribed(token, environment: environment(), conversationID: "other", expectedDraft: "saved draft", text: "spoken"))
        XCTAssertThrowsError(try state.transcribed(token, environment: environment(store: "other"), conversationID: "conv", expectedDraft: "saved draft", text: "spoken"))
        XCTAssertThrowsError(try state.transcribed(token, environment: environment(), conversationID: "conv", expectedDraft: "older draft", text: "spoken"))
        XCTAssertThrowsError(try state.transcribed(token, environment: environment(), conversationID: "conv", expectedDraft: "saved draft", text: "  "))
        XCTAssertEqual(state.draft, "saved draft")
        XCTAssertTrue(try state.transcribed(token, environment: environment(), conversationID: "conv", expectedDraft: "saved draft", text: "literal ' $() λ"))
        state.draft = state.draft // Rendering/sending the same draft preserves voice provenance.
        XCTAssertEqual(try state.send()["modality"], .string("voice"))
        XCTAssertThrowsError(try state.transcribed(token, environment: environment(), conversationID: "conv", expectedDraft: state.draft, text: "second"))
        state.invalidate()
        XCTAssertFalse(try state.transcribed(token, environment: environment(), conversationID: "conv", expectedDraft: "", text: "late"))
        let next = try bound(&state)
        _ = try state.settle(next, environment: environment(), conversationID: "conv", payload: page([]))
        state.draft = "edited transcript"
        XCTAssertEqual(try state.send()["modality"], .string("text"))
    }
    func testVoiceRequestsAndReceiptsRequireTheExactEnvironmentConversationAndOperation() throws {
        let id = "c88bf103-8399-42ee-93ae-19e73114e3fd"
        XCTAssertThrowsError(try NativeVoice.request(environment: environment(), conversationID: "active", audio: Data([1])))
        XCTAssertThrowsError(try NativeVoice.request(environment: environment(), conversationID: id))
        XCTAssertThrowsError(try NativeVoice.request(environment: environment(), conversationID: id, audio: Data([1]), text: "both"))
        let request = try NativeVoice.request(environment: environment(), conversationID: id, audio: Data([0, 1, 2]))
        XCTAssertEqual(request["audioBase64"], .string("AAEC"))
        let row: [String: JSONValue] = ["conversationId": .string(id), "requestId": request["requestId"],
            "operation": .string("transcribe"), "text": .string("literal ' $() λ")]
        let payload = JSONValue.object(["environment": environment(), "rows": .array([.object(row)])])
        XCTAssertEqual(try NativeVoice.receipt(payload, request: request)["text"], row["text"])
        for key in ["conversationId", "requestId", "operation"] {
            var wrong = row; wrong[key] = .string("foreign")
            XCTAssertThrowsError(try NativeVoice.receipt(.object(["environment": environment(), "rows": .array([.object(wrong)])]), request: request))
        }
        XCTAssertThrowsError(try NativeVoice.receipt(.object(["environment": environment(store: "other"), "rows": .array([.object(row)])]), request: request))
        let speak = try NativeVoice.request(environment: environment(), conversationID: id, text: "Read this")
        var speech: [String: JSONValue] = ["conversationId": .string(id), "requestId": speak["requestId"], "operation": .string("speak"), "audioBase64": .string("AAEC")]
        XCTAssertEqual(try NativeVoice.receipt(.object(["environment": environment(), "rows": .array([.object(speech)])]), request: speak)["audioBase64"], .string("AAEC"))
        speech["audioBase64"] = .string("invalid")
        XCTAssertThrowsError(try NativeVoice.receipt(.object(["environment": environment(), "rows": .array([.object(speech)])]), request: speak))
    }
    private func question(_ id: String = "card", conversation: String = "conv", kind: String = "radio") -> JSONValue {
        .object(["correlationId": .string(id), "conversationId": .string(conversation), "prompt": .string("Choose a route"),
            "createdAt": .number(5), "presentation": .object(["kind": .string(kind), "options": .array([
                .object(["id": .string("yes"), "label": .string("Approve")]), .object(["id": .string("no"), "label": .string("Decline")])])])])
    }
    private func cardSnapshot(_ cards: [JSONValue], version: Double = 1, run: String = "run") -> JSONValue {
        frame("snapshot", .object(["workspaceId": .string("selected"), "runId": .string(run), "version": .number(version),
            "snapshot": .object(["openCards": .array(cards)])]))
    }
    func testCardFailureRetainsTheQuestionAndOnlyAnExactReceiptAcknowledgesIt() throws {
        var state = NativeCardsState(); let token = state.begin(environment: environment(), conversationID: "conv")
        _ = try state.receive(token, cardSnapshot([question()]))
        let card = try XCTUnwrap(state.cards.first), payload = try card.answer(picks: ["yes"])
        let request = try state.request(card, action: "submit", payload: payload)
        XCTAssertEqual(request["conversationId"], .string("conv")); XCTAssertEqual(request["payload"], payload)
        XCTAssertEqual(state.cards, [card]); XCTAssertThrowsError(try state.request(card, action: "submit", payload: payload))
        state.responseFailed(token, WorkbenchError("permission denied"))
        XCTAssertEqual(state.cards, [card]); XCTAssertNil(state.pending); XCTAssertEqual(state.error, "permission denied")
        _ = try state.request(card, action: "submit", payload: payload)
        let receipt = JSONValue.object(["environment": environment(), "rows": .array([.object([
            "responded": .bool(true), "conversationId": .string("conv"), "correlationId": .string("card")])])])
        var wrong = receipt
        if case .object(var fields) = wrong { fields["environment"] = environment(workspace: "other"); wrong = .object(fields) }
        XCTAssertThrowsError(try state.responded(token, id: card.id, receipt: wrong)); XCTAssertEqual(state.cards, [card])
        XCTAssertTrue(try state.responded(token, id: card.id, receipt: receipt)); XCTAssertTrue(state.cards.isEmpty)
        _ = try state.receive(token, cardSnapshot([question()], version: 2)); XCTAssertTrue(state.cards.isEmpty)
    }
    func testCardsRejectForeignScopeDuplicatesAndConflictingVersionsAtomically() throws {
        var state = NativeCardsState(); let token = state.begin(environment: environment(), conversationID: "conv")
        _ = try state.receive(token, cardSnapshot([question()]))
        let retained = state.cards
        for invalid in [cardSnapshot([question(conversation: "other")], version: 2), cardSnapshot([question(), question()], version: 2),
                        cardSnapshot([], version: 1), cardSnapshot([question()], version: -1)] {
            XCTAssertThrowsError(try state.receive(token, invalid)); XCTAssertEqual(state.cards, retained)
        }
        XCTAssertFalse(try state.receive(token, cardSnapshot([], version: 0))); XCTAssertEqual(state.cards, retained)
        XCTAssertThrowsError(try state.receive(token, cardSnapshot([question()], version: 2, run: "duplicate")))
        var bad = cardSnapshot([question()], version: 2)
        if case .object(var fields) = bad { fields["environment"] = environment("http://other:3170"); bad = .object(fields) }
        XCTAssertThrowsError(try state.receive(token, bad)); XCTAssertEqual(state.cards, retained)
        _ = try state.receive(token, cardSnapshot([], version: 2)); XCTAssertTrue(state.cards.isEmpty)
    }
    func testCardConnectionResetAcceptsNewVersionBaselineAndStaleConversationCannotRespond() throws {
        var state = NativeCardsState(); let token = state.begin(environment: environment(), conversationID: "conv")
        _ = try state.receive(token, cardSnapshot([question()], version: 8))
        let card = try XCTUnwrap(state.cards.first)
        state.disconnected(token, WorkbenchError("offline")); XCTAssertEqual(state.cards, [card])
        XCTAssertThrowsError(try state.request(card, action: "submit", payload: try card.answer(picks: ["yes"])))
        _ = try state.receive(token, frame("reset", .object(["workspaceId": .string("selected")])))
        _ = try state.receive(token, cardSnapshot([question()], version: 1)); XCTAssertEqual(state.cards, [card])
        _ = state.begin(environment: environment(), conversationID: "other")
        XCTAssertFalse(try state.receive(token, cardSnapshot([question()], version: 2)))
        XCTAssertThrowsError(try state.request(card, action: "cancel")); XCTAssertTrue(state.cards.isEmpty)
    }
    func testCardPayloadsKeepOptionIdentityAndValidateInputKinds() throws {
        let radio = NativeCard(runID: "run", raw: question())
        XCTAssertEqual(try radio.answer(picks: ["no"]), .object(["picks": .array([.string("no")])]))
        for picks in [[], ["yes", "no"], ["foreign"], ["yes", "yes"]] { XCTAssertThrowsError(try radio.answer(picks: picks)) }
        let checkbox = NativeCard(runID: "run", raw: question(kind: "checkbox"))
        XCTAssertEqual(try checkbox.answer(picks: ["yes", "no"])["picks"].rows?.count, 2)
        let text = NativeCard(runID: "run", raw: question(kind: "text"))
        let literal = "literal ' $() λ\nnext"
        XCTAssertEqual(try text.answer(value: literal)["value"], .string(literal)); XCTAssertThrowsError(try text.answer(value: " "))
        let date = NativeCard(runID: "run", raw: question(kind: "date"))
        XCTAssertEqual(try date.answer(value: "2026-11-07")["value"], .string("2026-11-07"))
        XCTAssertThrowsError(try date.answer(value: "2026-02-30"))
        var raw = question(kind: "slider")
        if case .object(var fields) = raw { fields["presentation"] = .object(["kind": .string("slider"),
            "min": .number(2), "max": .number(10), "step": .number(2)]); raw = .object(fields) }
        let slider = NativeCard(runID: "run", raw: raw)
        XCTAssertEqual(try slider.answer(value: "6")["value"], .number(6))
        for value in ["3", "11", "nan"] { XCTAssertThrowsError(try slider.answer(value: value)) }
        XCTAssertThrowsError(try NativeCard(runID: "run", raw: question(kind: "future")).answer(value: "yes"))
    }
    func testApprovalShowsItsChangeAndOnlyOpensTheExactCanonicalLink() throws {
        guard case .object(var raw) = question() else { return XCTFail("missing question") }
        raw["approval"] = .object(["title": .string("Edit settings"), "question": .string("Allow this change?"), "body": .array([.string("- old"), .string("+ new")])])
        raw["report"] = .object(["title": .string("Workbench"), "plans": .array([.object(["title": .string("Native host"),
            "items": .array([.object(["id": .string("P-004"), "text": .string("Review host"), "status": .string("wip")])])])])])
        let card = NativeCard(runID: "run", raw: .object(raw))
        for text in ["Choose a route", "Edit settings", "- old", "+ new", "Allow this change?", "Native host", "P-004", "Review host"] {
            XCTAssertTrue(card.prose.contains(text), text)
        }
        for link in ["https://outside.test", "//outside.test", "/api/ui/cards/foreign/link", "/api/ui/cards/card/link?next=other"] {
            raw["presentation"] = .object(["kind": .string("text"), "link": .string(link)])
            XCTAssertNil(NativeCard(runID: "run", raw: .object(raw)).secureLink(environment: environment()))
        }
        raw["presentation"] = .object(["kind": .string("text"), "link": .string("/api/ui/cards/card/link")])
        XCTAssertEqual(NativeCard(runID: "run", raw: .object(raw)).secureLink(environment: environment())?.absoluteString,
            "http://selected:3170/api/ui/cards/card/link")
    }
    func testCardsStreamAndResponseUseTheSamePuiTransportWithoutShellExpansion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Native cards " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui")
        let output = frame("reset", .object(["workspaceId": .string("selected")]))
        let receipt = JSONValue.object(["environment": environment(), "rows": .array([])])
        let lines = String(decoding: try JSONEncoder().encode(output), as: UTF8.self)
        let json = String(decoding: try JSONEncoder().encode(receipt), as: UTF8.self)
        try ("#!/bin/sh\ntest \"$1\" = native-cards || exit 9\ncat > \"$0.request\"\n" +
            "if test -f \"$0.respond\"; then printf '%s' '" + json + "'; else printf '%s\\n' '" + lines + "'; fi\n").write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        let bridge = PuiBridge(executable: file), body: JSONValue = .object(["payload": .string("literal ' $() λ")])
        var frames: [JSONValue] = []; for try await value in bridge.cards(body) { frames.append(value) }
        XCTAssertEqual(frames, [output])
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request"))), body)
        try Data().write(to: URL(fileURLWithPath: file.path + ".respond"))
        let actual = try await bridge.respondToCard(body); XCTAssertEqual(actual, receipt)
    }
    private let replyID = "94fc7611-aeb0-4c2a-af6e-4416a0704f57"
    private func frame(_ name: String, _ data: JSONValue, environment: JSONValue? = nil) -> JSONValue {
        .object(["environment": environment ?? self.environment(), "event": .string(name), "data": data])
    }
    private func meta() -> JSONValue {
        frame("turn-meta", .object(["schemaVersion": .number(1), "conversationId": .string("conv"), "turnId": .string(replyID)]))
    }
    private func event(_ sequence: Double, _ payload: JSONValue) -> JSONValue {
        frame("chat-event", .object(["schemaVersion": .number(1), "conversationId": .string("conv"), "turnId": .string(replyID),
            "eventId": .string("event-\(sequence)"), "sequence": .number(sequence), "event": payload]))
    }
    func testReplyProjectsSplitSayTagsAndDeduplicatesReplayWithoutProtocolLeak() throws {
        var reply = NativeChatReply(environment: environment(), conversationID: "conv", text: "literal λ")
        try reply.receive(meta())
        let chunks = ["<sleep>3</sleep><sa", "y>Hello λ 👋</s", "ay><continue/>"]
        var prior: JSONValue?
        for (index, text) in chunks.enumerated() {
            let value = event(Double(index + 1), .object(["type": .string("delta"), "text": .string(text)]))
            try reply.receive(value); try reply.receive(value); prior = value
            XCTAssertFalse(reply.displayText.contains("<"))
        }
        XCTAssertEqual(reply.displayText, "Hello λ 👋"); XCTAssertEqual(reply.sequence, 3)
        reply.disconnected()
        XCTAssertEqual(try reply.control("reconnect")["afterSequence"], .number(3))
        var conflict = prior!
        if case .object(var outer) = conflict, case .object(var data) = outer["data"] {
            data["event"] = .object(["type": .string("delta"), "text": .string("tampered")]); outer["data"] = .object(data); conflict = .object(outer)
        }
        XCTAssertThrowsError(try reply.receive(conflict)); XCTAssertEqual(reply.displayText, "Hello λ 👋")
        XCTAssertThrowsError(try reply.receive(event(5, .object(["type": .string("delta"), "text": .string("gap")]))))
        XCTAssertEqual(reply.sequence, 3)
        let done = frame("done", .object(["persistedTurn": .object(["conversationId": .string("conv"),
            "turnId": .string(replyID), "seq": .number(17)])]))
        try reply.receive(done); XCTAssertTrue(reply.complete)
        XCTAssertThrowsError(try reply.control("reconnect")); XCTAssertThrowsError(try reply.control("cancel"))
    }
    func testReplyRequiresExactEnvironmentIdentityAndCommittedAcknowledgement() throws {
        var reply = NativeChatReply(environment: environment(), conversationID: "conv", text: "hello")
        XCTAssertThrowsError(try reply.control("cancel"))
        XCTAssertThrowsError(try reply.receive(event(1, .object(["type": .string("delta"), "text": .string("before identity")]))))
        try reply.receive(meta())
        for env in [environment("http://other"), environment(workspace: "other"), environment(store: "other"), environment(scope: "other")] {
            XCTAssertThrowsError(try reply.receive(frame("turn-meta", meta()["data"], environment: env)))
        }
        for receipt in [JSONValue.null, .object(["conversationId": .string("other"), "turnId": .string(replyID), "seq": .number(1)]),
            .object(["conversationId": .string("conv"), "turnId": .string(UUID().uuidString), "seq": .number(1)]),
            .object(["conversationId": .string("conv"), "turnId": .string(replyID), "seq": .number(-1)])] {
            XCTAssertThrowsError(try reply.receive(frame("done", .object(["persistedTurn": receipt]))))
            XCTAssertFalse(reply.complete)
        }
        XCTAssertThrowsError(try reply.receive(frame("error", .object(["message": .string("provider refused")]))))
        XCTAssertFalse(reply.complete)
    }
    func testSendPreservesDraftUntilCanonicalUserReceiptAndRejectsStaleFrames() throws {
        var state = ChatState(); let generation = try bound(&state)
        _ = try state.settle(generation, environment: environment(), conversationID: "conv", payload: page([]))
        state.draft = "literal ' $() λ"; let request = try state.send()
        XCTAssertEqual(state.draft, "literal ' $() λ"); XCTAssertFalse(state.canSend)
        XCTAssertThrowsError(try state.send())
        let row: JSONValue = .object(["id": request["userTurnId"], "conversationId": .string("conv"),
            "seq": .number(1), "role": .string("user"), "text": request["text"]])
        let saved = frame("user-saved", .object(["conversationId": .string("conv"), "turn": row]))
        XCTAssertTrue(try state.receive(generation, saved)); XCTAssertTrue(try state.receive(generation, saved))
        XCTAssertEqual(state.turns, [row]); XCTAssertEqual(state.draft, "")
        state.draft = "next draft"; state.invalidate()
        XCTAssertFalse(try state.receive(generation, meta())); XCTAssertTrue(state.turns.isEmpty)
        _ = try bound(&state); XCTAssertEqual(state.draft, "next draft")
    }
    func testCancellationRequiresTheCanonicalCancelledStateReceipt() throws {
        var reply = NativeChatReply(environment: environment(), conversationID: "conv", text: "hi")
        try reply.receive(meta())
        XCTAssertEqual(try reply.control("cancel")["turnId"], .string(replyID))
        XCTAssertThrowsError(try reply.receive(frame("cancelled", .object(["ok": .bool(true)]))))
        let capabilities = ["connectionReplay", "persistedHistory", "persistedInteractionDecisions", "completedToolCheckpoints", "interruptedTurnRecovery"]
        let state: JSONValue = .object(["schemaVersion": .number(1), "conversationId": .string("conv"), "turnId": .string(replyID),
            "revision": .number(1), "lastSequence": .number(0), "phase": .string("cancelled"),
            "capabilities": .object(Dictionary(uniqueKeysWithValues: capabilities.map { ($0, JSONValue.bool(true)) }))])
        try reply.receive(frame("cancelled", .object(["ok": .bool(true), "state": state])))
        XCTAssertTrue(reply.complete); XCTAssertEqual(reply.phase, "cancelled")
        var chat = ChatState(); let token = try bound(&chat)
        _ = try chat.settle(token, environment: environment(), conversationID: "conv", payload: page([]))
        chat.draft = "first"; _ = try chat.send(); _ = try chat.receive(token, meta())
        _ = try chat.receive(token, frame("cancelled", .object(["ok": .bool(true), "state": state])))
        chat.draft = "next"; XCTAssertTrue(chat.canSend); _ = try chat.send()
    }
    func testStreamingBridgeDeliversBeforeChildExitAndPreservesSplitUnicode() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Native chat " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui")
        let script = "#!/bin/sh\ntest \"$1\" = native-chat || exit 9\ncat > \"$0.request\"\nprintf '%s\\n' '{\"event\":\"first λ\"}'\nwhile test ! -f \"$0.continue\"; do sleep 0.01; done\nprintf '%s\\n' '{\"event\":\"last\"}'\n"
        try Data(script.utf8).write(to: file); try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        var received: [JSONValue] = []
        for try await value in PuiBridge(executable: file).chat(.object(["literal": .string("' $() λ")])) {
            received.append(value)
            if received.count == 1 { try Data().write(to: URL(fileURLWithPath: file.path + ".continue")) }
        }
        XCTAssertEqual(received.map { $0["event"].text }, ["first λ", "last"])
        let request = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request")))
        XCTAssertEqual(request["literal"].text, "' $() λ")
        final class Values: @unchecked Sendable { var rows: [JSONValue] = [] }
        let values = Values(), decoder = NativeChatLines { values.rows.append($0) }
        for byte in Data("{\"text\":\"λ 👋\"}\n".utf8) { try decoder.push(Data([byte])) }
        try decoder.finish(); XCTAssertEqual(values.rows.first?["text"].text, "λ 👋")
        try decoder.push(Data("{".utf8)); XCTAssertThrowsError(try decoder.finish())
    }
    private func environment(_ endpoint: String = "http://selected:3170", workspace: String = "selected",
                             store: String = "store", scope: String = "workspace:selected") -> JSONValue {
        .object(["endpoint": .string(endpoint), "workspaceId": .string(workspace),
            "store": .object(["id": .string(store)]), "agentChat": .object(["scope": .string(scope)])])
    }
    private func envelope(_ row: JSONValue) -> JSONValue { .object(["rows": .array([row])]) }
    private func conversation(_ id: String = "conv", workspace: String = "selected", kind: String = "global") -> JSONValue {
        envelope(.object(["id": .string(id), "workspaceId": .string(workspace), "subjectKind": .string(kind), "status": .string("active")]))
    }
    private func turn(_ seq: Double, id: String? = nil, conversation: String = "conv") -> JSONValue {
        .object(["id": .string(id ?? "turn-\(seq)"), "conversationId": .string(conversation), "seq": .number(seq),
            "role": .string("assistant"), "text": .string("Message \(seq)")])
    }
    private func page(_ rows: [JSONValue], more: Bool = false) -> JSONValue {
        envelope(.object(["turns": .array(rows), "hasMoreEarlier": .bool(more)]))
    }
    private func bound(_ state: inout ChatState, environment: JSONValue? = nil, id: String = "conv") throws -> Int {
        let token = state.begin(), env = environment ?? self.environment()
        XCTAssertTrue(try state.bind(token, environment: env, payload: conversation(id, workspace: env["workspaceId"].text)))
        return token
    }
    func testCanonicalHistoryPrependsStrictEarlierPagesAndPreservesDraft() throws {
        var state = ChatState(); let token = try bound(&state)
        state.draft = "A literal draft ' $() λ"
        XCTAssertTrue(try state.settle(token, environment: environment(), conversationID: "conv", payload: page([turn(3), turn(4)], more: true)))
        XCTAssertEqual(try state.beginEarlier(), 3)
        XCTAssertThrowsError(try state.beginEarlier())
        XCTAssertTrue(try state.settle(token, environment: environment(), conversationID: "conv", beforeSeq: 3, payload: page([turn(1), turn(2)])))
        XCTAssertEqual(state.turns.map { $0["seq"] }, [1, 2, 3, 4].map { JSONValue.number(Double($0)) })
        XCTAssertEqual(state.draft, "A literal draft ' $() λ")
        XCTAssertFalse(state.hasMoreEarlier); XCTAssertTrue(state.ready)
        XCTAssertThrowsError(try state.beginEarlier())
    }
    func testDraftsAreBoundToEveryRendezvousFieldAndConversation() throws {
        var state = ChatState(); _ = try bound(&state); state.draft = "selected draft"
        for env in [environment("http://other"), environment(workspace: "other"), environment(store: "other"), environment(scope: "other")] {
            _ = try bound(&state, environment: env); XCTAssertEqual(state.draft, ""); state.draft = "other"
        }
        _ = try bound(&state, id: "different"); XCTAssertEqual(state.draft, "")
        _ = try bound(&state); XCTAssertEqual(state.draft, "selected draft")
        state.invalidate(); XCTAssertEqual(state.draft, ""); XCTAssertTrue(state.turns.isEmpty)
    }
    func testStaleResponsesCannotRebindOrInjectMessages() throws {
        var state = ChatState(); let stale = try bound(&state)
        let current = state.begin()
        XCTAssertFalse(try state.bind(stale, environment: environment(), payload: conversation()))
        XCTAssertFalse(try state.settle(stale, environment: environment(), conversationID: "conv", payload: page([turn(1)])))
        state.fail(stale, WorkbenchError("old")); XCTAssertNil(state.error)
        XCTAssertTrue(try state.bind(current, environment: environment(), payload: conversation()))
        XCTAssertThrowsError(try state.settle(current, environment: environment(store: "other"), conversationID: "conv", payload: page([turn(1)])))
        XCTAssertThrowsError(try state.settle(current, environment: environment(), conversationID: "other", payload: page([turn(1)])))
        XCTAssertTrue(state.turns.isEmpty)
    }
    func testRejectsForeignDuplicateUnorderedAndNonadvancingPagesAtomically() throws {
        let badPages = [page([turn(1, conversation: "foreign")]), page([turn(2), turn(1)]),
            page([turn(1, id: "dup"), turn(2, id: "dup")]), page([turn(1), turn(1)]),
            page([turn(-1)]), page([turn(1.5)]), page([turn(9007199254740992)]), page([], more: true),
            envelope(.object(["turns": .array([])]))]
        for payload in badPages {
            var state = ChatState(); let token = try bound(&state)
            XCTAssertThrowsError(try state.settle(token, environment: environment(), conversationID: "conv", payload: payload))
            XCTAssertTrue(state.turns.isEmpty); XCTAssertFalse(state.loaded)
        }
        for payload in [page([turn(3)]), page([turn(1, id: "retained")]), page([turn(1, conversation: "foreign")])] {
            var state = ChatState(); let token = try bound(&state)
            let retained = turn(3, id: "retained")
            _ = try state.settle(token, environment: environment(), conversationID: "conv", payload: page([retained], more: true))
            _ = try state.beginEarlier()
            XCTAssertThrowsError(try state.settle(token, environment: environment(), conversationID: "conv", beforeSeq: 3, payload: payload))
            XCTAssertEqual(state.turns, [retained])
        }
    }
    func testUnavailableConversationIsDifferentFromEmptyHistory() throws {
        var state = ChatState(); let token = state.begin()
        for payload in [conversation(workspace: "foreign"), conversation(kind: "work-item"), .object(["rows": .array([])])] {
            XCTAssertThrowsError(try state.bind(token, environment: environment(), payload: payload))
        }
        _ = try state.bind(token, environment: environment(), payload: conversation())
        _ = try state.settle(token, environment: environment(), conversationID: "conv", payload: page([]))
        XCTAssertTrue(state.ready); XCTAssertTrue(state.turns.isEmpty); XCTAssertNil(state.error)
        state.fail(token, WorkbenchError("offline")); XCTAssertEqual(state.error, "offline")
    }
    func testPuiBridgePreservesLiteralHistoryCursorAndEnvironment() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench chat " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui")
        let script = "#!/bin/sh\ntest \"$1\" = native-read || exit 9\ncat > \"$0.request\"\nprintf '%s' '{\"rows\":[]}'\n"
        try Data(script.utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        for name in ["operatorConversations.current", "operatorTurns.page"] {
            let args: [String: JSONValue] = name == "operatorConversations.current" ? ["workspaceId": .string("selected")] :
                ["conversationId": .string("literal ' $() +/=& λ"), "beforeSeq": .number(17), "limit": .number(200)]
            _ = try await PuiBridge(executable: file).read(name, args: args, environment: environment())
            let request = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request")))
            XCTAssertEqual(request["name"], .string(name)); XCTAssertEqual(request["args"], .object(args))
            XCTAssertEqual(request["environment"], environment())
        }
    }
}
