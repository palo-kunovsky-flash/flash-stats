//! Small IOKit registry helper.
//!
//! Instead of copying an object's whole property bag (the GPU accelerator and
//! the battery objects carry tens of kilobytes of unrelated data) we keep the
//! registry entry alive and ask for the single keys we need. That takes the
//! per-tick cost of the GPU + battery reads from ~30 ms to well under a
//! millisecond.

use std::ffi::CString;
use std::os::raw::c_void;

use core_foundation::propertylist::{create_data, kCFPropertyListXMLFormat_v1_0};
use core_foundation_sys::base::{kCFAllocatorDefault, CFRelease};
use core_foundation_sys::dictionary::{CFDictionaryRef, CFMutableDictionaryRef};
use core_foundation_sys::string::{
    CFStringCreateWithCString, kCFStringEncodingUTF8, CFStringRef,
};
use io_kit_sys::types::{io_iterator_t, io_registry_entry_t};
use io_kit_sys::{
    IOIteratorNext, IOObjectRelease, IORegistryEntryCreateCFProperties, IORegistryEntryCreateCFProperty,
    IOServiceGetMatchingServices, IOServiceMatching,
};

/// A live registry entry. Released on drop.
pub struct Service {
    entry: io_registry_entry_t,
}

// IOKit object handles are plain kernel object ids; sending them between
// threads is fine as long as each use is not concurrent, which the sampler
// thread guarantees.
unsafe impl Send for Service {}
unsafe impl Sync for Service {}

impl Drop for Service {
    fn drop(&mut self) {
        unsafe {
            IOObjectRelease(self.entry);
        }
    }
}

#[allow(dead_code)]
impl Service {
    /// Look up the first object of `class_name` that has a `required_key`.
    pub fn find(class_name: &str, required_key: &str) -> Option<Self> {
        let class_c = CString::new(class_name).ok()?;
        unsafe {
            // +1 retain, consumed by IOServiceGetMatchingServices on success.
            let matching: CFMutableDictionaryRef = IOServiceMatching(class_c.as_ptr());
            if matching.is_null() {
                return None;
            }
            let mut iter: io_iterator_t = 0;
            // 0 == kIOMainPortDefault
            if IOServiceGetMatchingServices(0, matching as CFDictionaryRef, &mut iter) != 0 {
                CFRelease(matching as *const c_void);
                return None;
            }
            let mut found = None;
            loop {
                let entry = IOIteratorNext(iter);
                if entry == 0 {
                    break;
                }
                if found.is_none() && entry_has_key(entry, required_key) {
                    found = Some(entry);
                } else {
                    IOObjectRelease(entry);
                }
            }
            IOObjectRelease(iter);
            found.map(|entry| Self { entry })
        }
    }

    /// Read one property, converted to a plist value.
    pub fn value(&self, key: &str) -> Option<plist::Value> {
        let key_c = CString::new(key).ok()?;
        unsafe {
            let cf_key: CFStringRef =
                CFStringCreateWithCString(kCFAllocatorDefault, key_c.as_ptr(), kCFStringEncodingUTF8);
            if cf_key.is_null() {
                return None;
            }
            let object = IORegistryEntryCreateCFProperty(self.entry, cf_key, kCFAllocatorDefault, 0);
            CFRelease(cf_key as *const c_void);
            if object.is_null() {
                return None;
            }
            let result = (|| {
                let data = create_data(object, kCFPropertyListXMLFormat_v1_0).ok()?;
                let mut cursor = std::io::Cursor::new(data.bytes());
                plist::Value::from_reader(&mut cursor).ok()
            })();
            CFRelease(object);
            result
        }
    }

    pub fn dict(&self, key: &str) -> Option<plist::Dictionary> {
        self.value(key)?.into_dictionary()
    }

    pub fn f64(&self, key: &str) -> Option<f64> {
        f64_of_value(&self.value(key)?)
    }

    pub fn u64(&self, key: &str) -> Option<u64> {
        let value = self.value(key)?;
        value
            .as_unsigned_integer()
            .or_else(|| value.as_signed_integer().map(|v| v.max(0) as u64))
            .or_else(|| value.as_real().map(|v| v as u64))
    }

    /// Signed counter (Apple stores e.g. a negative amperage as a huge u64).
    pub fn i64(&self, key: &str) -> Option<i64> {
        let value = self.value(key)?;
        match value.as_signed_integer() {
            Some(signed) => Some(signed),
            None => value.as_unsigned_integer().map(|v| v as i64),
        }
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.value(key)?.as_boolean()
    }

    /// `dict[key]` inside a dictionary property.
    pub fn nested_f64(&self, dict_key: &str, key: &str) -> Option<f64> {
        let dict = self.dict(dict_key)?;
        f64_of_value(dict.get(key)?)
    }

    /// Whole property bag — only for debugging.
    pub fn all_properties(&self) -> Option<plist::Dictionary> {
        unsafe { properties_of(self.entry) }
    }
}

unsafe fn entry_has_key(entry: io_registry_entry_t, key: &str) -> bool {
    let Some(c) = CString::new(key).ok() else {
        return false;
    };
    let cf_key = CFStringCreateWithCString(kCFAllocatorDefault, c.as_ptr(), kCFStringEncodingUTF8);
    if cf_key.is_null() {
        return false;
    }
    let object = IORegistryEntryCreateCFProperty(entry, cf_key, kCFAllocatorDefault, 0);
    CFRelease(cf_key as *const c_void);
    if object.is_null() {
        return false;
    }
    CFRelease(object);
    true
}

#[allow(dead_code)]
unsafe fn properties_of(entry: io_registry_entry_t) -> Option<plist::Dictionary> {
    let mut dict: CFMutableDictionaryRef = std::ptr::null_mut();
    let status = IORegistryEntryCreateCFProperties(entry, &mut dict, kCFAllocatorDefault, 0);
    if dict.is_null() {
        return None;
    }
    let result = if status == 0 {
        (|| {
            let data = create_data(dict as *const c_void, kCFPropertyListXMLFormat_v1_0).ok()?;
            let mut cursor = std::io::Cursor::new(data.bytes());
            let value = plist::Value::from_reader(&mut cursor).ok()?;
            value.into_dictionary()
        })()
    } else {
        None
    };
    CFRelease(dict as *const c_void);
    result
}

/// Number-ish conversion for plist values (reals, ints, bools, numeric strings).
pub fn f64_of_value(value: &plist::Value) -> Option<f64> {
    if let Some(real) = value.as_real() {
        return Some(real);
    }
    if let Some(signed) = value.as_signed_integer() {
        return Some(signed as f64);
    }
    if let Some(unsigned) = value.as_unsigned_integer() {
        return Some(unsigned as f64);
    }
    if let Some(flag) = value.as_boolean() {
        return Some(if flag { 1.0 } else { 0.0 });
    }
    value.as_string().and_then(|s| s.parse::<f64>().ok())
}

/// `dict[key]` as a number.
pub fn f64_of(dict: &plist::Dictionary, key: &str) -> Option<f64> {
    f64_of_value(dict.get(key)?)
}

pub fn u64_of(dict: &plist::Dictionary, key: &str) -> Option<u64> {
    let value = dict.get(key)?;
    value
        .as_unsigned_integer()
        .or_else(|| value.as_signed_integer().map(|v| v.max(0) as u64))
        .or_else(|| value.as_real().map(|v| v as u64))
}

#[allow(dead_code)]
pub fn string_of(dict: &plist::Dictionary, key: &str) -> Option<String> {
    dict.get(key)?.as_string().map(|s| s.to_string())
}
