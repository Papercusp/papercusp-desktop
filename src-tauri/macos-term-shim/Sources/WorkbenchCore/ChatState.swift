import Foundation

/// UI state over the canonical operator conversation. Only drafts live here;
/// conversation identity and transcript pages always come from PUI.
public struct ChatState {
    public private(set) var generation = 0
    public private(set) var environment: JSONValue = .null
    public private(set) var conversation: JSONValue = .null
    public private(set) var turns: [JSONValue] = []
    public private(set) var loading = false
    public private(set) var loaded = false
    public private(set) var hasMoreEarlier = false
    public private(set) var error: String?
    public private(set) var reply: NativeChatReply?
    public private(set) var referencePlans: [PanelResult] = []
    public private(set) var referencePlan: Int?
    public private(set) var referenceError: String?
    private var referenceChoice: (environment: JSONValue, conversationID: String, identity: [JSONValue])?
    public enum VoicePhase { case permission, recording, transcribing, synthesizing, playing }
    public private(set) var voicePhase: VoicePhase?
    private var voice: (id: UUID, generation: Int, environment: JSONValue, conversationID: String, draft: String)?
    private var drafts: [String: String] = [:]
    private var draftModalities: [String: String] = [:]
    public init() {}
    public var conversationID: String { conversation["id"].text }
    public var ready: Bool { loaded && !conversationID.isEmpty && NativeEnvironment.same(environment, environment) }
    private var draftKey: String? {
        guard !conversationID.isEmpty, NativeEnvironment.same(environment, environment) else { return nil }
        return JSONValue.array([environment["endpoint"], environment["workspaceId"], environment["store"]["id"],
            environment["agentChat"]["scope"], conversation["id"]]).formatted
    }
    public var draft: String {
        get { draftKey.flatMap { drafts[$0] } ?? "" }
        set {
            if let key = draftKey {
                if drafts[key] != newValue { draftModalities[key] = "text"; cancelVoice() }
                drafts[key] = newValue
            }
        }
    }
    @discardableResult public mutating func begin() -> Int {
        cancelVoice()
        generation += 1; loading = true; loaded = false; error = nil
        environment = .null; conversation = .null; turns = []; hasMoreEarlier = false; reply = nil
        referencePlans = []; referencePlan = nil; referenceError = nil
        return generation
    }
    public mutating func invalidate() { _ = begin(); loading = false; referenceChoice = nil }
    @discardableResult public mutating func bind(_ token: Int, environment: JSONValue, payload: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        let row = try NativeEnvironment.one(payload)
        guard NativeEnvironment.same(environment, environment), !row["id"].text.isEmpty,
              row["workspaceId"] == environment["workspaceId"], row["subjectKind"].text == "global",
              row["status"].text == "active" else { throw WorkbenchError("The active Papercup conversation is unavailable") }
        if let choice = referenceChoice,
           !NativeEnvironment.same(choice.environment, environment) || choice.conversationID != row["id"].text {
            referenceChoice = nil
        }
        self.environment = environment; conversation = row
        return true
    }
    public mutating func beginEarlier() throws -> Double {
        guard ready, !loading, reply == nil, hasMoreEarlier, let cursor = turns.first?["seq"].sequence else {
            throw WorkbenchError("Earlier messages are unavailable")
        }
        cancelVoice(); loading = true; error = nil; return cursor
    }
    @discardableResult public mutating func settle(_ token: Int, environment: JSONValue, conversationID: String,
                                                  beforeSeq: Double? = nil, payload: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        guard loading, NativeEnvironment.same(self.environment, environment), self.conversationID == conversationID,
              !conversationID.isEmpty else { throw WorkbenchError("The selected Papercup conversation changed") }
        let page = try NativeEnvironment.one(payload)
        guard let rows = page["turns"].rows, case .bool(let hasMore) = page["hasMoreEarlier"],
              !(hasMore && rows.isEmpty) else { throw WorkbenchError("Papercup history is incomplete") }
        var previous: Double?, ids = Set<String>()
        for row in rows {
            guard !row["id"].text.isEmpty, ids.insert(row["id"].text).inserted,
                  row["conversationId"].text == conversationID, let seq = row["seq"].sequence,
                  previous.map({ seq > $0 }) ?? true,
                  ["user", "assistant", "system", "tool"].contains(row["role"].text),
                  case .string = row["text"] else { throw WorkbenchError("Papercup history contains an invalid or foreign message") }
            if let beforeSeq, seq >= beforeSeq { throw WorkbenchError("Earlier messages did not advance") }
            previous = seq
        }
        if let beforeSeq {
            guard loaded, turns.first?["seq"].sequence == beforeSeq,
                  Set(turns.map { $0["id"].text }).isDisjoint(with: ids) else {
                throw WorkbenchError("Earlier messages changed; refresh the conversation")
            }
            turns = rows + turns
        } else {
            guard !loaded else { throw WorkbenchError("History was already loaded") }
            turns = rows
        }
        hasMoreEarlier = hasMore; loading = false; loaded = true; error = nil
        return true
    }
    public mutating func fail(_ token: Int, _ failure: Error) {
        guard token == generation else { return }
        loading = false; error = failure.localizedDescription
    }
    public var canSend: Bool { ready && !loading && (reply == nil || reply?.complete == true) && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    public var canUseVoice: Bool { ready && !loading && (reply == nil || reply?.complete == true) }
    public var spokenReply: String {
        if let reply, reply.phase == "completed", !reply.displayText.isEmpty { return reply.displayText }
        return turns.last(where: { $0["role"].text == "assistant" })?["text"].text ?? ""
    }
    /// Permission, device and transport callbacks retain one identity. Edits,
    /// dismissal and reload retire it before any late callback can take effect.
    public mutating func beginVoice(_ phase: VoicePhase) throws -> UUID {
        guard canUseVoice, voice == nil, phase == .permission || phase == .synthesizing else {
            throw WorkbenchError("Load the conversation and finish the current voice operation first")
        }
        let id = UUID()
        voice = (id, generation, environment, conversationID, draft); voicePhase = phase
        return id
    }
    public func voiceCurrent(_ id: UUID) -> Bool {
        guard let voice else { return false }
        return voice.id == id && voice.generation == generation && canUseVoice &&
            NativeEnvironment.same(voice.environment, environment) && voice.conversationID == conversationID && voice.draft == draft
    }
    @discardableResult public mutating func advanceVoice(_ id: UUID, to phase: VoicePhase) -> Bool {
        guard voiceCurrent(id) else { return false }
        switch (voicePhase, phase) {
        case (.permission?, .recording), (.recording?, .transcribing), (.synthesizing?, .playing), (.playing?, .synthesizing):
            voicePhase = phase; return true
        default: return false
        }
    }
    public mutating func cancelVoice() { voice = nil; voicePhase = nil }
    /// Late transcription never overwrites another conversation or a newer edit.
    @discardableResult public mutating func transcribed(_ token: Int, environment: JSONValue, conversationID: String,
                                                       expectedDraft: String, text: String) throws -> Bool {
        guard token == generation else { return false }
        guard ready, !loading, NativeEnvironment.same(self.environment, environment), self.conversationID == conversationID,
              draft == expectedDraft, reply == nil || reply?.complete == true, let key = draftKey else {
            throw WorkbenchError("The conversation or draft changed while recording; the transcript was not applied")
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= 32 * 1024 else {
            throw WorkbenchError("No speech was recognized; your draft was preserved")
        }
        drafts[key] = text; draftModalities[key] = "voice"; return true
    }
    public mutating func send() throws -> JSONValue {
        guard canSend else { throw WorkbenchError("Load the conversation and enter a message first") }
        cancelVoice()
        let next = NativeChatReply(environment: environment, conversationID: conversationID, text: draft,
            modality: draftKey.flatMap { draftModalities[$0] } ?? "text")
        reply = next; error = nil; return next.sendRequest
    }
    @discardableResult public mutating func receive(_ token: Int, _ frame: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        guard var next = reply else { throw WorkbenchError("No reply is active") }
        try next.receive(frame)
        if !next.savedUser["id"].text.isEmpty, !turns.contains(where: { $0["id"] == next.savedUser["id"] }) {
            turns.append(next.savedUser)
            if draft == next.text { draft = "" }
        }
        reply = next; error = nil; return true
    }
    public mutating func replyFailed(_ token: Int, _ failure: Error) {
        guard token == generation else { return }
        reply?.disconnected(); error = failure.localizedDescription
    }
    /// Explicit fallback context for ambiguous refs. It changes only link
    /// routing, never the conversation or send target.
    @discardableResult public mutating func settleReferencePlans(_ token: Int, environment: JSONValue,
                                                                payload: JSONValue?, failure: Error? = nil) -> Bool {
        guard token == generation, ready, NativeEnvironment.same(self.environment, environment) else { return false }
        do {
            if let failure { throw failure }
            guard let payload, payload["ok"] != .bool(false), [.null, .bool(false), .string("")].contains(payload["error"]),
                  !payload["partial"].isTrue, NativeEnvironment.same(environment, payload["environment"]),
                  let rows = payload["rows"].rows else { throw WorkbenchError("Work link contexts are unavailable") }
            let plans = try rows.map { try PanelResult(kind: .plans, row: $0) }
            guard Set(plans.map { $0.identity.map(\.text) }).count == plans.count else {
                throw WorkbenchError("Work link contexts contain duplicate plans")
            }
            // Refreshes (including reply completion) may reorder this list.
            // Restore only an explicit choice that the new canonical list
            // still offers in this exact conversation and rendezvous.
            referencePlans = plans; referencePlan = nil; referenceError = nil
            if let choice = referenceChoice,
               NativeEnvironment.same(choice.environment, environment), choice.conversationID == conversationID {
                referencePlan = plans.firstIndex { $0.identity == choice.identity }
            }
            if referencePlan == nil { referenceChoice = nil }
        } catch {
            referencePlans = []; referencePlan = nil; referenceChoice = nil; referenceError = error.localizedDescription
        }
        return true
    }
    public mutating func selectReferencePlan(_ index: Int?) throws {
        guard ready, index == nil || referencePlans.indices.contains(index!) else {
            throw WorkbenchError("Select a current work link context")
        }
        referencePlan = index
        if let index { referenceChoice = (environment, conversationID, referencePlans[index].identity) }
        else { referenceChoice = nil }
    }
    public func linkedText(_ text: String, plan: String? = nil) -> String {
        guard ready else { return text }
        let selected = referencePlan.map { referencePlans[$0] }
        return NativeWorkRefs.markdown(text, environment: environment,
            harness: selected?.row["harness"].text ?? conversation["harnessSlug"].text,
            plan: plan ?? selected?.row["slug"].text)
    }
    public var markdown: String {
        turns.map { row in
            let title = row["role"].text == "user" ? "You" : row["role"].text.capitalized
            let plan = row["planSlug"].text
            return "### " + title + "\n\n" + linkedText(row["text"].text, plan: plan.isEmpty ? nil : plan)
        }.joined(separator: "\n\n")
    }
}

/// Native projection of chat-protocol v1. Persistence stays on the operator.
public struct NativeChatReply {
    public let environment: JSONValue, conversationID: String, text: String
    public let modality: String
    public let userTurnID: String
    public private(set) var turnID = "", sequence: Double = 0
    public private(set) var savedUser: JSONValue = .null
    public private(set) var phase = "connecting", complete = false, connected = true
    public private(set) var displayText = "", tools: [String] = []
    private var events: [Double: JSONValue] = [:]
    private var raw = ""
    public init(environment: JSONValue, conversationID: String, text: String, modality: String = "text") {
        self.environment = environment; self.conversationID = conversationID; self.text = text
        self.modality = modality
        userTurnID = UUID().uuidString.lowercased()
    }
    public var sendRequest: JSONValue { .object(["environment": environment, "conversationId": .string(conversationID),
        "operation": .string("send"), "text": .string(text), "userTurnId": .string(userTurnID), "modality": .string(modality)]) }
    public func control(_ operation: String) throws -> JSONValue {
        guard ["reconnect", "cancel"].contains(operation), !turnID.isEmpty, !complete else {
            throw WorkbenchError("The saved reply identity is unavailable; refresh before sending again")
        }
        var body: [String: JSONValue] = ["environment": environment, "conversationId": .string(conversationID),
            "operation": .string(operation), "turnId": .string(turnID)]
        if operation == "reconnect" { body["afterSequence"] = .number(sequence) }
        return .object(body)
    }
    public mutating func disconnected() { connected = false; if !complete { phase = "needs-reconciliation" } }
    private func matches(_ value: JSONValue) -> Bool {
        value["conversationId"].text == conversationID && !turnID.isEmpty && value["turnId"].text == turnID
    }
    private func state(_ value: JSONValue) throws -> String {
        let phases = ["running", "awaiting-input", "completed", "failed", "cancelled", "interrupted", "needs-reconciliation"]
        let capabilities = ["connectionReplay", "persistedHistory", "persistedInteractionDecisions", "completedToolCheckpoints", "interruptedTurnRecovery"]
        guard value["schemaVersion"] == .number(1), matches(value), value["revision"].sequence != nil,
              value["lastSequence"].sequence != nil, phases.contains(value["phase"].text),
              capabilities.allSatisfy({ if case .bool = value["capabilities"][$0] { return true }; return false }) else {
            throw WorkbenchError("Invalid saved reply state")
        }
        return value["phase"].text
    }
    public mutating func receive(_ frame: JSONValue) throws {
        var next = self; try next.reduce(frame); self = next
    }
    private mutating func reduce(_ frame: JSONValue) throws {
        guard NativeEnvironment.same(environment, frame["environment"]), !complete else {
            throw WorkbenchError("The reply belongs to a different environment or is already complete")
        }
        let data = frame["data"]
        switch frame["event"].text {
        case "user-saved":
            let row = data["turn"]
            guard data["conversationId"].text == conversationID, row["conversationId"].text == conversationID,
                  row["id"].text == userTurnID, row["role"].text == "user", row["text"].text == text,
                  row["seq"].sequence != nil else { throw WorkbenchError("Invalid saved message acknowledgement") }
            savedUser = row
        case "run-meta":
            guard data["chatProtocolVersion"] == .number(1), data["conversationId"].text == conversationID else {
                throw WorkbenchError("Unsupported reply protocol or conversation")
            }
        case "turn-meta":
            guard data["schemaVersion"] == .number(1), data["conversationId"].text == conversationID,
                  UUID(uuidString: data["turnId"].text) != nil,
                  turnID.isEmpty || data["turnId"].text == turnID else { throw WorkbenchError("Invalid reply identity") }
            turnID = data["turnId"].text; phase = "running"
        case "chat-event":
            guard data["schemaVersion"] == .number(1), matches(data), let next = data["sequence"].sequence,
                  next > 0, !data["eventId"].text.isEmpty else { throw WorkbenchError("Invalid saved reply event") }
            if next <= sequence {
                guard events[next] == data else { throw WorkbenchError("Conflicting saved reply event") }; return
            }
            guard next == sequence + 1 else { throw WorkbenchError("The saved reply has a sequence gap") }
            let event = data["event"], kind = event["type"].text
            switch kind {
            case "delta":
                guard case .string(let delta) = event["text"], raw.utf8.count + delta.utf8.count <= 8 * 1024 * 1024 else {
                    throw WorkbenchError("Invalid or oversized reply text")
                }
                raw += delta; projectSay()
            case "tool_call", "tool_result":
                guard !event["name"].text.isEmpty, !event["callId"].text.isEmpty else { throw WorkbenchError("Invalid tool activity") }
                if kind == "tool_result", case .bool = event["ok"] {} else if kind == "tool_result" { throw WorkbenchError("Invalid tool result") }
                tools.append(event["name"].text + (kind == "tool_call" ? " · running" : event["ok"].isTrue ? " · complete" : " · failed"))
            case "error": throw WorkbenchError(event["message"].text.isEmpty ? "Reply failed" : event["message"].text)
            case "lifecycle":
                guard ["running", "awaiting-input", "completed", "failed", "cancelled", "interrupted", "needs-reconciliation"].contains(event["phase"].text) else { throw WorkbenchError("Invalid reply lifecycle") }
                phase = event["phase"].text
            case "done", "session", "provenance", "result": break
            default: throw WorkbenchError("Unsupported saved reply event")
            }
            sequence = next; events[next] = data
            if events.count > 5000 { events.removeValue(forKey: next - 5000) }
        case "turn-state":
            let next = try state(data)
            guard !["failed", "cancelled", "interrupted", "needs-reconciliation"].contains(next) else {
                throw WorkbenchError("The saved reply is " + next)
            }
            phase = next
        case "done":
            let receipt = data["persistedTurn"]
            guard matches(receipt), receipt["seq"].sequence != nil,
                  data["phase"] == .null || data["phase"].text == "completed" else {
                throw WorkbenchError("The saved reply acknowledgement was lost or does not match")
            }
            complete = true; connected = false; phase = "completed"
        case "cancelled":
            guard data["ok"].isTrue, try state(data["state"]) == "cancelled" else { throw WorkbenchError("Reply cancellation needs reconciliation") }
            complete = true; connected = false; phase = "cancelled"
        case "error": throw WorkbenchError(data["message"].text.isEmpty ? "Reply failed; reconcile before sending again" : data["message"].text)
        default: throw WorkbenchError("Unsupported reply frame")
        }
    }
    private mutating func projectSay() {
        guard let open = raw.range(of: "<say>", options: .caseInsensitive) else { return }
        let body = String(raw[open.upperBound...])
        if let close = body.range(of: "</say>", options: .caseInsensitive) {
            displayText = String(body[..<close.lowerBound]); return
        }
        let close = "</say>"
        if !body.isEmpty {
            for n in stride(from: min(body.count, close.count - 1), through: 1, by: -1) {
                if body.lowercased().hasSuffix(String(close.prefix(n))) { displayText = String(body.dropLast(n)); return }
            }
        }
        displayText = body
    }
}

/// A card is a projection of a canonical snapshot, never a local approval.
public struct NativeCard: Equatable {
    public let runID: String, raw: JSONValue
    public var id: String { raw["correlationId"].text }
    public var kind: String { raw["presentation"]["kind"].text }
    public var options: [JSONValue] { raw["presentation"]["options"].rows ?? [] }
    public var canSubmit: Bool { ["radio", "checkbox", "select", "text", "date", "slider"].contains(kind) }
    public var prose: String {
        var parts = [raw["prompt"].text, raw["approval"]["title"].text]
        parts += raw["approval"]["body"].rows?.map { $0.text } ?? []
        parts += [raw["approval"]["question"].text, raw["report"]["title"].text]
        for plan in raw["report"]["plans"].rows ?? [] {
            parts += [plan["title"].text.isEmpty ? plan["slug"].text : plan["title"].text, plan["status"].text, plan["summary"].text]
            for item in plan["items"].rows ?? [] {
                parts.append([item["id"].text, item["text"].text, item["status"].text, item["ref"].text].filter { !$0.isEmpty }.joined(separator: " · "))
            }
        }
        return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
    public func secureLink(environment: JSONValue) -> URL? {
        let allowed = id.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 46 }
        let path = "/api/ui/cards/" + id + "/link"
        guard allowed, !id.isEmpty, raw["presentation"]["link"].text == path,
              NativeEnvironment.same(environment, environment),
              var url = URLComponents(string: environment["endpoint"].text),
              ["http", "https"].contains(url.scheme ?? ""), url.host != nil, url.user == nil, url.password == nil else { return nil }
        url.path = path; url.query = nil; url.fragment = nil; return url.url
    }
    public func answer(picks: [String] = [], value: String = "") throws -> JSONValue {
        let presentation = raw["presentation"]
        switch kind {
        case "radio", "checkbox", "select":
            let allowed = Set(options.map { $0["id"].text })
            let minimum = presentation["allowEmpty"].isTrue ? 0 : 1
            let maximum = kind == "checkbox" ? options.count : 1
            guard picks.count >= minimum, picks.count <= maximum, Set(picks).count == picks.count,
                  picks.allSatisfy({ allowed.contains($0) }) else { throw WorkbenchError("Choose the available answers") }
            return .object(["picks": .array(picks.map(JSONValue.string))])
        case "text":
            guard presentation["allowEmpty"].isTrue || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value.utf8.count <= 32 * 1024 else { throw WorkbenchError("Enter a bounded answer") }
            return .object(["value": .string(value)])
        case "date":
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
            let minimum = presentation["min"].text, maximum = presentation["max"].text
            guard let date = formatter.date(from: value), formatter.string(from: date) == value,
                  minimum.isEmpty || value >= minimum, maximum.isEmpty || value <= maximum else {
                throw WorkbenchError("Choose a date within the displayed range")
            }
            return .object(["value": .string(value)])
        case "slider":
            guard let number = Double(value), number.isFinite,
                  case .number(let minimum) = presentation["min"], case .number(let maximum) = presentation["max"],
                  number >= minimum, number <= maximum else { throw WorkbenchError("Choose a value within the displayed range") }
            let step: Double
            if case .number(let n) = presentation["step"] { step = n } else { step = 1 }
            guard step.isFinite, step > 0, abs((number - minimum) / step - ((number - minimum) / step).rounded()) < 0.000001 else {
                throw WorkbenchError("Choose a value on the displayed steps")
            }
            return .object(["value": .number(number)])
        default: throw WorkbenchError("This question cannot be answered on this surface")
        }
    }
}

public struct NativeCardsState {
    public private(set) var generation = 0
    public private(set) var environment: JSONValue = .null
    public private(set) var conversationID = ""
    public private(set) var connected = false
    public private(set) var error: String?
    public private(set) var pending: String?
    private var runs: [String: [NativeCard]] = [:]
    private var snapshots: [String: JSONValue] = [:]
    private var acknowledged = Set<String>()
    public init() {}
    public var cards: [NativeCard] {
        runs.values.flatMap { $0 }.filter { !acknowledged.contains($0.id) }.sorted {
            let lhs = $0.raw["createdAt"].sequence ?? 0, rhs = $1.raw["createdAt"].sequence ?? 0
            return lhs == rhs ? $0.id < $1.id : lhs < rhs
        }
    }
    @discardableResult public mutating func begin(environment: JSONValue, conversationID: String) -> Int {
        generation += 1; self.environment = environment; self.conversationID = conversationID
        connected = false; error = nil; pending = nil; runs = [:]; snapshots = [:]; acknowledged = []
        return generation
    }
    public var subscription: JSONValue { .object(["environment": environment, "conversationId": .string(conversationID),
        "operation": .string("subscribe")]) }
    @discardableResult public mutating func receive(_ token: Int, _ frame: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        guard !conversationID.isEmpty, NativeEnvironment.same(environment, frame["environment"]),
              frame["data"]["workspaceId"] == environment["workspaceId"] else { throw WorkbenchError("The card environment changed") }
        let data = frame["data"]
        if frame["event"].text == "reset" {
            runs = [:]; snapshots = [:]; connected = true; return true
        }
        guard frame["event"].text == "snapshot", !data["runId"].text.isEmpty,
              let version = data["version"].sequence, let rows = data["snapshot"]["openCards"].rows else {
            throw WorkbenchError("The card snapshot is unavailable")
        }
        let run = data["runId"].text
        if let prior = snapshots[run], let before = prior["version"].sequence, before >= version {
            if before == version && prior != data { throw WorkbenchError("Conflicting card snapshot") }
            return false
        }
        var ids = Set<String>(), next: [NativeCard] = []
        for row in rows {
            guard row["conversationId"].text == conversationID, !row["correlationId"].text.isEmpty,
                  ids.insert(row["correlationId"].text).inserted,
                  !row["prompt"].text.isEmpty else { throw WorkbenchError("A card has an invalid or foreign identity") }
            let card = NativeCard(runID: run, raw: row)
            if ["radio", "checkbox", "select"].contains(card.kind) {
                let options = card.options, optionIDs = options.map { $0["id"].text }
                guard !options.isEmpty, !optionIDs.contains(""), Set(optionIDs).count == options.count,
                      options.allSatisfy({ !$0["label"].text.isEmpty }) else { throw WorkbenchError("Card choices are incomplete") }
            }
            next.append(card)
        }
        let otherIDs = Set(runs.filter { $0.key != run }.values.flatMap { $0 }.map { $0.id })
        guard otherIDs.isDisjoint(with: ids) else { throw WorkbenchError("A card belongs to multiple runs") }
        runs[run] = next; snapshots[run] = data; connected = true
        return true
    }
    public mutating func request(_ card: NativeCard, action: String, payload: JSONValue = .null) throws -> JSONValue {
        guard connected, pending == nil, cards.contains(card), NativeEnvironment.same(environment, environment),
              ["submit", "decline", "cancel"].contains(action),
              action != "submit" || card.canSubmit,
              action != "decline" || card.raw["allowDecline"] != .bool(false) else {
            throw WorkbenchError("This question changed or is unavailable; reconnect before answering")
        }
        pending = card.id; error = nil
        var body: [String: JSONValue] = ["environment": environment, "conversationId": .string(conversationID),
            "operation": .string("respond"), "correlationId": .string(card.id), "action": .string(action)]
        if action == "submit" { body["payload"] = payload }
        return .object(body)
    }
    @discardableResult public mutating func responded(_ token: Int, id: String, receipt: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        let row = try NativeEnvironment.one(receipt)
        guard pending == id, NativeEnvironment.same(environment, receipt["environment"]), row["responded"].isTrue,
              row["conversationId"].text == conversationID, row["correlationId"].text == id else {
            throw WorkbenchError("The question response needs reconciliation")
        }
        acknowledged.insert(id); pending = nil; error = nil; return true
    }
    public mutating func responseFailed(_ token: Int, _ failure: Error) {
        guard token == generation else { return }; pending = nil; error = failure.localizedDescription
    }
    public mutating func disconnected(_ token: Int, _ failure: Error) {
        guard token == generation else { return }; connected = false; error = failure.localizedDescription
    }
}

private extension JSONValue {
    var sequence: Double? {
        if case .number(let value) = self, value.isFinite, value >= 0,
           value <= 9007199254740991, value.rounded() == value { return value }
        return nil
    }
}
