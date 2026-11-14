import Foundation
import XCTest
@testable import WorkbenchCore

final class WorkbenchResidentLifecycleTests: XCTestCase {
    private struct Fixture {
        let root: URL, source: URL, pui: URL, launchctl: URL
        var lifecycle: ResidentLifecycle {
            var value = ResidentLifecycle(home: root.appendingPathComponent("home ' & 🦊"), uid: 501, launchctl: launchctl)
            value.pidAlive = { _ in false }; return value
        }
        func marker(_ suffix: String) -> URL { URL(fileURLWithPath: launchctl.path + suffix) }
        var calls: String { (try? String(contentsOf: marker(".calls"), encoding: .utf8)) ?? "" }
    }
    private func fixture() throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("Workbench lifecycle " + UUID().uuidString)
        let source = root.appendingPathComponent("candidate & ' 🦊.app")
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        let info: [String: Any] = ["CFBundleIdentifier": ResidentLifecycle.label, "CFBundleExecutable": "PapercuspWorkbench", "LSUIElement": true]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: source.appendingPathComponent("Contents/Info.plist"))
        let executable = source.appendingPathComponent("Contents/MacOS/PapercuspWorkbench")
        try Data("#!/bin/sh\nprintf resident-v1\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        let pui = root.appendingPathComponent("pui installed ' & 🦊")
        try FileManager.default.copyItem(at: executable, to: pui)
        let launchctl = root.appendingPathComponent("launchctl fixture")
        let script = #"""
        #!/bin/sh
        printf '%s\n' "$@" >> "$0.calls"
        if test -e "$0.fail-$1"; then rm "$0.fail-$1"; exit 5; fi
        case "$1" in
          print) if test -e "$0.state"; then printf 'job = {\n pid = 424242\n}\n'; else printf 'Could not find service\n' >&2; exit 113; fi ;;
          bootstrap|kickstart) touch "$0.state" ;;
          bootout) rm -f "$0.state" ;;
          enable|disable) : ;;
          *) exit 99 ;;
        esac
        """#
        try Data((script + "\n").utf8).write(to: launchctl)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: launchctl.path)
        return Fixture(root: root, source: source, pui: pui, launchctl: launchctl)
    }
    func testResidentFirstInstallUsesAquaUserDomainAndIdempotentRegistration() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        let changed = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        XCTAssertTrue(changed)
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: Data(contentsOf: f.lifecycle.plist), format: nil) as? [String: Any])
        XCTAssertEqual(plist["Label"] as? String, ResidentLifecycle.label)
        XCTAssertEqual(plist["LimitLoadToSessionType"] as? String, "Aqua")
        XCTAssertEqual(plist["KeepAlive"] as? Bool, false)
        XCTAssertEqual(plist["ProgramArguments"] as? [String], [f.lifecycle.bundle.appendingPathComponent("Contents/MacOS/PapercuspWorkbench").path,
            "--settings", f.lifecycle.settingsURL.path, "--pui", f.pui.path])
        XCTAssertTrue(f.calls.contains("bootstrap\ngui/501\n"))
        let unchanged = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        XCTAssertFalse(unchanged)
        XCTAssertEqual(f.calls.components(separatedBy: "bootstrap\n").count - 1, 1)
        XCTAssertFalse(f.calls.contains("bootout\n"))
    }
    func testResidentDisabledUpgradePreservesShortcutAndCustomPuiWithoutStarting() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        var settings = try ResidentSettings.load(from: f.lifecycle.settingsURL, defaultPui: "")
        settings.shortcuts["inbox"] = Shortcut(keyCode: 99, modifiers: 768)
        settings.pui = "/custom installed/pui"; try settings.save(to: f.lifecycle.settingsURL)
        try await f.lifecycle.setLoginEnabled(false)
        let bytes = try Data(contentsOf: f.lifecycle.settingsURL)
        try Data("#!/bin/sh\nprintf resident-v2\n".utf8).write(to: f.source.appendingPathComponent("Contents/MacOS/PapercuspWorkbench"))
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        XCTAssertEqual(try Data(contentsOf: f.lifecycle.settingsURL), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.lifecycle.plist.path))
        XCTAssertEqual(f.calls.components(separatedBy: "bootstrap\n").count - 1, 1)
        try await f.lifecycle.setLoginEnabled(true)
        let restored = try ResidentSettings.load(from: f.lifecycle.settingsURL, defaultPui: "")
        XCTAssertTrue(restored.enabled); XCTAssertEqual(restored.shortcuts["inbox"]?.keyCode, 99)
        XCTAssertEqual(restored.pui, "/custom installed/pui")
    }
    func testResidentFailedUpgradeRollsBackBundleAndExactPreviousPlist() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        let binary = f.lifecycle.bundle.appendingPathComponent("Contents/MacOS/PapercuspWorkbench")
        let previous = try Data(contentsOf: binary), plist = try Data(contentsOf: f.lifecycle.plist)
        try Data("#!/bin/sh\nprintf resident-v2\n".utf8).write(to: f.source.appendingPathComponent("Contents/MacOS/PapercuspWorkbench"))
        try Data().write(to: f.marker(".fail-bootstrap"))
        do { _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui); XCTFail("accepted failed registration") } catch {}
        XCTAssertEqual(try Data(contentsOf: binary), previous)
        XCTAssertEqual(try Data(contentsOf: f.lifecycle.plist), plist)
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.marker(".state").path))
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: f.lifecycle.directory.path).contains { $0.hasPrefix("previous-") })
    }
    func testResidentInspectionFailureIsNotTreatedAsAnAbsentJob() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        let binary = f.lifecycle.bundle.appendingPathComponent("Contents/MacOS/PapercuspWorkbench")
        let before = try Data(contentsOf: binary)
        try Data("#!/bin/sh\nprintf resident-v2\n".utf8).write(to: f.source.appendingPathComponent("Contents/MacOS/PapercuspWorkbench"))
        try Data().write(to: f.marker(".fail-print"))
        do { _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui); XCTFail("ignored inspection error") } catch {}
        XCTAssertEqual(try Data(contentsOf: binary), before)
        XCTAssertFalse(f.calls.contains("bootout\n"))
    }
    func testResidentRejectsMalformedSettingsAndForeignBundleBeforeStopping() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        try Data("bad json".utf8).write(to: f.lifecycle.settingsURL)
        do { _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui); XCTFail("ignored saved settings") } catch {}
        XCTAssertEqual(try String(contentsOf: f.lifecycle.settingsURL), "bad json")
        XCTAssertFalse(f.calls.contains("bootout\n"))
        try Data("foreign bundle".utf8).write(to: f.lifecycle.bundle.appendingPathComponent("Contents/Info.plist"))
        do { try await f.lifecycle.uninstall(); XCTFail("deleted foreign bundle") } catch {}
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.lifecycle.bundle.path))
    }
    func testResidentRejectsLinkedBundleContentsBeforeFirstInstallOrUpgrade() async throws {
        for installed in [false, true] {
            for relativePath in ["Contents/MacOS/PapercuspWorkbench", "Contents/Resources/linked-resource"] {
                let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
                if installed { _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui) }
                let binary = f.lifecycle.bundle.appendingPathComponent("Contents/MacOS/PapercuspWorkbench")
                let previousBinary = try? Data(contentsOf: binary)
                let previousPlist = try? Data(contentsOf: f.lifecycle.plist)
                let previousCalls = f.calls
                let link = f.source.appendingPathComponent(relativePath)
                try FileManager.default.createDirectory(at: link.deletingLastPathComponent(), withIntermediateDirectories: true)
                if FileManager.default.fileExists(atPath: link.path) { try FileManager.default.removeItem(at: link) }
                try FileManager.default.createSymbolicLink(at: link, withDestinationURL: f.pui)
                do {
                    _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
                    XCTFail("accepted linked bundle contents: installed=\(installed), path=\(relativePath)")
                } catch {
                    XCTAssertTrue(error.localizedDescription.contains("symbolic link"), String(describing: error))
                }
                XCTAssertEqual(f.calls, previousCalls, "invalid candidates must not touch the resident login job")
                XCTAssertEqual(try? Data(contentsOf: binary), previousBinary)
                XCTAssertEqual(try? Data(contentsOf: f.lifecycle.plist), previousPlist)
                XCTAssertEqual(try String(contentsOf: f.pui), "#!/bin/sh\nprintf resident-v1\n")
            }
        }
    }
    func testResidentUninstallRemovesOnlyItsBundleAndLoginRetainingPreferences() async throws {
        let f = try fixture(); defer { try? FileManager.default.removeItem(at: f.root) }
        _ = try await f.lifecycle.install(sourceBundle: f.source, pui: f.pui)
        let unrelated = f.lifecycle.directory.appendingPathComponent("unrelated.txt")
        try Data("keep".utf8).write(to: unrelated)
        let before = try ResidentSettings.load(from: f.lifecycle.settingsURL, defaultPui: "")
        try await f.lifecycle.uninstall()
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.lifecycle.bundle.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.lifecycle.plist.path))
        let after = try ResidentSettings.load(from: f.lifecycle.settingsURL, defaultPui: "")
        XCTAssertFalse(after.enabled); XCTAssertEqual(after.shortcuts, before.shortcuts); XCTAssertEqual(after.pui, before.pui)
        XCTAssertEqual(try String(contentsOf: unrelated), "keep")
    }
}
