//! Small human-readable formatters shared by the tray title and the probe.

/// Bytes per second -> "1.37 MB/s".
pub fn human(bytes_per_sec: f64) -> String {
    const UNITS: [&str; 5] = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
    let mut v = bytes_per_sec.max(0.0);
    let mut i = 0;
    while v >= 999.5 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{} {}", v.round() as u64, UNITS[i])
    } else {
        format!("{v:.2} {}", UNITS[i])
    }
}

/// Compact form for the menu bar: `↓1.4M/s`.
pub fn short_rate(arrow: char, bytes_per_sec: f64) -> String {
    let units = ["B", "K", "M", "G"];
    let mut v = bytes_per_sec.max(0.0);
    let mut i = 0;
    while v >= 999.5 && i < units.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    let num = if i == 0 {
        format!("{}", v.round() as u64)
    } else if v < 10.0 {
        format!("{v:.1}")
    } else {
        format!("{}", v.round() as u64)
    };
    let suffix = if i == 0 { "" } else { "/s" };
    format!("{arrow}{num}{suffix}")
}

/// Menu-bar title: `↓1.4M/s ↑220K/s`.
pub fn badge(down: f64, up: f64) -> String {
    format!("{} {}", short_rate('↓', down), short_rate('↑', up))
}

/// Bytes -> "12.3 GB".
pub fn bytes(value: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = value as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{} {}", v.round() as u64, UNITS[i])
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

pub fn percent(part: u64, whole: u64) -> f32 {
    if whole == 0 {
        0.0
    } else {
        (part as f64 / whole as f64 * 100.0) as f32
    }
}

/// Seconds -> "3h 05m" / "42m".
pub fn duration(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    if h > 0 {
        format!("{h}h {m:02}m")
    } else {
        format!("{m}m")
    }
}
