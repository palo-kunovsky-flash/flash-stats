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

        info.temp_c = service.f64("Temperature").and_then(battery_celsius);

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

/// `AppleSmartBattery`'s `Temperature`, in hundredths of a degree Celsius.
///
/// Read as tenths of a Kelvin — which the Smart Battery Data spec prescribes,
/// and which this code used to prefer — the sibling `VirtualTemperature` comes
/// out at 78 °C on an idle machine, which is not a battery temperature. In
/// hundredths of a degree the two fields read 31 °C and 35 °C, and the SMC's
/// own `gas gauge battery` sensor sits between them.
///
/// There is no arithmetic that tells the two units apart in the range a
/// battery actually occupies: a pack at 25 °C reports 2981 in tenths of a
/// Kelvin and 2500 in hundredths of a degree, and both divide into something
/// plausible. So this commits to the unit Apple Silicon uses and returns
/// nothing at all when the result is not a temperature a battery can have,
/// rather than converting it twice and believing whichever answer fits.
pub fn battery_celsius(raw: f64) -> Option<f32> {
    let celsius = raw / 100.0;
    (-20.0..80.0).contains(&celsius).then_some(celsius as f32)
}

#[cfg(test)]
mod tests {
    use super::battery_celsius;

    #[test]
    fn hundredths_of_a_degree_are_the_unit() {
        // Real readings from an M4 on AC: Temperature and VirtualTemperature.
        assert_eq!(battery_celsius(3083.0), Some(30.83));
        assert_eq!(battery_celsius(3509.0), Some(35.09));
    }

    #[test]
    fn nonsense_is_reported_as_nothing() {
        assert_eq!(battery_celsius(0.0), Some(0.0));
        assert_eq!(battery_celsius(29815.0), None); // whatever this is, not °C
        assert_eq!(battery_celsius(-5000.0), None);
    }
}
