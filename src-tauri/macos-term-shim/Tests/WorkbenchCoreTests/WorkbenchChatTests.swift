import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchChatTests: XCTestCase {
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
