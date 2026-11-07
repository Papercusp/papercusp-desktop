import Foundation

public struct OrganizerDisplay {
    public let id: String, frame: OrganizerRect, workArea: OrganizerRect
    public init(id: String, frame: OrganizerRect, workArea: OrganizerRect) {
        self.id = id; self.frame = frame; self.workArea = workArea
    }
}
public enum OrganizerGeometry {
    /// AppKit uses bottom-left coordinates; AX and WindowServer use the
    /// primary display's top-left, including negative secondary coordinates.
    public static func topLeft(_ rect: OrganizerRect, primaryTop: Double) -> OrganizerRect {
        OrganizerRect(x: rect.x, y: primaryTop - rect.y - rect.height, width: rect.width, height: rect.height)
    }
    public static func display(for bounds: OrganizerRect, displays: [OrganizerDisplay]) -> OrganizerDisplay? {
        guard bounds.valid else { return nil }
        var best: OrganizerDisplay?, largest = 0.0, tied = false
        for display in displays where display.frame.valid && display.workArea.valid {
            let right = min(bounds.x + bounds.width, display.frame.x + display.frame.width)
            let left = max(bounds.x, display.frame.x)
            let bottom = min(bounds.y + bounds.height, display.frame.y + display.frame.height)
            let top = max(bounds.y, display.frame.y)
            let overlap = max(0, right - left) * max(0, bottom - top)
            if overlap > largest { best = display; largest = overlap; tied = false }
            else if overlap > 0 && overlap == largest { tied = true }
        }
        return tied ? nil : best
    }
}

#if os(macOS)
import AppKit
import ApplicationServices

