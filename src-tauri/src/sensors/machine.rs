//! Low level macOS helpers: sysctl reads and the Mach VM statistics that
//! Activity Monitor uses for its memory breakdown.

use std::ffi::CStr;

use mach2::mach_types::host_t;
use mach2::message::mach_msg_type_number_t;
use mach2::port::mach_port_t;
use mach2::vm_statistics::vm_statistics64;
use mach2::kern_return::kern_return_t;

/// `sysctl kern.foo.bar` as string.
pub fn sysctl_string(name: &CStr) -> Option<String> {
    unsafe {
        let mut len = 0usize;
        if libc::sysctlbyname(name.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0)
            != 0
            || len == 0
        {
            return None;
        }
        let mut buf: Vec<u8> = vec![0; len + 1];
        if libc::sysctlbyname(
            name.as_ptr(),
            buf.as_mut_ptr() as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        let end = buf[..len].iter().position(|&b| b == 0).unwrap_or(len);
        Some(String::from_utf8_lossy(&buf[..end]).into_owned())
    }
}

/// `sysctl kern.foo.bar` as integer.
pub fn sysctl_i64(name: &CStr) -> Option<i64> {
    unsafe {
        let mut value: i64 = 0;
        let mut len = std::mem::size_of::<i64>();
        if libc::sysctlbyname(
            name.as_ptr(),
            &mut value as *mut i64 as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        match len {
            8 => Some(value),
            4 => Some(value & 0xFFFF_FFFF),
            1 => Some(value & 0xFF),
            _ => None,
        }
    }
}

pub fn page_size() -> u64 {
    static CACHED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *CACHED.get_or_init(|| unsafe {
        let sz = libc::sysconf(libc::_SC_PAGESIZE);
        if sz > 0 {
            sz as u64
        } else {
            16384
        }
    })
}

extern "C" {
    fn host_statistics64(
        host: host_t,
        flavor: libc::c_int,
        info: *mut vm_statistics64,
        count: *mut mach_msg_type_number_t,
    ) -> kern_return_t;
}

const HOST_VM_INFO64: libc::c_int = 4;

/// Raw VM counters (pages).
#[derive(Clone, Copy, Debug, Default)]
pub struct VmPages {
    pub free: u64,
    pub active: u64,
    pub inactive: u64,
    pub wired: u64,
    pub compressed: u64,
    pub compressor: u64,
    pub speculative: u64,
    pub purgeable: u64,
    pub external: u64,
    pub internal: u64,
    pub uncompressed_in_compressor: u64,
    pub swapped: u64,
}

pub fn vm_pages() -> Option<VmPages> {
    unsafe {
        let host: mach_port_t = mach2::mach_init::mach_host_self();
        let mut stats = vm_statistics64::default();
        let mut count =
            (std::mem::size_of::<vm_statistics64>() / std::mem::size_of::<libc::c_int>())
                as mach_msg_type_number_t;
        let kr = host_statistics64(host, HOST_VM_INFO64, &mut stats, &mut count);
        if kr != 0 {
            return None;
        }
        // `vm_statistics64` is #[repr(packed)] — copy every field out.
        Some(VmPages {
            free: stats.free_count as u64,
            active: stats.active_count as u64,
            inactive: stats.inactive_count as u64,
            wired: stats.wire_count as u64,
            compressor: stats.compressor_page_count as u64,
            speculative: stats.speculative_count as u64,
            purgeable: stats.purgeable_count as u64,
            external: stats.external_page_count as u64,
            internal: stats.internal_page_count as u64,
            uncompressed_in_compressor: stats.total_uncompressed_pages_in_compressor,
            swapped: stats.swapped_count as u64,
            compressed: stats.total_uncompressed_pages_in_compressor,
        })
    }
}

/// Physical core split (performance / efficiency clusters).
#[derive(Clone, Copy, Debug, Default)]
pub struct CoreClusters {
    pub perf: u32,
    pub eff: u32,
}

pub fn core_clusters() -> CoreClusters {
    let perf = sysctl_i64(c"hw.perflevel0.physicalcpu").unwrap_or(0).max(0) as u32;
    let eff = sysctl_i64(c"hw.perflevel1.physicalcpu").unwrap_or(0).max(0) as u32;
    CoreClusters { perf, eff }
}
