// native_terminal — the native sibling terminal window glued to the GUI.
//
// Owner directive (native-terminal-desktop-2026-06-06): the desktop terminal
// must be a fully NATIVE terminal, NOT xterm.js. A webview renders HTML and
// can only host a *web* terminal, so the native terminal cannot be a Tauri /
// dockview pane. Option A: the terminal workbench (`pui workbench` = zellij +
// the ratatui pui) runs in its OWN native window, a SIBLING of the Tauri GUI
// window, glued visually so the pair reads as one app.
//
// Strategy (P-001 / P-008):
//   - Linux/X11  → GluedGhosttyX11 (D-003): spawn a borderless GPU-native
//     Ghostty window hosting `pui workbench`, share the app-id (WM_CLASS) with
//     the Tauri window, matched theme, and pin it flush-adjacent on every
//     Tauri-window move/resize (EWMH _NET_MOVERESIZE_WINDOW). GPU-native +
//     one-window-look, X11-only (only X11 lets you position a foreign window).
//   - Wayland / macOS / Windows → EmbeddedView (D-004, Phase 2): the app owns
//     a terminal window and renders a native terminal VIEW in it
//     (VTE / SwiftTerm / ConPTY — CPU-native, D-005). Not buildable/testable
//     on this X11 box; until those land we fall back to NewWindow (launch
//     `pui workbench` in a real native terminal window — still native, just
//     not glued). The seam is kept clean so a future embeddable libghostty
//     drops into the EmbeddedView path without rework.
//   - No display (headless / CI) → Disabled.
//
// The glue is VISUAL ONLY (D-006): the terminal coordinates with the GUI
// through the durable substrate (operator API / coord / roster), exactly as
// the standalone pui does — never through the window relationship. Nothing in
// this module touches that; `pui workbench` is already a standalone substrate
// client.

use std::sync::Mutex;

// ───────────────────────────────────────────────────────────────────────────
// P-001 — runtime session detection + strategy selection (pure, testable)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayServer {
    X11,
    Wayland,
    /// No display at all (headless / CI / a TTY-only session).
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Mac,
    Windows,
}

/// The per-OS embedded native terminal VIEW backend (Phase 2 / D-004).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedBackend {
    /// Linux/GTK — a VTE terminal widget beside the WebKitGTK webview.
    /// Wayland-safe (in-window, no foreign positioning).
    Vte,
    /// macOS — SwiftTerm in an NSWindow child window.
    SwiftTerm,
    /// Windows — a ConPTY-backed terminal control.
    ConPty,
}

/// The chosen terminal strategy for this desktop session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalStrategy {
    /// Linux/X11 v1: borderless GPU-native Ghostty sibling, glued by geometry.
    GluedGhosttyX11,
    /// Phase 2 portable path: an owned window with an embedded native view.
    EmbeddedView(EmbedBackend),
    /// Interim cross-platform fallback while the embedded views are unbuilt:
    /// launch `pui workbench` in a real native terminal NEW WINDOW (native,
    /// not glued). Reuses the proven `native_console` new-window spawner.
    NewWindow,
    /// Headless / no display — no terminal window.
    Disabled,
}

impl TerminalStrategy {
    /// Stable label for logs + the `native_terminal_status` command, so the
    /// rest of the desktop (and a debugging human) can see what was chosen.
    pub fn label(self) -> &'static str {
        match self {
            TerminalStrategy::GluedGhosttyX11 => "glued-ghostty-x11",
            TerminalStrategy::EmbeddedView(EmbedBackend::Vte) => "embedded-vte",
            TerminalStrategy::EmbeddedView(EmbedBackend::SwiftTerm) => "embedded-swiftterm",
            TerminalStrategy::EmbeddedView(EmbedBackend::ConPty) => "embedded-conpty",
            TerminalStrategy::NewWindow => "new-window",
            TerminalStrategy::Disabled => "disabled",
        }
    }
}

/// What we resolved about the running session. Built from env (X11/Wayland)
/// + the compile-time OS so the selection logic stays a pure function we can
/// unit-test on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionInfo {
    pub os: Os,
    pub display: DisplayServer,
}

/// Resolve the display server from the standard env vars. `xdg_session_type`
/// is authoritative when present ("x11"/"wayland"/"tty"); otherwise fall back
/// to WAYLAND_DISPLAY (wayland) / DISPLAY (x11) presence. Pure over its inputs.
pub fn detect_display_server(
    xdg_session_type: Option<&str>,
    wayland_display: Option<&str>,
    x11_display: Option<&str>,
) -> DisplayServer {
    let nonempty = |o: Option<&str>| o.map(|s| !s.is_empty()).unwrap_or(false);
    match xdg_session_type.map(|s| s.trim().to_ascii_lowercase()) {
        Some(ref s) if s == "wayland" => return DisplayServer::Wayland,
        Some(ref s) if s == "x11" => return DisplayServer::X11,
        // "tty" / unknown → fall through to the var-presence heuristic.
        _ => {}
    }
    if nonempty(wayland_display) {
        DisplayServer::Wayland
    } else if nonempty(x11_display) {
        DisplayServer::X11
    } else {
        DisplayServer::None
    }
}

/// Compile-time OS. Kept as a fn so tests can construct any `SessionInfo`.
pub fn current_os() -> Os {
    if cfg!(target_os = "macos") {
        Os::Mac
    } else if cfg!(target_os = "windows") {
        Os::Windows
    } else {
        Os::Linux
    }
}

