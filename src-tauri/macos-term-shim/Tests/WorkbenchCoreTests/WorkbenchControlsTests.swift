import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchControlsTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    private func envelope(_ rows: [JSONValue], environment: JSONValue? = nil) -> JSONValue {
        var value: [String: JSONValue] = ["rows": .array(rows)]
        if let environment { value["environment"] = environment }
        return .object(value)
    }
    private var environment: JSONValue {
        .object(["endpoint": .string("http://selected:3170"), "workspaceId": .string("selected"),
                 "store": .object(["id": .string("store-one")]), "agentChat": .object(["scope": .string("workspace:selected")])])
    }
    private var steering: JSONValue {
        .object(["defaultAccountId": .string("default"), "forcedAccounts": .array([.string("forced")]),
                 "excludeAccounts": .array([.string("excluded")])])
    }
    private var pool: JSONValue { envelope([.object(["id": .string("one"), "label": .string("Same"), "provider": .string("openai")]),
                                           .object(["id": .string("two"), "label": .string("Same"), "provider": .string("anthropic")])]) }
    private func accounts() -> AccountState {
        var state = AccountState(); let token = state.begin()
        XCTAssertTrue(state.settle(token, environment: environment, pool: pool, steering: envelope([steering])))
        XCTAssertTrue(state.ready); return state
    }
    private func goal(_ status: String = "active", effective: String = "active", holder: String = "held") -> JSONValue {
        .object(["goal": .object(["id": .string("literal +/=& λ"), "title": .string("Work on everything"),
                                  "status": .string(status), "spentCents": .null, "budgetCents": .number(12345),
                                  "spentCentsScope": .string("goal-attributed")]),
                 "effectiveStatus": .string(effective), "holderLiveness": .string(holder)])
    }
    private func loadedGoal(_ detail: JSONValue) throws -> GoalState {
        var state = GoalState(); try state.load(environment: environment, payload: envelope([detail]), goalID: "literal +/=& λ")
        return state
    }
    func testEnvironmentKeysMatchPuiRendezvousAndRejectMissingIdentities() throws {
        XCTAssertEqual(try NativeEnvironment.identity(envelope([environment])), environment)
        guard case .object(var changed) = environment else { return XCTFail() }
        changed["build"] = .object(["sha": .string("new-build")])
        XCTAssertTrue(NativeEnvironment.same(environment, .object(changed)))
        for key in ["endpoint", "workspaceId", "store", "agentChat"] {
            var other = changed; other[key] = .null
            XCTAssertFalse(NativeEnvironment.same(environment, .object(other)), key)
            XCTAssertThrowsError(try NativeEnvironment.identity(envelope([.object(other)])))
        }
        XCTAssertThrowsError(try NativeEnvironment.identity(envelope([])))
        XCTAssertThrowsError(try NativeEnvironment.identity(envelope([environment, environment])))
    }
    func testAccountReadRejectsPartialSteeringAndAmbiguousIds() {
        let invalid: [(JSONValue, JSONValue)] = [
            (.object(["rows": pool["rows"], "partial": .bool(true)]), envelope([steering])),
            (envelope([pool["rows"].rows![0], pool["rows"].rows![0]]), envelope([steering])),
            (pool, envelope([.object(["forcedAccounts": .array([])])])),
            (pool, .object(["rows": .array([steering]), "partial": .bool(true)])),
            (pool, .object(["rows": .array([steering]), "ok": .bool(false)])),
        ]
        for (pool, steering) in invalid {
            var state = AccountState(); let token = state.begin()
            XCTAssertTrue(state.settle(token, environment: environment, pool: pool, steering: steering))
            XCTAssertFalse(state.ready); XCTAssertNotNil(state.error); XCTAssertTrue(state.accounts.isEmpty)
            XCTAssertThrowsError(try state.beginAction("auto", accountID: nil))
        }
    }
    func testAccountsKeepDistinctAxesAndOnlyApplyConfirmedCurrentResponse() throws {
        var state = accounts(); state.selection = "two"
        XCTAssertEqual(state.results(query: "same").count, 2)
        XCTAssertEqual(state.results(query: "anthropic").first?["id"], .string("two"))
        let old = state.steering
        let token = try state.beginAction("exclude", accountID: "two")
        XCTAssertEqual(state.steering, old, "request launch must not optimistically change steering")
        XCTAssertThrowsError(try state.beginAction("auto", accountID: nil))
        var next: [String: JSONValue] = ["defaultAccountId": .string("default"), "forcedAccounts": .array([.string("forced")]),
                                        "excludeAccounts": .array([.string("excluded"), .string("two")])]
        XCTAssertTrue(state.applied(token, expected: environment, payload: envelope([.object(next)], environment: environment)))
        XCTAssertEqual(state.steering["forcedAccounts"], old["forcedAccounts"])
        XCTAssertEqual(state.steering["defaultAccountId"], old["defaultAccountId"])
        XCTAssertTrue(state.contains("excludeAccounts", id: "two"))
        XCTAssertFalse(state.applied(token, expected: environment, payload: envelope([old], environment: environment)))
        let auto = try state.beginAction("auto", accountID: nil)
        next["forcedAccounts"] = .array([]); next["excludeAccounts"] = .array([])
        XCTAssertTrue(state.applied(auto, expected: environment, payload: envelope([.object(next)], environment: environment)))
        XCTAssertEqual(state.steering["defaultAccountId"], old["defaultAccountId"])
        XCTAssertEqual(state.steering["forcedAccounts"], .array([])); XCTAssertEqual(state.steering["excludeAccounts"], .array([]))
        XCTAssertEqual(state.selection, "two")
    }
    func testAccountOldGenerationFailedWriteAndWrongEnvironmentCannotBecomeSuccess() throws {
        var state = accounts(); let action = try state.beginAction("default", accountID: "one")
        let old = state.steering
        XCTAssertTrue(state.applied(action, expected: environment, payload: nil, failure: WorkbenchError("write failed")))
        XCTAssertEqual(state.steering, old); XCTAssertFalse(state.ready); XCTAssertNotNil(state.error)
        let refresh = state.begin()
        XCTAssertFalse(state.applied(action, expected: environment, payload: envelope([steering], environment: environment)))
        XCTAssertTrue(state.settle(refresh, environment: environment, pool: pool, steering: envelope([steering])))
        let token = try state.beginAction("force", accountID: "one")
        guard case .object(var other) = environment else { return XCTFail() }
        other["store"] = .object(["id": .string("other")])
        XCTAssertTrue(state.applied(token, expected: environment, payload: envelope([steering], environment: .object(other))))
        XCTAssertFalse(state.ready); XCTAssertNotNil(state.error)
        state.invalidate()
        XCTAssertFalse(state.settle(refresh, environment: environment, pool: pool, steering: envelope([steering])))
    }
    func testGoalControlsUseCanonicalEffectiveStateAndUnknownDisablesActions() throws {
        for (detail, expected) in [
            (goal(), ["pause", "achieve", "kill"]),
            (goal(effective: "dormant", holder: "lost"), ["start", "achieve", "kill"]),
            (goal("paused", effective: "paused", holder: "unheld"), ["resume", "achieve", "kill"]),
            (goal("achieved", effective: "achieved", holder: "unheld"), ["reopen"]),
            (goal("killed", effective: "killed", holder: "unheld"), ["reopen"]),
            (goal(effective: "unknown"), []), (goal(holder: "unknown"), []),
        ] { XCTAssertEqual(try loadedGoal(detail).actions, expected) }
        var state = try loadedGoal(goal())
        XCTAssertThrowsError(try state.beginAction("resume"))
        XCTAssertThrowsError(try state.load(environment: environment, payload: envelope([goal()]), goalID: "other"))
        XCTAssertTrue(state.actions.isEmpty, "failed selection change must not retain old goal controls")
    }
    func testGoalNoOptimisticStateAndDegradedReadbackStaysVisible() throws {
        var state = try loadedGoal(goal()); try state.beginAction("pause")
        XCTAssertEqual(state.detail["goal"]["status"], .string("active")); XCTAssertTrue(state.actions.isEmpty)
        let confirmed = goal("paused", effective: "active", holder: "held")
        state.applied(.object(["rows": .array([confirmed]), "environment": environment, "degraded": .bool(true),
                               "degradedReasons": .array([.string("one attributed session did not pause")])]))
        XCTAssertEqual(state.detail["goal"]["status"], .string("paused"))
        XCTAssertEqual(state.detail["effectiveStatus"], .string("active"))
        XCTAssertTrue(state.warning?.contains("one attributed session") == true)
        XCTAssertEqual(state.environment, environment)
    }
    func testGoalRequestSuccessWithoutConfirmedStateAndFailedWriteRemainUnresolved() throws {
        var state = try loadedGoal(goal()); try state.beginAction("pause")
        state.applied(envelope([goal()], environment: environment))
        XCTAssertNotNil(state.error); XCTAssertEqual(state.detail["goal"]["status"], .string("active")); XCTAssertTrue(state.actions.isEmpty)
        state = try loadedGoal(goal()); try state.beginAction("pause")
        state.applied(nil, failure: WorkbenchError("network failed after send"))
        XCTAssertNotNil(state.error); XCTAssertEqual(state.detail["goal"]["status"], .string("active"))
        state = try loadedGoal(goal()); try state.beginAction("pause")
        state.applied(envelope([goal("paused", effective: "paused")], environment: .null))
        XCTAssertNotNil(state.error); XCTAssertTrue(state.actions.isEmpty)
    }
    func testNativeReaderUsesCanonicalProseAndGoalMeasurementUnitsWithoutChangingSteering() throws {
        XCTAssertEqual(NativeDocument.markdown(envelope([.object(["body_md": .string("# שלום\n\n```swift\nlet x = 1\n```"),
                                                               "privateTransport": .string("never rendered")])])), "# שלום\n\n```swift\nlet x = 1\n```")
        XCTAssertEqual(NativeDocument.markdown(envelope([.object(["content": .string("Full plan prose")])])), "Full plan prose")
        let accounts = accounts(), prior = accounts.steering
        let prose = NativeDocument.markdown(envelope([goal()]))
        XCTAssertTrue(prose.contains("Goal-attributed spend: Unknown")); XCTAssertTrue(prose.contains("Cap: $123.45"))
        XCTAssertTrue(prose.contains("Spend scope: goal-attributed")); XCTAssertEqual(accounts.steering, prior)
    }
    func testPanelRefreshClearsStaleDetailButPreservesDraftAndCanonicalSelection() {
        var model = PanelModel(); model.query = "draft"; model.selection = [.string("plans"), .string("harness"), .string("slug")]
        model.detail = envelope([.object(["content": .string("old content")])]); let selected = model.selection
        _ = model.beginRefresh()
        XCTAssertNil(model.detail); XCTAssertEqual(model.query, "draft"); XCTAssertEqual(model.selection, selected)
    }
    func testBridgeAccountAndGoalControlsUseTypedStdinWithExactEnvironmentAndConfirmation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench controls " + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("pui fixture")
        try Data("#!/bin/sh\nprintf '%s' \"$1\" > \"$0.command\"\ncat > \"$0.request\"\nprintf '%s' '{\"rows\":[]}'\n".utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        let bridge = PuiBridge(executable: file)
        func saved() throws -> JSONValue {
            try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: URL(fileURLWithPath: file.path + ".request")))
        }
        let id = "literal +/=& λ '$()"
        for action in ["default", "force", "exclude", "auto"] {
            _ = try await bridge.account(action, accountID: action == "auto" ? nil : id, environment: environment)
            XCTAssertEqual(try String(contentsOfFile: file.path + ".command", encoding: .utf8), "native-account")
            let request = try saved()
            XCTAssertEqual(request["action"], .string(action)); XCTAssertEqual(request["environment"], environment)
            XCTAssertEqual(request["accountId"], action == "auto" ? .null : .string(id))
        }
        _ = try await bridge.goal("pause", detail: goal(), confirmed: true, environment: environment)
        XCTAssertEqual(try String(contentsOfFile: file.path + ".command", encoding: .utf8), "native-goal")
        let request = try saved()
        XCTAssertEqual(request["goalId"], goal()["goal"]["id"]); XCTAssertEqual(request["environment"], environment)
        XCTAssertEqual(request["confirmed"], .bool(true)); XCTAssertEqual(request["expectedStatus"], .string("active"))
        XCTAssertEqual(request["expectedEffectiveStatus"], .string("active")); XCTAssertEqual(request["expectedHolderLiveness"], .string("held"))
        try FileManager.default.removeItem(atPath: file.path + ".request")
        do { _ = try await bridge.goal("pause", detail: goal(), confirmed: false, environment: environment); XCTFail("accepted unconfirmed goal") } catch {}
        do { _ = try await bridge.account("force", accountID: id, environment: .null); XCTFail("accepted unknown environment") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path + ".request"), "invalid controls must not launch PUI")
    }
}
