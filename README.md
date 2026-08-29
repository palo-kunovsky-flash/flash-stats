# Flash Stats

A system monitor for macOS that lives on the desktop like a widget: CPU, RAM,
GPU, network and battery (plus disk if you want it). Small, translucent, and it
needs no elevated privileges.

Built with Tauri 2 (Rust backend) + React 19 (frontend). No sudo, no root
helper, no launch daemon.

## What it looks like

<img src="docs/screenshots/desktop.jpg" width="380" alt="The widget on the desktop, showing CPU, GPU, memory, network and temperatures">

It sits on the desktop at the level of the icons — above the wallpaper, below
your windows, next to the system's own widgets. "Show desktop" leaves it where
it is, and Mission Control moves it along with the desktop rather than
stranding it.

<img src="docs/screenshots/menubar.png" width="300" alt="The network meter in the menu bar, download above upload">

Download and upload stacked next to the clock, half the width of a
side-by-side readout. Clicking it opens a network panel; the widget itself is
toggled from the right-click menu, never by this.

<img src="docs/screenshots/card-open.jpg" width="380" alt="The CPU card expanded, showing the user and system split and the busiest processes">

Every card opens for detail. CPU splits the load into user and system, says
which cluster is carrying it and which processes are responsible. Memory and
network do the same for what they measure.

<img src="docs/screenshots/settings.jpg" width="460" alt="The settings window, menu bar pane">

## Install

[**Download Flash Stats**](https://gitlab.com/palo.kunovsky/flash-stats/-/releases/permalink/latest/downloads/flash-stats-aarch64.dmg)
— 2.2 MB — then drag it to Applications. Older versions are on the
[releases page](https://gitlab.com/palo.kunovsky/flash-stats/-/releases).

Or with Homebrew:

```sh
brew tap palo.kunovsky/flash-stats https://gitlab.com/palo.kunovsky/homebrew-flash-stats.git
brew install --cask --no-quarantine flash-stats
```

**The first launch needs one extra step.** The app is signed, but with an
ad-hoc signature rather than an Apple Developer ID, because that certificate
costs $99 a year and this is a free tool. macOS therefore cannot check it
against Apple and refuses the first launch:

1. Double-click Flash Stats. macOS says it cannot verify the developer.
2. Open **System Settings → Privacy & Security**, scroll down, and press
   **Open Anyway** next to the message about Flash Stats.
3. Confirm. macOS remembers the decision; later launches are ordinary
   double-clicks.

Flash Stats has no Dock icon — it is a menu bar app. Look for the network
meter next to the clock.

### Wi-Fi network name

macOS treats the name of the network you are joined to as location data, so the
first launch asks for Location Services. Nothing else uses it, no position is
ever read, and declining only means the network card shows "Wi-Fi" instead of
the network's name.

## Building it yourself

```sh
npm install
npm run release      # signed .app + .dmg in src-tauri/target/release/bundle
```

`npm run release` is `tauri build` with `APPLE_SIGNING_IDENTITY=-`, which
ad-hoc signs the bundle before the disk image is built. Without it the bundle
ends up with a broken seal and macOS reports the app as *damaged* rather than
merely unverified — a much worse first impression, and a much longer detour for
whoever downloaded it.

## Self test

No clicking needed — `FLASH_STATS_SELFTEST=1` drives the window plumbing from
inside the app and prints PASS/FAIL before quitting: the preferences window may
only hide when closed (the tray app must survive), the widget has to be put back
after the system sweeps it away, and the menu bar item must stay registered.

```bash
FLASH_STATS_DEBUG=1 FLASH_STATS_SELFTEST=1 FLASH_STATS_SETTINGS=1 npm run tauri:dev
```

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

## Positioning

The bar is placed on a grid instead of being dropped anywhere: pick a side and an
edge (right/top by default) and a slot — one slot is the widget's own height plus a
16 px gap, so several of them stack into a tidy column like the system widgets.
Manual drags snap to an 8 px lattice. Positions are clamped so the widget is always
fully on the display it lands on, and the slot it does not fit into just clamps to
the last row that does.

`Place on the grid` (tray menu, or the button in Settings → Widget) is the recovery
action: it shows the widget, orders it to the front of the desktop layer and puts it
on its slot on the display with the menu bar. Use it when the bar ends up behind the
system widgets or on a display that is switched off.

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
- **Preferences window.** Settings live in their own window (`index.html?view=settings`)
  with native sidebar vibrancy, an EN/SK interface and the same glass styling as
  the widget. Closing it hides it; the app keeps running from the menu bar.
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