/// The core routing decision (P-001 / P-008). Pure over `SessionInfo`.
///
///   Linux + X11      → glued foreign Ghostty (the v1).
///   Linux + Wayland  → embedded VTE view (Phase 2).
///   Linux + None     → Disabled (headless).
///   macOS            → embedded SwiftTerm view (Phase 2).
///   Windows          → embedded ConPTY control (Phase 2).
pub fn select_strategy(info: SessionInfo) -> TerminalStrategy {
    match info.os {
        Os::Linux => match info.display {
            DisplayServer::X11 => TerminalStrategy::GluedGhosttyX11,
            DisplayServer::Wayland => TerminalStrategy::EmbeddedView(EmbedBackend::Vte),
            DisplayServer::None => TerminalStrategy::Disabled,
        },
        Os::Mac => TerminalStrategy::EmbeddedView(EmbedBackend::SwiftTerm),
        Os::Windows => TerminalStrategy::EmbeddedView(EmbedBackend::ConPty),
    }
}

/// Resolve the strategy from the live process environment, applying the
/// `PAPERCUSP_NATIVE_TERMINAL` opt-out and an interim policy: the Phase-2
/// embedded views aren't built yet, so any `EmbeddedView` selection is served
/// by the `NewWindow` fallback for now (still a real native terminal). When a
/// backend ships, drop it from this downgrade set.
///
/// `PAPERCUSP_NATIVE_TERMINAL=0` forces Disabled (no sibling terminal).
/// `PAPERCUSP_NATIVE_TERMINAL_FORCE=<label>` overrides detection for testing
/// (`glued-ghostty-x11` / `new-window` / `disabled`).
pub fn resolve_strategy_from_env() -> TerminalStrategy {
    let get = |k: &str| std::env::var(k).ok();
    if get("PAPERCUSP_NATIVE_TERMINAL").as_deref() == Some("0") {
        return TerminalStrategy::Disabled;
    }
    if let Some(forced) = get("PAPERCUSP_NATIVE_TERMINAL_FORCE") {
        match forced.trim() {
            "glued-ghostty-x11" => return TerminalStrategy::GluedGhosttyX11,
            "new-window" => return TerminalStrategy::NewWindow,
            "disabled" => return TerminalStrategy::Disabled,
            "embedded-vte" => return TerminalStrategy::EmbeddedView(EmbedBackend::Vte),
            _ => {}
        }
    }
    let info = SessionInfo {
        os: current_os(),
        display: detect_display_server(
            get("XDG_SESSION_TYPE").as_deref(),
            get("WAYLAND_DISPLAY").as_deref(),
            get("DISPLAY").as_deref(),
        ),
    };
    downgrade_unbuilt(select_strategy(info))
}

/// Phase-2 backends aren't implemented on this build yet — serve them with the
/// NewWindow fallback so the cross-platform path is still a real native
/// terminal. Centralised here so enabling a backend is a one-line change.
fn downgrade_unbuilt(s: TerminalStrategy) -> TerminalStrategy {
    match s {
        TerminalStrategy::EmbeddedView(_) => TerminalStrategy::NewWindow,
        other => other,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// P-005 — glue geometry (pure, testable)
// ───────────────────────────────────────────────────────────────────────────

/// A screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Which edge of the GUI window the terminal sibling docks against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockSide {
    Right,
    Left,
    Bottom,
    Top,
}

impl DockSide {
    pub fn from_env(v: Option<&str>) -> DockSide {
        match v.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("right") => DockSide::Right,
            Some("bottom") => DockSide::Bottom,
            Some("top") => DockSide::Top,
            Some("left") => DockSide::Left,
            // Default (unset / unrecognized) = LEFT: the native terminal docks on
            // the LEFT and the Tauri GUI sits on the right (native-terminal-desktop
            // D-011 / P-014). Override with PAPERCUSP_NATIVE_TERMINAL_SIDE=right.
            _ => DockSide::Left,
        }
    }
}

/// Compute the sibling terminal's rect so it sits flush against `main` on the
/// chosen side. `extent` is the terminal's size on the docking axis (width for
/// Left/Right, height for Top/Bottom); the other axis matches the GUI window
/// so the two read as one tiled surface. `gap` is the inter-window gap in px
/// (0 = seamless).
pub fn compute_sibling_geometry(main: Rect, side: DockSide, extent: i32, gap: i32) -> Rect {
    let extent = extent.max(1);
    match side {
        DockSide::Right => Rect {
            x: main.x + main.w + gap,
            y: main.y,
            w: extent,
            h: main.h,
        },
        DockSide::Left => Rect {
            x: main.x - extent - gap,
            y: main.y,
            w: extent,
            h: main.h,
        },
        DockSide::Bottom => Rect {
            x: main.x,
            y: main.y + main.h + gap,
            w: main.w,
            h: extent,
        },
        DockSide::Top => Rect {
            x: main.x,
            y: main.y - extent - gap,
            w: main.w,
            h: extent,
        },
    }
}

/// Whether two rects are within `tol` px on every coordinate. Used by the glue
/// to decide if the sibling has drifted far enough from its target to re-assert.
/// The tolerance is deliberately larger than a terminal cell (terminals snap
/// width/height to the character grid) so a snapped size isn't mistaken for
/// drift and re-sent forever — but small enough to catch a real reset (a window
/// that jumped back to its default origin/size is off by hundreds of px).
pub fn rects_close(a: Rect, b: Rect, tol: i32) -> bool {
    (a.x - b.x).abs() <= tol
        && (a.y - b.y).abs() <= tol
        && (a.w - b.w).abs() <= tol
        && (a.h - b.h).abs() <= tol
}

/// The terminal's extent on the docking axis: a fraction of the GUI window's
/// size on that axis, clamped to sane bounds so the terminal is never a sliver
/// or wider than the GUI. Pure.
pub fn sibling_extent(main: Rect, side: DockSide, fraction: f32, min_px: i32, max_px: i32) -> i32 {
    let axis = match side {
        DockSide::Right | DockSide::Left => main.w,
        DockSide::Top | DockSide::Bottom => main.h,
    };
    let raw = (axis as f32 * fraction).round() as i32;
    raw.clamp(min_px.min(max_px), max_px.max(min_px))
}

