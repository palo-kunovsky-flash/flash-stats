//! Window presentation: how the widget behaves on the desktop.
//!
//! The interesting mode is `desktop`: the NSWindow is pushed down to the level
//! macOS uses for desktop icons and marked `stationary`, so it behaves like a
//! real widget — it lives on the desktop, follows you across Spaces, is not
//! swept away by Mission Control or "show desktop" (⌘F3), and ordinary app
//! windows can cover it. `wallpaper` drops it under the desktop icons,
//! `floating` puts it above everything, `normal` is a plain window.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};

/// Window levels, expanded from the values in CGWindowLevel.h:
/// kCGDesktopWindowLevel = INT32_MIN + 25, kCGDesktopIconWindowLevel = +20 more.
const DESKTOP_ICON_LEVEL: isize = -2_147_483_603;
const WALLPAPER_LEVEL: isize = -2_147_483_623;
const NORMAL_LEVEL: isize = 0;
const FLOATING_LEVEL: isize = 3;

// NSWindowCollectionBehavior
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_AUXILIARY: usize = 1 << 7;
/// Also show the window on full-screen Spaces (macOS 15+).
const FULL_SCREEN_DISJOINED: usize = 1 << 9;
const JOIN_ALL_APPLICATIONS: usize = 1 << 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presentation {
    /// On the desktop, above the icons, below ordinary windows.
    Desktop,
    /// Under the desktop icons — behaves like the wallpaper.
    Wallpaper,
    /// Above every other window.
    Floating,
    /// A plain window.
    Normal,
}

impl Presentation {
    pub fn parse(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "wallpaper" => Self::Wallpaper,
            "floating" | "top" => Self::Floating,
            "normal" | "window" => Self::Normal,
            _ => Self::Desktop,
        }
    }
}

/// Safe entry point: hops to the main thread before touching AppKit.
pub fn apply(window: &WebviewWindow, mode: Presentation) -> Result<(), String> {
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            if let Err(error) = apply_inner(&target, mode) {
                crate::debug_log(&format!("presentation({mode:?}) failed: {error}"));
            }
        })
        .map_err(|error| error.to_string())
}

fn apply_inner(window: &WebviewWindow, mode: Presentation) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(|error| error.to_string())?;
    if ns_window.is_null() {
        return Err("ns_window is null".into());
    }

    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        let widget = ns_window as *mut AnyObject;
        let on_desktop = matches!(mode, Presentation::Desktop | Presentation::Wallpaper);
        let behavior = if on_desktop {
            CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY | JOIN_ALL_APPLICATIONS
        } else if mode == Presentation::Floating {
            CAN_JOIN_ALL_SPACES | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY | JOIN_ALL_APPLICATIONS
        } else {
            FULL_SCREEN_DISJOINED
        };
        let level = match mode {
            Presentation::Desktop => DESKTOP_ICON_LEVEL + 1,
            Presentation::Wallpaper => WALLPAPER_LEVEL + 1,
            Presentation::Floating => FLOATING_LEVEL,
            Presentation::Normal => NORMAL_LEVEL,
        };

        let _: () = msg_send![widget, setLevel: level];
        let _: () = msg_send![widget, setCollectionBehavior: behavior];
        // NSWindowAnimationBehaviorNone: no genie/space animations — the widget
        // should feel nailed to the desktop, not like a window.
        let _: () = msg_send![widget, setAnimationBehavior: on_desktop as isize];
        // A widget must not disappear when its app loses focus.
        let _: () = msg_send![widget, setHidesOnDeactivate: false];
        crate::debug_log(&format!("{} level -> {level} ({mode:?})", window.label()));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (ns_window, mode);
    }
    Ok(())
}

/// Brings a window of this accessory app forward and gives it keyboard focus.
/// Accessory apps have no Dock tile, so without this a freshly shown settings
/// window can end up behind the frontmost app.
pub fn raise(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;

            let _ = target.unminimize();
            let _ = target.show();
            let _ = target.set_focus();
            let class: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
            let _: () = msg_send![class, activateIgnoringOtherApps: true];
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = target.show();
        }
    });
}
