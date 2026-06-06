// PapercuspTermShim — C-ABI surface the Rust desktop dlopens (D-009 macOS).
//
// One exported function attaches a live SwiftTerm terminal (a real native
// terminal view with its own pty — CPU-native, accepted per D-005) INSIDE the
// Tauri window: the WKWebView is shrunk to the right portion and the terminal
// takes the left band (P-014: terminal left, GUI right), both with
// autoresizing so the split tracks window resizes. Must be called on the main
// thread (the Rust side hops via run_on_main_thread).
import AppKit
import SwiftTerm
import WebKit

/// Find the WKWebView anywhere under `view` (tauri/wry nests it).
private func findWebView(_ view: NSView) -> NSView? {
    if view is WKWebView { return view }
    for sub in view.subviews {
        if let hit = findWebView(sub) { return hit }
    }
    return nil
}

/// Attach a terminal hosting `exe` (NUL-separated `args`) to the LEFT
/// `fraction` of the window's content view, shrinking the webview to the
/// remainder. Returns an opaque retained pointer to the terminal view (kept
/// for the window's lifetime), or nil on failure.
@_cdecl("pcterm_attach_left")
public func pcterm_attach_left(
    _ nsWindowPtr: UnsafeMutableRawPointer?,
    _ fraction: Double,
    _ minPx: Double,
    _ maxPx: Double,
    _ exe: UnsafePointer<CChar>?,
    _ argsBlob: UnsafePointer<CChar>?,
    _ argsLen: Int32
) -> UnsafeMutableRawPointer? {
    guard let nsWindowPtr, let exe else { return nil }
    let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
    guard let content = window.contentView else { return nil }
    let bounds = content.bounds
    let extent = min(max(bounds.width * fraction, minPx), max(maxPx, minPx))

    // Terminal: left band, full height. Autoresize height + keep the right
    // margin flexible so the band stays put as the window grows.
    let term = LocalProcessTerminalView(
        frame: NSRect(x: 0, y: 0, width: extent, height: bounds.height))
    term.autoresizingMask = [.height]

    // Shrink the webview to the right remainder (width tracks the window).
    if let webview = findWebView(content) {
        webview.frame = NSRect(
            x: extent, y: 0, width: bounds.width - extent, height: bounds.height)
        webview.autoresizingMask = [.width, .height]
    }
    content.addSubview(term)

    // argsBlob: NUL-separated argv tail (exe is argv[0]).
    var args: [String] = []
    if let argsBlob, argsLen > 0 {
        let data = Data(bytes: argsBlob, count: Int(argsLen))
        args = data.split(separator: 0).compactMap { String(data: $0, encoding: .utf8) }
    }
    term.startProcess(executable: String(cString: exe), args: args)
    return Unmanaged.passRetained(term).toOpaque()
}
