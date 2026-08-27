# Flash Stats

A system monitor for macOS that lives on the desktop like a widget: CPU, RAM,
GPU, network and battery (plus disk if you want it). Small, translucent, and it
needs no elevated privileges.

Built with Tauri 2 (Rust backend) + React 19 (frontend). No sudo, no root
helper, no launch daemon.

## Run

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm install
npm run tauri:dev      # development
npm run tauri:build    # bundle Flash Stats.app
```

Quick data probe without the GUI (prints one snapshot as JSON):

```bash
PROBE_ROUNDS=1 cargo run --manifest-path src-tauri/Cargo.toml --bin probe
FLASH_STATS_DEBUG=1    # verbose stderr: tick timings, sampler phases, UI logs
```

## Design notes

- **No scrolling.** The window height is measured from the rendered content
  (header bar + visible cards) and resized to fit; width is a preset
  (280/320/360/420 px) and the position is remembered.
- **Desktop level** (default): the window sits under normal windows but above
  the wallpaper, joins all Spaces, survives "Show Desktop", and never appears
  in the Dock or Cmd+Tab. Settings can switch it to "above windows" or plain
  window behaviour.
- **Translucency** comes from `windowEffects: hudWindow` plus
  `macOSPrivateApi`, so the desktop shows through instead of a flat fill.
- **Menu bar meter.** The network meter is drawn in the frontend canvas (SF
  Mono, fixed-width fields, vector arrows) and pushed to the `NSStatusItem` as
  a PNG. Settings toggle between template (adapts to light/dark menu bar) and
  coloured mode; the full readout stays in the tooltip.
- **Shortcut.** ⌥⌘S shows/hides the widget (with fallbacks when the combo is
  already taken by another app).

## Where the numbers come from (no root)

| Metric | Source |
| --- | --- |
| CPU load, per-core load, P/E cores, frequency | `sysinfo` (host_processor_info) + `hw.cpufrequency`, `hw.perflevel*` |
| Temperatures | IOHID thermal sensors via `sysinfo::Components`, grouped into CPU / GPU / NAND / battery |
| GPU load, VRAM, GPU temperature | IOKit `IOAccelerator` → `PerformanceStatistics` (Device/Renderer/Tiler %, `Alloc system memory`) |
| Battery, power draw, health, cycles, time estimates | IOKit `AppleSmartBattery` (Voltage, InstantAmperage, Temperature, Design/MaxCapacity, CycleCount) |
| RAM split (App / Wired / Compressed / Cached), swap | `host_statistics64` (`vm_statistics64`) + `xsw_usage` |
| Network rates, per-interface counters, IPv4 | `sysinfo::Networks` + `getifaddrs` |
| Disk throughput and free space | `sysinfo::Disks` (IO counters + statvfs) |
| Hottest processes | `sysinfo::Processes`, refreshed once every 5 ticks |

Registry reads keep the entry alive and fetch single keys, which cut the GPU +
battery read from ~30 ms to under 1 ms per tick. The IOHID sensor read (~50 ms)
runs every third tick because temperature moves slowly.

## Known limits

- Apple Silicon does not expose a maximum core clock; the "max" figure is the
  highest frequency observed in the current run (4464 MHz on the M4).
- There is no dedicated GPU temperature sensor on Apple Silicon: the value is
  the average of the `PMU2*` sensors, the same approach the Stats app uses.
- First tick reports zero rates — throughput needs two samples.
- Time-to-full / time-to-empty use the instantaneous power draw, so they bounce
  while the charger negotiates.

## Roadmap

- [ ] Detail panels per subsystem (click a card for the full table)
- [ ] Calibration for the battery time estimates
- [ ] Multiple disks, SMART where available
- [ ] Linux / Windows backends (sysfs + hwmon, PDH + WMI)
- [ ] UI language switch (the interface is currently Slovak)
