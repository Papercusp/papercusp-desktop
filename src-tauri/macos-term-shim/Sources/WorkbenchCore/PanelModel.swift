import Foundation

public enum SourceKind: String, CaseIterable, Sendable {
    case plans, agents, reports, goals
    public var model: String {
        switch self { case .plans: return "plans.list"; case .agents: return "advRoster.list"
        case .reports: return "reports.list"; case .goals: return "goals.list" }
    }
}
public struct PanelResult: Equatable, Sendable {
    public let kind: SourceKind
    public let identity: [JSONValue]
    public let title: String
    public let subtitle: String
    public let row: JSONValue
    public init(kind: SourceKind, row: JSONValue) throws {
        self.kind = kind; self.row = row
        func required(_ key: String) throws -> JSONValue {
            guard !row[key].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw WorkbenchError("Missing canonical \(key)")
            }; return row[key]
        }
        switch kind {
        case .plans:
            identity = [.string(kind.rawValue), try required("harness"), try required("slug")]
            title = row["title"].text.isEmpty ? row["slug"].text : row["title"].text
            subtitle = ["status", "harness", "nextAction"].map { row[$0].text }.filter { !$0.isEmpty }.joined(separator: " · ")
        case .agents:
            if row["advSessionId"].positiveID != nil { identity = [.string("agents"), .string("adv"), row["advSessionId"]] }
            else { identity = [.string("agents"), .string("owner"), try required("ownerId")] }
            title = [row["label"].text, row["agent"].text, row["ownerId"].text, "Session"].first { !$0.isEmpty }!
            subtitle = ["intent", "sessionState", "host", "workspaceName"].map { row[$0].text }.filter { !$0.isEmpty }.joined(separator: " · ")
        case .reports:
            identity = [.string("reports"), try required("report_id")]
            title = row["title"].text; subtitle = row["summary"].text
        case .goals:
            identity = [.string("goals"), try required("id")]
            title = row["title"].text.isEmpty ? row["id"].text : row["title"].text
            subtitle = row["effectiveStatus"].text.isEmpty ? row["status"].text : row["effectiveStatus"].text
        }
    }
    public var detailRequest: (String, [String: JSONValue])? {
        switch kind {
        case .plans: return ("plans.get", ["harness": row["harness"], "slug": row["slug"], "mode": .string("full"), "includeRaw": .bool(true)])
        case .reports: return ("reports.get", ["reportId": row["report_id"]])
        case .goals: return ("goals.detail", ["goalId": row["id"]])
        case .agents: return nil
        }
    }
}
/// The GUI's canonical list/detail and saved bulk-run queries, kept separate so
/// an unavailable run cannot erase an otherwise usable question list.
public struct InboxState {
    public private(set) var generation = 0, contextGeneration = 0
    public private(set) var rows: [JSONValue] = [], items: [JSONValue] = []
    public private(set) var listReady = false, listPartial = false, bulkReady = false
    public private(set) var listError: String?, bulkError: String?, contextError: String?
    public private(set) var run: JSONValue = .null
    public private(set) var context: JSONValue?
    public var selection: String?
    public init() {}
    @discardableResult public mutating func begin() -> Int {
        generation += 1; rows = []; items = []; listReady = false; listPartial = false; bulkReady = false
        listError = nil; bulkError = nil; run = .null; clearContext(); return generation
    }
    public mutating func invalidate() { _ = begin() }
    private static func envelope(_ payload: JSONValue?) throws -> [JSONValue] {
        guard let payload, payload["ok"] != .bool(false), let rows = payload["rows"].rows,
              [.null, .bool(false), .string("")].contains(payload["error"]) else {
            throw WorkbenchError("Inbox data is unavailable")
        }; return rows
    }
    @discardableResult public mutating func settleList(_ token: Int, payload: JSONValue?, failure: Error? = nil) -> Bool {
        guard token == generation else { return false }
        do {
            if let failure { throw failure }
            let groups = try Self.envelope(payload)
            var ordered: [JSONValue] = [], seen: [String: JSONValue] = [:]
            var partial = payload?["partial"].isTrue == true
            for group in groups {
                guard let entries = group["items"].rows else { throw WorkbenchError("Inbox group is unavailable") }
                partial = partial || group["_meta"]["hasMore"].isTrue
                for row in entries {
                    let id = row["id"].text
                    guard !id.isEmpty, !row["kind"].text.isEmpty, case .object = row["ref"] else {
                        throw WorkbenchError("Inbox item has no canonical identity")
                    }
                    if let prior = seen[id] {
                        guard prior == row else { throw WorkbenchError("Inbox contains conflicting item identities") }
                    } else { seen[id] = row; ordered.append(row) }
                }
            }
            rows = ordered; listPartial = partial; listReady = true; listError = nil
            if !rows.contains(where: { $0["id"].text == selection }) { selection = nil; clearContext() }
        } catch { rows = []; listReady = false; listError = error.localizedDescription; clearContext() }
        return true
    }
    public func results(query: String) -> [JSONValue] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace })
        return rows.filter { row in
            let text = ["id", "title", "body", "kind", "harnessSlug", "planSlug"].map { row[$0].text }.joined(separator: " ").lowercased()
            return words.allSatisfy { text.contains($0) }
        }
    }
    public mutating func clearContext() { contextGeneration += 1; context = nil; contextError = nil }
    public mutating func select(_ id: String) throws -> Int {
        guard listReady, rows.contains(where: { $0["id"].text == id }) else { throw WorkbenchError("Select a current Inbox item") }
        selection = id; clearContext(); return contextGeneration
    }
    @discardableResult public mutating func settleContext(_ token: Int, id: String, payload: JSONValue?, failure: Error? = nil) -> Bool {
        guard token == contextGeneration, selection == id else { return false }
        do {
            if let failure { throw failure }
            let detail = try Self.envelope(payload)
            guard payload?["partial"].isTrue != true, detail.count == 1, detail[0]["id"].text == id,
                  let selected = rows.first(where: { $0["id"].text == id }),
                  detail[0]["kind"] == selected["kind"], detail[0]["ref"] == selected["ref"] else {
                throw WorkbenchError("The selected question changed or its context is unavailable")
            }; context = detail[0]; contextError = nil
        } catch { context = nil; contextError = error.localizedDescription }
        return true
    }
    @discardableResult public mutating func settleBulk(_ token: Int, payload: JSONValue?, expectedRunID: String? = nil, failure: Error? = nil) -> Bool {
        guard token == generation else { return false }
        do {
            if let failure { throw failure }
            let envelope = try Self.envelope(payload)
            guard payload?["partial"].isTrue != true, envelope.count == 1,
                  case .object(let row) = envelope[0], let run = row["run"], let items = row["items"]?.rows else {
                throw WorkbenchError("The saved bulk run is unavailable")
            }
            if run == .null {
                guard items.isEmpty, expectedRunID == nil else { throw WorkbenchError("The selected saved run is unavailable") }
            } else {
                guard !run["runId"].text.isEmpty, expectedRunID == nil || run["runId"].text == expectedRunID,
                      ["pending", "running", "review", "complete", "failed"].contains(run["phase"].text) else {
                    throw WorkbenchError("The saved bulk run has changed identity or phase")
                }; _ = try Self.counts(run: run, items: items)
            }
            self.run = run; self.items = items; bulkReady = true; bulkError = nil
        } catch { run = .null; items = []; bulkReady = false; bulkError = error.localizedDescription }
        return true
    }
    /// Match use-inbox-bulk-run.ts: outcomes supply numerators; the persisted
    /// total supplies the denominator even while individual rows are arriving.
    public static func counts(run: JSONValue, items: [JSONValue]) throws -> [String: Int] {
        guard case .number(let total) = run["totalItems"], total >= 0, total <= 9_007_199_254_740_991,
              total.rounded() == total, items.count <= Int(total) else { throw WorkbenchError("Invalid bulk total") }
        var counts = Dictionary(uniqueKeysWithValues: ["resolved", "forReview", "recommendationTotal", "pending", "skipped", "failed",
            "legacySkipped", "ownerAction", "cleanupCandidate", "retryNeeded", "routed", "investigate", "dismissed", "decided"].map { ($0, 0) })
        var seen = Set<String>()
        for item in items {
            let id = item["itemId"].text, outcome = item["outcome"].text
            guard !id.isEmpty, seen.insert(id).inserted, item["runId"] == run["runId"],
                  ["pending", "auto_resolved", "recommended", "skipped", "failed", "dismissed"].contains(outcome) else {
                throw WorkbenchError("Bulk item identity or outcome is invalid")
            }
            let disposition = item["disposition"].text
            if let bucket = ["auto_resolved": "resolved", "pending": "pending", "skipped": "skipped", "failed": "failed", "dismissed": "dismissed"][outcome] {
                counts[bucket, default: 0] += 1
            }
            if outcome != "pending" { counts["decided", default: 0] += 1 }
            if outcome == "recommended" {
                counts["recommendationTotal", default: 0] += 1
                if disposition.isEmpty || disposition == "recommended" { counts["forReview", default: 0] += 1 }
            }
            if outcome == "skipped", disposition.isEmpty || disposition == "legacy_skipped" || item["legacyDisposition"].text == "legacy_skipped" {
                counts["legacySkipped", default: 0] += 1
            }
            if let bucket = ["owner_action": "ownerAction", "cleanup_candidate": "cleanupCandidate", "retry_needed": "retryNeeded",
                             "routed": "routed", "investigate": "investigate"][disposition] { counts[bucket, default: 0] += 1 }
        }
        counts["total"] = Int(total); counts["left"] = max(0, Int(total) - counts["decided", default: 0])
        counts["percent"] = total > 0 ? min(100, Int((Double(counts["decided", default: 0]) / total * 100).rounded())) : 0
        counts["unresolved"] = ["forReview", "pending", "ownerAction", "cleanupCandidate", "retryNeeded", "routed", "investigate", "failed"].reduce(0) { $0 + counts[$1, default: 0] }
        return counts
    }
}

