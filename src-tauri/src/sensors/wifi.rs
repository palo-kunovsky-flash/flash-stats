//! The Wi-Fi network name, read in-process through CoreWLAN.
//!
//! Command line tools (`ipconfig`, `networksetup`, `scutil`) are separate
//! processes and are judged on their own Location Services access, so they keep
//! answering `<redacted>` however well authorised this app is. CoreWLAN asks
//! from inside our process, where the grant actually applies.

#[cfg(target_os = "macos")]
pub fn ssid(device: &str) -> Option<String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::CStr;

    unsafe {
        let class = AnyClass::get(c"CWWiFiClient")?;
        let client: *mut AnyObject = msg_send![class, sharedWiFiClient];
        if client.is_null() {
            return None;
        }
        // The named interface when we know it, the default one otherwise.
        let interface: *mut AnyObject = if device.is_empty() {
            msg_send![client, interface]
        } else {
            let name = nsstring(device)?;
            let named: *mut AnyObject = msg_send![client, interfaceWithName: name];
            if named.is_null() {
                msg_send![client, interface]
            } else {
                named
            }
        };
        if interface.is_null() {
            return None;
        }
        let ssid: *mut AnyObject = msg_send![interface, ssid];
        if ssid.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![ssid, UTF8String];
        if utf8.is_null() {
            return None;
        }
        let text = CStr::from_ptr(utf8).to_string_lossy().into_owned();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn nsstring(value: &str) -> Option<*mut objc2::runtime::AnyObject> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    let class = AnyClass::get(c"NSString")?;
    let bytes = value.as_bytes();
    // NSUTF8StringEncoding
    let object: *mut AnyObject = msg_send![
        class,
        stringWithBytes: bytes.as_ptr().cast::<std::ffi::c_void>(),
        length: bytes.len(),
        encoding: 4usize,
    ];
    if object.is_null() {
        None
    } else {
        Some(object)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn ssid(_device: &str) -> Option<String> {
    None
}