// ───────────────────────────────────────────────────────────────────────────
// P-015 — draggable split: the extent is USER-DRIVEN, not a fixed fraction
// ───────────────────────────────────────────────────────────────────────────

/// The (boundary, far) coordinates of the GUI window along the docking axis. The
/// *boundary* is the GUI edge the terminal docks flush against (the visible seam
/// between the two windows); the *far* edge is the opposite one. Horizontal axis
/// for Left/Right, vertical for Top/Bottom.
fn axis_edges(g: Rect, side: DockSide) -> (i32, i32) {
    match side {
        DockSide::Left => (g.x, g.x + g.w),
        DockSide::Right => (g.x + g.w, g.x),
        DockSide::Top => (g.y, g.y + g.h),
        DockSide::Bottom => (g.y + g.h, g.y),
    }
}

/// +1 when pushing the boundary edge outward (Left/Top: boundary coordinate
/// increasing) GROWS the terminal; -1 when it's the other way (Right/Bottom).
fn growth_sign(side: DockSide) -> i32 {
    match side {
        DockSide::Left | DockSide::Top => 1,
        DockSide::Right | DockSide::Bottom => -1,
    }
}

/// The terminal extent for this tick, given how the GUI window moved since the
/// last tick. Implements the **draggable split** (P-015): the terminal's inner
/// edge stays flush to the GUI's boundary edge (`compute_sibling_geometry` does
/// that), and its OUTER edge is anchored — so *dragging the boundary edge*
/// RESIZES the terminal, while *moving the whole window* only TRANSLATES it.
///
/// Along the docking axis the boundary edge moves by `d_boundary` and the far
/// edge by `d_far`. With a single pointer only one gesture happens per tick, so:
///   - whole-window move  → both edges shift equally (`d_boundary == d_far`)
///     → resize component 0 → extent unchanged (the terminal just translates).
///   - boundary-edge drag → far edge fixed (`d_far == 0`) → resize component
///     `d_boundary` → the terminal grows/shrinks by it.
///   - far-edge drag      → boundary fixed (`d_boundary == 0`) → extent unchanged.
/// The resize component is `d_boundary - d_far`, applied with the side's growth
/// sign and re-clamped to the configured bounds. (X11 v1 drives the split from
/// the GUI's WM-resizable edge; the embedded-view one-window path gets true
/// bidirectional drag for free — native-terminal-desktop D-012.)
pub fn resized_extent(
    side: DockSide,
    prev_gui: Rect,
    cur_gui: Rect,
    extent: i32,
    min_px: i32,
    max_px: i32,
) -> i32 {
    let lo = min_px.min(max_px);
    let hi = max_px.max(min_px);
    let (boundary_prev, far_prev) = axis_edges(prev_gui, side);
    let (boundary_cur, far_cur) = axis_edges(cur_gui, side);
    let d_boundary = boundary_cur - boundary_prev;
    if d_boundary == 0 {
        return extent.clamp(lo, hi);
    }
    let resize = d_boundary - (far_cur - far_prev);
    (extent + growth_sign(side) * resize).clamp(lo, hi)
}

// ───────────────────────────────────────────────────────────────────────────
// P-004 — the Ghostty launch argv (pure, testable)
// ───────────────────────────────────────────────────────────────────────────

/// Inputs to the Ghostty launch — kept as data so the argv builder is pure and
/// unit-testable without spawning anything.
#[derive(Debug, Clone)]
pub struct GhosttySpec {
    /// WM_CLASS *class* — shared with the Tauri window's app-id so taskbar /
    /// alt-tab group the pair as one app (P-004).
    pub class: String,
    /// WM_CLASS *instance* — unique so we can find the window deterministically.
    pub instance: String,
    /// Background hex (e.g. "#282c34"), matched to the GUI theme so there's no
    /// visual seam.
    pub background: String,
    /// The command Ghostty hosts. Normally `["pui", "workbench"]`.
    pub command: Vec<String>,
    /// ghostty binary (overridable via PAPERCUSP_GHOSTTY_BIN for tests / snaps).
    pub bin: String,
}

impl GhosttySpec {
    /// The default workbench spec: a borderless GPU-native Ghostty hosting
    /// `pui workbench`, sharing the desktop app-id.
    pub fn workbench() -> GhosttySpec {
        let class = std::env::var("PAPERCUSP_NATIVE_TERMINAL_CLASS")
            .unwrap_or_else(|_| "com.papercusp.desktop".to_string());
        let background = std::env::var("PAPERCUSP_NATIVE_TERMINAL_BG")
            .unwrap_or_else(|_| "#282c34".to_string());
        let bin = std::env::var("PAPERCUSP_GHOSTTY_BIN").unwrap_or_else(|_| "ghostty".to_string());
        let command = match std::env::var("PAPERCUSP_NATIVE_TERMINAL_CMD") {
            Ok(s) if !s.trim().is_empty() => {
                s.split_whitespace().map(|x| x.to_string()).collect()
            }
            _ => vec!["pui".to_string(), "workbench".to_string()],
        };
        GhosttySpec {
            class,
            instance: "papercusp-terminal".to_string(),
            background,
            command,
            bin,
        }
    }

    /// Build the full ghostty argv (everything after the binary). Borderless,
    /// shared class, matched background, spawn-per-process (so the PID owns the
    /// window and is trackable), hosting the command via `-e`.
    pub fn argv(&self) -> Vec<String> {
        let mut a = vec![
            format!("--class={}", self.class),
            format!("--x11-instance-name={}", self.instance),
            "--window-decoration=false".to_string(),
            "--gtk-single-instance=false".to_string(),
            "--quit-after-last-window-closed=true".to_string(),
            "--confirm-close-surface=false".to_string(),
            format!("--background={}", self.background),
        ];
        // `-e <cmd...>` MUST be last — ghostty treats everything after it as the
        // hosted command line.
        a.push("-e".to_string());
        a.extend(self.command.iter().cloned());
        a
    }
}

