//! WebKitGTK renderer feature tuning (Linux only; a no-op everywhere else).
//!
//! WHY THIS EXISTS — WI-6502, "typing into the chat boxes is very laggy".
//!
//! Measured in a live headless instance: a keystroke in a focused text field
//! invalidates the ENTIRE VIEWPORT, so the per-keystroke cost is proportional to
//! everything painting viewport-sized rather than to the caret box. A 10x10px
//! invalidation costs the same as a no-op frame (~17ms), so small damage is
//! genuinely cheap — the problem is purely that the damage is not small.
//!
//! The cause is not our CSS and not a "platform floor". WebKitGTK 2.52.3 ships
//! ~486 toggleable features, and their defaults on this build are:
//!
//!     PropagateDamagingInformation           default TRUE
//!     UseDamagingInformationForCompositing   default FALSE   <-- the problem
//!     UnifyDamagedRegions                    default TRUE
//!
//! i.e. WebKit computes and propagates fine-grained damage and then does not use
//! it for compositing, so the compositor repaints the whole viewport regardless.
//! Turning the second one on makes the compositor honour the damage rects.
//!
//! ⚠ THAT IS THE THEORY, AND MEASUREMENT DID NOT BEAR IT OUT. See
//! DAMAGE_DEFAULT_ON below: with the control arm actually run, the flag did not
//! help a single keystroke (already free without it) and made sustained typing
//! WORSE. It is applied only when explicitly asked for. Everything above this
//! line is the hypothesis this module was built to test, not a description of
//! how the app is configured -- do not read it as the latter.
//!
//! Related and deliberately NOT the fix here (both measured, both dead ends):
//!   - compositing-layer promotion (`will-change`, `contain:paint`) of the heavy
//!     decorative surfaces: +1ms / +2ms, null in every paired round. Expected —
//!     when the damage rect is the whole viewport, every layer intersects it.
//!   - re-enabling the DMA-BUF renderer (main.rs force-disables it on NVIDIA):
//!     the webview runs JS but never presents a frame at all on driver 580, and
//!     the SHM-transport variant measured *worse* than shipping config.

/// Feature identifier => desired enabled state.
///
/// Keep this list SHORT and justified. Each entry is an experimental or
/// development WebKit feature, so each one needs its own measurement before it
/// earns a place here.
#[cfg(target_os = "linux")]
const DESIRED_FEATURES: &[(&str, bool)] = &[
    // Make the compositor actually honour the damage rects WebKit already
    // computes, instead of repainting the full viewport on every frame.
    ("UseDamagingInformationForCompositing", true),
];

/// Env escape hatch: `PAPERCUSP_WEBKIT_DAMAGE_COMPOSITING=0` restores stock
/// WebKit behaviour, `=1` forces it on. Launch-time renderer configuration, not
/// a product feature toggle — product features belong in `libs/flags`.
#[cfg(target_os = "linux")]
const DAMAGE_ENV: &str = "PAPERCUSP_WEBKIT_DAMAGE_COMPOSITING";

/// Whether the damage-compositing feature is applied when the env var is unset.
///
/// FALSE — measured 2026-07-28, run13. This defaulted to true on the strength of
/// a dmgON-only measurement whose base arm read ~= its sham arm. Running the
/// dmgOFF control with the same probe showed stock WebKit does the SAME (paired
/// base-sham median 0 in both arms), so that was never evidence the flag helped;
/// a single keystroke is already free either way. On SUSTAINED typing -- 20 chars
/// at the 33ms key-repeat interval, which is the owner's actual complaint -- the
/// flag measured WORSE, with no overlap across 8 rounds per arm:
///     wall time for 20 chars (ideal 660ms):  OFF 862..982   ON 1099..1424
///     worst frame during the burst:          OFF 48..76     ON 78..144
/// Left OFF pending a counterbalanced repeat (run14) that rules out boot order.
/// Do not flip this back on without an in-run sham control on the BURST arm.
#[cfg(target_os = "linux")]
const DAMAGE_DEFAULT_ON: bool = false;

#[cfg(target_os = "linux")]
fn damage_compositing_wanted() -> bool {
    match std::env::var(DAMAGE_ENV).ok().as_deref() {
        Some("0") | Some("false") => false,
        Some("1") | Some("true") => true,
        _ => DAMAGE_DEFAULT_ON,
    }
}

#[cfg(target_os = "linux")]
mod ffi_features {
    use std::ffi::{c_char, c_int};

    #[repr(C)]
    pub struct WebKitFeature {
        _private: [u8; 0],
    }
    #[repr(C)]
    pub struct WebKitFeatureList {
        _private: [u8; 0],
    }

    // Present in libwebkit2gtk-4.1.so.0 (WebKitGTK >= 2.42) but not bound by the
    // webkit2gtk 2.0.2 crate, so we declare them directly. Verified present on
    // the shipping lib with `strings | grep '^webkit_feature_'`.
    extern "C" {
        pub fn webkit_settings_get_all_features() -> *mut WebKitFeatureList;
        pub fn webkit_feature_list_get_length(list: *mut WebKitFeatureList) -> usize;
        pub fn webkit_feature_list_get(
            list: *mut WebKitFeatureList,
            index: usize,
        ) -> *mut WebKitFeature;
        pub fn webkit_feature_list_unref(list: *mut WebKitFeatureList);
        pub fn webkit_feature_get_identifier(feature: *mut WebKitFeature) -> *const c_char;
        pub fn webkit_settings_set_feature_enabled(
            settings: *mut webkit2gtk::ffi::WebKitSettings,
            feature: *mut WebKitFeature,
            enabled: c_int,
        );
        pub fn webkit_settings_get_feature_enabled(
            settings: *mut webkit2gtk::ffi::WebKitSettings,
            feature: *mut WebKitFeature,
        ) -> c_int;
    }
}

