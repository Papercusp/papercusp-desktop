import AppKit
import Carbon
import Dispatch
import WorkbenchCore

final class Sidebar: NSPanel {
    var onEscape: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { onEscape?() }
}

/// A native resident accessory. The per-agent HUD remains in PUI/Zellij;
/// this process owns only desktop panels and their global summon shortcuts.
@MainActor final class WorkbenchHost: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate, NSSearchFieldDelegate {
    private let settingsURL: URL = {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--settings"), arguments.indices.contains(index + 1), arguments[index + 1].hasPrefix("/") {
            return URL(fileURLWithPath: arguments[index + 1])
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Papercusp/Workbench/settings.json")
    }()
    private var settings = ResidentSettings(pui: "")
    private var statusItem: NSStatusItem?
    private var eventHandler: EventHandlerRef?
    private var hotKeys: [WorkbenchSurface: (UInt32, EventHotKeyRef)] = [:]
    private var serial: UInt32 = 0
    private var panels: [WorkbenchSurface: Sidebar] = [:]
    private var models: [WorkbenchSurface: PanelModel] = [:]
    private var tables: [WorkbenchSurface: NSTableView] = [:]
    private var searches: [WorkbenchSurface: NSSearchField] = [:]
    private var messages: [WorkbenchSurface: NSTextField] = [:]
    private var details: [WorkbenchSurface: NSTextView] = [:]
    private var tasks: [WorkbenchSurface: [Task<Void, Never>]] = [:]
    private var detailGeneration: [WorkbenchSurface: Int] = [:]
    private var workspaceObserver: NSObjectProtocol?
    private var environment: JSONValue = .null
    private var changingEnabled = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let arguments = CommandLine.arguments
        let defaultPui: String
        if let index = arguments.firstIndex(of: "--pui"), arguments.indices.contains(index + 1) {
            defaultPui = arguments[index + 1]
        } else {
            defaultPui = "/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/pui"
        }
        do { settings = try ResidentSettings.load(from: settingsURL, defaultPui: defaultPui) }
        catch {
            // A malformed settings file must not silently re-enable shortcuts.
            settings.enabled = false; showError("Workbench settings could not be read. Your saved file was preserved.")
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "Workbench"
        installHandler(); rebuildMenu()
        if settings.enabled {
            for surface in WorkbenchSurface.allCases {
                do { try register(surface) } catch { showError(error.localizedDescription) }
            }
        }
        workspaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
                guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      app.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
                Task { @MainActor in self?.outsideFocus() }
            }
    }
    private func installHandler() {
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let result = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                UInt32(MemoryLayout<EventHotKeyID>.size), nil, &id)
            guard result == noErr else { return result }
            let host = Unmanaged<WorkbenchHost>.fromOpaque(context).takeUnretainedValue()
            let hotKeyID = id.id
            Task { @MainActor in
                if let surface = host.hotKeys.first(where: { $0.value.0 == hotKeyID })?.key { host.toggle(surface) }
            }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &eventHandler)
    }
    private func newRegistration(_ shortcut: Shortcut) throws -> (UInt32, EventHotKeyRef) {
        serial += 1
        var ref: EventHotKeyRef?
        let result = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers,
            EventHotKeyID(signature: 0x50574342, id: serial), GetApplicationEventTarget(), 0, &ref)
        guard result == noErr, let ref else { throw WorkbenchError("That shortcut is unavailable. The existing shortcut is still active.") }
        return (serial, ref)
    }
    private func register(_ surface: WorkbenchSurface) throws {
        guard let shortcut = settings.shortcuts[surface.rawValue] else { return }
        hotKeys[surface] = try newRegistration(shortcut)
    }
    private func rebuildMenu() {
        let menu = NSMenu()
        for surface in WorkbenchSurface.allCases {
            let item = NSMenuItem(title: surface.title, action: #selector(menuToggle(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = surface.rawValue; item.isEnabled = settings.enabled; menu.addItem(item)
        }
        menu.addItem(.separator())
        let shortcuts = NSMenuItem(title: "Shortcuts", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        for surface in WorkbenchSurface.allCases {
            let item = NSMenuItem(title: surface.title + "…", action: #selector(editShortcut(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = surface.rawValue; item.isEnabled = settings.enabled; submenu.addItem(item)
        }
        shortcuts.submenu = submenu; menu.addItem(shortcuts)
        let enabled = NSMenuItem(title: settings.enabled ? "Disable Workbench" : "Enable Workbench", action: #selector(setEnabled), keyEquivalent: "")
        enabled.target = self; menu.addItem(enabled)
        let pui = NSMenuItem(title: "Choose installed PUI…", action: #selector(selectPui), keyEquivalent: "")
        pui.target = self; menu.addItem(pui)
        let quit = NSMenuItem(title: "Quit Workbench", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        menu.addItem(quit); statusItem?.menu = menu
    }
    @objc private func menuToggle(_ item: NSMenuItem) {
        if let raw = item.representedObject as? String, let surface = WorkbenchSurface(rawValue: raw) { toggle(surface) }
    }
    @objc private func setEnabled() {
        guard !changingEnabled else { return }
        changingEnabled = true
        var next = settings; next.enabled.toggle()
        Task { @MainActor in
            defer { changingEnabled = false }
            do {
                let lifecycle = ResidentLifecycle(home: FileManager.default.homeDirectoryForCurrentUser, uid: getuid())
                // Isolated --settings runs never touch the user's login job.
                if settingsURL.standardizedFileURL == lifecycle.settingsURL.standardizedFileURL,
                   Bundle.main.bundleURL.standardizedFileURL == lifecycle.bundle.standardizedFileURL {
                    try await lifecycle.setLoginEnabled(next.enabled)
                } else { try next.save(to: settingsURL) }
                settings = next
                if settings.enabled {
                    for surface in WorkbenchSurface.allCases { do { try register(surface) } catch { showError(error.localizedDescription) } }
                } else {
                    for (_, ref) in hotKeys.values { UnregisterEventHotKey(ref) }; hotKeys.removeAll()
                    for panel in panels.values { panel.orderOut(nil) }
                    for surface in WorkbenchSurface.allCases { models[surface]?.visible = false; cancelReads(surface) }
                }
                rebuildMenu()
            } catch { showError("Could not change Workbench's login state. " + error.localizedDescription) }
            }
    }
    @objc private func selectPui() {
        let picker = NSOpenPanel(); picker.canChooseDirectories = false; picker.allowsMultipleSelection = false
        picker.message = "Choose the installed Papercusp PUI executable."
        guard picker.runModal() == .OK, let url = picker.url else { return }
        guard FileManager.default.isExecutableFile(atPath: url.path) else { showError("Choose an executable file."); return }
        var next = settings; next.pui = url.path
        do {
            try next.save(to: settingsURL)
            for surface in WorkbenchSurface.allCases { cancelReads(surface); models[surface] = PanelModel() }
            environment = .null; settings = next
            for (surface, panel) in panels where panel.isVisible { models[surface]?.visible = true; refresh(surface) }
        } catch { showError("Could not save the selected PUI. The previous connection is retained.") }
    }
    @objc private func editShortcut(_ item: NSMenuItem) {
        guard let raw = item.representedObject as? String, let surface = WorkbenchSurface(rawValue: raw) else { return }
        let alert = NSAlert(); alert.messageText = "Shortcut for " + surface.title
        alert.informativeText = "Press the new key combination in the field. Command, Control or Option is required."
        let recorder = ShortcutRecorder(frame: NSRect(x: 0, y: 0, width: 300, height: 32))
        recorder.stringValue = "Press a shortcut"; alert.accessoryView = recorder
        alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = recorder
        guard alert.runModal() == .alertFirstButtonReturn, let shortcut = recorder.shortcut else { return }
        if shortcut == settings.shortcuts[raw] { return }
        var next = settings; next.shortcuts[raw] = shortcut
        do {
            hotKeys[surface] = try ShortcutReplacement.commit(old: hotKeys[surface],
                register: { try newRegistration(shortcut) }, persist: { try next.save(to: settingsURL) },
                unregister: { UnregisterEventHotKey($0.1) })
            settings = next
        } catch { showError(error.localizedDescription) }
    }
    private func toggle(_ surface: WorkbenchSurface) {
        guard settings.enabled else { return }
        if panels[surface] == nil { createPanel(surface) }
        guard let panel = panels[surface] else { return }
        models[surface]?.visible.toggle()
        guard models[surface]?.visible == true else { panel.orderOut(nil); cancelReads(surface); return }
        let point = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
        if let frame = screen?.visibleFrame {
            panel.setFrame(NSRect(x: frame.maxX - min(520, frame.width), y: frame.minY,
                width: min(520, frame.width), height: frame.height), display: true)
        }
        panel.makeKeyAndOrderFront(nil); panel.makeFirstResponder(searches[surface]); refresh(surface)
    }
    private func createPanel(_ surface: WorkbenchSurface) {
        let panel = Sidebar(contentRect: NSRect(x: 0, y: 0, width: 520, height: 760),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = surface.title; panel.level = .floating; panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false; panel.isExcludedFromWindowsMenu = true
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary, .ignoresCycle]
        panel.setAccessibilityLabel("Papercusp " + surface.title)
        let root = NSStackView(); root.orientation = .vertical; root.alignment = .leading; root.spacing = 10
        root.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        panel.contentView = root
        let heading = NSStackView(); heading.orientation = .horizontal
        heading.addArrangedSubview(NSTextField(labelWithString: surface.title))
        let pin = NSButton(checkboxWithTitle: "Keep visible", target: self, action: #selector(pin(_:)))
        pin.identifier = NSUserInterfaceItemIdentifier(surface.rawValue); heading.addArrangedSubview(pin)
        let reload = NSButton(title: "Refresh", target: self, action: #selector(reload(_:)))
        reload.identifier = NSUserInterfaceItemIdentifier(surface.rawValue); heading.addArrangedSubview(reload); root.addArrangedSubview(heading)
        let search = NSSearchField(); search.placeholderString = "Search " + surface.title
        search.identifier = NSUserInterfaceItemIdentifier(surface.rawValue); search.delegate = self
        root.addArrangedSubview(search); searches[surface] = search
        let message = NSTextField(wrappingLabelWithString: "Loading…"); root.addArrangedSubview(message); messages[surface] = message
        let table = NSTableView(); table.identifier = NSUserInterfaceItemIdentifier(surface.rawValue)
        table.addTableColumn(NSTableColumn(identifier: NSUserInterfaceItemIdentifier("result")))
        table.headerView = nil; table.rowHeight = 58; table.delegate = self; table.dataSource = self
        table.target = self; table.doubleAction = #selector(openSelection(_:))
        let scroll = NSScrollView(); scroll.documentView = table; scroll.hasVerticalScroller = true
        root.addArrangedSubview(scroll); tables[surface] = table
        let detail = NSTextView(); detail.isEditable = false; detail.isSelectable = true
        detail.textContainer?.widthTracksTextView = true; detail.autoresizingMask = [.width]
        let detailScroll = NSScrollView(); detailScroll.documentView = detail; detailScroll.hasVerticalScroller = true
        detailScroll.isHidden = true; root.addArrangedSubview(detailScroll); details[surface] = detail
        for view in [search, message, scroll, detailScroll] { view.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true }
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 160).isActive = true
        detailScroll.heightAnchor.constraint(equalToConstant: 260).isActive = true
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)
        models[surface] = PanelModel(); panels[surface] = panel
        if surface == .goals { models[surface]?.scope = .goals }
        panel.onEscape = { [weak self] in self?.escape(surface) }
    }
    @objc private func pin(_ button: NSButton) {
        if let raw = button.identifier?.rawValue, let surface = WorkbenchSurface(rawValue: raw) { models[surface]?.pinned = button.state == .on }
    }
    @objc private func reload(_ button: NSButton) {
        if let raw = button.identifier?.rawValue, let surface = WorkbenchSurface(rawValue: raw) { refresh(surface) }
    }
    private func cancelReads(_ surface: WorkbenchSurface) {
        for task in tasks[surface] ?? [] { task.cancel() }; tasks[surface] = []
        detailGeneration[surface, default: 0] += 1
    }
    private func refresh(_ surface: WorkbenchSurface) {
        cancelReads(surface)
        guard surface == .quickAccess || surface == .goals else {
            messages[surface]?.stringValue = "This native surface is not available in this build."; return
        }
        let generation = models[surface]?.beginRefresh() ?? 0
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let environment = self.environment
        let kinds: [SourceKind] = surface == .goals ? [.goals] : SourceKind.allCases
        for kind in kinds {
            let task = Task { [weak self] in
                do {
                    let payload = try await bridge.read(kind.model, environment: environment)
                    guard let self, !Task.isCancelled else { return }
                    self.models[surface]?.settle(kind, generation: generation, payload: payload); self.render(surface)
                } catch {
                    guard let self, !Task.isCancelled else { return }
                    self.models[surface]?.settle(kind, generation: generation, payload: nil, error: error); self.render(surface)
                }
            }
            tasks[surface, default: []].append(task)
        }
        render(surface)
    }
    private func render(_ surface: WorkbenchSurface) {
        guard let model = models[surface], let table = tables[surface] else { return }
        table.reloadData()
        if let selected = model.selection, let index = model.results().firstIndex(where: { $0.identity == selected }) {
            table.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        }
        let kinds: [SourceKind] = surface == .goals ? [.goals] : SourceKind.allCases
        messages[surface]?.stringValue = kinds.map { kind in
            guard let source = model.sources[kind] else { return kind.rawValue + ": unavailable" }
            let state = source.status == .ready ? (source.rows.isEmpty ? "no results" : "ready") : source.status.rawValue
            return kind.rawValue + ": " + state + (source.partial ? " (partial)" : "") + (source.error.map { " — " + $0 } ?? "")
        }.joined(separator: "\n")
        details[surface]?.string = model.detail?.formatted ?? ""
        details[surface]?.enclosingScrollView?.isHidden = model.detail == nil
    }
    func controlTextDidChange(_ notification: Notification) {
        guard let search = notification.object as? NSSearchField, let raw = search.identifier?.rawValue,
              let surface = WorkbenchSurface(rawValue: raw) else { return }
        models[surface]?.query = search.stringValue; render(surface)
    }
    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard let raw = control.identifier?.rawValue, let surface = WorkbenchSurface(rawValue: raw), let table = tables[surface] else { return false }
        if selector == #selector(NSResponder.cancelOperation(_:)) { escape(surface); return true }
        if selector == #selector(NSResponder.insertNewline(_:)) { openSelection(table); return true }
        if selector == #selector(NSResponder.moveDown(_:)) || selector == #selector(NSResponder.moveUp(_:)) {
            let step = selector == #selector(NSResponder.moveDown(_:)) ? 1 : -1
            let row = max(0, min(table.numberOfRows - 1, table.selectedRow + step))
            if table.numberOfRows > 0 { table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false); table.scrollRowToVisible(row) }
            return true
        }
        return false
    }
    func numberOfRows(in tableView: NSTableView) -> Int { surface(tableView).flatMap { models[$0]?.results().count } ?? 0 }
    private func surface(_ table: NSTableView) -> WorkbenchSurface? { table.identifier.flatMap { WorkbenchSurface(rawValue: $0.rawValue) } }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard let surface = surface(tableView), let results = models[surface]?.results(), results.indices.contains(row) else { return nil }
        let result = results[row]
        return NSTextField(wrappingLabelWithString: result.kind.rawValue.capitalized + " · " + result.title + "\n" + result.subtitle)
    }
    func tableViewSelectionDidChange(_ notification: Notification) {
        guard let table = notification.object as? NSTableView, let surface = surface(table),
              let results = models[surface]?.results(), results.indices.contains(table.selectedRow) else { return }
        models[surface]?.selection = results[table.selectedRow].identity
        detailGeneration[surface, default: 0] += 1
    }
    @objc private func openSelection(_ table: NSTableView) {
        guard let surface = surface(table), let results = models[surface]?.results(), results.indices.contains(table.selectedRow) else { return }
        let selected = results[table.selectedRow]
        guard let (name, args) = selected.detailRequest else {
            messages[surface]?.stringValue = "Exact terminal focus is unavailable in this build."; return
        }
        detailGeneration[surface, default: 0] += 1
        let generation = detailGeneration[surface]
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui)), environment = self.environment
        let task = Task { [weak self] in
            do {
                let payload = try await bridge.read(name, args: args, environment: environment)
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation,
                      self.models[surface]?.selection == selected.identity else { return }
                self.models[surface]?.detail = payload; self.render(surface)
            } catch {
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation else { return }
                self.messages[surface]?.stringValue = error.localizedDescription
            }
        }
        tasks[surface, default: []].append(task)
    }
    private func escape(_ surface: WorkbenchSurface) {
        detailGeneration[surface, default: 0] += 1; models[surface]?.escape()
        if models[surface]?.visible != true { panels[surface]?.orderOut(nil); cancelReads(surface) }; render(surface)
    }
    private func outsideFocus() {
        for surface in WorkbenchSurface.allCases {
            models[surface]?.outsideFocus()
            if models[surface]?.visible != true { panels[surface]?.orderOut(nil); cancelReads(surface) }
        }
    }
    private func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "Workbench"; alert.informativeText = message; alert.runModal()
    }
    func applicationWillTerminate(_ notification: Notification) {
        for surface in WorkbenchSurface.allCases { cancelReads(surface) }
        for (_, ref) in hotKeys.values { UnregisterEventHotKey(ref) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
        if let workspaceObserver { NSWorkspace.shared.notificationCenter.removeObserver(workspaceObserver) }
    }
}

