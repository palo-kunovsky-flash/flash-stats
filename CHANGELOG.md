# Changelog

Notable changes per release. Dates are the day the build was published.

## Unreleased

Nothing in the app itself yet; these are `flash-top`, which lives in the
repository rather than in the bundle.

### Fixed

- **The chart collapsed to half its width every few sweeps.** Each bucket took
  a fixed `ceil(len / n)` samples, so the moment the history outgrew the panel
  the leftmost columns had nothing left to draw and the chart visibly shrank
  back, over and over. The samples are now divided proportionally between the
  columns, which fills the width and still covers the whole session.
- **A single spike rescaled every bar, twice.** The ceiling was the rounded
  maximum of the moment, so one busy bucket shrank the whole chart and passing
  it stretched it back. A peak now holds the scale for twenty seconds before it
  is allowed to fall.

### Added

- **`--selftest`.** The drawing invariants that have broken before — a chart
  that never narrows, a frame exactly as wide as it claims, text measured
  without counting escape sequences — checked in one run. Reverting the
  bucketing fix makes it report `chart never narrows FAILED, shrank 16 times`.

### Changed

- **The default refresh is one second rather than two**, which doubles the
  charts' resolution for 1.8% of one core instead of 1.3%.

## 0.1.3 — 2026-10-09

### Fixed

- **The battery temperature read about four degrees high.** `AppleSmartBattery`
  reports `Temperature` in hundredths of a degree Celsius, and the widget
  preferred to read it as tenths of a Kelvin. The sibling `VirtualTemperature`
  settles it: in Kelvin it comes out at 78 °C on an idle machine, which is not
  a battery temperature, and the SMC's own `gas gauge battery` sensor sits
  beside the Celsius reading. No arithmetic can tell the two units apart in the
  range a battery occupies — a pack at 25 °C reports 2981 in tenths of a Kelvin
  and 2500 in hundredths of a degree, and both divide into something plausible
  — so the conversion now commits to the unit Apple Silicon uses and reports
  nothing when the result is not a temperature a battery can have.

### Added

- **`flash-top`, the same dashboard in a terminal.** One Python file, standard
  library only. CPU and memory come from the same Mach calls the widget makes,
  reached through `ctypes`, so the numbers agree with the app; the commands
  (`ioreg`, `netstat`, `ps`, `nettop`) run on background threads at their own
  intervals so a frame never waits for one. It lives in the repository as
  `./flash-top` and is **not** part of the app bundle, so nothing below about
  the dashboard changes anything in this download — clone the repo for it.
- **The terminal dashboard reads the real thermal sensors.** CPU and GPU
  temperature come from IOKit's private `IOHIDEventSystemClient`, the same
  interface the widget uses, reached through `ctypes`: the hottest sensor of
  the CPU group and the average of the GPU group, matching what the app shows,
  with the SSD and battery sensors beside them. The battery moved out of its
  own panel and onto the machine line to make room — a chart of a number that
  moves over hours was the least useful thing on screen.
- **Charts name their series.** Each series is labelled in the chart's own
  label column, in the colour it is drawn in, so a two-series chart says which
  of its two blocks is which. The panels are also ordered so that what belongs
  together sits together: the SoC and its heat, then what it is working on,
  then storage, the network, and finally the processes behind all of it.
- **The terminal dashboard lays itself out for the window it is in.** Every
  frame is built in each column count that fits, up to eight, and the shortest
  one wins, so the arrangement is measured rather than guessed from the width:
  122 lines at 80 characters, 29 at 200, 21 at 320, 18 at 400. A packed frame
  trims charts and tables rather than stretching them, and from five columns on
  the network panel splits into link, interfaces and talkers, since as one tall
  panel it set the height of the whole frame. `--cols N` forces a count.

## 0.1.2 — 2026-08-29

### Fixed

- **The About pane reported the wrong version.** The number shown in the app
  came from the crate version while the bundle took its own from the Tauri
  config, and 0.1.1 shipped with only the latter bumped — so it installed as
  0.1.1 and called itself 0.1.0. There is now one place that carries the
  version, `src-tauri/Cargo.toml`; Tauri falls back to it when the config has
  no `version` field, and that is the same number the binary is compiled with.

## 0.1.1 — 2026-08-29

### Fixed

- **The menu bar meter did not draw.** Instead of the two stacked rates you got
  a plain text readout and a blank icon. The app's Content-Security-Policy set
  `default-src 'self'`, which also governs `connect-src`, and that blocked the
  request Tauri uses for IPC. Tauri catches the failure and quietly falls back
  to a slower interface that serialises everything as JSON — so the meter's raw
  pixel buffer arrived as a JSON object and was rejected. Every other IPC call
  was taking the slow path too.

## 0.1.0 — 2026-08-29

First release. **Superseded by 0.1.1**, which is the same app with the menu bar
meter actually working.

### The widget

- CPU, GPU, memory, network, temperatures and battery, each as a card that
  opens for detail. Disk is available but off by default.
- CPU reports the user and system split from `host_statistics`, which cluster
  is carrying the load, and the busiest processes.
- Memory shows the Activity Monitor breakdown — app, wired, compressed, cached
  — plus what is actually available.
- Network names the link rather than calling it `en0`, shows both addresses,
  and lists which processes are using the connection.
- Lives at the level of the desktop icons: "show desktop" leaves it alone and
  Mission Control moves it with the desktop.

### The menu bar

- Download and upload stacked in one status item, half the width of a
  side-by-side readout, drawn as a real image rather than text.
- Clicking it opens a network panel. It never hides the widget — that is on the
  right-click menu.

### Reading the hardware

No root, no daemon, no helper. IOKit for GPU and battery, IOHID for
temperatures, `host_statistics64` for memory, CoreWLAN for the Wi-Fi name,
`nettop` for per-process network rates, sysinfo for the rest.

The Wi-Fi name needs Location Services, because macOS classes it as location
data. Nothing else uses that permission and no position is ever read.

The one outbound request the app makes is a public-address lookup, once every
ten minutes, and it can be switched off.
