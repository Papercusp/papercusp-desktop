import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchAgentTests: XCTestCase {
    func testOrganizerConvertsWorkAreasAcrossNegativeAndUpperDisplays() {
        let lower = OrganizerRect(x: -1600, y: -900, width: 1600, height: 860)
        XCTAssertEqual(OrganizerGeometry.topLeft(lower, primaryTop: 1080),
            OrganizerRect(x: -1600, y: 1120, width: 1600, height: 860))
        let upper = OrganizerRect(x: 0, y: 1080, width: 1920, height: 1200)
        XCTAssertEqual(OrganizerGeometry.topLeft(upper, primaryTop: 1080),
            OrganizerRect(x: 0, y: -1200, width: 1920, height: 1200))
    }
    func testOrganizerUsesLargestDisplayIntersectionAndRefusesAmbiguity() {
        let left = OrganizerDisplay(id: "left", frame: OrganizerRect(x: -1000, y: 0, width: 1000, height: 800),
            workArea: OrganizerRect(x: -1000, y: 24, width: 1000, height: 740))
        let right = OrganizerDisplay(id: "right", frame: OrganizerRect(x: 0, y: 0, width: 1000, height: 800),
            workArea: OrganizerRect(x: 0, y: 24, width: 1000, height: 740))
        let displays = [left, right]
        XCTAssertEqual(OrganizerGeometry.display(for: OrganizerRect(x: -100, y: 40, width: 600, height: 300), displays: displays)?.id, "right")
        XCTAssertEqual(OrganizerGeometry.display(for: OrganizerRect(x: -900, y: 40, width: 600, height: 300), displays: displays)?.workArea, left.workArea)
        for rect in [OrganizerRect(x: -300, y: 40, width: 600, height: 300),
                     OrganizerRect(x: 2000, y: 0, width: 100, height: 100),
                     OrganizerRect(x: 0, y: 0, width: .nan, height: 100)] {
            XCTAssertNil(OrganizerGeometry.display(for: rect, displays: displays))
        }
    }
    private func organizerAgent(_ id: Int, _ changes: [String: JSONValue] = [:]) throws -> PanelResult {
        var row: [String: JSONValue] = ["advSessionId": .number(Double(id)), "ownerId": .string("owner-\(id)"),
            "host": .string("mac"), "sessionState": .string("live"), "windowId": .string("\(id)"),
            "currentPlanSlug": .string("plan"), "potSlug": .string("pot"), "fleetSlug": .string("fleet")]
        row.merge(changes) { _, next in next }
        return try PanelResult(kind: .agents, row: .object(row))
    }
    private func roster(_ rows: [PanelResult], _ fields: [String: JSONValue] = [:]) -> JSONValue {
        var aggregate: [String: JSONValue] = ["active": .array(rows.map(\.row)), "ended": .array([])]
        aggregate.merge(fields) { _, next in next }
        return .object(["rows": .array([.object(aggregate)])])
    }
    private func organizerWindow(_ id: String, desktop: String = "current", monitor: String = "display-1",
        bounds: OrganizerRect? = nil, unsupported: String? = nil) -> OrganizerWindow {
        OrganizerWindow(id: id, title: "terminal [adv:\(id)]", desktop: desktop, monitor: monitor,
            area: OrganizerRect(x: 0, y: 0, width: 1000, height: 800), bounds: bounds, unsupported: unsupported)
    }
    func testOrganizerUsesQualifiedPlansFleetsAndCanonicalGoalLinks() throws {
        let a = try organizerAgent(1), b = try organizerAgent(2, ["potSlug": .string("other")])
        let groups = try PanelModel.organizerGroups(kind: "plan", agents: [a, b], goals: [])
        XCTAssertEqual(groups.count, 2); XCTAssertNotEqual(groups[0].key, groups[1].key)
        XCTAssertEqual(try PanelModel.organizerMembers(groups[0], roster: roster([a, b])), [a])
        XCTAssertEqual(try PanelModel.organizerGroups(kind: "fleet", agents: [a, b], goals: []).first?.members.count, 2)
        let goal = try PanelResult(kind: .goals, row: .object(["id": .string("goal"), "title": .string("Goal")]))
        let group = try XCTUnwrap(PanelModel.organizerGroups(kind: "goal", agents: [], goals: [goal]).first)
        let detail = try json("{\"rows\":[{\"goal\":{\"id\":\"goal\"},\"plans\":[{\"planSlug\":\"plan\",\"harnessSlug\":\"pot\"}],\"agents\":[]}]}")
        XCTAssertEqual(try PanelModel.organizerMembers(group, roster: roster([a, b]), goal: detail), [a])
        let holders = try json("{\"rows\":[{\"goal\":{\"id\":\"goal\"},\"plans\":[],\"agents\":[{\"ownerId\":\"owner-2\",\"live\":true}]}]}")
        XCTAssertEqual(try PanelModel.organizerMembers(group, roster: roster([a, b]), goal: holders), [b])
        XCTAssertThrowsError(try PanelModel.organizerMembers(group, roster: roster([a]), goal: .null))
        for fields: [String: JSONValue] in [["partial": .bool(true)], ["degradedFields": .object(["host": .string("down")])], ["truncatedByLimit": .bool(true)]] {
            XCTAssertThrowsError(try PanelModel.organizerMembers(groups[0], roster: roster([a], fields)))
        }
    }
    func testOrganizerRejectsAmbiguousRecycledAndMissingExactWindows() throws {
        let a = try organizerAgent(1)
        XCTAssertEqual(try PanelModel.exactOrganizerWindow(a, windows: [organizerWindow("0x1")]).id, "0x1")
        XCTAssertThrowsError(try PanelModel.exactOrganizerWindow(a, windows: [organizerWindow("2")]))
        XCTAssertThrowsError(try PanelModel.exactOrganizerWindow(a, windows: [organizerWindow("1"), organizerWindow("1")]))
        let recycled = OrganizerWindow(id: "1", title: "terminal [adv:2]", desktop: "current", monitor: "1", area: nil)
        XCTAssertThrowsError(try PanelModel.exactOrganizerWindow(a, windows: [recycled]))
    }
    func testOrganizerArrangesEachDesktopAndPreservesIndividualFailures() async throws {
        let agents = try (1...5).map { try organizerAgent($0, $0 == 4 ? ["host": .string("remote")] :
            $0 == 5 ? ["stale": .bool(true)] : [:]) }
        let group = try XCTUnwrap(PanelModel.organizerGroups(kind: "fleet", agents: agents, goals: []).first)
        var moves: [String] = []
        let receipts = try await PanelModel.arrangeOrganizer(group, roster: roster(agents), localHost: "mac",
            windows: [organizerWindow("1"), organizerWindow("2", monitor: "display-2"),
                      organizerWindow("3", desktop: "unsupported", unsupported: "Space is not controllable")]) { window, rect in
                moves.append(window.id)
                return self.organizerWindow(window.id, desktop: window.desktop!, monitor: window.monitor!, bounds: rect)
            }
        XCTAssertEqual(Set(moves), Set(["1", "2"]))
        XCTAssertEqual(receipts.map(\.status), ["moved", "moved", "unsupported", "unsupported", "offline"])
        XCTAssertEqual(receipts[0].requested, receipts[1].requested, "separate monitors each receive their full work area")
        XCTAssertTrue(receipts.allSatisfy { $0.status == "moved" || $0.error != nil })
    }
    func testOrganizerRequiresObservedIdentityGeometryAndFreshGroupBeforeSuccess() async throws {
        let a = try organizerAgent(1), b = try organizerAgent(2)
        let group = try XCTUnwrap(PanelModel.organizerGroups(kind: "plan", agents: [a, b], goals: []).first)
        for wrongIdentity in [false, true] {
            let receipts = try await PanelModel.arrangeOrganizer(group, roster: roster([a, b]), localHost: "mac",
                windows: [organizerWindow("1"), organizerWindow("2")]) { window, rect in
                    if window.id == "2" { throw WorkbenchError("native move failed") }
                    return self.organizerWindow(wrongIdentity ? "99" : "1", bounds: wrongIdentity ? rect :
                        OrganizerRect(x: rect.x, y: rect.y, width: rect.width - 20, height: rect.height))
                }
            XCTAssertEqual(receipts.map(\.status), ["failed", "failed"])
            XCTAssertTrue(receipts.allSatisfy { $0.requested != nil && $0.error != nil })
        }
        var moves = 0
        let changed = try organizerAgent(1, ["currentPlanSlug": .string("different")])
        let receipts = try await PanelModel.arrangeOrganizer(group, roster: roster([changed, b]), localHost: "mac",
            windows: [organizerWindow("1"), organizerWindow("2")]) { window, rect in
                moves += 1; return self.organizerWindow(window.id, bounds: rect)
            }
        XCTAssertEqual(moves, 1); XCTAssertEqual(receipts.map(\.status), ["failed", "moved"])
    }
    func testOrganizerNeverMovesOneWindowForTwoSelectedSessions() async throws {
        let a = try organizerAgent(1, ["windowId": .string("shared")])
        let b = try organizerAgent(2, ["windowId": .string("shared")])
        let group = try XCTUnwrap(PanelModel.organizerGroups(kind: "fleet", agents: [a, b], goals: []).first)
        let window = OrganizerWindow(id: "1", title: "shared", desktop: "current", monitor: "1",
            area: OrganizerRect(x: 0, y: 0, width: 1000, height: 800))
        let receipts = try await PanelModel.arrangeOrganizer(group, roster: roster([a, b]), localHost: "mac", windows: [window]) { _, _ in
            XCTFail("ambiguous shared window must not move"); return window
        }
        XCTAssertEqual(receipts.map(\.status), ["failed", "failed"])
    }
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private func environment() throws -> JSONValue {
        try json("{\"endpoint\":\"http://selected:3170\",\"workspaceId\":\"selected\",\"store\":{\"id\":\"store\"},\"agentChat\":{\"scope\":\"workspace:selected\"}}")
    }
    func testResumeCommandRoundTripsShellMetacharactersAndExactEnvironment() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench ' $() " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui ' fixture")
        let body = "#!/bin/sh\nprintf '%s\\n' \"$@\"\nprintf '%s\\n' \"$PUI_OPERATOR\" \"$PAPERCUSP_OPERATOR_URL\" \"$PUI_WORKBENCH_EXPECTED_IDENTITY\"\n"
        try Data(body.utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        let owner = "owner ' $(touch SHOULD_NOT_EXIST) ; `echo no`"
        let target = try PanelResult(kind: .agents, row: .object(["advSessionId": .number(41),
            "ownerId": .string(owner), "host": .string("remote"), "sessionState": .string("ended")]))
        let environment = try environment()
        let command = try PanelModel.resumeCommand(executable: file, target: target, environment: environment)
        let output = try await BoundedNativeProcess.run(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", command])
        XCTAssertEqual(output.status, 0)
        let rows = String(decoding: output.output, as: UTF8.self).split(separator: "\n").map(String.init)
        XCTAssertEqual(Array(rows.prefix(5)), ["workbench", "resume", "41", "remote", owner])
        XCTAssertEqual(rows[5], "http://selected:3170"); XCTAssertEqual(rows[6], rows[5])
        XCTAssertEqual(try json(rows[7]), environment)
        XCTAssertThrowsError(try PanelModel.resumeCommand(executable: file, target: target, environment: .null))
    }
    func testEndedResumeRequiresFreshIdentityAndNoRunningReplacement() throws {
        let row = try json("{\"id\":41,\"coordOwnerId\":\"exact\",\"hostname\":\"remote\",\"sessionState\":\"ended\"}")
        let selected = try PanelResult(kind: .agents, row: json("{\"advSessionId\":41,\"ownerId\":\"exact\",\"hostname\":\"remote\",\"sessionState\":\"ended\"}"))
        var aggregate: [String: JSONValue] = ["active": .array([]), "ended": .array([row])]
        func envelope() -> JSONValue { .object(["rows": .array([.object(aggregate)])]) }
        let target = try PanelModel.agentTarget(selected, roster: envelope(), localHost: "mac", resume: true)
        XCTAssertEqual(try PanelModel.resumeArguments(target), ["workbench", "resume", "41", "remote", "exact"])
        aggregate["starting"] = .array([try json("{\"advSessionId\":42,\"ownerId\":\"exact\",\"host\":\"mac\",\"sessionState\":\"starting\"}")])
        XCTAssertThrowsError(try PanelModel.agentTarget(selected, roster: envelope(), localHost: "mac", resume: true))
    }
    func testFocusRequiresExactReceiptAndPreservesSelectedIdentity() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench focus " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui")
        let environment = try environment()
        let target = try PanelResult(kind: .agents, row: json("{\"advSessionId\":41,\"ownerId\":\"exact\",\"host\":\"mac\",\"windowId\":\"macos:exact\"}"))
        for (id, focused, succeeds) in [(41, true, true), (42, true, false), (41, false, false)] {
            let response: JSONValue = .object(["rows": .array([.object(["advSessionId": .number(Double(id)), "focused": .bool(focused)])]), "environment": environment])
            let script = "#!/bin/sh\ntest \"$1\" = native-agent-focus || exit 9\ncat > \"$0.request\"\ncat <<'RESPONSE'\n" + response.formatted + "\nRESPONSE\n"
            try Data(script.utf8).write(to: file)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
            do { _ = try await PuiBridge(executable: file).focus(target, environment: environment); XCTAssertTrue(succeeds) }
            catch { XCTAssertFalse(succeeds) }
            let request = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request")))
            XCTAssertEqual(request["advSessionId"], .number(41)); XCTAssertEqual(request["ownerId"], .string("exact"))
            XCTAssertEqual(request["host"], .string("mac")); XCTAssertEqual(request["windowId"], .string("macos:exact"))
            XCTAssertEqual(request["environment"], environment)
        }
    }
}