public struct PanelSource: Sendable {
    public enum Status: String, Sendable { case loading, ready, unavailable }
    public var status: Status = .loading
    public var rows: [PanelResult] = []
    public var partial = false
    public var error: String?
    public var version: JSONValue = .null
}
public struct PanelModel {
    public var visible = false, pinned = false
    public var query = ""
    public var scope: SourceKind?
    public var selection: [JSONValue]?
    public var detail: JSONValue?
    public private(set) var generation = 0
    public private(set) var sources: [SourceKind: PanelSource] = [:]
    public init() {}
    @discardableResult public mutating func beginRefresh() -> Int {
        generation += 1
        detail = nil
        sources = Dictionary(uniqueKeysWithValues: SourceKind.allCases.map { ($0, PanelSource()) })
        return generation
    }
    @discardableResult public mutating func settle(_ kind: SourceKind, generation: Int,
                                                  payload: JSONValue?, error: Error? = nil) -> Bool {
        guard generation == self.generation else { return false }
        var source = PanelSource()
        do {
            if let error { throw error }
            guard let payload, payload["ok"] != .bool(false), let envelope = payload["rows"].rows,
                  [.null, .bool(false), .string("")].contains(payload["error"]) else {
                throw WorkbenchError("The operator returned no row envelope")
            }
            var rows = envelope
            if kind == .agents || kind == .goals {
                guard envelope.count == 1 else { throw WorkbenchError("Canonical portfolio is unavailable") }
                let aggregate = envelope[0]
                guard let active = aggregate[kind == .agents ? "active" : "goals"].rows else {
                    throw WorkbenchError("Canonical portfolio is unavailable")
                }; rows = active
                if kind == .agents {
                    guard let ended = aggregate["ended"].rows else { throw WorkbenchError("Ended roster is unavailable") }
                    rows += ended.map { item in
                        guard case .object(var row) = item else { return item }
                        row["advSessionId"] = row["id"]; row["ownerId"] = row["coordOwnerId"]
                        row["sessionState"] = .string("ended"); return .object(row)
                    }
                    for tier in ["pending", "starting"] { rows += aggregate[tier].rows ?? [] }
                }
                source.partial = aggregate["partial"].isTrue || aggregate["truncatedByLimit"].isTrue
                for flag in ["degradedFields", "unavailable", "errors"] {
                    if ![.null, .bool(false), .array([]), .object([:]), .string("")].contains(aggregate[flag]) {
                        source.partial = true; source.error = "Some canonical fields are unavailable"
                    }
                }
            }
            source.rows = try rows.map { try PanelResult(kind: kind, row: $0) }
            guard Set(source.rows.map { JSONValue.array($0.identity).formatted }).count == source.rows.count else {
                throw WorkbenchError("The operator returned ambiguous canonical identities")
            }
            source.status = .ready; source.version = payload["version"]
            source.partial = source.partial || payload["partial"].isTrue
        } catch { source.rows = []; source.status = .unavailable; source.error = error.localizedDescription }
        sources[kind] = source; return true
    }
    public func results(limitPerKind: Int = 26) -> [PanelResult] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace })
        return SourceKind.allCases.filter { scope == nil || scope == $0 }.flatMap { kind in
            Array((sources[kind]?.rows ?? []).filter { row in
                let text = ([row.title, row.subtitle, row.row["slug"].text, row.row["ownerId"].text,
                             row.row["currentPlanSlug"].text].joined(separator: " ")).lowercased()
                return words.allSatisfy { text.contains($0) }
            }.prefix(max(0, limitPerKind)))
        }
    }
    public mutating func escape() { if detail != nil { detail = nil } else { visible = false } }
    public mutating func outsideFocus() { if !pinned { visible = false } }
    public static func agentTarget(_ selected: PanelResult, roster: JSONValue, localHost: String, resume: Bool) throws -> PanelResult {
        guard selected.kind == .agents, !localHost.isEmpty else { throw WorkbenchError("Select an exact agent session") }
        let id = selected.row["advSessionId"].positiveID
        let owner = selected.row["ownerId"].text, window = selected.row["windowId"].text
        guard (id != nil || (!resume && !window.isEmpty)), resume || !owner.isEmpty else {
            throw WorkbenchError("The selected row has no exact session identity")
        }
        var model = PanelModel(); let generation = model.beginRefresh()
        model.settle(.agents, generation: generation, payload: roster)
        guard let source = model.sources[.agents], source.status == .ready, !source.partial else {
            throw WorkbenchError("Agent roster is unavailable or incomplete")
        }
        let matches = source.rows.filter {
            id != nil ? $0.row["advSessionId"].positiveID == id :
                ($0.row["ownerId"].text == owner && $0.row["windowId"].text == window)
        }
        guard matches.count == 1 else { throw WorkbenchError("The selected session is unavailable or ambiguous") }
        let target = matches[0]
        func host(_ row: JSONValue) -> String { row["host"].text.isEmpty ? row["hostname"].text : row["host"].text }
        guard !host(target.row).isEmpty, host(target.row) == host(selected.row), target.row["ownerId"].text == owner,
              !target.row["revoked"].isTrue, !target.row["stale"].isTrue else { throw WorkbenchError("The selected session changed; refresh") }
        let state = target.row["sessionState"].text
        if resume {
            guard state == "ended", !target.row["pidAlive"].isTrue,
                  !source.rows.contains(where: { $0.identity != target.identity && !owner.isEmpty &&
                    $0.row["ownerId"].text == owner && ["live", "parked", "starting"].contains($0.row["sessionState"].text) }) else {
                throw WorkbenchError("The selected session is already running")
            }
        } else {
            guard ["live", "parked"].contains(state), selected.row["sessionState"].text != "ended",
                  [.null, .string("")].contains(selected.row["endedAt"]), target.row["isLocal"] != .bool(false),
                  host(target.row).caseInsensitiveCompare(localHost) == .orderedSame,
                  window.isEmpty || target.row["windowId"].text == window else {
                throw WorkbenchError("The exact local terminal is unavailable; use its saved connection")
            }
        }
        return target
    }
    public static func resumeArguments(_ target: PanelResult) throws -> [String] {
        let host = target.row["host"].text.isEmpty ? target.row["hostname"].text : target.row["host"].text
        guard let id = target.row["advSessionId"].positiveID,
              host.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$", options: .regularExpression) != nil else {
            throw WorkbenchError("Missing exact session identity")
        }
        return ["workbench", "resume", String(Int64(id)), host, target.row["ownerId"].text]
    }
    public static func resumeCommand(executable: URL, target: PanelResult, environment: JSONValue) throws -> String {
        guard executable.isFileURL, executable.path.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: executable.path),
              NativeEnvironment.same(environment, environment) else {
            throw WorkbenchError("Select an installed PUI and refresh the selected environment")
        }
        func quote(_ value: String) throws -> String {
            guard !value.utf8.contains(0) else { throw WorkbenchError("Invalid terminal argument") }
            return "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
        }
        let identity = String(decoding: try JSONEncoder().encode(environment), as: UTF8.self)
        let argv = ["/usr/bin/env", "PUI_OPERATOR=" + environment["endpoint"].text,
            "PAPERCUSP_OPERATOR_URL=" + environment["endpoint"].text,
            "PUI_WORKBENCH_EXPECTED_IDENTITY=" + identity, executable.path] + (try resumeArguments(target))
        return "exec " + (try argv.map(quote)).joined(separator: " ")
    }
}

