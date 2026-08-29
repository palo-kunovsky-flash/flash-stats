<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="88" alt="">
</p>

<h1 align="center">Flash Stats</h1>

<p align="center">
  A system monitor that lives on your macOS desktop like a widget.<br>
  CPU, memory, GPU, network, temperatures and battery — no sudo, no daemon,
  and a 2.2&nbsp;MB download.
</p>

<p align="center">
  <a href="https://gitlab.com/palo.kunovsky/flash-stats/-/releases/permalink/latest/downloads/flash-stats-aarch64.dmg"><b>Download for Apple&nbsp;Silicon</b></a>
  &nbsp;·&nbsp;
  <a href="#install">Install</a>
  &nbsp;·&nbsp;
  <a href="#where-the-numbers-come-from-no-root">How it reads the hardware</a>
  &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/screenshots/desktop.jpg" width="420" alt="The widget on the desktop showing CPU, GPU, memory, network and temperatures">
</p>

<p align="center">
  <i>It sits at the level of the desktop icons — above the wallpaper, below your
  windows, beside the system's own widgets. "Show desktop" leaves it where it
  is, and Mission Control moves it along with the desktop rather than stranding
  it.</i>
</p>

<p align="center">
  <img src="docs/screenshots/menubar.png" width="330" alt="The network meter in the menu bar, download above upload">
</p>

<p align="center">
  <i>Download and upload stacked next to the clock, half the width of a
  side-by-side readout. Clicking it opens a network panel; the widget itself is
  toggled from the right-click menu, never by this.</i>
</p>

<p align="center">
  <img src="docs/screenshots/card-open.jpg" width="380" alt="The CPU card expanded, showing the user and system split and the busiest processes">
</p>

<p align="center">
  <i>Every card opens for detail. CPU splits the load into user and system, says
  which cluster is carrying it, and names the processes responsible. Memory and
  network do the same for what they measure.</i>
</p>

<p align="center">
  <img src="docs/screenshots/settings.jpg" width="460" alt="The settings window, menu bar pane">
</p>

<p align="center">
  <i>Settings for what is worth choosing: which cards, where the widget sits,
  how often the sensors are read, °C or °F, and whether the one outbound request
  this app makes happens at all.</i>
</p>

Built with Tauri 2 (Rust) and React 19. No sudo, no root helper, no launch
daemon.

<a id="install"></a>

## Install

**Requires an Apple Silicon Mac on macOS 12 or later.** There is no Intel
build; see the roadmap.

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

### Uninstalling

Drag the app to the Trash, or `brew uninstall --cask flash-stats`. Two files
are left behind and can go with it:

```sh
rm -rf ~/Library/Application\ Support/com.kunovsky.flashstats
rm -f  ~/Library/Preferences/com.kunovsky.flashstats.plist
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

## Where the numbers come from (no root)

| Metric | Source |
| --- | --- |
| CPU load, per-core load, P/E cores, frequency | `sysinfo` (host_processor_info) + `hw.cpufrequency`, `hw.perflevel*` |
| CPU user / system split | `host_statistics` (`HOST_CPU_LOAD_INFO` tick counters) |
| Temperatures | IOHID thermal sensors via `sysinfo::Components`, grouped into CPU / GPU / NAND / battery |
| GPU load, VRAM, GPU temperature | IOKit `IOAccelerator` → `PerformanceStatistics` (Device/Renderer/Tiler %, `Alloc system memory`) |
| Battery, power draw, health, cycles, time estimates | IOKit `AppleSmartBattery` (Voltage, InstantAmperage, Temperature, Design/MaxCapacity, CycleCount) |
| RAM split (App / Wired / Compressed / Cached), swap | `host_statistics64` (`vm_statistics64`) + `xsw_usage` |
| Network rates, per-interface counters, IPv4 | `sysinfo::Networks` + `getifaddrs`; the active link comes from the default route |
| Wi-Fi network name | CoreWLAN in-process — the CLI tools answer `<redacted>` to anyone without Location Services access |
| Per-process network rates | `nettop -P -d -t external`, sampled off the tick thread, only while the card is visible |
| Public address | one request to `api.ipify.org` every ten minutes, and only if left switched on |
| Disk throughput and free space | `sysinfo::Disks` (IO counters + statvfs) |
| Hottest processes | `sysinfo::Processes`, refreshed once every 5 ticks |

Registry reads keep the entry alive and fetch single keys, which cut the GPU +
battery read from ~30 ms to under 1 ms per tick. The IOHID sensor read (~60 ms)
runs every sixth tick and the IOKit accelerator registry every other one,
because neither heat nor GPU load says anything new at 1 Hz.

## Known limits

- Apple Silicon does not expose a maximum core clock; the "max" figure is the
  highest frequency observed in the current run (4464 MHz on the M4).
- There is no dedicated GPU temperature sensor on Apple Silicon: the value is
  the average of the `PMU2*` sensors, the same approach the Stats app uses.
- First tick reports zero rates — throughput needs two samples.
- Time-to-full / time-to-empty use the instantaneous power draw, so they bounce
  while the charger negotiates.

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

```sh
npm run tauri:dev      # development
npm run typecheck
PROBE_ROUNDS=1 npm run probe    # one snapshot of every sensor, as JSON
FLASH_STATS_DEBUG=1             # tick timings, sampler phases and UI logs on stderr
```

## Self test

No clicking needed — `FLASH_STATS_SELFTEST=1` drives the window plumbing from
inside the app and prints PASS/FAIL before quitting: the preferences window may
only hide when closed (the tray app must survive), the widget has to be put back
after the system sweeps it away, and the menu bar item must stay registered.

```bash
FLASH_STATS_DEBUG=1 FLASH_STATS_SELFTEST=1 FLASH_STATS_SETTINGS=1 npm run tauri:dev
```

## Design notes

- **Fits its content.** The height is measured from the rendered cards and the
  window resized to match — capped at the height of the screen, where the card
  stack scrolls instead of growing past the edge. Width is a preset
  (360/400/440/480 px) and the position is remembered.
- **Desktop level** (default): the window sits under normal windows but above
  the wallpaper, joins all Spaces, survives "Show Desktop", and never appears
  in the Dock or Cmd+Tab. Settings can switch it to "above windows" or plain
  window behaviour.
- **Translucency** comes from `windowEffects: hudWindow` plus
  `macOSPrivateApi`, so the desktop shows through instead of a flat fill.
- **Preferences window.** Settings live in their own window (`index.html?view=settings`)
  with native sidebar vibrancy, an EN/SK interface and the same glass styling as
  the widget. Closing it hides it; the app keeps running from the menu bar.
- **Menu bar meter.** Drawn in a canvas (SF Mono, fixed-width fields, vector
  arrows) and handed to the `NSStatusItem` as a raw pixel buffer over a binary
  IPC body — no PNG encoded in JavaScript, no base64, once a second. Settings
  toggle between template (adapts to a light or dark menu bar) and coloured.
- **Shortcut.** ⌥⌘S shows/hides the widget (with fallbacks when the combo is
  already taken by another app).

## Roadmap

- [ ] Calibration for the battery time estimates
- [ ] Multiple disks, SMART where available
- [ ] An Intel build, or a universal one
- [ ] Linux / Windows backends (sysfs + hwmon, PDH + WMI)