// ───────────────────────────────────────────────────────────────────────────
// The live manager (Tauri-managed state)
// ───────────────────────────────────────────────────────────────────────────

/// Per-run config resolved once at boot.
#[derive(Debug, Clone)]
pub struct GlueConfig {
    pub side: DockSide,
    pub fraction: f32,
    pub min_px: i32,
    pub max_px: i32,
    pub gap: i32,
}

impl GlueConfig {
    pub fn from_env() -> GlueConfig {
        let f = |k: &str, d: f32| {
            std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
        };
        let i = |k: &str, d: i32| {
            std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
        };
        GlueConfig {
            side: DockSide::from_env(std::env::var("PAPERCUSP_NATIVE_TERMINAL_SIDE").ok().as_deref()),
            fraction: f("PAPERCUSP_NATIVE_TERMINAL_FRACTION", 0.42),
            min_px: i("PAPERCUSP_NATIVE_TERMINAL_MIN_PX", 480),
            max_px: i("PAPERCUSP_NATIVE_TERMINAL_MAX_PX", 1200),
            gap: i("PAPERCUSP_NATIVE_TERMINAL_GAP", 0),
        }
    }
}

struct Live {
    /// The spawned ghostty process. Killing it SIGHUPs the hosted zellij/pui.
    /// All the X11 glue state (window ids, extent, last target) lives in the
    /// loop thread's `GlueSession`, not here.
    child: std::process::Child,
}

pub struct NativeTerminal {
    pub strategy: TerminalStrategy,
    pub config: GlueConfig,
    live: Mutex<Option<Live>>,
}

impl NativeTerminal {
    pub fn new(strategy: TerminalStrategy) -> NativeTerminal {
        NativeTerminal {
            strategy,
            config: GlueConfig::from_env(),
            live: Mutex::new(None),
        }
    }

    pub fn is_running(&self) -> bool {
        self.live.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// PID of the spawned ghostty process, if running. The glue loop resolves
    /// the sibling X11 window by this pid (`_NET_WM_PID`).
    pub fn ghostty_pid(&self) -> Option<u32> {
        self.live
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|l| l.child.id()))
    }
}

