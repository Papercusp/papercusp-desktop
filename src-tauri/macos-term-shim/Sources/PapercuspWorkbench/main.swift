import AppKit
import AVFoundation
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
@MainActor final class WorkbenchHost: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate, NSSearchFieldDelegate, NSTextViewDelegate, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
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
    private var queryTasks: [WorkbenchSurface: Task<Void, Never>] = [:]
    private var detailGeneration: [WorkbenchSurface: Int] = [:]
    private var workspaceObserver: NSObjectProtocol?
    private var environments: [WorkbenchSurface: JSONValue] = [:]
    private var accountState = AccountState()
    private var inboxState = InboxState()
    private var inboxBulkStatus: NSTextField?, inboxRunField: NSTextField?
    private var inboxRunID: String?
    private var inboxButtons: [String: NSButton] = [:]
    private var inboxReviewStack: NSStackView?, inboxActionChoice: NSPopUpButton?, inboxAnswer: NSTextField?
    private var inboxWrite: Task<Void, Never>?
    private var inboxUpdates: Task<Void, Never>?
    private var renderedInboxReview: [JSONValue]?
    private var chatState = ChatState()
    private var chatEarlier: NSButton?
    private var chatComposer: NSTextView?
    private var chatSend: NSButton?, chatCancel: NSButton?, chatRecover: NSButton?
    private var chatTask: Task<Void, Never>?
    private var chatOperation = UUID()
    private var voiceRecord: NSButton?, voiceRead: NSButton?, voiceStop: NSButton?, voiceMessage: NSTextField?
    private var voiceTask: Task<Void, Never>?, voiceID: UUID?
    private var recorder: AVAudioRecorder?, player: AVAudioPlayer?, voiceDirectory: URL?
    private var voiceStatus = ""
    private var captureContext: (generation: Int, environment: JSONValue, conversationID: String, draft: String)?
    private var cardsState = NativeCardsState()
    private var cardsTask: Task<Void, Never>?
    private var cardStack: NSStackView?, cardMessage: NSTextField?
    private var renderedCard: NativeCard?
    private var cardChoices: [NSButton] = [], cardActions: [NSButton] = []
    private var cardInput: NSTextField?, cardMultiline: NSTextView?, cardSelect: NSPopUpButton?
    private var cardDate: NSDatePicker?, cardSlider: NSSlider?
    private var goalStates: [WorkbenchSurface: GoalState] = [:]
    private var accountButtons: [NSButton] = []
    private var accountScope: NSTextField?
    private var accountSummary: NSTextField?
    private var goalControls: [WorkbenchSurface: NSStackView] = [:]
    private var goalStatus: [WorkbenchSurface: NSTextField] = [:]
    private var rendering = false
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
            environments = [:]; accountState.invalidate(); goalStates = [:]; settings = next
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
            let width = min(surface == .inbox ? 840 : 520, frame.width)
            panel.setFrame(NSRect(x: frame.maxX - width, y: frame.minY,
                width: width, height: frame.height), display: true)
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
        search.isHidden = surface == .papercup
        let message = NSTextField(wrappingLabelWithString: "Loading…"); root.addArrangedSubview(message); messages[surface] = message
        if surface == .papercup {
            let earlier = NSButton(title: "Load earlier messages", target: self, action: #selector(loadEarlierChat))
            earlier.isEnabled = false; root.addArrangedSubview(earlier); chatEarlier = earlier
        }
        if surface == .accounts {
            let scope = NSTextField(wrappingLabelWithString: "Environment unavailable")
            let summary = NSTextField(wrappingLabelWithString: "Steering unavailable")
            root.addArrangedSubview(scope); root.addArrangedSubview(summary)
            accountScope = scope; accountSummary = summary
            let controls = NSStackView(); controls.orientation = .horizontal
            for action in ["default", "force", "exclude", "auto"] {
                let button = NSButton(title: action.capitalized, target: self, action: #selector(applyAccount(_:)))
                button.identifier = NSUserInterfaceItemIdentifier(action); button.isEnabled = false
                controls.addArrangedSubview(button); accountButtons.append(button)
            }
            root.addArrangedSubview(controls)
        }
        let table = NSTableView(); table.identifier = NSUserInterfaceItemIdentifier(surface.rawValue)
        table.addTableColumn(NSTableColumn(identifier: NSUserInterfaceItemIdentifier("result")))
        table.headerView = nil; table.rowHeight = 58; table.delegate = self; table.dataSource = self
        table.target = self; table.doubleAction = #selector(openSelection(_:))
        let scroll = NSScrollView(); scroll.documentView = table; scroll.hasVerticalScroller = true
        root.addArrangedSubview(scroll); tables[surface] = table
        if surface == .quickAccess || surface == .goals {
            let status = NSTextField(wrappingLabelWithString: ""); status.isHidden = true
            root.addArrangedSubview(status); goalStatus[surface] = status
            let controls = NSStackView(); controls.orientation = .horizontal; controls.isHidden = true
            for action in ["start", "pause", "resume", "reopen", "achieve", "kill"] {
                let button = NSButton(title: action.capitalized, target: self, action: #selector(applyGoal(_:)))
                button.identifier = NSUserInterfaceItemIdentifier(surface.rawValue + ":" + action)
                controls.addArrangedSubview(button)
            }
            root.addArrangedSubview(controls); goalControls[surface] = controls
        }
        let detail = NSTextView(); detail.isEditable = false; detail.isSelectable = true
        detail.textContainer?.widthTracksTextView = true; detail.autoresizingMask = [.width]
        let detailScroll = NSScrollView(); detailScroll.documentView = detail; detailScroll.hasVerticalScroller = true
        detailScroll.isHidden = true; root.addArrangedSubview(detailScroll); details[surface] = detail
        for view in [search, message] { view.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true }
        if surface == .inbox {
            // B: the question list and its independently scrollable context
            // remain siblings, including when no question is selected.
            root.removeArrangedSubview(scroll); scroll.removeFromSuperview()
            root.removeArrangedSubview(detailScroll); detailScroll.removeFromSuperview()
            let split = NSStackView(views: [scroll, detailScroll]); split.orientation = .horizontal
            split.alignment = .top; split.distribution = .fillEqually; split.spacing = 12
            root.addArrangedSubview(split); detailScroll.isHidden = false
            split.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            scroll.heightAnchor.constraint(equalTo: split.heightAnchor).isActive = true
            detailScroll.heightAnchor.constraint(equalTo: split.heightAnchor).isActive = true
            split.heightAnchor.constraint(greaterThanOrEqualToConstant: 240).isActive = true
            split.setContentHuggingPriority(.defaultLow, for: .vertical)
            table.setAccessibilityLabel("Inbox questions"); detail.setAccessibilityLabel("Selected question context")
            let bulk = NSTextField(wrappingLabelWithString: "Loading saved run…")
            root.addArrangedSubview(bulk); inboxBulkStatus = bulk
            bulk.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            let run = NSTextField(); run.placeholderString = "Saved run ID (empty opens latest)"
            run.setAccessibilityLabel("Saved Inbox run ID"); inboxRunField = run
            let open = NSButton(title: "Open saved run", target: self, action: #selector(openInboxRun))
            let controls = NSStackView(views: [run, open]); controls.orientation = .horizontal
            root.addArrangedSubview(controls)
            controls.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            let operations = NSStackView(); operations.orientation = .horizontal
            for (id, title) in [("start", "Start visible batch"), ("stop", "Stop"), ("resume", "Continue retryable"), ("apply", "Apply selected")] {
                let button = NSButton(title: title, target: self, action: #selector(inboxControl(_:)))
                button.identifier = NSUserInterfaceItemIdentifier(id); operations.addArrangedSubview(button); inboxButtons[id] = button
            }
            root.addArrangedSubview(operations)
            let choice = NSPopUpButton(); inboxActionChoice = choice
            let answer = NSTextField(); answer.placeholderString = "Your answer to the selected question"
            answer.setAccessibilityLabel("Answer to selected Inbox question"); inboxAnswer = answer
            let resolve = NSButton(title: "Resolve selected question", target: self, action: #selector(inboxControl(_:)))
            resolve.identifier = NSUserInterfaceItemIdentifier("resolve"); inboxButtons["resolve"] = resolve
            let manual = NSStackView(views: [choice, answer, resolve]); manual.orientation = .horizontal
            root.addArrangedSubview(manual); manual.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            let reviewScroll = NSScrollView(); reviewScroll.hasVerticalScroller = true
            let review = NSStackView(); review.orientation = .vertical; review.alignment = .leading; review.spacing = 8
            review.translatesAutoresizingMaskIntoConstraints = false; reviewScroll.documentView = review; inboxReviewStack = review
            reviewScroll.setAccessibilityLabel("Grouped saved run review")
            root.addArrangedSubview(reviewScroll)
            reviewScroll.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            reviewScroll.heightAnchor.constraint(equalToConstant: 160).isActive = true
            review.widthAnchor.constraint(equalTo: reviewScroll.contentView.widthAnchor, constant: -16).isActive = true
        } else {
            for view in [scroll, detailScroll] { view.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true }
        }
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 160).isActive = true
        if surface == .papercup {
            scroll.isHidden = true; detailScroll.isHidden = false
            detailScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true
            detailScroll.setContentHuggingPriority(.defaultLow, for: .vertical)
        } else if surface != .inbox { detailScroll.heightAnchor.constraint(equalToConstant: 260).isActive = true }
        if surface == .papercup {
            let cardStatus = NSTextField(wrappingLabelWithString: "Connecting questions…")
            root.addArrangedSubview(cardStatus); cardMessage = cardStatus
            let cardScroll = NSScrollView(); cardScroll.hasVerticalScroller = true
            let cardContent = NSStackView(); cardContent.orientation = .vertical; cardContent.alignment = .leading
            cardContent.spacing = 8; cardContent.translatesAutoresizingMaskIntoConstraints = false
            cardScroll.documentView = cardContent; root.addArrangedSubview(cardScroll); cardStack = cardContent
            cardScroll.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            cardScroll.heightAnchor.constraint(equalToConstant: 180).isActive = true
            cardContent.widthAnchor.constraint(equalTo: cardScroll.contentView.widthAnchor, constant: -16).isActive = true
            let reconnect = NSButton(title: "Reconnect questions", target: self, action: #selector(reconnectCards))
            root.addArrangedSubview(reconnect)
            let composer = NSTextView(); composer.isRichText = false; composer.delegate = self
            composer.setAccessibilityLabel("Message Papercup")
            let composeScroll = NSScrollView(); composeScroll.documentView = composer; composeScroll.hasVerticalScroller = true
            root.addArrangedSubview(composeScroll); chatComposer = composer
            composeScroll.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -32).isActive = true
            composeScroll.heightAnchor.constraint(equalToConstant: 80).isActive = true
            composer.textContainer?.widthTracksTextView = true; composer.autoresizingMask = [.width]
            let controls = NSStackView(); controls.orientation = .horizontal
            let send = NSButton(title: "Send", target: self, action: #selector(sendChat))
            let cancel = NSButton(title: "Cancel reply", target: self, action: #selector(cancelChat))
            let recover = NSButton(title: "Recover reply", target: self, action: #selector(recoverChat))
            for button in [send, cancel, recover] { button.isEnabled = false; controls.addArrangedSubview(button) }
            chatSend = send; chatCancel = cancel; chatRecover = recover; root.addArrangedSubview(controls)
            let voiceControls = NSStackView(); voiceControls.orientation = .horizontal
            let record = NSButton(title: "Record message", target: self, action: #selector(recordVoice))
            let read = NSButton(title: "Read reply", target: self, action: #selector(readVoice))
            let stop = NSButton(title: "Cancel voice", target: self, action: #selector(cancelVoiceAction))
            for button in [record, read, stop] { button.isEnabled = false; voiceControls.addArrangedSubview(button) }
            voiceRecord = record; voiceRead = read; voiceStop = stop; root.addArrangedSubview(voiceControls)
            let voiceLabel = NSTextField(wrappingLabelWithString: "")
            root.addArrangedSubview(voiceLabel); voiceMessage = voiceLabel
        }
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
        queryTasks[surface]?.cancel(); queryTasks[surface] = nil
        for task in tasks[surface] ?? [] { task.cancel() }; tasks[surface] = []
        detailGeneration[surface, default: 0] += 1
        if surface == .accounts { accountState.invalidate() }
        if surface == .inbox { inboxUpdates?.cancel(); inboxUpdates = nil; inboxState.invalidate() }
        if surface == .papercup {
            cancelVoice()
            cardsTask?.cancel(); cardsTask = nil
            _ = cardsState.begin(environment: .null, conversationID: ""); renderCards()
            chatState.draft = chatComposer?.string ?? chatState.draft
            // The operator owns execution after admission. Cancel through its
            // canonical control route; killing the pipe alone is insufficient.
            if let request = try? chatState.reply?.control("cancel") {
                let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
                let reply = chatState.reply
                let cancelledEnvironment = chatState.environment
                Task {
                    do {
                        var receipt = reply
                        for try await frame in bridge.chat(request) { try receipt?.receive(frame) }
                        guard receipt?.phase == "cancelled" else { throw WorkbenchError("Reply cancellation needs reconciliation") }
                    } catch {
                        if NativeEnvironment.same(self.chatState.environment, cancelledEnvironment),
                           self.chatState.conversationID == reply?.conversationID {
                            self.messages[.papercup]?.stringValue = error.localizedDescription
                        }
                    }
                }
            }
            chatOperation = UUID(); chatTask?.cancel(); chatTask = nil; chatState.invalidate()
        }
    }
    private func refresh(_ surface: WorkbenchSurface) {
        cancelReads(surface)
        goalStates[surface] = GoalState()
        if surface == .accounts { refreshAccounts(); return }
        if surface == .papercup { refreshChat(); return }
        if surface == .inbox { refreshInbox(); return }
        guard surface == .quickAccess || surface == .goals else {
            messages[surface]?.stringValue = "This native surface is not available in this build."; return
        }
        let generation = models[surface]?.beginRefresh() ?? 0
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let query = models[surface]?.query ?? ""
        let kinds: [SourceKind] = surface == .goals ? [.goals] : SourceKind.allCases
        let task = Task { [weak self] in
            do {
                let environment = try NativeEnvironment.identity(await bridge.read("operator.identity"))
                guard let self, !Task.isCancelled, self.models[surface]?.generation == generation else { return }
                self.environments[surface] = environment
                for kind in kinds {
                    let read = Task { [weak self] in
                        do {
                            let args: [String: JSONValue] = kind == .reports || kind == .goals ?
                                ["query": .string(query), "limit": .number(kind == .goals ? 500 : 200), "workspaceId": environment["workspaceId"]] : [:]
                            let payload = try await bridge.read(kind.model, args: args, environment: environment)
                            guard let self, !Task.isCancelled else { return }
                            self.models[surface]?.settle(kind, generation: generation, payload: payload); self.render(surface)
                        } catch {
                            guard let self, !Task.isCancelled else { return }
                            self.models[surface]?.settle(kind, generation: generation, payload: nil, error: error); self.render(surface)
                        }
                    }
                    self.tasks[surface, default: []].append(read)
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                for kind in kinds { self.models[surface]?.settle(kind, generation: generation, payload: nil, error: error) }
                self.render(surface)
            }
        }
        tasks[surface, default: []].append(task)
        render(surface)
    }
    private func render(_ surface: WorkbenchSurface) {
        if surface == .accounts { renderAccounts(); return }
        if surface == .papercup { renderChat(); return }
        if surface == .inbox { renderInbox(); return }
        guard let model = models[surface], let table = tables[surface] else { return }
        rendering = true; defer { rendering = false }
        table.reloadData()
        if let selected = model.selection, let index = model.results().firstIndex(where: { $0.identity == selected }) {
            table.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        } else { table.deselectAll(nil) }
        let kinds: [SourceKind] = surface == .goals ? [.goals] : SourceKind.allCases
        messages[surface]?.stringValue = kinds.map { kind in
            guard let source = model.sources[kind] else { return kind.rawValue + ": unavailable" }
            let state = source.status == .ready ? (source.rows.isEmpty ? "no results" : "ready") : source.status.rawValue
            return kind.rawValue + ": " + state + (source.partial ? " (partial)" : "") + (source.error.map { " — " + $0 } ?? "")
        }.joined(separator: "\n")
        let content = model.detail.map { NativeDocument.markdown($0) } ?? ""
        if let markdown = try? AttributedString(markdown: content, options: .init(interpretedSyntax: .full)) {
            details[surface]?.textStorage?.setAttributedString(NSAttributedString(markdown))
        } else { details[surface]?.string = content }
        details[surface]?.enclosingScrollView?.isHidden = model.detail == nil
        renderGoalControls(surface)
    }
    func controlTextDidChange(_ notification: Notification) {
        if let field = notification.object as? NSTextField, let id = field.identifier?.rawValue, id.hasPrefix("inbox-draft:") {
            inboxState.reviewDrafts[String(id.dropFirst("inbox-draft:".count))] = field.stringValue; return
        }
        guard let search = notification.object as? NSSearchField, let raw = search.identifier?.rawValue,
              let surface = WorkbenchSurface(rawValue: raw) else { return }
        models[surface]?.query = search.stringValue; render(surface)
        if surface == .quickAccess || surface == .goals {
            queryTasks[surface]?.cancel()
            queryTasks[surface] = Task { [weak self] in
                do { try await Task.sleep(nanoseconds: 180_000_000) } catch { return }
                guard let self, !Task.isCancelled, self.models[surface]?.visible == true else { return }
                self.queryTasks[surface] = nil; self.refresh(surface)
            }
        }
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
    func numberOfRows(in tableView: NSTableView) -> Int {
        if surface(tableView) == .accounts { return accountState.results(query: models[.accounts]?.query ?? "").count }
        if surface(tableView) == .inbox { return inboxState.results(query: models[.inbox]?.query ?? "").count }
        return surface(tableView).flatMap { models[$0]?.results().count } ?? 0
    }
    private func surface(_ table: NSTableView) -> WorkbenchSurface? { table.identifier.flatMap { WorkbenchSurface(rawValue: $0.rawValue) } }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        if surface(tableView) == .inbox {
            let rows = inboxState.results(query: models[.inbox]?.query ?? "")
            guard rows.indices.contains(row) else { return nil }
            let item = rows[row]
            return NSTextField(wrappingLabelWithString: item["title"].text + "\n" +
                [item["kind"].text, item["harnessSlug"].text, item["planSlug"].text].filter { !$0.isEmpty }.joined(separator: " · "))
        }
        if surface(tableView) == .accounts {
            let rows = accountState.results(query: models[.accounts]?.query ?? "")
            guard rows.indices.contains(row) else { return nil }
            let item = rows[row], id = item["id"].text
            let label = item["label"].text.isEmpty ? id : item["label"].text
            let axes = (accountState.steering["defaultAccountId"].text == id ? " · Default" : "") +
                (accountState.contains("forcedAccounts", id: id) ? " · Forced" : "") +
                (accountState.contains("excludeAccounts", id: id) ? " · Excluded" : "")
            return NSTextField(wrappingLabelWithString: label + " (" + id + ")\n" + item["provider"].text +
                " · " + (item["available"].isTrue ? "Available" : "Unavailable") + axes)
        }
        guard let surface = surface(tableView), let results = models[surface]?.results(), results.indices.contains(row) else { return nil }
        let result = results[row]
        return NSTextField(wrappingLabelWithString: result.kind.rawValue.capitalized + " · " + result.title + "\n" + result.subtitle)
    }
    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !rendering else { return }
        if let table = notification.object as? NSTableView, surface(table) == .inbox {
            loadInboxContext(table); return
        }
        if let table = notification.object as? NSTableView, surface(table) == .accounts {
            let rows = accountState.results(query: models[.accounts]?.query ?? "")
            accountState.selection = rows.indices.contains(table.selectedRow) ? rows[table.selectedRow]["id"].text : nil
            updateAccountControls(); return
        }
        guard let table = notification.object as? NSTableView, let surface = surface(table),
              let results = models[surface]?.results(), results.indices.contains(table.selectedRow) else { return }
        models[surface]?.selection = results[table.selectedRow].identity
        detailGeneration[surface, default: 0] += 1
        goalStates[surface]?.clear(); models[surface]?.detail = nil
        details[surface]?.string = ""; details[surface]?.enclosingScrollView?.isHidden = true
        renderGoalControls(surface)
    }
    @objc private func openSelection(_ table: NSTableView) {
        if surface(table) == .accounts { return }
        if surface(table) == .inbox { loadInboxContext(table); return }
        guard let surface = surface(table), let results = models[surface]?.results(), results.indices.contains(table.selectedRow) else { return }
        let selected = results[table.selectedRow]
        models[surface]?.selection = selected.identity
        if selected.kind == .agents { activateAgent(selected, surface: surface); return }
        guard let (name, args) = selected.detailRequest else {
            messages[surface]?.stringValue = "Exact terminal focus is unavailable in this build."; return
        }
        detailGeneration[surface, default: 0] += 1
        let generation = detailGeneration[surface]
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let environment = environments[surface] ?? .null
        let task = Task { [weak self] in
            do {
                var args = args
                if selected.kind == .plans { args["mode"] = .string("full"); args["includeRaw"] = .bool(true) }
                if selected.kind == .goals { args["workspaceId"] = environment["workspaceId"] }
                let payload = try await bridge.read(name, args: args, environment: environment)
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation,
                      self.models[surface]?.selection == selected.identity else { return }
                self.goalStates[surface] = GoalState()
                if selected.kind == .goals {
                    try self.goalStates[surface]?.load(environment: environment, payload: payload, goalID: selected.row["id"].text)
                }
                self.models[surface]?.detail = payload; self.render(surface)
            } catch {
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation else { return }
                self.messages[surface]?.stringValue = error.localizedDescription
            }
        }
        tasks[surface, default: []].append(task)
    }
    private func activateAgent(_ selected: PanelResult, surface: WorkbenchSurface) {
        let resume = selected.row["sessionState"].text == "ended"
        if resume {
            let alert = NSAlert(); alert.messageText = "Resume “" + selected.title + "”?"
            alert.informativeText = "Open this exact ended session in Terminal using its saved local or remote connection."
            alert.addButton(withTitle: "Resume session"); alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        detailGeneration[surface, default: 0] += 1
        let generation = detailGeneration[surface], environment = environments[surface] ?? .null
        let pui = settings.pui, bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        messages[surface]?.stringValue = "Checking selected session…"
        let task = Task { [weak self] in
            do {
                let roster = try await bridge.read("advRoster.list", environment: environment)
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation,
                      self.models[surface]?.selection == selected.identity, self.models[surface]?.visible == true,
                      self.settings.pui == pui else { return }
                let target = try PanelModel.agentTarget(selected, roster: roster,
                    localHost: ProcessInfo.processInfo.hostName, resume: resume)
                if resume { try await bridge.resume(target, environment: environment) }
                else { _ = try await bridge.focus(target, environment: environment) }
                guard !Task.isCancelled, self.detailGeneration[surface] == generation else { return }
                self.models[surface]?.visible = false; self.panels[surface]?.orderOut(nil)
            } catch {
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation else { return }
                self.messages[surface]?.stringValue = error.localizedDescription
            }
        }
        tasks[surface, default: []].append(task)
    }
    private func escape(_ surface: WorkbenchSurface) {
        if surface == .inbox, inboxState.dismissContext() { renderInbox(); return }
        detailGeneration[surface, default: 0] += 1; models[surface]?.escape()
        goalStates[surface]?.clear()
        if models[surface]?.visible != true { panels[surface]?.orderOut(nil); cancelReads(surface) }; render(surface)
    }
    private func outsideFocus() {
        for surface in WorkbenchSurface.allCases {
            models[surface]?.outsideFocus()
            if models[surface]?.visible != true { panels[surface]?.orderOut(nil); cancelReads(surface) }
        }
    }
    @objc private func openInboxRun() {
        let id = inboxRunField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        inboxRunID = id.isEmpty ? nil : id; refresh(.inbox)
    }
    private func refreshInbox() {
        let generation = inboxState.begin(), runID = inboxRunID
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let task = Task { [weak self] in
            do {
                let environment = try NativeEnvironment.identity(await bridge.read("operator.identity"))
                guard let self, !Task.isCancelled, self.inboxState.generation == generation else { return }
                self.environments[.inbox] = environment
                for name in ["plans.attention", "plans.attentionBulkRun"] {
                    let read = Task { [weak self] in
                        do {
                            let args: [String: JSONValue] = name == "plans.attentionBulkRun" ? runID.map { ["runId": .string($0)] } ?? [:] : [:]
                            let payload = try await bridge.read(name, args: args, environment: environment)
                            guard let self, !Task.isCancelled else { return }
                            if name == "plans.attention" {
                                guard self.inboxState.settleList(generation, payload: payload) else { return }
                                self.renderInbox()
                                if let id = self.inboxState.selection { self.loadInboxContext(id: id) }
                            } else {
                                self.inboxState.settleBulk(generation, payload: payload, expectedRunID: runID); self.renderInbox()
                                if self.inboxState.bulkReady { self.followInboxRun(generation: generation, environment: environment) }
                            }
                        } catch {
                            guard let self, !Task.isCancelled else { return }
                            if name == "plans.attention" { self.inboxState.settleList(generation, payload: nil, failure: error) }
                            else { self.inboxState.settleBulk(generation, payload: nil, expectedRunID: runID, failure: error) }
                            self.renderInbox()
                        }
                    }
                    self.tasks[.inbox, default: []].append(read)
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.inboxState.settleList(generation, payload: nil, failure: error)
                self.inboxState.settleBulk(generation, payload: nil, failure: error); self.renderInbox()
            }
        }
        tasks[.inbox, default: []].append(task); renderInbox()
    }
    private func followInboxRun(generation: Int, environment: JSONValue) {
        guard inboxUpdates == nil else { return }
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        inboxUpdates = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                guard let self, self.models[.inbox]?.visible == true, self.inboxState.generation == generation,
                      NativeEnvironment.same(self.environments[.inbox] ?? .null, environment) else { return }
                guard !self.inboxState.pending, let runID = self.inboxState.refreshRunID else { continue }
                do {
                    let payload = try await bridge.read("plans.attentionBulkRun", args: ["runId": .string(runID)], environment: environment)
                    guard !Task.isCancelled else { return }
                    if self.inboxState.settleLiveBulk(generation, runID: runID, payload: payload) { self.renderInbox() }
                } catch {
                    guard !Task.isCancelled else { return }
                    if self.inboxState.settleLiveBulk(generation, runID: runID, payload: nil, failure: error) { self.renderInbox() }
                }
            }
        }
    }
    private func loadInboxContext(_ table: NSTableView) {
        let rows = inboxState.results(query: models[.inbox]?.query ?? "")
        guard rows.indices.contains(table.selectedRow) else { _ = inboxState.dismissContext(); renderInbox(); return }
        loadInboxContext(id: rows[table.selectedRow]["id"].text)
    }
    private func loadInboxContext(id: String) {
        inboxAnswer?.stringValue = ""
        guard let generation = try? inboxState.select(id) else { return }
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui)), environment = environments[.inbox] ?? .null
        let task = Task { [weak self] in
            do {
                let payload = try await bridge.read("plans.attentionItem", args: ["id": .string(id)], environment: environment)
                guard let self, !Task.isCancelled else { return }
                self.inboxState.settleContext(generation, id: id, payload: payload); self.renderInbox()
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.inboxState.settleContext(generation, id: id, payload: nil, failure: error); self.renderInbox()
            }
        }
        tasks[.inbox, default: []].append(task); renderInbox()
    }
    private func renderInbox() {
        guard let table = tables[.inbox] else { return }
        rendering = true; defer { rendering = false }
        let query = models[.inbox]?.query ?? ""
        inboxState.retainVisibleSelection(query: query)
        let rows = inboxState.results(query: query); table.reloadData()
        if let id = inboxState.selection, let index = rows.firstIndex(where: { $0["id"].text == id }) {
            table.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        } else { table.deselectAll(nil) }
        messages[.inbox]?.stringValue = inboxState.listError.map { "Inbox unavailable — " + $0 } ??
            (inboxState.listReady ? (rows.isEmpty ? "No matching questions" : "\(rows.count) questions") +
                (inboxState.listPartial ? " · Partial list — refresh to check for more" : "") : "Loading questions…")
        let content: String
        if let context = inboxState.context {
            content = context["title"].text + "\n\n" + NativeDocument.markdown(.object(["rows": .array([context])]))
        } else {
            content = inboxState.contextError.map { "Context unavailable — " + $0 } ??
                (inboxState.selection == nil ? "Select a question to view its context." : "Loading selected question…")
        }
        if let markdown = try? AttributedString(markdown: content, options: .init(interpretedSyntax: .full)) {
            details[.inbox]?.textStorage?.setAttributedString(NSAttributedString(markdown))
        } else { details[.inbox]?.string = content }
        details[.inbox]?.enclosingScrollView?.isHidden = false
        if let error = inboxState.bulkError { inboxBulkStatus?.stringValue = "Saved run unavailable — " + error }
        else if !inboxState.bulkReady { inboxBulkStatus?.stringValue = "Loading saved run…" }
        else if inboxState.run == .null { inboxBulkStatus?.stringValue = "No saved bulk run" }
        else if let counts = try? InboxState.counts(run: inboxState.run, items: inboxState.items) {
            inboxBulkStatus?.stringValue = "Run " + inboxState.run["runId"].text + " · " + inboxState.run["phase"].text +
                "\n\(counts["decided", default: 0])/\(counts["total", default: 0]) decided · \(counts["percent", default: 0])% · " +
                "\(counts["resolved", default: 0]) resolved · \(counts["unresolved", default: 0]) need attention · \(counts["left", default: 0]) left"
        }
        if let notice = inboxState.actionNotice { inboxBulkStatus?.stringValue += "\n" + notice }
        if inboxState.pending { inboxBulkStatus?.stringValue += "\nApplying action…" }
        let environment = environments[.inbox] ?? .null
        for operation in ["start", "stop", "resume"] {
            inboxButtons[operation]?.isEnabled = (try? inboxState.request(operation, environment: environment, query: query)) != nil
        }
        inboxButtons["apply"]?.isEnabled = !inboxState.pending && inboxState.run["phase"].text == "review" && !inboxState.selectedReviews.isEmpty
        let prior = inboxActionChoice?.selectedItem?.representedObject as? String
        inboxActionChoice?.removeAllItems()
        for action in inboxState.context.map(InboxState.actions) ?? [] {
            let id = action["id"].text
            guard !["chat", "discuss", "view-log", "open", "message-owner"].contains(id), !id.isEmpty else { continue }
            inboxActionChoice?.addItem(withTitle: action["label"].text.isEmpty ? id : action["label"].text)
            inboxActionChoice?.lastItem?.representedObject = id
        }
        if let prior, let item = inboxActionChoice?.itemArray.first(where: { ($0.representedObject as? String) == prior }) {
            inboxActionChoice?.select(item)
        }
        inboxButtons["resolve"]?.isEnabled = !inboxState.pending && (inboxActionChoice?.numberOfItems ?? 0) > 0
        inboxAnswer?.isEnabled = !inboxState.pending; inboxActionChoice?.isEnabled = !inboxState.pending
        // Do not rebuild editors on a checkbox toggle, losing the insertion
        // point or an owner's partially edited answer.
        if renderedInboxReview != inboxState.items || inboxState.pending {
            renderedInboxReview = inboxState.items
            if let stack = inboxReviewStack {
                for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
                for (group, items) in inboxState.reviewGroups {
                    stack.addArrangedSubview(NSTextField(labelWithString: group.replacingOccurrences(of: "_", with: " ").capitalized))
                    for row in items {
                        let id = row["itemId"].text
                        let pick = NSButton(checkboxWithTitle: row["title"].text.isEmpty ? id : row["title"].text,
                            target: self, action: #selector(selectInboxReview(_:)))
                        pick.identifier = NSUserInterfaceItemIdentifier(id); pick.state = inboxState.selectedReviews.contains(id) ? .on : .off
                        pick.isEnabled = inboxState.canSelectReview(id)
                        stack.addArrangedSubview(pick)
                        let rationale = [row["rationale"].text, row["recommendation"]["rationale"].text, row["error"].text,
                            row["retryCondition"].text].filter { !$0.isEmpty }.joined(separator: "\n")
                        if !rationale.isEmpty { stack.addArrangedSubview(NSTextField(wrappingLabelWithString: rationale)) }
                        if row["actionId"].text == "answer", InboxState.reviewable(row) {
                            let draft = NSTextField(string: inboxState.draft(row)); draft.placeholderString = "Edit answer before Apply"
                            draft.identifier = NSUserInterfaceItemIdentifier("inbox-draft:" + id); draft.delegate = self
                            draft.setAccessibilityLabel("Draft answer for " + pick.title); draft.isEnabled = !inboxState.pending
                            stack.addArrangedSubview(draft); draft.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
                        } else if !InboxState.reviewable(row) {
                            stack.addArrangedSubview(NSTextField(wrappingLabelWithString: "Open the question above for manual review. This item is excluded from batch Apply."))
                        }
                    }
                }
            }
        }
    }
    @objc private func selectInboxReview(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        inboxState.setReviewSelected(id, selected: sender.state == .on)
        inboxButtons["apply"]?.isEnabled = !inboxState.pending && !inboxState.selectedReviews.isEmpty
    }
    @objc private func inboxControl(_ sender: NSButton) {
        guard let operation = sender.identifier?.rawValue else { return }
        do {
            // Commit the current field editor before freezing drafts.
            panels[.inbox]?.makeFirstResponder(nil)
            let environment = environments[.inbox] ?? .null
            let requests: [JSONValue]
            if operation == "apply" {
                requests = try inboxState.items.filter { inboxState.selectedReviews.contains($0["itemId"].text) }.map {
                    try inboxState.request("apply", environment: environment, itemID: $0["itemId"].text)
                }
            } else {
                requests = [try inboxState.request(operation, environment: environment, query: models[.inbox]?.query ?? "",
                    actionID: inboxActionChoice?.selectedItem?.representedObject as? String, answer: inboxAnswer?.stringValue)]
            }
            let alert = NSAlert(); alert.messageText = sender.title + "?"
            alert.informativeText = operation == "start" ? "Send exactly \(requests[0]["items"].rows?.count ?? 0) currently visible questions to the resolver with this saved filter?" :
                (operation == "apply" ? "Apply \(requests.count) selected recommendations with your edited answers?" : "Apply this control to the selected question or saved run?")
            alert.addButton(withTitle: "Confirm"); alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            let token = try inboxState.beginAction(requests); renderInbox()
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
            // This write is independent of panel read cancellation: hiding or
            // refreshing a panel cannot imply that an admitted action stopped.
            inboxWrite = Task { [weak self] in
                guard let self else { return }
                do {
                    for request in requests {
                        let receipt = try await bridge.inbox(request)
                        if let id = try self.inboxState.recordAction(token, request: request, payload: receipt) {
                            self.inboxRunID = id; self.inboxRunField?.stringValue = id
                        }
                    }
                    self.inboxState.finishAction(token)
                } catch { self.inboxState.finishAction(token, failure: error) }
                self.inboxWrite = nil; self.renderedInboxReview = nil; self.refresh(.inbox)
            }
        } catch { inboxBulkStatus?.stringValue = error.localizedDescription }
    }
    private func refreshChat() {
        cancelVoice()
        let generation = chatState.begin(); renderChat()
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let task = Task { [weak self] in
            do {
                let environment = try NativeEnvironment.identity(await bridge.read("operator.identity"))
                let conversation = try await bridge.read("operatorConversations.current",
                    args: ["workspaceId": environment["workspaceId"]], environment: environment)
                guard let self, !Task.isCancelled, self.models[.papercup]?.visible == true,
                      try self.chatState.bind(generation, environment: environment, payload: conversation) else { return }
                let id = self.chatState.conversationID
                let page = try await bridge.read("operatorTurns.page",
                    args: ["conversationId": .string(id), "limit": .number(200)], environment: environment)
                guard !Task.isCancelled, self.models[.papercup]?.visible == true else { return }
                if try self.chatState.settle(generation, environment: environment, conversationID: id, payload: page) {
                    self.renderChat(); self.reconnectCards()
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.chatState.fail(generation, error); self.renderChat()
            }
        }
        tasks[.papercup, default: []].append(task)
    }
    @objc private func loadEarlierChat() {
        cancelVoice()
        do {
            let cursor = try chatState.beginEarlier(), generation = chatState.generation
            let environment = chatState.environment, id = chatState.conversationID
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui)); renderChat()
            let task = Task { [weak self] in
                do {
                    let page = try await bridge.read("operatorTurns.page", args: ["conversationId": .string(id),
                        "beforeSeq": .number(cursor), "limit": .number(200)], environment: environment)
                    guard let self, !Task.isCancelled, self.models[.papercup]?.visible == true else { return }
                    if try self.chatState.settle(generation, environment: environment, conversationID: id,
                                                beforeSeq: cursor, payload: page) { self.renderChat() }
                } catch {
                    guard let self, !Task.isCancelled else { return }
                    self.chatState.fail(generation, error); self.renderChat()
                }
            }
            tasks[.papercup, default: []].append(task)
        } catch { messages[.papercup]?.stringValue = error.localizedDescription }
    }
    func textDidChange(_ notification: Notification) {
        guard (notification.object as? NSTextView) === chatComposer else { return }
        if chatState.draft != chatComposer?.string { cancelVoice() }
        chatState.draft = chatComposer?.string ?? ""; renderChat()
    }
    @objc private func sendChat() {
        cancelVoice()
        do {
            chatState.draft = chatComposer?.string ?? ""
            let request = try chatState.send(); streamChat(request)
        } catch { messages[.papercup]?.stringValue = error.localizedDescription }
    }
    @objc private func cancelChat() { controlChat("cancel") }
    @objc private func recoverChat() { controlChat("reconnect") }
    private func controlChat(_ operation: String) {
        do {
            guard let reply = chatState.reply else { return }
            streamChat(try reply.control(operation))
        } catch { messages[.papercup]?.stringValue = error.localizedDescription }
    }
    private func streamChat(_ request: JSONValue) {
        chatTask?.cancel(); let operation = UUID(); chatOperation = operation
        let generation = chatState.generation, bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        chatTask = Task { [weak self] in
            do {
                for try await frame in bridge.chat(request) {
                    guard let self, !Task.isCancelled, self.chatOperation == operation,
                          self.models[.papercup]?.visible == true else { return }
                    if try self.chatState.receive(generation, frame) { self.renderChat() }
                }
                guard let self, !Task.isCancelled, self.chatOperation == operation else { return }
                guard self.chatState.reply?.complete == true else { throw WorkbenchError("Reply disconnected; recover before sending again") }
                self.chatTask = nil
                if self.chatState.reply?.phase == "completed" { self.refreshChat() } else { self.renderChat() }
            } catch {
                guard let self, !Task.isCancelled, self.chatOperation == operation else { return }
                self.chatTask = nil; self.chatState.replyFailed(generation, error); self.renderChat()
            }
        }
        renderChat()
    }
    private func renderChat() {
        chatEarlier?.isEnabled = chatState.ready && !chatState.loading && chatState.reply == nil && chatState.hasMoreEarlier
        chatComposer?.isEditable = chatState.ready
        if chatComposer?.string != chatState.draft { chatComposer?.string = chatState.draft }
        chatSend?.isEnabled = chatState.canSend
        chatCancel?.isEnabled = chatState.reply.map { !$0.turnID.isEmpty && !$0.complete } ?? false
        chatRecover?.isEnabled = chatTask == nil && (chatState.reply.map { !$0.turnID.isEmpty && !$0.complete } ?? false)
        voiceRecord?.title = chatState.voicePhase == .recording ? "Use recording" : "Record message"
        voiceRecord?.isEnabled = chatState.voicePhase == .recording || (chatState.canUseVoice && voiceID == nil)
        voiceRead?.isEnabled = chatState.canUseVoice && voiceID == nil && !chatState.spokenReply.isEmpty
        voiceStop?.isEnabled = voiceID != nil
        voiceMessage?.stringValue = voiceStatus
        let scope = chatState.environment == .null ? "" : "\n" + chatState.environment["endpoint"].text +
            " · " + chatState.environment["workspaceId"].text
        messages[.papercup]?.stringValue = (chatState.error.map { "Unavailable · " + $0 } ??
            (chatState.loading ? "Loading messages…" : chatState.reply?.phase ?? (chatState.ready ? "Papercup" : "Conversation unavailable"))) + scope
        var content = chatState.ready && chatState.turns.isEmpty ? "No messages yet." : chatState.markdown
        if let reply = chatState.reply {
            if !reply.displayText.isEmpty { content += "\n\n### Papercup\n\n" + reply.displayText }
            if !reply.tools.isEmpty { content += "\n\n" + reply.tools.joined(separator: "\n\n") }
        }
        if let markdown = try? AttributedString(markdown: content, options: .init(interpretedSyntax: .full)) {
            details[.papercup]?.textStorage?.setAttributedString(NSAttributedString(markdown))
        } else { details[.papercup]?.string = content }
        details[.papercup]?.enclosingScrollView?.isHidden = false
    }
    private func voiceCurrent(_ id: UUID) -> Bool {
        voiceID == id && chatState.voiceCurrent(id) && models[.papercup]?.visible == true
    }
    @objc private func cancelVoiceAction() { cancelVoice(); voiceStatus = "Voice stopped. Your draft was preserved."; renderChat() }
    private func cancelVoice() {
        // Retire the identity before stopping devices: their completion callbacks
        // may arrive after cancellation or after a different conversation opens.
        voiceID = nil; chatState.cancelVoice(); captureContext = nil
        voiceTask?.cancel(); voiceTask = nil
        recorder?.delegate = nil; recorder?.stop(); recorder = nil
        player?.delegate = nil; player?.stop(); player = nil
        if let voiceDirectory { try? FileManager.default.removeItem(at: voiceDirectory) }
        voiceDirectory = nil; voiceStatus = ""
    }
    private func voiceFailed(_ id: UUID, _ message: String) {
        guard voiceID == id else { return }
        cancelVoice(); voiceStatus = message; renderChat()
    }
    @objc private func recordVoice() {
        if chatState.voicePhase == .recording { finishRecording(success: true); return }
        do {
            let id = try chatState.beginVoice(.permission); voiceID = id
            captureContext = (chatState.generation, chatState.environment, chatState.conversationID, chatState.draft)
            voiceStatus = "Waiting for microphone permission…"; renderChat()
            voiceTask = Task { [weak self] in
                let allowed = await withCheckedContinuation { continuation in
                    AVCaptureDevice.requestAccess(for: .audio) { continuation.resume(returning: $0) }
                }
                guard let self, !Task.isCancelled, self.voiceCurrent(id) else { return }
                do {
                    guard allowed else { throw WorkbenchError("Microphone access is unavailable. Allow Papercusp Workbench in System Settings → Privacy & Security → Microphone, then try again.") }
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("papercusp-voice-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                        attributes: [.posixPermissions: 0o700])
                    self.voiceDirectory = directory
                    let recorder = try AVAudioRecorder(url: directory.appendingPathComponent("message.wav"), settings: [
                        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000,
                        AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16,
                        AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false])
                    recorder.delegate = self; self.recorder = recorder
                    guard recorder.prepareToRecord(), self.chatState.advanceVoice(id, to: .recording),
                          recorder.record(forDuration: 60) else { throw WorkbenchError("The microphone could not start recording.") }
                    self.voiceTask = nil
                    self.voiceStatus = "Recording · up to 60 seconds. Use recording to transcribe, or Cancel voice to discard."
                    self.renderChat()
                } catch { self.voiceFailed(id, error.localizedDescription) }
            }
        } catch { voiceStatus = error.localizedDescription; renderChat() }
    }
    private func finishRecording(success: Bool) {
        guard let id = voiceID, voiceCurrent(id), let context = captureContext, let recorder else { return }
        recorder.delegate = nil; recorder.stop(); self.recorder = nil
        do {
            guard success else { throw WorkbenchError("Recording failed. Your draft was preserved.") }
            let size = try FileManager.default.attributesOfItem(atPath: recorder.url.path)[.size] as? NSNumber
            guard let size, size.intValue > 0, size.intValue <= 1_950_000 else { throw WorkbenchError("Record up to 60 seconds of audio.") }
            let request = try NativeVoice.request(environment: context.environment, conversationID: context.conversationID,
                audio: Data(contentsOf: recorder.url))
            if let voiceDirectory { try FileManager.default.removeItem(at: voiceDirectory) }
            voiceDirectory = nil
            guard chatState.advanceVoice(id, to: .transcribing) else { cancelVoice(); renderChat(); return }
            voiceStatus = "Transcribing…"; renderChat()
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
            voiceTask = Task { [weak self] in
                do {
                    let row = try await bridge.voice(request)
                    guard let self, !Task.isCancelled, self.voiceCurrent(id) else { return }
                    guard try self.chatState.transcribed(context.generation, environment: context.environment,
                        conversationID: context.conversationID, expectedDraft: context.draft, text: row["text"].text) else { return }
                    self.cancelVoice(); self.voiceStatus = "Transcript ready. Review it, then Send."; self.renderChat()
                } catch { self?.voiceFailed(id, error.localizedDescription) }
            }
        } catch { voiceFailed(id, error.localizedDescription) }
    }
    @objc private func readVoice() {
        do {
            let request = try NativeVoice.request(environment: chatState.environment, conversationID: chatState.conversationID, text: chatState.spokenReply)
            let id = try chatState.beginVoice(.synthesizing); voiceID = id
            voiceStatus = "Preparing spoken reply…"; renderChat()
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
            voiceTask = Task { [weak self] in
                do {
                    let row = try await bridge.voice(request)
                    guard let self, !Task.isCancelled, self.voiceCurrent(id),
                          let data = Data(base64Encoded: row["audioBase64"].text) else { return }
                    let player = try AVAudioPlayer(data: data); player.delegate = self; self.player = player
                    guard player.prepareToPlay(), self.chatState.advanceVoice(id, to: .playing), player.play() else {
                        throw WorkbenchError("The spoken reply could not be played.")
                    }
                    self.voiceTask = nil; self.voiceStatus = "Playing reply…"; self.renderChat()
                } catch { self?.voiceFailed(id, error.localizedDescription) }
            }
        } catch { voiceStatus = error.localizedDescription; renderChat() }
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let identity = ObjectIdentifier(recorder)
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map({ ObjectIdentifier($0) }) == identity else { return }
            self.finishRecording(success: flag)
        }
    }
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let identity = ObjectIdentifier(recorder), message = error?.localizedDescription ?? "Recording failed."
        Task { @MainActor [weak self] in
            guard let self, self.recorder.map({ ObjectIdentifier($0) }) == identity, let id = self.voiceID else { return }
            self.voiceFailed(id, message)
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, self.player.map({ ObjectIdentifier($0) }) == identity else { return }
            self.cancelVoice(); self.voiceStatus = flag ? "Playback finished." : "Playback failed."; self.renderChat()
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let identity = ObjectIdentifier(player), message = error?.localizedDescription ?? "Playback failed."
        Task { @MainActor [weak self] in
            guard let self, self.player.map({ ObjectIdentifier($0) }) == identity, let id = self.voiceID else { return }
            self.voiceFailed(id, message)
        }
    }
    @objc private func reconnectCards() {
        guard chatState.ready, models[.papercup]?.visible == true else { return }
        cardsTask?.cancel()
        let generation = cardsState.begin(environment: chatState.environment, conversationID: chatState.conversationID)
        let request = cardsState.subscription, bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        renderCards()
        cardsTask = Task { [weak self] in
            do {
                for try await frame in bridge.cards(request) {
                    guard let self, !Task.isCancelled, self.models[.papercup]?.visible == true else { return }
                    if try self.cardsState.receive(generation, frame) { self.renderCards() }
                }
                throw WorkbenchError("Questions disconnected; reconnect before answering")
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.cardsState.disconnected(generation, error); self.renderCards()
            }
        }
    }
    private func renderCards() {
        let head = cardsState.cards.first
        cardMessage?.stringValue = cardsState.error.map { "Questions · " + $0 } ??
            (cardsState.pending != nil ? "Submitting answer…" : !cardsState.connected ? "Questions disconnected" :
                head == nil ? "No pending questions" : "Question · \(cardsState.cards.count) pending")
        if renderedCard != head {
            renderedCard = head
            for view in cardStack?.arrangedSubviews ?? [] { cardStack?.removeArrangedSubview(view); view.removeFromSuperview() }
            cardChoices = []; cardActions = []; cardInput = nil; cardMultiline = nil
            cardSelect = nil; cardDate = nil; cardSlider = nil
            if let head, let stack = cardStack {
                let prompt = NSTextField(wrappingLabelWithString: head.prose)
                prompt.setAccessibilityLabel("Papercup question"); stack.addArrangedSubview(prompt)
                if head.secureLink(environment: cardsState.environment) != nil {
                    stack.addArrangedSubview(NSButton(title: "Open secure link", target: self, action: #selector(openCardLink)))
                }
                let presentation = head.raw["presentation"]
                switch head.kind {
                case "radio", "checkbox":
                    for option in head.options {
                        let button = NSButton(title: option["label"].text + (option["hint"].text.isEmpty ? "" : " · " + option["hint"].text),
                            target: self, action: #selector(selectCardChoice(_:)))
                        button.setButtonType(head.kind == "radio" ? .radio : .switch)
                        button.identifier = NSUserInterfaceItemIdentifier(option["id"].text)
                        cardChoices.append(button); stack.addArrangedSubview(button)
                    }
                case "select":
                    let select = NSPopUpButton(); select.addItem(withTitle: "Choose an answer")
                    for option in head.options { select.addItem(withTitle: option["label"].text); select.lastItem?.representedObject = option["id"].text }
                    cardSelect = select; stack.addArrangedSubview(select)
                case "text":
                    if presentation["multiline"].isTrue && !presentation["sensitive"].isTrue {
                        let scroll = NSScrollView(); scroll.hasVerticalScroller = true
                        let text = NSTextView(); text.isRichText = false; text.setAccessibilityLabel("Question answer")
                        scroll.documentView = text; text.autoresizingMask = [.width]; text.textContainer?.widthTracksTextView = true
                        stack.addArrangedSubview(scroll); scroll.heightAnchor.constraint(equalToConstant: 70).isActive = true
                        scroll.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true; cardMultiline = text
                    } else {
                        let field: NSTextField = presentation["sensitive"].isTrue ? NSSecureTextField() : NSTextField()
                        field.placeholderString = presentation["placeholder"].text; field.setAccessibilityLabel("Question answer")
                        cardInput = field; stack.addArrangedSubview(field)
                    }
                case "date":
                    let date = NSDatePicker(); date.datePickerElements = .yearMonthDay; date.datePickerStyle = .textFieldAndStepper
                    date.timeZone = TimeZone(secondsFromGMT: 0); date.setAccessibilityLabel("Question date")
                    cardDate = date; stack.addArrangedSubview(date)
                case "slider":
                    if case .number(let min) = presentation["min"], case .number(let max) = presentation["max"], min.isFinite, max.isFinite, max >= min {
                        let slider = NSSlider(value: min, minValue: min, maxValue: max, target: self, action: #selector(stepCardSlider))
                        slider.setAccessibilityLabel("Question value"); cardSlider = slider; stack.addArrangedSubview(slider)
                        stack.addArrangedSubview(NSTextField(labelWithString: "Range \(min) – \(max)"))
                    }
                default: stack.addArrangedSubview(NSTextField(wrappingLabelWithString: head.raw["fallbackText"].text.isEmpty ?
                    "This question needs another supported surface." : head.raw["fallbackText"].text))
                }
                let buttons = NSStackView(); buttons.orientation = .horizontal
                for (title, action) in [("Submit answer", "submit"), ("Skip question", "decline"), ("Cancel question", "cancel")] {
                    if action == "decline" && head.raw["allowDecline"] == .bool(false) { continue }
                    let button = NSButton(title: title, target: self, action: #selector(respondToCard(_:)))
                    button.identifier = NSUserInterfaceItemIdentifier(action); cardActions.append(button); buttons.addArrangedSubview(button)
                }
                stack.addArrangedSubview(buttons)
            }
        }
        let enabled = cardsState.connected && cardsState.pending == nil
        for button in cardChoices { button.isEnabled = enabled }
        for button in cardActions { button.isEnabled = enabled && (button.identifier?.rawValue != "submit" || head?.canSubmit == true) }
        cardInput?.isEnabled = enabled; cardMultiline?.isEditable = enabled; cardSelect?.isEnabled = enabled
        cardDate?.isEnabled = enabled; cardSlider?.isEnabled = enabled
        cardStack?.enclosingScrollView?.isHidden = head == nil
    }
    @objc private func selectCardChoice(_ selected: NSButton) {
        if renderedCard?.kind == "radio" { for button in cardChoices { button.state = button === selected ? .on : .off } }
    }
    @objc private func openCardLink() {
        guard cardsState.connected, let card = renderedCard, cardsState.cards.contains(card),
              let link = card.secureLink(environment: cardsState.environment) else { return }
        if !NSWorkspace.shared.open(link) { cardMessage?.stringValue = "Could not open the selected question link" }
    }
    @objc private func stepCardSlider() {
        guard let slider = cardSlider, let card = renderedCard else { return }
        let step: Double
        if case .number(let n) = card.raw["presentation"]["step"], n.isFinite, n > 0 { step = n } else { step = 1 }
        slider.doubleValue = min(slider.maxValue, slider.minValue + ((slider.doubleValue - slider.minValue) / step).rounded() * step)
    }
    @objc private func respondToCard(_ button: NSButton) {
        guard let card = renderedCard else { return }
        do {
            let action = button.identifier?.rawValue ?? ""
            var value = cardMultiline?.string ?? cardInput?.stringValue ?? ""
            if let date = cardDate {
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.dateFormat = "yyyy-MM-dd"; value = formatter.string(from: date.dateValue)
            }
            if let slider = cardSlider { value = String(slider.doubleValue) }
            var picks = cardChoices.filter { $0.state == .on }.compactMap { $0.identifier?.rawValue }
            if let id = cardSelect?.selectedItem?.representedObject as? String { picks = [id] }
            let payload = action == "submit" ? try card.answer(picks: picks, value: value) : JSONValue.null
            let request = try cardsState.request(card, action: action, payload: payload), generation = cardsState.generation
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui)); renderCards()
            let task = Task { [weak self] in
                do {
                    let receipt = try await bridge.respondToCard(request)
                    guard let self, !Task.isCancelled else { return }
                    if try self.cardsState.responded(generation, id: card.id, receipt: receipt) { self.renderCards() }
                } catch {
                    guard let self, !Task.isCancelled else { return }
                    self.cardsState.responseFailed(generation, error); self.renderCards()
                }
            }
            tasks[.papercup, default: []].append(task)
        } catch { cardMessage?.stringValue = error.localizedDescription }
    }
    private func refreshAccounts() {
        let generation = accountState.begin(); renderAccounts()
        let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
        let task = Task { [weak self] in
            var environment: JSONValue = .null, pool: JSONValue?, steering: JSONValue?, failure: Error?
            do {
                environment = try NativeEnvironment.identity(await bridge.read("operator.identity"))
                async let poolRead = bridge.read("accounts.pool", args: ["workspace": environment["workspaceId"]], environment: environment)
                async let steeringRead = bridge.read("accounts.sessionOverride", args: ["workspaceId": environment["workspaceId"]], environment: environment)
                (pool, steering) = try await (poolRead, steeringRead)
            } catch { failure = error }
            guard let self, !Task.isCancelled, self.models[.accounts]?.visible == true else { return }
            if self.accountState.settle(generation, environment: environment, pool: pool, steering: steering, failure: failure) {
                self.renderAccounts()
            }
        }
        tasks[.accounts, default: []].append(task)
    }
    private func updateAccountControls() {
        let selected = accountState.results(query: models[.accounts]?.query ?? "").contains { $0["id"].text == accountState.selection }
        for button in accountButtons {
            button.isEnabled = accountState.ready && !accountState.busy && (button.identifier?.rawValue == "auto" || selected)
        }
    }
    private func renderAccounts() {
        guard let table = tables[.accounts] else { return }
        rendering = true; defer { rendering = false }
        table.reloadData()
        let rows = accountState.results(query: models[.accounts]?.query ?? "")
        if let index = rows.firstIndex(where: { $0["id"].text == accountState.selection }) {
            table.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        } else { table.deselectAll(nil) }
        messages[.accounts]?.stringValue = accountState.busy ? "Checking account state…" :
            accountState.error.map { "Unavailable · " + $0 } ?? (accountState.accounts.isEmpty ? "No accounts" : "Accounts ready")
        accountScope?.stringValue = accountState.environment == .null ? "Environment unavailable" :
            accountState.environment["endpoint"].text + "\nWorkspace: " + accountState.environment["workspaceId"].text
        let steering = accountState.steering
        accountSummary?.stringValue = steering == .null ? "Steering unavailable" :
            "Default: " + (steering["defaultAccountId"].text.isEmpty ? "This machine’s login" : steering["defaultAccountId"].text) +
            "\nForce: " + (steering["forcedAccounts"].rows ?? []).map { $0.text }.joined(separator: ", ") +
            "\nExclude: " + (steering["excludeAccounts"].rows ?? []).map { $0.text }.joined(separator: ", ") +
            "\nAuto clears Force and Exclude; it preserves Default."
        updateAccountControls()
    }
    @objc private func applyAccount(_ button: NSButton) {
        guard let action = button.identifier?.rawValue else { return }
        do {
            let id = action == "auto" ? nil : accountState.selection
            let generation = try accountState.beginAction(action, accountID: id)
            let environment = accountState.environment
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui)); renderAccounts()
            let task = Task { [weak self] in
                var payload: JSONValue?, failure: Error?
                do { payload = try await bridge.account(action, accountID: id, environment: environment) } catch { failure = error }
                guard let self, !Task.isCancelled, self.models[.accounts]?.visible == true else { return }
                if self.accountState.applied(generation, expected: environment, payload: payload, failure: failure) { self.renderAccounts() }
            }
            tasks[.accounts, default: []].append(task)
        } catch { messages[.accounts]?.stringValue = error.localizedDescription }
    }
    private func renderGoalControls(_ surface: WorkbenchSurface) {
        let goal = goalStates[surface] ?? GoalState()
        let visible = goal.detail != .null && models[surface]?.detail != nil
        goalControls[surface]?.isHidden = !visible; goalStatus[surface]?.isHidden = !visible
        guard visible else { return }
        goalStatus[surface]?.stringValue = "Workspace: " + goal.environment["workspaceId"].text + " · " + goal.environment["endpoint"].text +
            "\nStatus: " + goal.detail["goal"]["status"].text + " · Effective state: " + goal.detail["effectiveStatus"].text +
            " · Holder: " + goal.detail["holderLiveness"].text +
            (goal.busy ? "\nChecking goal action…" : goal.error.map { "\nUnavailable · " + $0 } ?? goal.warning.map { "\n" + $0 } ?? "")
        for case let button as NSButton in goalControls[surface]?.arrangedSubviews ?? [] {
            let action = button.identifier?.rawValue.split(separator: ":").last.map(String.init) ?? ""
            button.isHidden = !goal.actions.contains(action); button.isEnabled = !goal.busy && goal.error == nil
        }
    }
    @objc private func applyGoal(_ button: NSButton) {
        guard let parts = button.identifier?.rawValue.split(separator: ":"), parts.count == 2,
              let surface = WorkbenchSurface(rawValue: String(parts[0])), var goal = goalStates[surface] else { return }
        let action = String(parts[1]); guard goal.actions.contains(action) else { return }
        let alert = NSAlert(); alert.messageText = action.capitalized + " “" + goal.detail["goal"]["title"].text + "”?"
        alert.informativeText = action == "pause" ? "Placement stops and attributed sessions are paused. Unattributed activity may remain." :
            "Apply this goal control in workspace “" + goal.environment["workspaceId"].text + "” on " + goal.environment["endpoint"].text + "."
        alert.addButton(withTitle: action.capitalized); alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let generation = detailGeneration[surface]
        do {
            try goal.beginAction(action); goalStates[surface] = goal; renderGoalControls(surface)
            let bridge = PuiBridge(executable: URL(fileURLWithPath: settings.pui))
            let detail = goal.detail, environment = goal.environment
            let task = Task { [weak self] in
                var payload: JSONValue?, failure: Error?
                do { payload = try await bridge.goal(action, detail: detail, confirmed: true, environment: environment) } catch { failure = error }
                guard let self, !Task.isCancelled, self.detailGeneration[surface] == generation, self.models[surface]?.visible == true else { return }
                self.goalStates[surface]?.applied(payload, failure: failure)
                if self.goalStates[surface]?.error == nil, let payload { self.models[surface]?.detail = payload }
                self.render(surface)
            }
            tasks[surface, default: []].append(task)
        } catch { messages[surface]?.stringValue = error.localizedDescription }
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