/// Match PUI's BackendIdentity.same_rendezvous. A rebuild can change build.sha
/// without changing the selected store; a different store must never inherit controls.
public enum NativeEnvironment {
    public static func same(_ a: JSONValue, _ b: JSONValue) -> Bool {
        let pairs = [(a["endpoint"], b["endpoint"]), (a["workspaceId"], b["workspaceId"]),
                     (a["store"]["id"], b["store"]["id"]), (a["agentChat"]["scope"], b["agentChat"]["scope"])]
        return pairs.allSatisfy { !$0.0.text.isEmpty && $0.0 == $0.1 }
    }
    public static func one(_ payload: JSONValue) throws -> JSONValue {
        guard payload["ok"] != .bool(false), [.null, .bool(false), .string("")].contains(payload["error"]),
              !payload["partial"].isTrue, let rows = payload["rows"].rows, rows.count == 1,
              case .object = rows[0] else { throw WorkbenchError("Canonical state is unavailable or incomplete") }
        return rows[0]
    }
    public static func identity(_ payload: JSONValue) throws -> JSONValue {
        let value = try one(payload)
        guard same(value, value) else { throw WorkbenchError("Selected environment is unavailable") }
        return value
    }
}

public struct AccountState {
    public private(set) var generation = 0
    public private(set) var busy = false
    public private(set) var environment: JSONValue = .null
    public private(set) var steering: JSONValue = .null
    public private(set) var accounts: [JSONValue] = []
    public private(set) var error: String?
    public var selection: String?
    public var ready: Bool { NativeEnvironment.same(environment, environment) && steering != .null && error == nil }
    public init() {}
    @discardableResult public mutating func begin() -> Int {
        generation += 1; busy = true; error = nil; environment = .null; steering = .null; accounts = []
        return generation
    }
    public mutating func invalidate() { _ = begin(); busy = false }
    private static func validate(_ steering: JSONValue) throws {
        for field in ["forcedAccounts", "excludeAccounts"] {
            guard let items = steering[field].rows, items.allSatisfy({ if case .string = $0 { return true }; return false }) else {
                throw WorkbenchError("Canonical account steering is unavailable")
            }
        }
        guard steering["defaultAccountId"] == .null || { if case .string = steering["defaultAccountId"] { return true }; return false }() else {
            throw WorkbenchError("Canonical default account is unavailable")
        }
    }
    @discardableResult public mutating func settle(_ token: Int, environment: JSONValue,
                                                  pool: JSONValue?, steering: JSONValue?, failure: Error? = nil) -> Bool {
        guard token == generation, busy else { return false }
        busy = false
        do {
            if let failure { throw failure }
            guard NativeEnvironment.same(environment, environment), let pool, let steering,
                  pool["ok"] != .bool(false), [.null, .bool(false), .string("")].contains(pool["error"]),
                  !pool["partial"].isTrue, let accounts = pool["rows"].rows,
                  accounts.allSatisfy({ !$0["id"].text.isEmpty }),
                  Set(accounts.map { $0["id"].text }).count == accounts.count else {
                throw WorkbenchError("Account pool is unavailable, incomplete or ambiguous")
            }
            let current = try NativeEnvironment.one(steering); try Self.validate(current)
            self.environment = environment; self.accounts = accounts; self.steering = current; error = nil
        } catch { self.environment = .null; self.steering = .null; accounts = []; self.error = error.localizedDescription }
        return true
    }
    public mutating func beginAction(_ action: String, accountID: String?) throws -> Int {
        guard ready, !busy, ["default", "force", "exclude", "auto"].contains(action),
              action == "auto" ? accountID == nil : accounts.filter({ $0["id"].text == accountID }).count == 1 else {
            throw WorkbenchError("Refresh Accounts and select an exact account control")
        }
        generation += 1; busy = true; return generation
    }
    @discardableResult public mutating func applied(_ token: Int, expected: JSONValue,
                                                   payload: JSONValue?, failure: Error? = nil) -> Bool {
        guard token == generation, busy else { return false }
        busy = false
        do {
            if let failure { throw failure }
            guard let payload, NativeEnvironment.same(expected, payload["environment"]),
                  NativeEnvironment.same(environment, expected) else {
                throw WorkbenchError("Account environment changed; refresh before applying another control")
            }
            let current = try NativeEnvironment.one(payload); try Self.validate(current)
            steering = current; error = nil
        } catch { self.error = error.localizedDescription + " · Refresh Accounts to verify server state" }
        return true
    }
    public func contains(_ field: String, id: String) -> Bool { steering[field].rows?.contains(.string(id)) == true }
    public func results(query: String) -> [JSONValue] {
        let terms = query.lowercased().split(whereSeparator: { $0.isWhitespace })
        return accounts.filter { row in
            let text = ["id", "label", "provider"].map { row[$0].text }.joined(separator: " ").lowercased()
            return terms.allSatisfy { text.contains($0) }
        }
    }
}

