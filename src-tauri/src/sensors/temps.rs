//! Temperature sensors. On Apple Silicon macOS exposes the SMC sensors as
//! IOHID temperature services, which `sysinfo` reads for us (`Components`).

use sysinfo::Components;

use crate::models::{Sensor, SensorGroup};

pub struct Temps {
    components: Components,
}

/// Some SMC proximity sensors on Apple Silicon report Fahrenheit. Above 105 the
/// firmware means °F — the SoC throttles hard long before a real 105 °C — so
/// those are converted and everything downstream works in °C.
pub fn canonical_celsius(raw: f32) -> f32 {
    if raw > 105.0 {
        (raw - 32.0) * 5.0 / 9.0
    } else {
        raw
    }
}

impl Temps {
    pub fn new() -> Self {
        Self {
            components: Components::new_with_refreshed_list(),
        }
    }

    /// All sensor names this machine reports (for the settings sheet).
    pub fn labels(&self) -> Vec<String> {
        self.components.list().iter().map(|c| c.label().to_string()).collect()
    }

    pub fn read(&mut self) -> Vec<Sensor> {
        self.components.refresh(false);
        let mut out: Vec<Sensor> = self
            .components
            .list()
            .iter()
            .filter_map(|c| {
                let temp = canonical_celsius(c.temperature()?);
                if !temp.is_finite() || temp < -20.0 || temp > 130.0 {
                    return None;
                }
                let raw_label = c.label().to_string();
                Some(Sensor {
                    id: c.id().unwrap_or(raw_label.as_str()).to_string(),
                    label: raw_label.clone(),
                    temp_c: temp,
                    group: group_of(&raw_label),
                })
            })
            .collect();
        out.sort_by(|a, b| a.label.cmp(&b.label));
        out
    }
}

/// Map the (cryptic) HID sensor names Apple exposes to something useful.
///
/// On Apple Silicon the SMC surfaces itself as `PMU tdev/tdie`, `PMU2 ...`,
/// `NAND CH0`, `gas gauge battery`, … On Intel Macs sysinfo reports the classic
/// SMC keys (`Tp0*` = CPU, `Tg0*` = GPU, `Tm0*` = memory, `TB0T` = battery).
fn group_of(label: &str) -> SensorGroup {
    let l = label.to_lowercase();
    if l.contains("battery") || l.starts_with("tb") || l.contains("gas gauge") {
        SensorGroup::Battery
    } else if l.starts_with("pmu2") || l.contains("gpu") || l.starts_with("tg") || l.contains("gddr")
    {
        SensorGroup::Gpu
    } else if l.contains("nand")
        || l.contains("ssd")
        || l.contains("ambient")
        || l.contains("airflow")
        || l.contains("skin")
        || l.starts_with("tm")
        || l.contains("mem")
    {
        SensorGroup::Memory
    } else if l.starts_with("pmu")
        || l.contains("cpu")
        || l.contains("core")
        || l.starts_with("tp")
        || l.starts_with("tc")
        || l.starts_with("ta")
    {
        SensorGroup::Cpu
    } else {
        SensorGroup::Other
    }
}

/// Human friendly name for the details list.
pub fn pretty(label: &str) -> String {
    let l = label.to_lowercase();
    if l.contains("gas gauge") || l.contains("battery") {
        return format!("Batéria ({label})");
    }
    if l.starts_with("pmu2") {
        return format!("GPU (SoC) {label}");
    }
    if l.starts_with("pmu") {
        return format!("SoC {label}");
    }
    if l.contains("nand") {
        return format!("SSD {label}");
    }
    label.to_string()
}

/// Hottest sensor of a group (falls back to the overall max).
pub fn hottest(sensors: &[Sensor], groups: &[SensorGroup]) -> Option<f32> {
    let pool: Vec<f32> = sensors
        .iter()
        .filter(|s| groups.contains(&s.group))
        .map(|s| s.temp_c)
        .collect();
    let chosen = if pool.is_empty() {
        sensors.iter().map(|s| s.temp_c).collect()
    } else {
        pool
    };
    chosen.into_iter().reduce(f32::max)
}

/// Average over a group — smoother than a single hottest sensor.
pub fn average(sensors: &[Sensor], groups: &[SensorGroup]) -> Option<f32> {
    let mut sum = 0.0;
    let mut n = 0.0;
    for s in sensors {
        if groups.contains(&s.group) {
            sum += s.temp_c;
            n += 1.0;
        }
    }
    if n == 0.0 {
        None
    } else {
        Some(sum / n)
    }
}

#[cfg(test)]
mod tests {
    use super::canonical_celsius;

    #[test]
    fn fahrenheit_sensors_are_converted() {
        // Real readings from an M4 machine: the SoC sensors sit in the 50s-60s
        // while the proximity keys report 110-122, which is Fahrenheit.
        assert_eq!(canonical_celsius(110.5).round(), 44.0);
        assert_eq!(canonical_celsius(121.7).round(), 50.0);
        // Genuine Celsius readings pass through untouched.
        assert_eq!(canonical_celsius(57.2), 57.2);
        assert_eq!(canonical_celsius(100.0), 100.0);
    }
}
