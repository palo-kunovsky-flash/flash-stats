//! Sampling loop: pulls one snapshot per tick and keeps ring buffers for the
//! sparklines.

pub mod battery;
pub mod gpu;
pub mod location;
pub mod machine;
pub mod net;
pub mod wifi;
pub mod temps;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use sysinfo::{CpuRefreshKind, DiskRefreshKind, Disks, Networks, ProcessesToUpdate, System};

use crate::formatting::percent;
use crate::models::*;

/// Samples kept for the sparklines (with a 1 s tick that's 3 minutes).
pub const HISTORY_LEN: usize = 180;

pub struct Sampler {
    sys: System,
    networks: Networks,
    disks: Disks,
    temps: temps::Temps,
    gpu: gpu::Gpu,
    battery: battery::Battery,
    last: Instant,
    tick_index: u32,
    core_kinds: Vec<String>,
    cached_processes: u32,
    cached_top: Vec<ProcessInfo>,
    /// The same process table ranked by resident memory instead of CPU.
    cached_top_memory: Vec<ProcessInfo>,
    cached_sensors: Vec<Sensor>,
    max_seen_freq_mhz: f32,
    /// Previous scheduler ticks, for the user / system split.
    prev_ticks: Option<machine::CpuTicks>,
    cpu_split: (f32, f32, f32, f32),
    /// `en0 -> "Wi-Fi"`; a shell-out, so it is refreshed rarely.
    ports: net::Ports,
    default_route: Option<String>,
    ssid: Option<String>,
    /// Public address, looked up off the sampling thread so a slow or dead
    /// network never stalls a tick.
    public_ip: Arc<Mutex<Option<String>>>,
    public_ip_enabled: Arc<AtomicBool>,
    public_ip_pending: Arc<AtomicBool>,
    public_ip_at: Option<Instant>,
    /// Per-process network rates. `nettop` blocks for a second per sample, so
    /// it lives on its own thread and only runs while someone is looking.
    net_top: Arc<Mutex<Vec<NetProcess>>>,
    net_top_enabled: Arc<AtomicBool>,
    net_top_pending: Arc<AtomicBool>,
    net_top_at: Option<Instant>,
    /// Debug: how long each phase of the last tick took (ms).
    pub phase_ms: [u32; 6],
}