public struct GoalState {
    public private(set) var detail: JSONValue = .null
    public private(set) var environment: JSONValue = .null
    public private(set) var busy = false
    public private(set) var error: String?
    public private(set) var warning: String?
    private var expectedStatus: String?
    public init() {}
    public mutating func clear() { self = GoalState() }
    public static func one(_ payload: JSONValue, goalID: String) throws -> JSONValue {
        let detail = try NativeEnvironment.one(payload)
        guard !goalID.isEmpty, detail["goal"]["id"].text == goalID,
              ["active", "paused", "achieved", "killed"].contains(detail["goal"]["status"].text),
              !detail["effectiveStatus"].text.isEmpty,
              ["held", "unheld", "lost", "unknown"].contains(detail["holderLiveness"].text) else {
            throw WorkbenchError("Selected goal is unavailable or changed")
        }; return detail
    }
    public mutating func load(environment: JSONValue, payload: JSONValue, goalID: String) throws {
        clear()
        guard NativeEnvironment.same(environment, environment) else { throw WorkbenchError("Selected goal environment is unavailable") }
        let detail = try Self.one(payload, goalID: goalID)
        self.detail = detail; self.environment = environment
    }
    public var actions: [String] {
        guard !busy, error == nil, detail != .null, NativeEnvironment.same(environment, environment),
              detail["holderLiveness"].text != "unknown", detail["effectiveStatus"].text != "unknown" else { return [] }
        let status = detail["goal"]["status"].text
        if ["achieved", "killed"].contains(status) { return ["reopen"] }
        if status == "paused" { return ["resume", "achieve", "kill"] }
        let dormant = detail["effectiveStatus"].text == "dormant" || ["unheld", "lost"].contains(detail["holderLiveness"].text)
        return [dormant ? "start" : "pause", "achieve", "kill"]
    }
    public mutating func beginAction(_ action: String) throws {
        guard actions.contains(action) else { throw WorkbenchError("Refresh the selected goal before applying this control") }
        expectedStatus = ["pause":"paused", "resume":"active", "start":"active", "reopen":"active", "achieve":"achieved", "kill":"killed"][action]
        busy = true
    }
    public mutating func applied(_ payload: JSONValue?, failure: Error? = nil) {
        guard busy, let expectedStatus else { return }
        busy = false
        self.expectedStatus = nil
        do {
            if let failure { throw failure }
            guard let payload, NativeEnvironment.same(environment, payload["environment"]) else {
                throw WorkbenchError("Goal environment changed")
            }
            let next = try Self.one(payload, goalID: detail["goal"]["id"].text)
            guard next["goal"]["status"].text == expectedStatus else {
                throw WorkbenchError("The goal request returned without a confirmed resulting state")
            }
            detail = next; error = nil
            warning = payload["degraded"].isTrue ? "Goal action was incomplete. " +
                (payload["degradedReasons"].rows ?? []).map { $0.text }.joined(separator: " · ") : nil
        } catch { self.error = error.localizedDescription + " · Refresh Goals to verify server state" }
    }
}

