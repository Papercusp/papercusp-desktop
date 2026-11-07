import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchCoreTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private func envelope(_ rows: [JSONValue]) -> JSONValue { .object(["rows": .array(rows)]) }
    private func executable(_ body: String) throws -> (URL, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench tests " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("pui fixture")
        try Data(("#!/bin/sh\n" + body).utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        return (root, file)
    }
    func testCanonicalIdentityAndPerSourceQuotas() throws {
        var model = PanelModel(); let generation = model.beginRefresh()
        let plans = try (0..<60).map { try json("{\"harness\":\"one\",\"slug\":\"p\($0)\",\"title\":\"Shared\"}") }
        model.settle(.plans, generation: generation, payload: envelope(plans))
        let report = try json("{\"report_id\":\"r1\",\"title\":\"Shared\"}")
        model.settle(.reports, generation: generation, payload: envelope([report]))
        XCTAssertEqual(model.results().filter { $0.kind == .plans }.count, 26)
        XCTAssertEqual(model.results().filter { $0.kind == .reports }.count, 1)
        let other = try PanelResult(kind: .plans, row: json("{\"harness\":\"two\",\"slug\":\"p0\"}"))
        XCTAssertNotEqual(model.results()[0].identity, other.identity)
        XCTAssertEqual(other.detailRequest?.1["harness"], .string("two"))
    }
    func testStaleRefreshCannotReplaceNewResults() throws {
        var model = PanelModel(); let old = model.beginRefresh(), current = model.beginRefresh()
        XCTAssertFalse(model.settle(.reports, generation: old, payload: envelope([])))
        model.settle(.plans, generation: current, payload: envelope([]))
        model.settle(.reports, generation: current, payload: nil, error: WorkbenchError("Denied"))
        XCTAssertEqual(model.sources[.plans]?.status, .ready)
        XCTAssertEqual(model.sources[.reports]?.status, .unavailable)
        XCTAssertEqual(model.sources[.agents]?.status, .loading)
    }
    func testDuplicateCanonicalRowsAreUnavailable() throws {
        var model = PanelModel(); let generation = model.beginRefresh()
        let report = try json("{\"report_id\":\"r\"}")
        model.settle(.reports, generation: generation, payload: envelope([report, report]))
        XCTAssertEqual(model.sources[.reports]?.status, .unavailable)
        XCTAssertTrue(model.results().isEmpty)
    }
    func testGoalPortfolioPreservesUnknownAndWorkOnEverything() throws {
        var model = PanelModel(); let generation = model.beginRefresh()
        let portfolio = try json("{\"goals\":[{\"id\":\"g\",\"kind\":\"work-on-everything\",\"status\":\"active\",\"effectiveStatus\":\"unknown\",\"spend\":null}],\"partial\":true}")
        model.settle(.goals, generation: generation, payload: envelope([portfolio]))
        XCTAssertEqual(model.results()[0].subtitle, "unknown")
        XCTAssertEqual(model.results()[0].row["spend"], .null)
        XCTAssertEqual(model.sources[.goals]?.partial, true)
    }
    func testEscapePinAndDraftAreIndependent() {
        var first = PanelModel(), second = PanelModel()
        first.visible = true; first.pinned = true; first.query = "draft"; first.detail = .string("report")
        second.visible = true
        first.outsideFocus(); second.outsideFocus()
        XCTAssertTrue(first.visible); XCTAssertFalse(second.visible)
        first.escape(); XCTAssertNil(first.detail); XCTAssertTrue(first.visible)
        first.escape(); XCTAssertFalse(first.visible); XCTAssertEqual(first.query, "draft")
    }
    func testShortcutReplacementRetainsOldUntilPersistedAndRollsBackCandidate() throws {
        var live = Set([1]), order: [String] = []
        let new = try ShortcutReplacement.commit(old: 1, register: { live.insert(2); return 2 },
            persist: { XCTAssertEqual(live, [1, 2]); order.append("persist") },
            unregister: { live.remove($0); order.append("remove\($0)") })
        XCTAssertEqual(new, 2); XCTAssertEqual(live, [2]); XCTAssertEqual(order, ["persist", "remove1"])
        XCTAssertThrowsError(try ShortcutReplacement.commit(old: 2, register: { live.insert(3); return 3 },
            persist: { throw WorkbenchError("disk") }, unregister: { live.remove($0) }))
        XCTAssertEqual(live, [2])
        XCTAssertThrowsError(try ShortcutReplacement.commit(old: 2, register: { () throws -> Int in throw WorkbenchError("conflict") },
            persist: { XCTFail("must not persist") }, unregister: { _ in XCTFail("must not unregister") }))
    }
    func testDisabledSettingsSurviveRoundTrip() throws {
        let (root, _) = try executable("exit 0\n"); defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("settings.json")
        var settings = ResidentSettings(pui: "/installed/pui"); settings.enabled = false
        settings.shortcuts["goals"] = Shortcut(keyCode: 9, modifiers: 6400); try settings.save(to: file)
        let loaded = try ResidentSettings.load(from: file, defaultPui: "/new/pui")
        XCTAssertFalse(loaded.enabled); XCTAssertEqual(loaded.pui, "/installed/pui")
        XCTAssertEqual(loaded.shortcuts["goals"]?.keyCode, 9)
    }
    func testExactAgentRequiresFreshUnambiguousCompleteRoster() throws {
        let row = try json("{\"advSessionId\":7,\"ownerId\":\"owner\",\"host\":\"mac\",\"sessionState\":\"live\",\"windowId\":\"8\"}")
        let selected = try PanelResult(kind: .agents, row: row)
        let roster = envelope([.object(["active": .array([row]), "ended": .array([])])])
        XCTAssertEqual(try PanelModel.agentTarget(selected, roster: roster, localHost: "MAC", resume: false).identity, selected.identity)
        XCTAssertThrowsError(try PanelModel.agentTarget(selected, roster: roster, localHost: "other", resume: false))
        let partial = envelope([.object(["active": .array([row]), "ended": .array([]), "partial": .bool(true)])])
        XCTAssertThrowsError(try PanelModel.agentTarget(selected, roster: partial, localHost: "mac", resume: false))
        let duplicate = envelope([.object(["active": .array([row, row]), "ended": .array([])])])
        XCTAssertThrowsError(try PanelModel.agentTarget(selected, roster: duplicate, localHost: "mac", resume: false))
    }
    func testBridgeUsesStdinAndPreservesUnicodeAndArgumentsWithSpaces() async throws {
        let (root, file) = try executable("test \"$1\" = native-read || exit 9\ncat > \"$0.request\"\nprintf '%s' '{\"rows\":[{\"title\":\"שלום 🦊\"}]}'\n")
        defer { try? FileManager.default.removeItem(at: root) }
        let result = try await PuiBridge(executable: file).read("plans.list", args: ["query": .string("$() ' \\ 🦊")])
        XCTAssertEqual(result["rows"].rows?.first?["title"].text, "שלום 🦊")
        let request = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request")))
        XCTAssertEqual(request["args"]["query"].text, "$() ' \\ 🦊")
    }
    func testBridgeRejectsUnavailableAndInvalidEnvelopes() async throws {
        for body in ["{\"rows\":[],\"ok\":false}", "{\"rows\":[],\"error\":\"denied\"}", "{\"rows\":{}}", "not json"] {
            let (root, file) = try executable("cat >/dev/null\nprintf '%s' '" + body + "'\n")
            do { _ = try await PuiBridge(executable: file).read("plans.list"); XCTFail("accepted invalid envelope") } catch {}
            try FileManager.default.removeItem(at: root)
        }
    }
    func testBridgeDrainsStderrAndBoundsOutputBeforeJSONDecode() async throws {
        let (root, file) = try executable("cat >/dev/null\ndd if=/dev/zero bs=65536 count=300 2>/dev/null\n")
        defer { try? FileManager.default.removeItem(at: root) }
        do { _ = try await PuiBridge(executable: file).read("plans.list", timeout: 3); XCTFail("accepted oversized output") }
        catch { XCTAssertTrue(error.localizedDescription.contains("limit")) }
        let (otherRoot, otherFile) = try executable("cat >/dev/null\ndd if=/dev/zero bs=65536 count=8 >&2 2>/dev/null\nprintf '%s' '{\"rows\":[]}'\n")
        defer { try? FileManager.default.removeItem(at: otherRoot) }
        let drained = try await PuiBridge(executable: otherFile).read("plans.list")
        XCTAssertEqual(drained["rows"], .array([]))
    }
    func testBridgeDeadlineAndCancellationTerminateOnlyOwnedHelper() async throws {
        let (root, file) = try executable("cat >/dev/null\nexec sleep 20\n")
        defer { try? FileManager.default.removeItem(at: root) }
        let start = Date()
        do { _ = try await PuiBridge(executable: file).read("plans.list", timeout: 0.15); XCTFail("accepted hung helper") }
        catch { XCTAssertTrue(error.localizedDescription.contains("time")) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 3)
        let task = Task { try await PuiBridge(executable: file).read("plans.list") }
        try await Task.sleep(nanoseconds: 30_000_000); task.cancel()
        do { _ = try await task.value; XCTFail("ignored cancellation") } catch { XCTAssertTrue(error is CancellationError) }
    }
    func testBridgeRefusesUnknownReadBeforeLaunching() async throws {
        let (root, file) = try executable("touch \"$0.launched\"\n")
        defer { try? FileManager.default.removeItem(at: root) }
        do { _ = try await PuiBridge(executable: file).read("anything.write"); XCTFail("accepted unknown model") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path + ".launched"))
    }
}