impl Sampler {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        // First refresh only establishes a baseline; usage needs two samples.
        sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        sys.refresh_memory();
        let disks = Disks::new_with_refreshed_list();
        let networks = Networks::new_with_refreshed_list();
        let mut temps = temps::Temps::new();
        let _ = temps.read();
        let gpu = gpu::Gpu::detect();
        let battery = battery::Battery::new();
        let core_kinds = classify_cores(sys.cpus().len());
        let max_seen_freq_mhz = sys
            .cpus()
            .iter()
            .map(|c| c.frequency() as f32)
            .fold(0.0f32, f32::max);
        Self {
            sys,
            networks,
            disks,
            temps,
            gpu,
            battery,
            last: Instant::now(),
            tick_index: 0,
            core_kinds,
            cached_processes: 0,
            cached_top: Vec::new(),
            cached_top_memory: Vec::new(),
            cached_sensors: Vec::new(),
            max_seen_freq_mhz,
            prev_ticks: machine::cpu_ticks(),
            cpu_split: (0.0, 0.0, 100.0, 0.0),
            ports: net::Ports::read(),
            default_route: net::default_route(),
            ssid: None,
            public_ip: Arc::new(Mutex::new(None)),
            public_ip_enabled: Arc::new(AtomicBool::new(true)),
            public_ip_pending: Arc::new(AtomicBool::new(false)),
            public_ip_at: None,
            net_top: Arc::new(Mutex::new(Vec::new())),
            net_top_enabled: Arc::new(AtomicBool::new(false)),
            net_top_pending: Arc::new(AtomicBool::new(false)),
            net_top_at: None,
            phase_ms: [0; 6],
        }
    }

    pub fn tick(&mut self) -> Snapshot {
        let now = Instant::now();
        let dt = now.duration_since(self.last).as_secs_f64().max(0.05);
        self.last = now;
        self.tick_index = self.tick_index.wrapping_add(1);

        let mut marks = [0u32; 6];
        let mut lap = Instant::now();
        let mut mark = |index: usize| {
            marks[index] = lap.elapsed().as_millis() as u32;
            lap = Instant::now();
        };

        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        mark(0);
        self.networks.refresh(false);
        mark(1);
        self.disks
            .refresh_specifics(false, DiskRefreshKind::nothing().with_io_usage());
        if self.tick_index % 30 == 1 {
            // statvfs is not free either — space only changes slowly.
            self.disks
                .refresh_specifics(false, DiskRefreshKind::nothing().with_storage());
        }
        mark(2);
        if self.tick_index % 5 == 1 {
            // Enumerating processes is the priciest call — every 5th tick is plenty.
            self.sys
                .refresh_processes(ProcessesToUpdate::All, true);
            self.cached_processes = self.sys.processes().len() as u32;
            let (by_cpu, by_memory) = rank_processes(&self.sys);
            self.cached_top = by_cpu;
            self.cached_top_memory = by_memory;
        }
        mark(3);

        let ts_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // The IOHID sensor read is the most expensive call (~50 ms) and
        // temperature moves slowly, so every third tick is plenty.
        if self.tick_index % 3 == 1 {
            self.cached_sensors = self.temps.read();
        }
        let sensors = self.cached_sensors.clone();
        mark(4);
        let snapshot = Snapshot {
            ts_ms,
            interval_ms: (dt * 1000.0).round() as u64,
            cpu: self.read_cpu(&sensors),
            gpu: self.read_gpu(&sensors),
            memory: self.read_memory(),
            battery: self.battery.read(),
            net: self.read_net(dt),
            disk: self.read_disk(dt),
            sensors,
            top_processes: self.cached_top.clone(),
        };
        mark(5);
        self.phase_ms = marks;
        snapshot
    }

    // ---------------------------------------------------------------- CPU

    fn read_cpu(&mut self, sensors: &[Sensor]) -> CpuInfo {
        let cpus = self.sys.cpus();
        let logical = self.core_kinds.len().max(1);
        // Some backends prepend an aggregate entry.
        let offset = if cpus.len() == logical + 1 { 1 } else { 0 };
        let cores: Vec<f32> = cpus[offset..].iter().map(|c| c.cpu_usage()).collect();

        let freqs: Vec<f32> = cpus[offset..]
            .iter()
            .map(|c| c.frequency() as f32)
            .filter(|f| *f > 0.0)
            .collect();
        let freq_mhz = if freqs.is_empty() {
            0.0
        } else {
            // Weight the current frequency by how busy each core is.
            let mut num = 0.0;
            let mut den: f32 = 0.0;
            for (i, f) in freqs.iter().enumerate() {
                let w = cores.get(i).copied().unwrap_or(0.0).max(1.0);
                num += f * w;
                den += w;
            }
            num / den.max(1.0)
        };

        let live_max = freqs.iter().cloned().fold(0.0f32, f32::max);
        self.max_seen_freq_mhz = self.max_seen_freq_mhz.max(live_max);

        let load = System::load_average();
        let (user, system, idle, nice) = self.cpu_split();
        CpuInfo {
            usage: self.sys.global_cpu_usage(),
            cores,
            core_kinds: self.core_kinds.clone(),
            load1: load.one as f32,
            load5: load.five as f32,
            load15: load.fifteen as f32,
            freq_mhz,
            max_freq_mhz: self.max_seen_freq_mhz,
            temp_c: temps::hottest(sensors, &[SensorGroup::Cpu]),
            processes: self.cached_processes,
            uptime_secs: System::uptime(),
            user,
            system,
            idle,
            nice,
        }
    }

    /// Share of the busy time that went to user code vs. the kernel. The
    /// counters are 32 bit and wrap, so a negative delta keeps the last split.
    fn cpu_split(&mut self) -> (f32, f32, f32, f32) {
        let Some(now) = machine::cpu_ticks() else {
            return self.cpu_split;
        };
        if let Some(prev) = self.prev_ticks {
            let delta = |a: u64, b: u64| a.checked_sub(b);
            let parts = (
                delta(now.user, prev.user),
                delta(now.system, prev.system),
                delta(now.idle, prev.idle),
                delta(now.nice, prev.nice),
            );
            if let (Some(u), Some(s), Some(i), Some(n)) = parts {
                let total = (u + s + i + n) as f32;
                if total > 0.0 {
                    let scale = 100.0 / total;
                    self.cpu_split = (
                        u as f32 * scale,
                        s as f32 * scale,
                        i as f32 * scale,
                        n as f32 * scale,
                    );
                }
            }
        }
        self.prev_ticks = Some(now);
        self.cpu_split
    }

    fn max_cpu_freq(&self) -> f32 {
        self.max_seen_freq_mhz
    }

    // ---------------------------------------------------------------- GPU

    fn read_gpu(&mut self, sensors: &[Sensor]) -> GpuInfo {
        let mut info = self.gpu.read();
        info.temp_c = temps::average(sensors, &[SensorGroup::Gpu]);
        info
    }

    // ------------------------------------------------------------- Memory

    fn read_memory(&self) -> MemoryInfo {
        let total = self.sys.total_memory();
        let pg = machine::page_size();
        let swap_total = self.sys.total_swap();
        let swap_used = self.sys.used_swap();

        let mut info = MemoryInfo {
            total,
            used: self.sys.used_memory(),
            available: self.sys.available_memory(),
            swap_total,
            swap_used,
            ..Default::default()
        };

        if let  Some(v) = machine::vm_pages() {
            let wired = v.wired * pg;
            let app = (v.internal.saturating_sub(v.wired)) * pg;
            let cached = v.external.saturating_sub(v.purgeable) * pg + v.purgeable * pg / 2;
            let compressed_phys = v.compressor * pg;
            info.wired = wired;
            info.app = app;
            info.cached = cached;
            info.compressed = compressed_phys;
            info.uncompressed = v.uncompressed_in_compressor * pg;
            info.used = app + wired + compressed_phys;
            // sysinfo's `available_memory` counts pages that are already in
            // `used` here, so used + available could add up to more than the
            // machine has. Activity Monitor's model is the honest one: what is
            // not held by apps, the kernel or the compressor is available,
            // cached files included since the kernel hands those back on demand.
            info.available = total.saturating_sub(info.used);

            // Memory pressure: how much easily reclaimable memory is left,
            // with swap / heavy compression forcing it up.
            let total_pages = total / pg;
            let headroom = v.free + v.speculative + v.purgeable / 2;
            let target = (total_pages as f64 * 0.10).max(1.0);
            let mut pressure = 1.0 - (headroom as f64 / target).min(1.0);
            if swap_used > 0 {
                pressure = pressure.max(0.3);
            }
            if total_pages > 0 && compressed_phys / pg > total_pages / 10 {
                pressure = pressure.max(0.45);
            }
            info.pressure = (pressure.clamp(0.0, 1.0) * 100.0) as f32;
        } else {
            let used = info.used as f64;
            let tot = total.max(1) as f64;
            info.app = self.sys.used_memory();
            info.pressure = ((((used / tot) - 0.65) / 0.3).clamp(0.0, 1.0) * 100.0) as f32;
        }
        info.top_processes = self.cached_top_memory.clone();
        info
    }

    // ------------------------------------------------------------- Network

    /// Shared switch for the public-address lookup, so the settings window can
    /// turn the one outbound request this app makes off.
    pub fn public_ip_switch(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.public_ip_enabled)
    }

    /// Shared switch for the per-process network sampling, so it only runs
    /// while the card that shows it is actually on screen.
    pub fn net_top_switch(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.net_top_enabled)
    }

    /// Refreshes the per-process rates every few seconds, off the tick thread.
    fn refresh_net_top(&mut self) {
        if !self.net_top_enabled.load(Ordering::Relaxed) {
            if let Ok(mut slot) = self.net_top.lock() {
                slot.clear();
            }
            self.net_top_at = None;
            return;
        }
        let due = self
            .net_top_at
            .map(|at| at.elapsed() > std::time::Duration::from_secs(4))
            .unwrap_or(true);
        if !due || self.net_top_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        self.net_top_at = Some(Instant::now());
        let slot = Arc::clone(&self.net_top);
        let pending = Arc::clone(&self.net_top_pending);
        let enabled = Arc::clone(&self.net_top_enabled);
        let _ = std::thread::Builder::new()
            .name("net-top".into())
            .spawn(move || {
                let found: Vec<NetProcess> = net::talkers(5)
                    .into_iter()
                    .map(|t| NetProcess {
                        name: t.name,
                        pid: t.pid,
                        down_bps: t.down_bps,
                        up_bps: t.up_bps,
                    })
                    .collect();
                if enabled.load(Ordering::Relaxed) {
                    if let Ok(mut guard) = slot.lock() {
                        *guard = found;
                    }
                }
                pending.store(false, Ordering::SeqCst);
            });
    }

    /// Kicks off a lookup at most every ten minutes, on its own thread.
    fn refresh_public_ip(&mut self) {
        if !self.public_ip_enabled.load(Ordering::Relaxed) {
            if let Ok(mut slot) = self.public_ip.lock() {
                *slot = None;
            }
            self.public_ip_at = None;
            return;
        }
        let due = self
            .public_ip_at
            .map(|at| at.elapsed() > std::time::Duration::from_secs(600))
            .unwrap_or(true);
        if !due || self.public_ip_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        self.public_ip_at = Some(Instant::now());
        let slot = Arc::clone(&self.public_ip);
        let pending = Arc::clone(&self.public_ip_pending);
        let enabled = Arc::clone(&self.public_ip_enabled);
        let _ = std::thread::Builder::new()
            .name("public-ip".into())
            .spawn(move || {
                let found = net::public_ip();
                if enabled.load(Ordering::Relaxed) {
                    if let Ok(mut guard) = slot.lock() {
                        // A failed lookup keeps the previous answer: a blip
                        // should not blank the row.
                        if found.is_some() {
                            *guard = found;
                        }
                    }
                }
                pending.store(false, Ordering::SeqCst);
            });
    }

    /// The per-process list with readable names: `nettop` cuts them at fifteen
    /// characters ("io.tailscale.ip"), and the process table we already keep
    /// has the whole thing.
    fn net_talkers(&self) -> Vec<NetProcess> {
        let Ok(found) = self.net_top.lock() else {
            return Vec::new();
        };
        found
            .iter()
            .map(|entry| {
                let name = usize::try_from(entry.pid)
                    .ok()
                    .and_then(|pid| self.sys.process(sysinfo::Pid::from(pid)))
                    .map(|process| process.name().to_string_lossy().into_owned())
                    .filter(|name| name.len() >= entry.name.len())
                    .unwrap_or_else(|| entry.name.clone());
                NetProcess { name, ..entry.clone() }
            })
            .collect()
    }

    fn read_net(&mut self, dt: f64) -> NetInfo {
        // Both of these shell out, so they run on a slow cadence.
        if self.tick_index % 120 == 1 {
            self.ports = net::Ports::read();
        }
        if self.tick_index % 10 == 1 {
            self.default_route = net::default_route();
        }

        let mut interfaces: Vec<NetInterface> = Vec::new();
        let mut sum_in = 0u64;
        let mut sum_out = 0u64;

        for (name, data) in self.networks.list().iter() {
            if !counts(name) {
                continue;
            }
            let label = self.ports.label(name);
            let kind = net::kind_of(name, Some(&label));
            let ipv4 = data
                .ip_networks()
                .iter()
                .map(|ip| ip.addr)
                .find(|addr| addr.is_ipv4() && !addr.is_loopback() && !is_link_local(addr))
                .map(|addr| addr.to_string());
            let down = data.received() as f64 / dt;
            let up = data.transmitted() as f64 / dt;
            sum_in += data.total_received();
            sum_out += data.total_transmitted();
            interfaces.push(NetInterface {
                name: name.to_string(),
                label,
                kind: kind.to_string(),
                down_bps: down,
                up_bps: up,
                total_in: data.total_received(),
                total_out: data.total_transmitted(),
                // An interface without an address and without traffic is a
                // leftover port nobody is using — it only clutters the card.
                active: ipv4.is_some() || down + up > 0.5,
                ipv4,
                is_primary: false,
            });
        }

        // Everything asleep: keep the ones that at least have an address.
        if interfaces.iter().any(|i| i.active) {
            interfaces.retain(|i| i.active);
        }

        interfaces.sort_by(|a, b| {
            (b.down_bps + b.up_bps)
                .partial_cmp(&(a.down_bps + a.up_bps))
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // The link with the default route is the one that gets you online; the
        // busiest interface is only the fallback when there is no route.
        let primary_index = self
            .default_route
            .as_ref()
            .and_then(|route| interfaces.iter().position(|i| &i.name == route))
            .unwrap_or(0);
        if let Some(chosen) = interfaces.get_mut(primary_index) {
            chosen.is_primary = true;
        }
        let primary_info = interfaces.get(primary_index).cloned();
        let primary = primary_info
            .as_ref()
            .map(|i| i.name.clone())
            .unwrap_or_else(|| "\u{2014}".into());
        let primary_label = primary_info
            .as_ref()
            .map(|i| i.label.clone())
            .unwrap_or_else(|| "\u{2014}".into());
        let kind = primary_info
            .as_ref()
            .map(|i| i.kind.clone())
            .unwrap_or_else(|| "other".into());

        // While the main link is idle, show the busiest one instead of a sum:
        // a VPN carries the same bytes twice and would double the rate.
        let busiest = interfaces.first();
        let (down_bps, up_bps) = match primary_info.as_ref() {
            Some(i) if i.down_bps + i.up_bps > 0.5 => (i.down_bps, i.up_bps),
            _ => (
                busiest.map(|i| i.down_bps).unwrap_or(0.0),
                busiest.map(|i| i.up_bps).unwrap_or(0.0),
            ),
        };

        self.refresh_public_ip();
        self.refresh_net_top();

        if kind == "wifi" {
            // CoreWLAN is an in-process call, so it can run every tick; the
            // command line fallback spawns a process and runs rarely. Both are
            // silent unless macOS granted Location Services access, which is
            // what the name of a Wi-Fi network counts as since macOS 14.
            self.ssid = net::ssid(&primary).or_else(|| {
                if self.tick_index % 30 == 1 {
                    net::ssid_slow(&primary)
                } else {
                    self.ssid.clone()
                }
            });
        } else {
            self.ssid = None;
        }

        // macOS withholds the name rather than failing, so "wifi but no name and
        // no permission" is the case worth telling the user about.
        let ssid_blocked = kind == "wifi" && self.ssid.is_none() && !location::authorized();

        NetInfo {
            down_bps,
            up_bps,
            total_in: sum_in,
            total_out: sum_out,
            ipv4: primary_info.as_ref().and_then(|i| i.ipv4.clone()),
            primary,
            primary_label,
            kind,
            ssid_blocked,
            top_processes: self.net_talkers(),
            ssid: self.ssid.clone(),
            public_ip: self.public_ip.lock().ok().and_then(|v| v.clone()),
            interfaces,
        }
    }

    // --------------------------------------------------------------- Disk

    fn read_disk(&mut self, dt: f64) -> DiskInfo {
        let mut info = DiskInfo::default();
        let mut best: Option<&sysinfo::Disk> = None;
        for disk in self.disks.list() {
            if disk.mount_point() == std::path::Path::new("/") {
                best = Some(disk);
                break;
            }
            if best.is_none() && !disk.is_removable() {
                best = Some(disk);
            }
        }
        let Some(disk) = best else { return info };
        let usage = disk.usage();
        let (read, written) = (usage.read_bytes, usage.written_bytes);
        info.read_bps = read as f64 / dt;
        info.write_bps = written as f64 / dt;
        info.total_read = usage.total_read_bytes;
        info.total_write = usage.total_written_bytes;
        info.total_space = disk.total_space();
        info.free_space = disk.available_space();
        let raw = disk.name().to_string_lossy().to_string();
        info.name = raw.rsplit('/').next().unwrap_or(&raw).to_string();
        info
    }

    // --------------------------------------------------------------- Meta

    pub fn meta(&self) -> Meta {
        let clusters = machine::core_clusters();
        let gpu_name = self.gpu.name.clone();
        let chip = machine::sysctl_string(c"machdep.cpu.brand_string")
            .unwrap_or_else(|| "Apple Silicon".into());
        let logical = self
            .core_kinds
            .len()
            .max(self.sys.cpus().len()) as u32;
        Meta {
            chip,
            gpu_name,
            macos_version: System::os_version().unwrap_or_default(),
            hostname: System::host_name()
                .unwrap_or_default()
                .trim_end_matches(".local")
                .to_string(),
            arch: System::cpu_arch(),
            physical_cores: System::physical_core_count().unwrap_or(0) as u32,
            logical_cores: logical,
            perf_cores: clusters.perf,
            eff_cores: clusters.eff,
            total_memory: self.sys.total_memory(),
            has_battery: self.battery.present(),
            eff_cores_first: true,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            max_cpu_freq_mhz: self.max_cpu_freq(),
            sensor_labels: self.temps.labels(),
        }
    }

    pub fn gpu_cores(&self) -> u32 {
        self.gpu.cores
    }
}

/// The five busiest processes by CPU (falling back to memory when nothing is
/// busy — a machine idling at 1% still has a top list).
/// Everything the process table can tell us, in one pass — the two rankings
/// come from the same snapshot rather than two walks of the list.
fn rank_processes(sys: &System) -> (Vec<ProcessInfo>, Vec<ProcessInfo>) {
    let total = sys.total_memory().max(1) as f32;
    let all: Vec<ProcessInfo> = sys
        .processes()
        .values()
        .map(|p| ProcessInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu: p.cpu_usage(),
            mem_bytes: p.memory(),
            mem_percent: p.memory() as f32 / total * 100.0,
        })
        .collect();

    let mut by_cpu = all.clone();
    by_cpu.sort_by(|a, b| {
        b.cpu
            .partial_cmp(&a.cpu)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.mem_bytes.cmp(&a.mem_bytes))
    });
    by_cpu.truncate(6);
    by_cpu.retain(|p| p.cpu > 0.05 || p.mem_percent > 0.2);
    by_cpu.truncate(5);

    let mut by_memory = all;
    by_memory.sort_by(|a, b| b.mem_bytes.cmp(&a.mem_bytes));
    by_memory.truncate(5);

    (by_cpu, by_memory)
}

