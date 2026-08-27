use serde::Serialize;

/// Everything the UI needs for one tick.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub ts_ms: u64,
    pub interval_ms: u64,
    pub cpu: CpuInfo,
    pub gpu: GpuInfo,
    pub memory: MemoryInfo,
    pub battery: BatteryInfo,
    pub net: NetInfo,
    pub disk: DiskInfo,
    pub sensors: Vec<Sensor>,
    /// Most CPU hungry processes (refreshed a few times slower).
    pub top_processes: Vec<ProcessInfo>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    /// Aggregate utilisation, 0..=100
    pub usage: f32,
    /// Per logical core utilisation, 0..=100
    pub cores: Vec<f32>,
    /// `performance` / `efficiency` per logical core (empty when unknown)
    pub core_kinds: Vec<String>,
    pub load1: f32,
    pub load5: f32,
    pub load15: f32,
    pub freq_mhz: f32,
    pub max_freq_mhz: f32,
    pub temp_c: Option<f32>,
    pub processes: u32,
    pub uptime_secs: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    /// Device utilisation 0..=100 (IOKit `Device Utilization %`)
    pub usage: Option<f32>,
    pub renderer: Option<f32>,
    pub tiler: Option<f32>,
    /// VRAM / system memory allocated by the GPU
    pub allocated_bytes: Option<u64>,
    pub in_use_bytes: Option<u64>,
    pub temp_c: Option<f32>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    /// Activity-Monitor style buckets
    pub app: u64,
    pub wired: u64,
    pub compressed: u64,
    /// How much memory the compressed pool stands for once unpacked.
    pub uncompressed: u64,
    pub cached: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    /// 0..=100, how tight memory is (pressure)
    pub pressure: f32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub present: bool,
    /// Charge level 0..=100
    pub level: f32,
    pub charging: bool,
    pub ac_connected: bool,
    /// Positive = discharging, negative = charging (W)
    pub watts: f32,
    pub voltage_mv: f32,
    pub amperage_ma: f32,
    pub temp_c: Option<f32>,
    /// Max capacity vs. design capacity, 0..=100
    pub health: f32,
    pub cycles: Option<u32>,
    pub design_mah: f32,
    pub now_mah: f32,
    pub time_remaining_secs: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    /// Bytes per second, summed over the "real" interfaces
    pub down_bps: f64,
    pub up_bps: f64,
    pub total_in: u64,
    pub total_out: u64,
    /// Interface with the most traffic (e.g. en0)
    pub primary: String,
    pub ipv4: Option<String>,
    pub interfaces: Vec<NetInterface>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetInterface {
    pub name: String,
    pub down_bps: f64,
    pub up_bps: f64,
    pub total_in: u64,
    pub total_out: u64,
    pub is_primary: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub read_bps: f64,
    pub write_bps: f64,
    pub total_read: u64,
    pub total_write: u64,
    pub total_space: u64,
    pub free_space: u64,
    pub name: String,
}

/// One temperature sensor (SMC / HID).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    pub id: String,
    pub label: String,
    pub temp_c: f32,
    pub group: SensorGroup,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SensorGroup {
    Cpu,
    Gpu,
    Memory,
    Battery,
    Airflow,
    Other,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    /// Percent of one core (like Activity Monitor).
    pub cpu: f32,
    pub mem_bytes: u64,
    pub mem_percent: f32,
}

/// Static machine info, fetched once at startup.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub chip: String,
    pub gpu_name: String,
    pub macos_version: String,
    pub hostname: String,
    /// CPU ids 0..E belong to the efficiency cluster on Apple Silicon.
    pub eff_cores_first: bool,
    pub arch: String,
    pub physical_cores: u32,
    pub logical_cores: u32,
    pub perf_cores: u32,
    pub eff_cores: u32,
    pub total_memory: u64,
    pub has_battery: bool,
    pub app_version: String,
    pub max_cpu_freq_mhz: f32,
    pub sensor_labels: Vec<String>,
}

/// Ring buffers for the sparklines. Oldest sample first.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub cpu: Vec<f32>,
    pub gpu: Vec<f32>,
    pub memory: Vec<f32>,
    pub temp: Vec<f32>,
    pub down: Vec<f32>,
    pub up: Vec<f32>,
    pub disk_read: Vec<f32>,
    pub disk_write: Vec<f32>,
    pub battery: Vec<f32>,
    pub watts: Vec<f32>,
}