/// Public AX and WindowServer APIs only. Spaces that cannot be identified and
/// controlled through those APIs remain explicit per-window unsupported results.
@MainActor public final class NativeOrganizer {
    private struct Entry {
        let element: AXUIElement, pid: pid_t, title: String
    }
    private var entries: [String: Entry] = [:]
    public init() {}
    private func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
        return value
    }
    private func bounds(_ element: AXUIElement) -> OrganizerRect? {
        guard let position = attribute(element, kAXPositionAttribute as CFString),
              let size = attribute(element, kAXSizeAttribute as CFString),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, extent = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
        let rect = OrganizerRect(x: point.x, y: point.y, width: extent.width, height: extent.height)
        return rect.valid ? rect : nil
    }
    private func metadata() throws -> [[String: Any]] {
        guard let values = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            throw WorkbenchError("WindowServer could not enumerate terminal windows")
        }
        return values.filter { ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 }
    }
    private func displays() -> [OrganizerDisplay] {
        guard let primary = NSScreen.screens.first else { return [] }
        func rect(_ value: NSRect) -> OrganizerRect {
            OrganizerGeometry.topLeft(OrganizerRect(x: value.minX, y: value.minY, width: value.width, height: value.height),
                primaryTop: primary.frame.maxY)
        }
        return NSScreen.screens.compactMap { screen in
            guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            return OrganizerDisplay(id: id.stringValue, frame: rect(screen.frame), workArea: rect(screen.visibleFrame))
        }
    }
    private func describe(_ info: [String: Any], title: String, element: AXUIElement?) -> OrganizerWindow? {
        guard let id = info[kCGWindowNumber as String] as? NSNumber,
              let dictionary = info[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { return nil }
        let rect = OrganizerRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height)
        let display = OrganizerGeometry.display(for: rect, displays: displays())
        let visible = (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
        var unsupported: String?
        if !visible { unsupported = "This Space or minimized window is not controllable through public macOS APIs" }
        else if display == nil { unsupported = "The window's display is unavailable or ambiguous" }
        else if let element {
            var position: DarwinBoolean = false, size: DarwinBoolean = false
            if (attribute(element, kAXMinimizedAttribute as CFString) as? NSNumber)?.boolValue == true ||
                (attribute(element, "AXFullScreen" as CFString) as? NSNumber)?.boolValue == true {
                unsupported = "Minimized and full-screen windows cannot be arranged"
            } else if AXUIElementIsAttributeSettable(element, kAXPositionAttribute as CFString, &position) != .success ||
                AXUIElementIsAttributeSettable(element, kAXSizeAttribute as CFString, &size) != .success || !position.boolValue || !size.boolValue {
                unsupported = "This terminal does not permit Accessibility move and resize"
            }
        } else { unsupported = "The exact Accessibility window is unavailable or ambiguous" }
        return OrganizerWindow(id: id.stringValue, title: title, desktop: visible ? "current-space" : nil,
            monitor: display?.id, area: display?.workArea, bounds: rect, unsupported: unsupported)
    }
    public func snapshot() throws -> [OrganizerWindow] {
        guard AXIsProcessTrusted() else {
            throw WorkbenchError("Enable Papercusp Workbench in System Settings → Privacy & Security → Accessibility, then refresh")
        }
        entries = [:]
        var applications: [pid_t: [AXUIElement]] = [:], result: [OrganizerWindow] = []
        for info in try metadata() {
            guard let number = info[kCGWindowNumber as String] as? NSNumber,
                  let process = info[kCGWindowOwnerPID as String] as? NSNumber,
                  let dictionary = info[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { continue }
            let pid = process.int32Value
            if applications[pid] == nil {
                let app = AXUIElementCreateApplication(pid); AXUIElementSetMessagingTimeout(app, 0.3)
                applications[pid] = attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []
            }
            let title = info[kCGWindowName as String] as? String ?? ""
            let rect = OrganizerRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height)
            let matches = (applications[pid] ?? []).filter { element in
                guard let measured = bounds(element), measured.matches(rect) else { return false }
                return title.isEmpty || (attribute(element, kAXTitleAttribute as CFString) as? String) == title
            }
            let element = matches.count == 1 ? matches[0] : nil
            let exactTitle = element.flatMap { attribute($0, kAXTitleAttribute as CFString) as? String } ?? title
            if let element { entries[number.stringValue] = Entry(element: element, pid: pid, title: exactTitle) }
            if let window = describe(info, title: exactTitle, element: element) { result.append(window) }
        }
        return result
    }
    private func observe(_ window: OrganizerWindow, entry: Entry) throws -> OrganizerWindow {
        guard let info = try metadata().first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.stringValue == window.id }),
              (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == entry.pid,
              (attribute(entry.element, kAXTitleAttribute as CFString) as? String) == entry.title,
              let current = describe(info, title: entry.title, element: entry.element),
              current.desktop == window.desktop, current.monitor == window.monitor, current.unsupported == nil else {
            throw WorkbenchError("The terminal identity, Space or display changed; refresh before arranging")
        }
        return current
    }
    public func place(_ window: OrganizerWindow, rect: OrganizerRect) async throws -> OrganizerWindow {
        try Task.checkCancellation()
        guard rect.valid, let entry = entries[window.id], entry.title == window.title else {
            throw WorkbenchError("The exact native terminal binding expired")
        }
        let before = try observe(window, entry: entry)
        guard let actual = bounds(entry.element), let expected = before.bounds, actual.matches(expected) else {
            throw WorkbenchError("Accessibility and WindowServer disagree about this terminal")
        }
        var point = CGPoint(x: rect.x, y: rect.y), size = CGSize(width: rect.width, height: rect.height)
        guard let positionValue = AXValueCreate(.cgPoint, &point), let sizeValue = AXValueCreate(.cgSize, &size),
              AXUIElementSetAttributeValue(entry.element, kAXSizeAttribute as CFString, sizeValue) == .success,
              AXUIElementSetAttributeValue(entry.element, kAXPositionAttribute as CFString, positionValue) == .success else {
            throw WorkbenchError("macOS refused to move or resize this terminal")
        }
        for _ in 0..<12 {
            try Task.checkCancellation()
            let observed = try observe(window, entry: entry)
            if let actual = bounds(entry.element), let measured = observed.bounds,
               rect.matches(actual), rect.matches(measured) { return observed }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw WorkbenchError("macOS did not confirm the requested terminal geometry")
    }
}
#endif
