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
    private var drafts: [String: String] = [:]
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
        set { if let key = draftKey { drafts[key] = newValue } }
    }
    @discardableResult public mutating func begin() -> Int {
        generation += 1; loading = true; loaded = false; error = nil
        environment = .null; conversation = .null; turns = []; hasMoreEarlier = false; reply = nil
        return generation
    }
    public mutating func invalidate() { _ = begin(); loading = false }
    @discardableResult public mutating func bind(_ token: Int, environment: JSONValue, payload: JSONValue) throws -> Bool {
        guard token == generation else { return false }
        let row = try NativeEnvironment.one(payload)
        guard NativeEnvironment.same(environment, environment), !row["id"].text.isEmpty,
              row["workspaceId"] == environment["workspaceId"], row["subjectKind"].text == "global",
              row["status"].text == "active" else { throw WorkbenchError("The active Papercup conversation is unavailable") }
        self.environment = environment; conversation = row
        return true
    }
    public mutating func beginEarlier() throws -> Double {
        guard ready, !loading, reply == nil, hasMoreEarlier, let cursor = turns.first?["seq"].sequence else {
            throw WorkbenchError("Earlier messages are unavailable")
        }
        loading = true; error = nil; return cursor
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
    public mutating func send() throws -> JSONValue {
        guard canSend else { throw WorkbenchError("Load the conversation and enter a message first") }
        let next = NativeChatReply(environment: environment, conversationID: conversationID, text: draft)
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
    public var markdown: String {
        turns.map { row in
            let title = row["role"].text == "user" ? "You" : row["role"].text.capitalized
            return "### " + title + "\n\n" + row["text"].text
        }.joined(separator: "\n\n")
    }
}

/// Native projection of chat-protocol v1. Persistence stays on the operator.
public struct NativeChatReply {
    public let environment: JSONValue, conversationID: String, text: String
    public let userTurnID: String
    public private(set) var turnID = "", sequence: Double = 0
    public private(set) var savedUser: JSONValue = .null
    public private(set) var phase = "connecting", complete = false, connected = true
    public private(set) var displayText = "", tools: [String] = []
    private var events: [Double: JSONValue] = [:]
    private var raw = ""
    public init(environment: JSONValue, conversationID: String, text: String) {
        self.environment = environment; self.conversationID = conversationID; self.text = text
        userTurnID = UUID().uuidString.lowercased()
    }
    public var sendRequest: JSONValue { .object(["environment": environment, "conversationId": .string(conversationID),
        "operation": .string("send"), "text": .string(text), "userTurnId": .string(userTurnID)]) }
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

private extension JSONValue {
    var sequence: Double? {
        if case .number(let value) = self, value.isFinite, value >= 0,
           value <= 9007199254740991, value.rounded() == value { return value }
        return nil
    }
}