/// `performance` / `efficiency` label per logical core.
///
/// macOS numbers Apple Silicon CPUs efficiency-first: ids `0..E` are the E
/// cluster, `E..E+P` the P cluster (`hw.perflevel1.physicalcpu` gives E).
fn classify_cores(logical: usize) -> Vec<String> {
    let clusters = machine::core_clusters();
    let eff = clusters.eff as usize;
    let perf = clusters.perf as usize;
    if eff + perf == 0 || eff + perf != logical {
        return vec!["performance".to_string(); logical];
    }
    let mut kinds: Vec<String> = Vec::with_capacity(logical);
    kinds.extend((0..eff).map(|_| "efficiency".into()));
    kinds.extend((0..perf).map(|_| "performance".into()));
    kinds
}

/// Interfaces that should add up to "the" network speed. Counting tunnel or
/// virtual NICs too would double-count traffic.
fn counts(name: &str) -> bool {
    let n = name.to_lowercase();
    if n.starts_with("lo") {
        return false;
    }
    // utun/ppp are VPNs — worth showing when they carry traffic, and the
    // `active` flag drops them again when they do not.
    ["en", "eth", "wlan", "bond", "utun", "ppp", "ipsec"]
        .iter()
        .any(|prefix| n.starts_with(prefix))
}

