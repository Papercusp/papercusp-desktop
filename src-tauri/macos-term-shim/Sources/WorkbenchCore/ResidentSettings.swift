import Foundation

public enum WorkbenchSurface: String, Codable, CaseIterable {
    case quickAccess, papercup, accounts, organizer, goals, inbox
    public var title: String {
        switch self { case .quickAccess: return "Quick Access"; case .papercup: return "Papercup"
        case .accounts: return "Accounts"; case .organizer: return "Organize windows"
        case .goals: return "Goals"; case .inbox: return "Inbox" }
    }
}
public struct Shortcut: Codable, Equatable {
    public var keyCode: UInt32
    public var modifiers: UInt32
    public init(keyCode: UInt32, modifiers: UInt32) { self.keyCode = keyCode; self.modifiers = modifiers }
}
public struct ResidentSettings: Codable {
    public var enabled = true
    public var pui: String
    public var shortcuts: [String: Shortcut]
    public init(pui: String) {
        self.pui = pui
        // Carbon Cmd+Ctrl+Option; normal vendor input is not intercepted.
        let keys: [WorkbenchSurface: UInt32] = [.quickAccess:12, .papercup:35, .accounts:0, .organizer:31, .goals:5, .inbox:34]
        shortcuts = Dictionary(uniqueKeysWithValues: keys.map { ($0.key.rawValue, Shortcut(keyCode: $0.value, modifiers: 6400)) })
    }
    public static func load(from url: URL, defaultPui: String) throws -> ResidentSettings {
        guard FileManager.default.fileExists(atPath: url.path) else { return ResidentSettings(pui: defaultPui) }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: [.atomic])
    }
}
public enum ShortcutReplacement {
    /// Keep the old registration until candidate registration AND persistence
    /// succeed. A conflict or failed save rolls back only the candidate.
    public static func commit<Token>(old: Token?, register: () throws -> Token,
                                     persist: () throws -> Void, unregister: (Token) -> Void) throws -> Token {
        let candidate = try register()
        do { try persist() } catch { unregister(candidate); throw error }
        if let old { unregister(old) }
        return candidate
    }
}
