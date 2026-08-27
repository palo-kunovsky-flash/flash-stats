//! Window presentation: how the widget behaves on the desktop.
//!
//! The interesting mode is `desktop`: the NSWindow is pushed down to the
//! desktop-icon level and marked stationary, so it behaves like a real macOS
//! widget — it lives on the desktop, follows you across all Spaces, stays
//! where it is in Mission Control and survives "show desktop", while ordinary
//! app windows cover it.

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Presentation {
    /// Sits on the desktop, below normal windows (widget behaviour).
    Desktop,
    /// Floats above everything.
    Floating,
    /// Plain window.
    Normal,
}

impl Presentation {
    pub fn parse(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "floating" | "top" => Self::Floating,
            "normal" | "window" => Self::Normal,
            _ => Self::Desktop,
        }
    }
}

extern "C" {
    /// CoreGraphics helper that returns the window level for a well known key.
    fn CGWindowLevelForKey(key: i32) -> i32;
}

const K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 2;
const K_CG_FLOATING_WINDOW_LEVEL_KEY: i32 = 5;

// NSWindowCollectionBehavior
const JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_AUXILIARY: usize = 1 << 7;
/// Lets the window appear on full-screen Spaces too (macOS 15+).
const JOIN_ALL_APPLICATIONS: usize = 1 << 12;

/// Safe entry point: hops to the main thread before touching AppKit.
pub fn apply(window: &WebviewWindow, mode: Presentation) -> Result<(), String> {
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            if let  Err(error) = apply_inner(&target, mode) {
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

        let window_ptr = ns_window as *mut AnyObject;
        let (level, behavior) = match mode {
            Presentation::Desktop => {
                let base = CGWindowLevelForKey(K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY);
                // one step above the Finder icons, still below normal windows
                (
                    base + 1,
                    JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY | JOIN_ALL_APPLICATIONS,
                )
            }
            Presentation::Floating => (
                CGWindowLevelForKey(K_CG_FLOATING_WINDOW_LEVEL_KEY),
                JOIN_ALL_SPACES | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY | JOIN_ALL_APPLICATIONS,
            ),
            Presentation::Normal => (0, 0),
        };

        let _: () = msg_send![window_ptr, setLevel: level as isize];
        let _: () = msg_send![window_ptr, setCollectionBehavior: behavior];
        // A widget should never make the app "active" visually.
        let _: () = msg_send![window_ptr, setHidesOnDeactivate: false];
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = ns_window;
    }
    Ok(())
}
