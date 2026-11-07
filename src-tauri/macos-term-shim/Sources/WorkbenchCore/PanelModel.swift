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
        case .plans: return ("plans.get", ["harness": row["harness"], "slug": row["slug"]])
        case .reports: return ("reports.get", ["reportId": row["report_id"]])
        case .goals: return ("goals.detail", ["goalId": row["id"]])
        case .agents: return nil
        }
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
}