/// Apply `DESIRED_FEATURES` to the main window's webview.
///
/// Fail-soft everywhere: a missing window, a missing settings object, or a
/// WebKit build without a given feature is logged and skipped, never fatal — a
/// renderer tweak must not be able to prevent the app from starting.
#[cfg(target_os = "linux")]
pub fn init(app: &tauri::App) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        // Headless / non-GUI role has no window and legitimately wants none.
        // Logged rather than silently skipped: a silent no-op here is
        // indistinguishable from "the renderer fix didn't help".
        eprintln!("[webkit-render] no main webview window at setup — features not applied");
        return;
    };

    let want_damage = damage_compositing_wanted();

    let res = window.with_webview(move |webview| {
        use webkit2gtk::glib::translate::ToGlibPtr;
        use webkit2gtk::WebViewExt;

        let wv: webkit2gtk::WebView = webview.inner();
        let Some(settings) = wv.settings() else {
            eprintln!("[webkit-render] no WebKitSettings on the webview — skipped");
            return;
        };
        let settings_ptr: *mut webkit2gtk::ffi::WebKitSettings = settings.to_glib_none().0;

        unsafe {
            let list = ffi_features::webkit_settings_get_all_features();
            if list.is_null() {
                eprintln!("[webkit-render] webkit_settings_get_all_features() returned null");
                return;
            }
            let len = ffi_features::webkit_feature_list_get_length(list);
            let mut applied = 0usize;

            for i in 0..len {
                let feature = ffi_features::webkit_feature_list_get(list, i);
                if feature.is_null() {
                    continue;
                }
                let raw = ffi_features::webkit_feature_get_identifier(feature);
                if raw.is_null() {
                    continue;
                }
                let Ok(ident) = std::ffi::CStr::from_ptr(raw).to_str() else {
                    continue;
                };

                let Some((_, mut desired)) =
                    DESIRED_FEATURES.iter().copied().find(|(name, _)| *name == ident)
                else {
                    continue;
                };
                if ident == "UseDamagingInformationForCompositing" {
                    desired = want_damage;
                }

                let before = ffi_features::webkit_settings_get_feature_enabled(settings_ptr, feature);
                ffi_features::webkit_settings_set_feature_enabled(
                    settings_ptr,
                    feature,
                    if desired { 1 } else { 0 },
                );
                let after = ffi_features::webkit_settings_get_feature_enabled(settings_ptr, feature);

                // Read back rather than trusting the setter: an unknown or
                // locked feature silently keeps its old value, and a silent
                // no-op here would look exactly like "the fix didn't help".
                eprintln!(
                    "[webkit-render] {ident}: {} -> {} (requested {})",
                    before != 0,
                    after != 0,
                    desired
                );
                if (after != 0) == desired {
                    applied += 1;
                }
            }

            ffi_features::webkit_feature_list_unref(list);
            eprintln!(
                "[webkit-render] applied {applied}/{} feature(s) of {len} available",
                DESIRED_FEATURES.len()
            );
        }
    });

    if let Err(e) = res {
        eprintln!("[webkit-render] with_webview failed — renderer features not applied: {e}");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn init(_app: &tauri::App) {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn with_env<T>(value: Option<&str>, f: impl FnOnce() -> T) -> T {
        let prev = std::env::var(DAMAGE_ENV).ok();
        match value {
            Some(v) => std::env::set_var(DAMAGE_ENV, v),
            None => std::env::remove_var(DAMAGE_ENV),
        }
        let out = f();
        match prev {
            Some(p) => std::env::set_var(DAMAGE_ENV, p),
            None => std::env::remove_var(DAMAGE_ENV),
        }
        out
    }

    #[test]
    fn env_overrides_default_both_ways() {
        assert!(with_env(Some("1"), damage_compositing_wanted));
        assert!(with_env(Some("true"), damage_compositing_wanted));
        assert!(!with_env(Some("0"), damage_compositing_wanted));
        assert!(!with_env(Some("false"), damage_compositing_wanted));
    }

    #[test]
    fn unset_and_garbage_fall_back_to_the_default() {
        assert_eq!(with_env(None, damage_compositing_wanted), DAMAGE_DEFAULT_ON);
        assert_eq!(
            with_env(Some("yes-please"), damage_compositing_wanted),
            DAMAGE_DEFAULT_ON
        );
    }

    #[test]
    fn desired_features_are_unique_and_named() {
        for (name, _) in DESIRED_FEATURES {
            assert!(!name.is_empty());
            assert_eq!(
                DESIRED_FEATURES.iter().filter(|(n, _)| n == name).count(),
                1,
                "duplicate entry for {name}"
            );
        }
    }
}
