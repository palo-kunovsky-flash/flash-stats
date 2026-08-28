//! Location Services, for one reason only: since macOS 14 the name of the
//! joined Wi-Fi network counts as location data. Every tool that reports it —
//! `ipconfig`, `networksetup`, `scutil` — answers a placeholder like
//! `<redacted>` to a process that has not been granted access.
//!
//! Nothing here reads a position. A `CLLocationManager` is created and asked
//! for authorisation, which is what flips the SSID from a placeholder to the
//! real name; no location updates are ever started.

use std::sync::OnceLock;

/// CLAuthorizationStatus
const NOT_DETERMINED: i32 = 0;
const AUTHORIZED_ALWAYS: i32 = 3;
const AUTHORIZED_WHEN_IN_USE: i32 = 4;

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    /// The manager has to outlive the request or the prompt never appears.
    struct Manager(*mut AnyObject);
    // Only ever touched behind the OnceLock below, and never dereferenced from
    // two threads at once.
    unsafe impl Send for Manager {}
    unsafe impl Sync for Manager {}

    static MANAGER: OnceLock<Option<Manager>> = OnceLock::new();

    fn manager() -> Option<*mut AnyObject> {
        MANAGER
            .get_or_init(|| {
                let class = AnyClass::get(c"CLLocationManager")?;
                let instance: *mut AnyObject = unsafe { msg_send![class, new] };
                if instance.is_null() {
                    return None;
                }
                Some(Manager(instance))
            })
            .as_ref()
            .map(|m| m.0)
    }

    pub fn status() -> i32 {
        let Some(instance) = manager() else {
            return -1;
        };
        unsafe { msg_send![instance, authorizationStatus] }
    }

    pub fn request() {
        let Some(instance) = manager() else {
            return;
        };
        unsafe {
            let _: () = msg_send![instance, requestWhenInUseAuthorization];
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn status() -> i32 {
        -1
    }
    pub fn request() {}
}

/// True once the SSID can actually be read.
pub fn authorized() -> bool {
    matches!(imp::status(), AUTHORIZED_ALWAYS | AUTHORIZED_WHEN_IN_USE)
}

/// Raw CLAuthorizationStatus, or -1 when CoreLocation is not there at all.
/// Worth logging: "no Wi-Fi name" has very different causes at 0 (never asked),
/// 2 (the user said no) and -1 (the framework never loaded).
pub fn status() -> i32 {
    imp::status()
}

/// Human readable form of [`status`].
pub fn status_name() -> &'static str {
    match imp::status() {
        NOT_DETERMINED => "not determined",
        1 => "restricted",
        2 => "denied",
        AUTHORIZED_ALWAYS => "authorized (always)",
        AUTHORIZED_WHEN_IN_USE => "authorized (when in use)",
        _ => "unavailable",
    }
}

/// Asks once per launch, and only while the answer is still "not determined" —
/// re-asking a user who said no just spams them.
///
/// Must run on the main thread, and only once the run loop is turning:
/// `CLLocationManager` talks to locationd through that run loop, so a manager
/// created on a worker thread — or during app setup — simply never asks
/// anything.
///
/// Only a packaged build gets an answer with data behind it. Under `tauri dev`
/// the executable is unbundled and signed differently from the app TCC has on
/// record, so macOS keeps withholding the name even when the stored decision
/// reads as authorised.
pub fn request_once() {
    static ASKED: OnceLock<()> = OnceLock::new();
    if imp::status() != NOT_DETERMINED {
        return;
    }
    ASKED.get_or_init(|| {
        imp::request();
    });
}