final class ShortcutRecorder: NSTextField {
    var shortcut: Shortcut?
    override func performKeyEquivalent(with event: NSEvent) -> Bool { record(event); return true }
    override func keyDown(with event: NSEvent) { record(event) }
    private func record(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.intersection([.command, .control, .option]).isEmpty else { return }
        var modifiers: UInt32 = 0
        for (flag, value) in [(NSEvent.ModifierFlags.command, cmdKey), (.control, controlKey), (.option, optionKey), (.shift, shiftKey)] {
            if flags.contains(flag) { modifiers |= UInt32(value) }
        }
        shortcut = Shortcut(keyCode: UInt32(event.keyCode), modifiers: modifiers)
        stringValue = (flags.contains(.control) ? "⌃" : "") + (flags.contains(.option) ? "⌥" : "") +
            (flags.contains(.shift) ? "⇧" : "") + (flags.contains(.command) ? "⌘" : "") + (event.charactersIgnoringModifiers ?? "")
    }
}

// Lifecycle commands do not create an NSApplication, Dock icon or panel.
if CommandLine.arguments.contains("--install-resident") || CommandLine.arguments.contains("--uninstall-resident") {
    Task {
        do {
            let lifecycle = ResidentLifecycle(home: FileManager.default.homeDirectoryForCurrentUser, uid: getuid())
            if CommandLine.arguments.contains("--uninstall-resident") { try await lifecycle.uninstall() }
            else {
                let args = CommandLine.arguments
                guard let index = args.firstIndex(of: "--pui"), args.indices.contains(index + 1) else {
                    throw WorkbenchError("An installed PUI executable is required")
                }
                try await lifecycle.install(sourceBundle: Bundle.main.bundleURL, pui: URL(fileURLWithPath: args[index + 1]))
            }
            print("{\"ok\":true}"); exit(0)
        } catch {
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); exit(1)
        }
    }
    dispatchMain()
}
let application = NSApplication.shared
let host = WorkbenchHost()
application.delegate = host
application.run()