/// 169.254.x.x — a self-assigned address means the link never came up.
fn is_link_local(addr: &std::net::IpAddr) -> bool {
    matches!(addr, std::net::IpAddr::V4(v4) if v4.is_link_local())
}

/// Ring buffers for the sparkline history (oldest first).
#[derive(Default)]
pub struct Rings {
    pub cpu: VecDeque<f32>,
    pub gpu: VecDeque<f32>,
    pub memory: VecDeque<f32>,
    pub temp: VecDeque<f32>,
    pub down: VecDeque<f32>,
    pub up: VecDeque<f32>,
    pub disk_read: VecDeque<f32>,
    pub disk_write: VecDeque<f32>,
    pub battery: VecDeque<f32>,
    pub watts: VecDeque<f32>,
}

fn push(q: &mut VecDeque<f32>, v: f32) {
    if q.len() == HISTORY_LEN {
        q.pop_front();
    }
    q.push_back(v);
}

impl Rings {
    pub fn push_snapshot(&mut self, s: &Snapshot) {
        push(&mut self.cpu, s.cpu.usage);
        push(&mut self.gpu, s.gpu.usage.unwrap_or(0.0));
        push(&mut self.memory, percent(s.memory.used, s.memory.total));
        push(
            &mut self.temp,
            s.cpu.temp_c.unwrap_or_else(|| {
                s.sensors
                    .iter()
                    .map(|x| x.temp_c)
                    .fold(0.0, f32::max)
            }),
        );
        push(&mut self.down, s.net.down_bps as f32);
        push(&mut self.up, s.net.up_bps as f32);
        push(&mut self.disk_read, s.disk.read_bps as f32);
        push(&mut self.disk_write, s.disk.write_bps as f32);
        push(&mut self.battery, s.battery.level);
        push(&mut self.watts, s.battery.watts);
    }

    pub fn snapshot(&self) -> History {
        History {
            cpu: self.cpu.iter().copied().collect(),
            gpu: self.gpu.iter().copied().collect(),
            memory: self.memory.iter().copied().collect(),
            temp: self.temp.iter().copied().collect(),
            down: self.down.iter().copied().collect(),
            up: self.up.iter().copied().collect(),
            disk_read: self.disk_read.iter().copied().collect(),
            disk_write: self.disk_write.iter().copied().collect(),
            battery: self.battery.iter().copied().collect(),
            watts: self.watts.iter().copied().collect(),
        }
    }
}



