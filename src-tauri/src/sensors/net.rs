//! Naming for network interfaces: BSD names like `en0` say nothing, so the
//! hardware port table and the joined Wi-Fi network are pulled from
//! `networksetup`. Both are shell-outs, so both are cached and refreshed on a
//! slow cadence.

use std::collections::HashMap;
use std::process::Command;

/// `en0 -> "Wi-Fi"`, straight from `networksetup -listallhardwareports`.
#[derive(Default)]
pub struct Ports {
    map: HashMap<String, String>,
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

impl Ports {
    pub fn read() -> Self {
        let mut map = HashMap::new();
        if let Some(text) = run("/usr/sbin/networksetup", &["-listallhardwareports"]) {
            let mut port: Option<String> = None;
            for line in text.lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("Hardware Port:") {
                    port = Some(rest.trim().to_string());
                } else if let Some(rest) = line.strip_prefix("Device:") {
                    if let Some(name) = port.take() {
                        map.insert(rest.trim().to_string(), name);
                    }
                }
            }
        }
        Self { map }
    }

    pub fn label(&self, device: &str) -> String {
        if let Some(name) = self.map.get(device) {
            return name.clone();
        }
        match kind_of(device, None) {
            "vpn" => "VPN".into(),
            "bridge" => "Bridge".into(),
            _ => device.to_string(),
        }
    }
}

/// Coarse type used for the icon and for the "is this my link" decision.
pub fn kind_of(device: &str, label: Option<&str>) -> &'static str {
    let port = label.unwrap_or("").to_lowercase();
    if port.contains("wi-fi") || port.contains("wifi") || port.contains("airport") {
        return "wifi";
    }
    if port.contains("ethernet") || port.contains("lan") {
        return "ethernet";
    }
    if port.contains("bridge") {
        return "bridge";
    }
    let dev = device.to_lowercase();
    if dev.starts_with("utun") || dev.starts_with("ipsec") || dev.starts_with("ppp") {
        return "vpn";
    }
    if dev.starts_with("bridge") {
        return "bridge";
    }
    if dev.starts_with("en") {
        return "ethernet";
    }
    "other"
}

/// macOS hides the SSID from callers without Location Services access by
/// answering with a placeholder instead of failing, so `<redacted>` and friends
/// have to be recognised and dropped — otherwise the widget proudly shows
/// "&lt;redacted&gt;" as the network name.
fn real_ssid(value: &str) -> Option<String> {
    let name = value.trim();
    if name.is_empty() || (name.starts_with('<') && name.ends_with('>')) {
        return None;
    }
    if name.starts_with("You are not associated") {
        return None;
    }
    Some(name.to_string())
}

/// Name of the Wi-Fi network `device` is joined to, if any.
///
/// Which tool still answers moves between releases — `ipconfig` is the one that
/// keeps working on current macOS, `networksetup` is the older fallback. Both
/// need Location Services access; see [`location`].
pub fn ssid(device: &str) -> Option<String> {
    // In-process first: a subprocess is judged on its own Location Services
    // access, so the CLI tools stay redacted no matter what this app was
    // granted. This one is also free, so it can run on every tick.
    crate::sensors::wifi::ssid(device).and_then(|name| real_ssid(&name))
}

/// Last resort when CoreWLAN says nothing: the command line tools. Each call
/// spawns a process, so this belongs on a slow cadence.
pub fn ssid_slow(device: &str) -> Option<String> {
    if let Some(text) = run("/usr/sbin/ipconfig", &["getsummary", device]) {
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("SSID : ") {
                if let Some(name) = real_ssid(rest) {
                    return Some(name);
                }
            }
        }
    }
    let text = run("/usr/sbin/networksetup", &["-getairportnetwork", device])?;
    let (_, name) = text.split_once(": ")?;
    real_ssid(name)
}

/// BSD name of the interface carrying the default IPv4 route — the link that
/// actually gets you online, which is not always the busiest one.
pub fn default_route() -> Option<String> {
    let text = run("/sbin/route", &["-n", "get", "default"])?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("interface:") {
            let name = rest.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Address the internet sees, which is not any of the local ones once there is
/// a router (or a VPN) in the way.
///
/// This is the one reading that cannot be taken from the machine itself: it
/// costs one plain-text HTTPS request to `api.ipify.org`, nothing is sent along
/// with it, and the whole feature is behind a setting that can be turned off.
pub fn public_ip() -> Option<String> {
    let text = run(
        "/usr/bin/curl",
        &[
            "--silent",
            "--fail",
            "--max-time",
            "5",
            "https://api.ipify.org",
        ],
    )?;
    let value = text.trim();
    // Anything that is not a bare address means the endpoint answered with
    // something unexpected — a captive portal, an error page — so drop it.
    if value.is_empty() || value.len() > 45 || !value.chars().all(|c| c.is_ascii_hexdigit() || c == '.' || c == ':') {
        return None;
    }
    Some(value.to_string())
}

/// One process and what it moved over the network in the last second.
#[derive(Clone, Debug, Default)]
pub struct Talker {
    pub name: String,
    pub pid: i32,
    pub down_bps: f64,
    pub up_bps: f64,
}

/// Per-process network rates, via `nettop`.
///
/// There is no public API for this — `proc_pid_rusage` does not carry network
/// counters — but `nettop` reports it without root. `-d` makes each sample a
/// delta, so two samples one second apart give a rate; the call therefore
/// blocks for about a second and belongs on a background thread.
///
/// `-t external` keeps loopback out: traffic between two local processes is
/// not what "who is using my connection" means.
pub fn talkers(limit: usize) -> Vec<Talker> {
    const HEADER: &str = ",bytes_in,bytes_out,";
    let Some(text) = run(
        "/usr/bin/nettop",
        &[
            "-P", // aggregate per process rather than per connection
            "-x", // plain values, no units and no padding
            "-d", // deltas since the previous sample
            "-L", "2", // two samples: the second one is the rate
            "-s", "1", "-t", "external", "-J", "bytes_in,bytes_out",
        ],
    ) else {
        return Vec::new();
    };

    // The first block is measured from process start, so only the last one is
    // an actual rate.
    let Some(start) = text.rfind(HEADER) else {
        return Vec::new();
    };
    let mut found: Vec<Talker> = Vec::new();
    for line in text[start + HEADER.len()..].lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split(',');
        let (Some(who), Some(down), Some(up)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        // "Google Chrome H.4928" — the name may itself contain dots, so the pid
        // is whatever follows the last one.
        let Some((name, pid)) = who.rsplit_once('.') else {
            continue;
        };
        let (Ok(pid), Ok(down), Ok(up)) = (
            pid.parse::<i32>(),
            down.trim().parse::<f64>(),
            up.trim().parse::<f64>(),
        ) else {
            continue;
        };
        if down + up <= 0.0 {
            continue;
        }
        found.push(Talker {
            name: name.to_string(),
            pid,
            down_bps: down,
            up_bps: up,
        });
    }

    found.sort_by(|a, b| {
        (b.down_bps + b.up_bps)
            .partial_cmp(&(a.down_bps + a.up_bps))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    found.truncate(limit);
    found
}
