import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchAgentTests: XCTestCase {
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
