import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

/// One per-user launchd identity shared by the GUI and Server bundles. This
/// extends the resident's existing settings and process runner, not Server's
/// system daemon or startup preference.
public struct ResidentLifecycle {
    public static let label = "ai.papercusp.workbench"
    public let home: URL
    public let uid: UInt32
    let launchctl: URL
    var pidAlive: (Int32) -> Bool = { kill($0, 0) == 0 || errno == EPERM }
    public init(home: URL, uid: UInt32, launchctl: URL = URL(fileURLWithPath: "/bin/launchctl")) {
        self.home = home; self.uid = uid; self.launchctl = launchctl
    }
    public var directory: URL { home.appendingPathComponent("Library/Application Support/Papercusp/Workbench") }
    public var bundle: URL { directory.appendingPathComponent("PapercuspWorkbench.app") }
    public var settingsURL: URL { directory.appendingPathComponent("settings.json") }
    public var plist: URL { home.appendingPathComponent("Library/LaunchAgents/" + Self.label + ".plist") }
    private var domain: String { "gui/\(uid)" }
    private var service: String { domain + "/" + Self.label }
    private var executable: URL { bundle.appendingPathComponent("Contents/MacOS/PapercuspWorkbench") }
    private let fm = FileManager.default

    private func lock() throws -> FileHandle {
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent("install.lock").path
        let fd = open(path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw WorkbenchError("Could not open the Workbench installation lock") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            _ = close(fd); throw WorkbenchError("Another Workbench installation is in progress")
        }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }
    private func command(_ arguments: [String]) async throws -> NativeProcessOutput {
        try await BoundedNativeProcess.run(executable: launchctl, arguments: arguments)
    }
    private func checked(_ arguments: [String]) async throws {
        let result = try await command(arguments)
        guard result.status == 0 else { throw WorkbenchError("Workbench login registration failed (exit \(result.status))") }
    }
    private func job() async throws -> String? {
        let result = try await command(["print", service])
        if result.status == 0 { return String(decoding: result.output, as: UTF8.self) }
        let diagnostic = String(decoding: result.diagnostic, as: UTF8.self)
        if [3, 113].contains(result.status),
           ["Could not find service", "Could not find specified service", "No such process"].contains(where: diagnostic.contains) { return nil }
        throw WorkbenchError("Could not inspect the Workbench login job (exit \(result.status))")
    }
    private func pid(_ state: String?) -> Int32? {
        for line in (state ?? "").split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 2, parts[0] == "pid", let value = Int32(parts[1]), value > 1 { return value }
        }
        return nil
    }
    private func stop() async throws {
        guard let state = try await job() else { return }
        let oldPID = pid(state)
        guard oldPID != getpid() else { throw WorkbenchError("Run lifecycle changes from the bundled installer process") }
        try await checked(["bootout", service])
        let deadline = Date().addingTimeInterval(5)
        while true {
            let absent = try await job() == nil
            if absent && !(oldPID.map(pidAlive) ?? false) { return }
            guard Date() < deadline else { throw WorkbenchError("The previous Workbench process has not stopped; its files were preserved") }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }
    private func validate(_ url: URL) throws {
        let info = try PropertyListSerialization.propertyList(from: Data(contentsOf: url.appendingPathComponent("Contents/Info.plist")), format: nil) as? [String: Any]
        guard info?["CFBundleIdentifier"] as? String == Self.label,
              info?["CFBundleExecutable"] as? String == "PapercuspWorkbench",
              info?["LSUIElement"] as? Bool == true,
              fm.isExecutableFile(atPath: url.appendingPathComponent("Contents/MacOS/PapercuspWorkbench").path) else {
            throw WorkbenchError("The native Workbench bundle is incomplete or has a different identity")
        }
    }
    private func manifest(_ url: URL) throws -> [String: Data] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isSymbolicLinkKey, .isDirectoryKey]
        guard let entries = fm.enumerator(at: url, includingPropertiesForKeys: keys, options: []) else {
            throw WorkbenchError("Could not inspect the Workbench bundle")
        }
        var files: [String: Data] = [:]
        for case let entry as URL in entries {
            let values = try entry.resourceValues(forKeys: Set(keys))
            guard values.isSymbolicLink != true else { throw WorkbenchError("The Workbench bundle contains an unexpected symbolic link") }
            if values.isRegularFile == true { files[String(entry.path.dropFirst(url.path.count))] = try Data(contentsOf: entry) }
            else if values.isDirectory != true { throw WorkbenchError("The Workbench bundle contains an unsupported file") }
        }
        return files
    }
    private func plistData(pui: String) throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: [
            "Label": Self.label,
            "ProgramArguments": [executable.path, "--settings", settingsURL.path, "--pui", pui],
            "RunAtLoad": true, "KeepAlive": false, "LimitLoadToSessionType": "Aqua",
            "ProcessType": "Interactive"
        ], format: .xml, options: 0)
    }
    private func start() async throws {
        try await checked(["enable", service])
        if let state = try await job() {
            if pid(state) == nil { try await checked(["kickstart", service]) }
        } else { try await checked(["bootstrap", domain, plist.path]) }
    }

    /// Validate and stage before stopping anything. Preserve the previous signed
    /// bundle and plist until the new launchd registration succeeds.
    @discardableResult public func install(sourceBundle: URL, pui: URL) async throws -> Bool {
        guard home.isFileURL, home.path.hasPrefix("/"), sourceBundle.isFileURL,
              sourceBundle.path.hasPrefix("/"), pui.isFileURL, pui.path.hasPrefix("/"),
              fm.isExecutableFile(atPath: pui.path) else { throw WorkbenchError("Install an executable PUI before Workbench") }
        try validate(sourceBundle)
        let handle = try lock(); defer { try? handle.close() }
        let settingsExisted = fm.fileExists(atPath: settingsURL.path)
        let settings = try ResidentSettings.load(from: settingsURL, defaultPui: pui.path)
        let nextPlist = try plistData(pui: settings.pui)
        let previousPlist = fm.fileExists(atPath: plist.path) ? try Data(contentsOf: plist) : nil
        let existed = fm.fileExists(atPath: bundle.path)
        if existed { try validate(bundle) }
        let same = try existed && manifest(bundle) == manifest(sourceBundle)
        if same && (!settings.enabled || previousPlist == nextPlist) {
            if settings.enabled { try await start() }
            else { try await stop(); if fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) } }
            return false
        }
        let stage = directory.appendingPathComponent("stage-" + UUID().uuidString + ".app")
        let backup = directory.appendingPathComponent("previous-" + UUID().uuidString + ".app")
        try fm.copyItem(at: sourceBundle, to: stage)
        defer { try? fm.removeItem(at: stage) }
        try validate(stage)
        try await stop()
        if existed { try fm.moveItem(at: bundle, to: backup) }
        do {
            try fm.moveItem(at: stage, to: bundle)
            if !settingsExisted { try settings.save(to: settingsURL) }
            try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
            if settings.enabled { try nextPlist.write(to: plist, options: .atomic); try await start() }
            else if fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) }
        } catch {
            let installError = error
            do {
                try await stop()
                if fm.fileExists(atPath: bundle.path) { try fm.removeItem(at: bundle) }
                if existed { try fm.moveItem(at: backup, to: bundle) }
                if let previousPlist { try previousPlist.write(to: plist, options: .atomic) }
                else if fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) }
                if existed && settings.enabled && previousPlist != nil { try await start() }
            } catch { throw WorkbenchError("Workbench update and rollback failed; retained recovery bundle at \(backup.path)") }
            throw installError
        }
        if existed { try fm.removeItem(at: backup) }
        return true
    }

    /// Keep the current menu-bar process alive so disabling is reversible there.
    /// launchd's disabled state also survives logout and the next app upgrade.
    public func setLoginEnabled(_ enabled: Bool) async throws {
        let handle = try lock(); defer { try? handle.close() }
        var settings = try ResidentSettings.load(from: settingsURL, defaultPui: "")
        let previous = settings
        settings.enabled = enabled
        if enabled {
            try validate(bundle)
            try fm.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
            try plistData(pui: settings.pui).write(to: plist, options: .atomic)
        }
        do {
            try await checked([enabled ? "enable" : "disable", service])
            try settings.save(to: settingsURL)
            if !enabled, fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) }
        } catch {
            do {
                try await checked([previous.enabled ? "enable" : "disable", service])
                try previous.save(to: settingsURL)
                if previous.enabled { try plistData(pui: previous.pui).write(to: plist, options: .atomic) }
                else if fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) }
            } catch { throw WorkbenchError("Workbench login change could not be rolled back; inspect the saved login state") }
            throw error
        }
    }
    public func uninstall() async throws {
        let handle = try lock(); defer { try? handle.close() }
        if fm.fileExists(atPath: bundle.path) { try validate(bundle) }
        try await stop()
        try await checked(["disable", service])
        var settings = try ResidentSettings.load(from: settingsURL, defaultPui: "")
        settings.enabled = false; try settings.save(to: settingsURL)
        if fm.fileExists(atPath: plist.path) { try fm.removeItem(at: plist) }
        if fm.fileExists(atPath: bundle.path) { try fm.removeItem(at: bundle) }
    }
}
