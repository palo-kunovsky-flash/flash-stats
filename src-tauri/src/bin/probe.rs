//! CLI probe: `cargo run --bin probe` — dumps everything the sensors can see.
//! Handy for checking that the IOKit / SMC reads work on a new machine.

use std::time::Duration;

use flash_stats_lib::sensors::Sampler;
use flash_stats_lib::{formatting, models};

fn main() {
    let mut sampler = Sampler::new();
    // The probe is for looking at everything, including the samples the widget
    // only collects while the matching card is on screen.
    sampler
        .net_top_switch()
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let meta = sampler.meta();
    println!("== meta ==");
    println!("{}", serde_json::to_string_pretty(&meta).unwrap());

    let rounds: usize = std::env::var("PROBE_ROUNDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);

    for i in 0..rounds {
        let snap = sampler.tick();
        println!("\n== sample {i} ==");
        println!("{}", serde_json::to_string_pretty(&snap).unwrap());
        println!(
            "cpu {:>5.1}%  gpu {:>5.1}%  ram {:>5.1}%  batt {:>3.0}% {:>6.2}W  net ↓{} ↑{}",
            snap.cpu.usage,
            snap.gpu.usage.unwrap_or(0.0),
            formatting::percent(snap.memory.used, snap.memory.total),
            snap.battery.level,
            snap.battery.watts,
            formatting::human(snap.net.down_bps),
            formatting::human(snap.net.up_bps),
        );
        if i + 1 < rounds {
            std::thread::sleep(Duration::from_millis(1000));
        }
    }
    let _ = std::mem::size_of::<models::Snapshot>();
}
