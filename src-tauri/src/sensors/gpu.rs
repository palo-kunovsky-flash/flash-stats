//! GPU counters from the Apple graphics accelerator (IOKit), no root needed.

use crate::models::GpuInfo;
use crate::registry::{f64_of, Service};

const CLASS: &str = "IOAccelerator";
const STATS: &str = "PerformanceStatistics";

pub struct Gpu {
    pub name: String,
    pub cores: u32,
    service: Option<Service>,
}

impl Gpu {
    pub fn detect() -> Self {
        let service = Service::find(CLASS, STATS);
        let mut name = String::from("GPU");
        let mut cores = 0u32;
        if let Some(service) = service.as_ref() {
            if let Some(model) = service.value("model").and_then(|v| v.into_string()) {
                name = model;
            } else if let Some(publisher) = service
                .value("IOPersonalityPublisher")
                .and_then(|v| v.into_string())
            {
                name = publisher;
            }
            cores = service.u64("gpu-core-count").unwrap_or(0) as u32;
        }
        Self {
            name,
            cores,
            service,
        }
    }

    fn service(&mut self) -> Option<&Service> {
        if self.service.is_none() {
            self.service = Service::find(CLASS, STATS);
        }
        self.service.as_ref()
    }

    pub fn read(&mut self) -> GpuInfo {
        let mut info = GpuInfo::default();
        let Some(stats) = self.service().and_then(|service| service.dict(STATS)) else {
            return info;
        };
        info.usage = percent(&stats, "Device Utilization %");
        info.renderer = percent(&stats, "Renderer Utilization %");
        info.tiler = percent(&stats, "Tiler Utilization %");
        info.allocated_bytes = crate::registry::u64_of(&stats, "Alloc system memory");
        info.in_use_bytes = crate::registry::u64_of(&stats, "In use system memory")
            .or(info.allocated_bytes);
        info
    }
}

fn percent(stats: &plist::Dictionary, key: &str) -> Option<f32> {
    f64_of(stats, key).map(|value| value.clamp(0.0, 100.0) as f32)
}
