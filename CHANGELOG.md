# Changelog

Notable changes per release. Dates are the day the build was published.

## Unreleased

### Added

- **`flash-top`, the same dashboard in a terminal.** One Python file, standard
  library only. CPU and memory come from the same Mach calls the widget makes,
  reached through `ctypes`, so the numbers agree with the app; the commands
  (`ioreg`, `netstat`, `ps`, `nettop`) run on background threads at their own
  intervals so a frame never waits for one. CPU and GPU temperatures are the
  one thing it cannot show — those need root or the private IOKit API.
- **The terminal dashboard lays itself out for the window it is in.** Panels
  pack into up to six balanced columns depending on the width, reflowing as the
  window is dragged, and a packed frame trims charts and tables rather than
  stretching them: 121 lines at 80 characters wide, 29 at 200, 24 at 320.

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