#[cfg(target_os = "linux")]
mod x11_glue {
    //! The X11 glue. One PERSISTENT connection drives the whole loop: opening a
    //! fresh connection per op (the naive approach) is too slow under Xvfb — the
    //! handshake dominates and the effective tick rate collapses to ~1/s, so the
    //! sibling lags the GUI by seconds. We resolve both windows by `_NET_WM_PID`
    //! once, read the GUI window's TRUE geometry from the server each tick
    //! (Tauri's `outer_position` lags WM moves), and pin the borderless Ghostty
    //! sibling with EWMH `_NET_MOVERESIZE_WINDOW` (what wmctrl uses; works under
    //! reparenting WMs). Foreign-window positioning is exactly what X11 uniquely
    //! allows (D-003) and Wayland forbids.
    use super::{
        compute_sibling_geometry, rects_close, resized_extent, sibling_extent, DockSide,
        GlueConfig, Rect,
    };
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, StackMode,
    };
    use x11rb::rust_connection::RustConnection;

    fn intern(conn: &RustConnection, name: &[u8]) -> Option<u32> {
        conn.intern_atom(false, name).ok()?.reply().ok().map(|r| r.atom)
    }

    /// A live glue session: the connection + resolved windows + the dock config
    /// + the fixed extent and last target. Owned by the glue-loop thread.
    pub struct GlueSession {
        conn: RustConnection,
        root: u32,
        net_client_list: u32,
        net_wm_pid: u32,
        net_moveresize: u32,
        net_frame_extents: u32,
        gui: u32,
        sibling: u32,
        side: DockSide,
        fraction: f32,
        min_px: i32,
        max_px: i32,
        gap: i32,
        extent: Option<i32>,
        last_target: Option<Rect>,
        /// Previous tick's GUI outer rect — the baseline the draggable split
        /// (P-015) diffs against to tell a boundary-edge RESIZE from a
        /// whole-window MOVE. `None` until the first tick seeds it.
        last_gui: Option<Rect>,
    }

    impl GlueSession {
        /// Connect, intern atoms, and resolve both windows: the sibling by the
        /// ghostty pid (retried ~4s, since ghostty maps its window late) and our
        /// own GUI window by our process pid. None if X is unreachable or the
        /// sibling never appears.
        pub fn connect(sibling_pid: u32, gui_pid: u32, cfg: &GlueConfig) -> Option<Self> {
            let (conn, screen) = x11rb::connect(None).ok()?;
            let root = conn.setup().roots[screen].root;
            let net_client_list = intern(&conn, b"_NET_CLIENT_LIST")?;
            let net_wm_pid = intern(&conn, b"_NET_WM_PID")?;
            let net_moveresize = intern(&conn, b"_NET_MOVERESIZE_WINDOW")?;
            let net_frame_extents = intern(&conn, b"_NET_FRAME_EXTENTS")?;
            let mut me = GlueSession {
                conn,
                root,
                net_client_list,
                net_wm_pid,
                net_moveresize,
                net_frame_extents,
                gui: 0,
                sibling: 0,
                side: cfg.side,
                fraction: cfg.fraction,
                min_px: cfg.min_px,
                max_px: cfg.max_px,
                gap: cfg.gap,
                extent: None,
                last_target: None,
                last_gui: None,
            };
            let mut sibling = None;
            for _ in 0..40 {
                if let Some(w) = me.find_by_pid(sibling_pid) {
                    sibling = Some(w);
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            me.sibling = sibling?;
            me.gui = me.find_by_pid(gui_pid)?;
            Some(me)
        }

        pub fn sibling(&self) -> u32 {
            self.sibling
        }

        fn window_pid(&self, win: u32) -> Option<u32> {
            let r = self
                .conn
                .get_property(false, win, self.net_wm_pid, AtomEnum::CARDINAL, 0, 1)
                .ok()?
                .reply()
                .ok()?;
            r.value32().and_then(|mut it| it.next())
        }

        /// First top-level window (in `_NET_CLIENT_LIST`) owned by `pid`.
        fn find_by_pid(&self, pid: u32) -> Option<u32> {
            let r = self
                .conn
                .get_property(false, self.root, self.net_client_list, AtomEnum::WINDOW, 0, 4096)
                .ok()?
                .reply()
                .ok()?;
            for w in r.value32()?.collect::<Vec<u32>>() {
                if self.window_pid(w) == Some(pid) {
                    return Some(w);
                }
            }
            None
        }

        /// OUTER frame geometry of `win` in root coords (client geom translated
        /// to root, expanded by `_NET_FRAME_EXTENTS`).
        fn geometry(&self, win: u32) -> Option<Rect> {
            let geo = self.conn.get_geometry(win).ok()?.reply().ok()?;
            let t = self
                .conn
                .translate_coordinates(win, self.root, 0, 0)
                .ok()?
                .reply()
                .ok()?;
            let (mut fl, mut fr, mut ft, mut fb) = (0i32, 0i32, 0i32, 0i32);
            if let Ok(Ok(reply)) = self
                .conn
                .get_property(false, win, self.net_frame_extents, AtomEnum::CARDINAL, 0, 4)
                .map(|c| c.reply())
            {
                let vals: Vec<u32> = reply.value32().map(|it| it.collect()).unwrap_or_default();
                if vals.len() == 4 {
                    fl = vals[0] as i32;
                    fr = vals[1] as i32;
                    ft = vals[2] as i32;
                    fb = vals[3] as i32;
                }
            }
            Some(Rect {
                x: t.dst_x as i32 - fl,
                y: t.dst_y as i32 - ft,
                w: geo.width as i32 + fl + fr,
                h: geo.height as i32 + ft + fb,
            })
        }

        fn move_resize(&self, win: u32, x: i32, y: i32, w: i32, h: i32) {
            // data.l[0]: low byte = gravity (0); bits 8..=11 flag x,y,w,h present;
            // bits 12..13 = source indication (2 = pager/app per EWMH).
            let flags: u32 = (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (2 << 12);
            let data = [flags, x as u32, y as u32, w.max(1) as u32, h.max(1) as u32];
            let event = ClientMessageEvent::new(32, win, self.net_moveresize, data);
            let mask = EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT;
            let _ = self.conn.send_event(false, self.root, mask, event);
            let _ = self.conn.flush();
        }

        /// Raise the sibling above (keep it with the GUI's z-order — "share
        /// focus sensibly"). Called once after the initial placement.
        pub fn raise(&self) {
            use x11rb::protocol::xproto::ConfigureWindowAux;
            let aux = ConfigureWindowAux::new().stack_mode(StackMode::ABOVE);
            let _ = self.conn.configure_window(self.sibling, &aux);
            let _ = self.conn.flush();
        }

        /// One glue step: read the GUI geometry and pin the sibling flush to it.
        /// Re-asserts on `force` (warmup), target change (GUI moved), or drift
        /// (the sibling jumped on its own — ghostty occasionally re-applies its
        /// default geometry; the drift check observes the sibling's ACTUAL
        /// geometry, with a tolerance that ignores terminal cell-snap but catches
        /// a real reset). Returns `(target, changed, drifted)` when it moved.
        pub fn tick(&mut self, force: bool) -> Option<(Rect, bool, bool)> {
            let main = self.geometry(self.gui)?;
            // Resolve the terminal extent. Initial extent = the configured
            // fraction; thereafter the user RESIZES it by dragging the boundary
            // edge between the two windows (P-015) — a draggable split, not a
            // fixed ratio. `resized_extent` distinguishes that boundary drag from
            // a whole-window move (which only translates the sibling).
            let extent = match (self.extent, self.last_gui) {
                (Some(prev), Some(prev_gui)) => {
                    resized_extent(self.side, prev_gui, main, prev, self.min_px, self.max_px)
                }
                _ => sibling_extent(main, self.side, self.fraction, self.min_px, self.max_px),
            };
            self.extent = Some(extent);
            self.last_gui = Some(main);
            let t = compute_sibling_geometry(main, self.side, extent, self.gap);
            const DRIFT_TOL: i32 = 40;
            let changed = self.last_target != Some(t);
            let drifted = self
                .geometry(self.sibling)
                .map(|cur| !rects_close(cur, t, DRIFT_TOL))
                .unwrap_or(false);
            if force || changed || drifted {
                self.move_resize(self.sibling, t.x, t.y, t.w, t.h);
                self.last_target = Some(t);
                return Some((t, changed, drifted));
            }
            None
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Launch + glue driving (Linux). Called from main.rs's setup() + window-event
// hook. Non-Linux builds compile these as no-ops so the call sites stay clean.
// ───────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
impl NativeTerminal {
    /// Spawn the borderless Ghostty sibling hosting `pui workbench`. Idempotent
    /// — a no-op if already running. The X11 window is resolved + first-glued
    /// separately via `poll_resolve_window` + the steady glue loop (off the
    /// setup thread) so launch never blocks on the window mapping.
    pub fn launch_glued(&self) -> Result<(), String> {
        if !matches!(self.strategy, TerminalStrategy::GluedGhosttyX11) {
            return Err(format!(
                "launch_glued called for non-glued strategy {}",
                self.strategy.label()
            ));
        }
        let mut guard = self.live.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        let spec = GhosttySpec::workbench();
        // The shared app identity is the bundle id `com.papercusp.desktop`
        // (GhosttySpec default / PAPERCUSP_NATIVE_TERMINAL_CLASS). The Tauri
        // window exposes no _GTK_APPLICATION_ID and its WM_CLASS *class*
        // ("Papercusp-desktop") isn't a valid GTK app-id, so there's nothing to
        // copy at runtime; perfect taskbar grouping is a packaging concern (the
        // bundle's .desktop StartupWMClass), not something we can force here.
        let mut cmd = std::process::Command::new(&spec.bin);
        cmd.args(spec.argv());
        // Detach stdio: a chatty terminal shouldn't spam the desktop's logs,
        // and closing the desktop's own stdout shouldn't ripple in.
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let child = cmd
            .spawn()
            .map_err(|e| format!("spawn ghostty ({}): {e}", spec.bin))?;
        println!(
            "[papercusp-desktop] native-terminal: spawned ghostty pid={} class={} hosting {:?}",
            child.id(),
            spec.class,
            spec.command
        );
        *guard = Some(Live { child });
        Ok(())
    }

    /// The steady glue loop — run on a dedicated thread. Establishes one
    /// persistent X11 connection (`GlueSession`), resolves the sibling + GUI
    /// windows, raises the sibling once, then re-pins it to the GUI window every
    /// ~150ms until the terminal is shut down. A persistent connection is what
    /// makes tracking instant: a fresh connect per tick is too slow under Xvfb.
    pub fn run_glue_loop(&self) {
        if !matches!(self.strategy, TerminalStrategy::GluedGhosttyX11) {
            return;
        }
        let Some(gpid) = self.ghostty_pid() else { return };
        let mut sess = match x11_glue::GlueSession::connect(gpid, std::process::id(), &self.config) {
            Some(s) => s,
            None => {
                println!(
                    "[papercusp-desktop] native-terminal: could not establish X11 glue session for pid={gpid}"
                );
                return;
            }
        };
        println!(
            "[papercusp-desktop] native-terminal: glued window 0x{:x}",
            sess.sibling()
        );
        sess.raise();
        let debug = std::env::var("PAPERCUSP_NATIVE_TERMINAL_DEBUG").is_ok();
        let mut tick: u32 = 0;
        loop {
            if !self.is_running() {
                break;
            }
            // Warmup re-asserts the placement for the first ~2s so we win
            // ghostty applying its own initial geometry after we placed it.
            if let Some((t, changed, drifted)) = sess.tick(tick < 12) {
                if debug {
                    println!(
                        "[nt-debug] move -> ({},{},{},{}) changed={changed} drifted={drifted}",
                        t.x, t.y, t.w, t.h
                    );
                }
            }
            tick = tick.saturating_add(1);
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    }

    /// Interim cross-platform fallback (Wayland today): launch `pui workbench`
    /// in a real native terminal window — decorated, normal, NOT glued. Still a
    /// fully native terminal; it just isn't pinned to the GUI window (foreign
    /// positioning is forbidden off X11). Replaced per-OS by the embedded views.
    pub fn launch_new_window(&self) -> Result<(), String> {
        let mut guard = self.live.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        let spec = GhosttySpec::workbench();
        // Same hosted command + shared class (so taskbars still group it), but
        // keep decorations + skip the glue knobs.
        let mut argv = vec![
            format!("--class={}", spec.class),
            format!("--background={}", spec.background),
            "--gtk-single-instance=false".to_string(),
            "-e".to_string(),
        ];
        argv.extend(spec.command.iter().cloned());
        let mut cmd = std::process::Command::new(&spec.bin);
        cmd.args(argv);
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let child = cmd
            .spawn()
            .map_err(|e| format!("spawn ghostty new-window ({}): {e}", spec.bin))?;
        println!(
            "[papercusp-desktop] native-terminal: new-window ghostty pid={} hosting {:?}",
            child.id(),
            spec.command
        );
        *guard = Some(Live { child });
        Ok(())
    }

    /// Kill the sibling on shutdown. SIGHUP via process kill ends the hosted
    /// zellij + pui cleanly enough for an app exit.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.live.lock() {
            if let Some(mut live) = guard.take() {
                let pid = live.child.id();
                println!("[papercusp-desktop] native-terminal: terminating ghostty pid={pid}");
                let _ = live.child.kill();
                let _ = live.child.wait();
            }
        }
    }
}

// Non-Linux: the glued path is X11-only; these are no-ops so main.rs call sites
// stay platform-free. (Phase 2 embedded views land as their own impls.)
#[cfg(not(target_os = "linux"))]
impl NativeTerminal {
    pub fn launch_glued(&self) -> Result<(), String> {
        Err("glued terminal is X11-only".into())
    }
    pub fn launch_new_window(&self) -> Result<(), String> {
        Err("new-window terminal launcher is implemented on Linux only".into())
    }
    pub fn run_glue_loop(&self) {}
    pub fn shutdown(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── P-001 detection ────────────────────────────────────────────────────

    #[test]
    fn display_server_prefers_xdg_session_type() {
        assert_eq!(
            detect_display_server(Some("wayland"), None, Some(":0")),
            DisplayServer::Wayland
        );
        assert_eq!(
            detect_display_server(Some("x11"), Some("wayland-0"), Some(":0")),
            DisplayServer::X11
        );
        // Case + whitespace tolerant.
        assert_eq!(
            detect_display_server(Some(" X11 "), None, None),
            DisplayServer::X11
        );
    }

    #[test]
    fn display_server_falls_back_to_var_presence() {
        assert_eq!(
            detect_display_server(None, Some("wayland-0"), Some(":0")),
            DisplayServer::Wayland
        );
        assert_eq!(detect_display_server(None, None, Some(":0")), DisplayServer::X11);
        assert_eq!(detect_display_server(None, Some(""), Some("")), DisplayServer::None);
        assert_eq!(detect_display_server(Some("tty"), None, None), DisplayServer::None);
    }

    #[test]
    fn strategy_routes_per_os_and_display() {
        assert_eq!(
            select_strategy(SessionInfo { os: Os::Linux, display: DisplayServer::X11 }),
            TerminalStrategy::GluedGhosttyX11
        );
        assert_eq!(
            select_strategy(SessionInfo { os: Os::Linux, display: DisplayServer::Wayland }),
            TerminalStrategy::EmbeddedView(EmbedBackend::Vte)
        );
        assert_eq!(
            select_strategy(SessionInfo { os: Os::Linux, display: DisplayServer::None }),
            TerminalStrategy::Disabled
        );
        assert_eq!(
            select_strategy(SessionInfo { os: Os::Mac, display: DisplayServer::None }),
            TerminalStrategy::EmbeddedView(EmbedBackend::SwiftTerm)
        );
        assert_eq!(
            select_strategy(SessionInfo { os: Os::Windows, display: DisplayServer::None }),
            TerminalStrategy::EmbeddedView(EmbedBackend::ConPty)
        );
    }

    #[test]
    fn unbuilt_embedded_views_downgrade_to_new_window() {
        assert_eq!(
            downgrade_unbuilt(TerminalStrategy::EmbeddedView(EmbedBackend::Vte)),
            TerminalStrategy::NewWindow
        );
        assert_eq!(
            downgrade_unbuilt(TerminalStrategy::EmbeddedView(EmbedBackend::SwiftTerm)),
            TerminalStrategy::NewWindow
        );
        // The X11 glued path is never downgraded.
        assert_eq!(
            downgrade_unbuilt(TerminalStrategy::GluedGhosttyX11),
            TerminalStrategy::GluedGhosttyX11
        );
    }

    #[test]
    fn strategy_labels_are_stable() {
        assert_eq!(TerminalStrategy::GluedGhosttyX11.label(), "glued-ghostty-x11");
        assert_eq!(TerminalStrategy::NewWindow.label(), "new-window");
        assert_eq!(TerminalStrategy::Disabled.label(), "disabled");
        assert_eq!(
            TerminalStrategy::EmbeddedView(EmbedBackend::Vte).label(),
            "embedded-vte"
        );
    }

    // ── P-005 geometry ──────────────────────────────────────────────────────

    fn main_rect() -> Rect {
        Rect { x: 100, y: 50, w: 1280, h: 800 }
    }

    #[test]
    fn sibling_docks_flush_on_each_side() {
        let m = main_rect();
        let r = compute_sibling_geometry(m, DockSide::Right, 500, 0);
        assert_eq!(r, Rect { x: 1380, y: 50, w: 500, h: 800 });
        let l = compute_sibling_geometry(m, DockSide::Left, 500, 0);
        assert_eq!(l, Rect { x: -400, y: 50, w: 500, h: 800 });
        let b = compute_sibling_geometry(m, DockSide::Bottom, 300, 0);
        assert_eq!(b, Rect { x: 100, y: 850, w: 1280, h: 300 });
        let t = compute_sibling_geometry(m, DockSide::Top, 300, 0);
        assert_eq!(t, Rect { x: 100, y: -250, w: 1280, h: 300 });
    }

    #[test]
    fn gap_offsets_the_sibling() {
        let m = main_rect();
        let r = compute_sibling_geometry(m, DockSide::Right, 500, 8);
        assert_eq!(r.x, 100 + 1280 + 8);
        assert_eq!(r.y, 50);
        assert_eq!(r.h, 800);
    }

    #[test]
    fn right_dock_stays_flush_after_move_and_resize() {
        // The defining property of the glue: the terminal's left edge equals the
        // GUI window's right edge, for any GUI geometry.
        for (x, y, w, h) in [(0, 0, 800, 600), (640, 360, 1600, 900), (-50, 12, 1000, 1000)] {
            let m = Rect { x, y, w, h };
            let r = compute_sibling_geometry(m, DockSide::Right, 400, 0);
            assert_eq!(r.x, m.x + m.w, "terminal left edge must touch GUI right edge");
            assert_eq!(r.y, m.y, "tops aligned");
            assert_eq!(r.h, m.h, "heights matched");
        }
    }

    #[test]
    fn extent_is_a_clamped_fraction() {
        let m = Rect { x: 0, y: 0, w: 1000, h: 800 };
        // 42% of width = 420, within [480,1200] clamp → 480 (min wins).
        assert_eq!(sibling_extent(m, DockSide::Right, 0.42, 480, 1200), 480);
        // 42% of a wide window = 840, within bounds → 840.
        let wide = Rect { x: 0, y: 0, w: 2000, h: 800 };
        assert_eq!(sibling_extent(wide, DockSide::Right, 0.42, 480, 1200), 840);
        // Capped at max.
        let huge = Rect { x: 0, y: 0, w: 4000, h: 800 };
        assert_eq!(sibling_extent(huge, DockSide::Right, 0.42, 480, 1200), 1200);
        // Bottom dock uses height as the axis.
        assert_eq!(sibling_extent(m, DockSide::Bottom, 0.5, 100, 1000), 400);
    }

    #[test]
    fn rects_close_tolerance() {
        let a = Rect { x: 100, y: 100, w: 500, h: 800 };
        // identical → close
        assert!(rects_close(a, a, 40));
        // within tol on every axis (cell-snap sized) → close
        assert!(rects_close(a, Rect { x: 102, y: 98, w: 492, h: 808 }, 40));
        // a reset to default origin/size → NOT close (catches the drift)
        assert!(!rects_close(a, Rect { x: 0, y: 0, w: 800, h: 600 }, 40));
        // just past tol on one axis → not close
        assert!(!rects_close(a, Rect { x: 100, y: 141, w: 500, h: 800 }, 40));
    }

    #[test]
    fn dock_side_parses_env() {
        assert_eq!(DockSide::from_env(Some("left")), DockSide::Left);
        assert_eq!(DockSide::from_env(Some("BOTTOM")), DockSide::Bottom);
        assert_eq!(DockSide::from_env(Some("right")), DockSide::Right);
        // Default (unset / unrecognized) is LEFT now (D-011 / P-014): the native
        // terminal docks on the left, the Tauri GUI on the right.
        assert_eq!(DockSide::from_env(None), DockSide::Left);
        assert_eq!(DockSide::from_env(Some("nonsense")), DockSide::Left);
    }

    // ── P-015 draggable split ────────────────────────────────────────────────

    #[test]
    fn whole_window_move_keeps_extent() {
        // Translating the GUI (both edges shift equally) only TRANSLATES the
        // terminal — the split is unchanged, on every side.
        let a = Rect { x: 100, y: 50, w: 1280, h: 800 };
        let b = Rect { x: 300, y: 120, w: 1280, h: 800 }; // moved, same size
        for side in [DockSide::Left, DockSide::Right, DockSide::Top, DockSide::Bottom] {
            assert_eq!(resized_extent(side, a, b, 500, 100, 2000), 500, "{side:?}");
        }
    }

    #[test]
    fn dragging_boundary_edge_resizes_left_dock() {
        // Left dock: the boundary is the GUI's LEFT edge. Dragging it RIGHT by 120
        // (GUI shrinks from the left, far/right edge fixed at 1500) makes room →
        // the left-docked terminal GROWS by 120.
        let a = Rect { x: 500, y: 0, w: 1000, h: 800 }; // left=500  right=1500
        let b = Rect { x: 620, y: 0, w: 880, h: 800 }; //  left=620  right=1500
        assert_eq!(resized_extent(DockSide::Left, a, b, 400, 100, 2000), 520);
        // Dragging the boundary LEFT shrinks the terminal.
        let c = Rect { x: 420, y: 0, w: 1080, h: 800 }; // left=420  right=1500
        assert_eq!(resized_extent(DockSide::Left, a, c, 400, 100, 2000), 320);
    }

    #[test]
    fn dragging_boundary_edge_resizes_right_dock() {
        // Right dock: the boundary is the GUI's RIGHT edge. Dragging it LEFT by 120
        // (GUI shrinks from the right, left edge fixed at 0) makes room on the
        // right → the right-docked terminal GROWS by 120.
        let a = Rect { x: 0, y: 0, w: 1000, h: 800 }; // left=0  right=1000
        let b = Rect { x: 0, y: 0, w: 880, h: 800 }; //  left=0  right=880
        assert_eq!(resized_extent(DockSide::Right, a, b, 400, 100, 2000), 520);
    }

    #[test]
    fn dragging_far_edge_leaves_split_untouched() {
        // Left dock: dragging the GUI's FAR (right) edge moves only the far edge;
        // the boundary (left) is fixed → the terminal split is unchanged.
        let a = Rect { x: 500, y: 0, w: 1000, h: 800 }; // left=500  right=1500
        let b = Rect { x: 500, y: 0, w: 1200, h: 800 }; // left=500  right=1700
        assert_eq!(resized_extent(DockSide::Left, a, b, 400, 100, 2000), 400);
    }

    #[test]
    fn resized_extent_clamps_to_min() {
        // A boundary drag that would shrink the terminal below min is clamped.
        let a = Rect { x: 500, y: 0, w: 1000, h: 800 }; // left=500  right=1500
        let b = Rect { x: -100, y: 0, w: 1600, h: 800 }; // boundary −600, right fixed
        assert_eq!(resized_extent(DockSide::Left, a, b, 400, 100, 2000), 100);
    }

    #[test]
    fn resized_extent_clamps_to_max() {
        // A boundary drag past max is clamped.
        let a = Rect { x: 0, y: 0, w: 2000, h: 800 }; //  left=0     right=2000
        let b = Rect { x: 1900, y: 0, w: 100, h: 800 }; // boundary +1900, right fixed
        assert_eq!(resized_extent(DockSide::Left, a, b, 400, 100, 2000), 2000);
    }

    // ── P-004 launch argv ────────────────────────────────────────────────────

    #[test]
    fn ghostty_argv_is_borderless_shared_class_and_hosts_command() {
        let spec = GhosttySpec {
            class: "com.papercusp.desktop".into(),
            instance: "papercusp-terminal".into(),
            background: "#282c34".into(),
            command: vec!["pui".into(), "workbench".into()],
            bin: "ghostty".into(),
        };
        let argv = spec.argv();
        assert!(argv.contains(&"--class=com.papercusp.desktop".to_string()));
        assert!(argv.contains(&"--x11-instance-name=papercusp-terminal".to_string()));
        assert!(argv.contains(&"--window-decoration=false".to_string()));
        assert!(argv.contains(&"--gtk-single-instance=false".to_string()));
        assert!(argv.contains(&"--background=#282c34".to_string()));
        // `-e` must be present and everything after it is the hosted command,
        // in order, at the very end.
        let e = argv.iter().position(|a| a == "-e").expect("missing -e");
        assert_eq!(&argv[e + 1..], &["pui".to_string(), "workbench".to_string()]);
        assert_eq!(e, argv.len() - 3, "-e must be immediately before the command");
    }
}
