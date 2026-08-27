//! Battery state from the `AppleSmartBattery` IOKit object: charge, power
//! draw, temperature, cycles and a rough time estimate.

use crate::models::BatteryInfo;
use crate::registry::Service;

const CLASS: &str = "AppleSmartBattery";
const KEY: &str = "CurrentCapacity";

pub struct Battery {
    service: Option<Service>,
}

impl Battery {
    pub fn new() -> Self {
        Self {
            service: Service::find(CLASS, KEY),
        }
    }

    pub fn present(&self) -> bool {
        self.service.is_some()
    }

    fn service(&mut self) -> Option<&Service> {
        if self.service.is_none() {
            self.service = Service::find(CLASS, KEY);
        }
        self.service.as_ref()
    }

    pub fn read(&mut self) -> BatteryInfo {
        let mut info = BatteryInfo::default();
        let Some(service) = self.service() else {
            return info;
        };
        info.present = true;

        let level = service.f64("CurrentCapacity").unwrap_or(0.0) as f32;
        info.level = level;
        info.charging = service.bool("IsCharging").unwrap_or(false);
        info.ac_connected = service.bool("ExternalConnected").unwrap_or(false);

        // Voltage in mV, amperage in µA (negative = discharging).
        let voltage_mv = service.f64("Voltage").unwrap_or(0.0) as f32;
        let amperage_ua = service.i64("InstantAmperage").unwrap_or(0) as f64;
        info.voltage_mv = voltage_mv;
        info.amperage_ma = (amperage_ua / 1000.0) as f32;
        // mV * µA = 1e-9 W, and Apple reports current flowing *into* the battery.
        info.watts = -(voltage_mv as f64 * amperage_ua) as f32 / 1e9;

        // SMC reports battery temperature in tenths of Kelvin.
        if let Some(raw) = service.f64("Temperature") {
            let kelvin = raw / 10.0;
            info.temp_c = if (200.0..400.0).contains(&kelvin) {
                Some((kelvin - 273.15) as f32)
            } else {
                Some((raw / 100.0) as f32)
            };
        }

        let design = service.f64("DesignCapacity").unwrap_or(0.0) as f32;
        info.design_mah = design;
        // MaxCapacity is a percentage of the design capacity, i.e. health.
        info.health = service.f64("MaxCapacity").unwrap_or(100.0) as f32;
        info.health = info.health.clamp(0.0, 100.0);
        info.cycles = service.u64("CycleCount").map(|value| value as u32);
        if info.cycles.is_none() {
            info.cycles = service
                .dict("BatteryData")
                .and_then(|data| crate::registry::u64_of(&data, "CycleCount"))
                .map(|value| value as u32);
        }

        let max_mah = if design > 0.0 {
            design * info.health / 100.0
        } else {
            0.0
        };
        info.now_mah = max_mah * level / 100.0;

        if voltage_mv > 1.0 && max_mah > 0.0 {
            let now_wh = info.now_mah as f64 * voltage_mv as f64 / 1e6;
            let max_wh = max_mah as f64 * voltage_mv as f64 / 1e6;
            let watts = info.watts as f64;
            if !info.ac_connected && watts > 0.5 {
                info.time_remaining_secs =
                    Some((now_wh / watts * 3600.0).clamp(0.0, 172_800.0) as u64);
            } else if info.charging && watts.abs() > 0.5 {
                let missing = (max_wh - now_wh).max(0.0);
                info.time_remaining_secs =
                    Some((missing / watts.abs() * 3600.0).clamp(0.0, 172_800.0) as u64);
            }
        }
        info
    }
}

impl Default for Battery {
    fn default() -> Self {
        Self::new()
    }
}