/// Preserve canonical prose instead of exposing transport envelopes in the reader.
public enum NativeDocument {
    public static func markdown(_ payload: JSONValue) -> String {
        guard let rows = payload["rows"].rows else { return "Content unavailable" }
        return rows.map { row in
            for field in ["body_md", "content", "markdown", "body"] { if case .string(let text) = row[field] { return text } }
            if row["goal"] != .null {
                let goal = row["goal"]
                let title = goal["title"].text.isEmpty ? goal["id"].text : goal["title"].text
                var lines = [title, "Status: " + goal["status"].text, "Effective state: " + row["effectiveStatus"].text,
                             "Holder: " + row["holderLiveness"].text]
                // Missing measurements stay unknown, never zero.
                for (field, label) in [("spentCents", "Goal-attributed spend"), ("budgetCents", "Cap")] {
                    let value = goal[field]
                    let amount: String
                    if case .number(let cents) = value, cents.isFinite { amount = String(format: "$%.2f", cents / 100) }
                    else { amount = "Unknown" }
                    lines.append(label + ": " + amount)
                }
                if !goal["spentCentsScope"].text.isEmpty { lines.append("Spend scope: " + goal["spentCentsScope"].text) }
                if !row["spendNote"].text.isEmpty { lines.append(row["spendNote"].text) }
                if !goal["description"].text.isEmpty { lines.append(goal["description"].text) }
                return lines.joined(separator: "\n\n")
            }
            return "Content unavailable"
        }.joined(separator: "\n\n")
    }
}
