pub mod formatting;
pub mod models;
mod registry;
pub mod sensors;
mod window;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::formatting::{badge, human};
use crate::models::{History, Meta, Snapshot};
use crate::sensors::{Rings, Sampler};
use crate::window::Presentation;

const TRAY_ID: &str = "net-meter";
const WINDOW: &str = "main";

pub struct Shared {
    sampler: Mutex<Sampler>,
    rings: Mutex<Rings>,
    last: Mutex<Option<Snapshot>>,
    interval_ms: AtomicU64,
    tray_net: AtomicBool,
    /// Set once the frontend started drawing the menu-bar meter itself.
    tray_image: AtomicBool,
    /// Last strings pushed to the status item (avoid touching AppKit needlessly).
    tray_shown: Mutex<Option<(String, String)>>,
    tray: Mutex<Option<TrayIcon>>,
}

pub type SharedRef = Arc<Shared>;

// ---------------------------------------------------------------- commands

#[tauri::command]
fn read_meta(state: State<'_, SharedRef>) -> Meta {
    state.sampler.lock().expect("sampler").meta()
}

#[tauri::command]
fn read_snapshot(state: State<'_, SharedRef>) -> Snapshot {
    state
        .last
        .lock()
        .expect("last")
        .clone()
        .unwrap_or_else(|| state.sampler.lock().expect("sampler").tick())
}

#[tauri::command]
fn read_history(state: State<'_, SharedRef>) -> History {
    state.rings.lock().expect("rings").snapshot()
}

#[tauri::command]
fn sample_now(state: State<'_, SharedRef>) -> Snapshot {
    let snap = state.sampler.lock().expect("sampler").tick();
    state.rings.lock().expect("rings").push_snapshot(&snap);
    *state.last.lock().expect("last") = Some(snap.clone());
    snap
}

#[tauri::command]
fn set_interval(state: State<'_, SharedRef>, ms: u64) -> u64 {
    let clamped = ms.clamp(250, 10_000);
    state.interval_ms.store(clamped, Ordering::Relaxed);
    refresh_tray_menu(&state);
    clamped
}

#[tauri::command]
fn set_tray_net(state: State<'_, SharedRef>, enabled: bool) -> bool {
    state.tray_net.store(enabled, Ordering::Relaxed);
    if enabled {
        state.tray_image.store(false, Ordering::Relaxed);
    }
    if !enabled {
        if let  Ok(guard) = state.tray.lock() {
            if let  Some(tray) = guard.as_ref() {
                let _ = tray.set_title(None::<&str>);
                restore_template_icon(&tray);
            }
        }
    }
    refresh_tray_menu(&state);
    enabled
}

/// The widget renders its own menu-bar meter (canvas -> PNG) and ships the
/// bytes here; macOS then shows a crisp, font-perfect status item.
/// The widget draws its own menu-bar meter (canvas -> PNG at device scale);
/// the tray implementation scales it to the 18 pt status-item height.
#[tauri::command]
fn set_tray_image(state: State<'_, SharedRef>, png: Vec<u8>, template: bool) -> Result<(), String> {
    let image = Image::from_bytes(&png).map_err(|error| error.to_string())?;
    let width = image.width();
    let height = image.height();
    let guard = state.tray.lock().map_err(|error| error.to_string())?;
    if let  Some(tray) = guard.as_ref() {
        tray.set_icon_with_as_template(Some(image), template)
            .map_err(|error| error.to_string())?;
        state.tray_image.store(true, Ordering::Relaxed);
        let _ = tray.set_title(None::<&str>);
        debug_log(&format!("tray meter {width}x{height}px template={template}"));
    }
    Ok(())
}

#[tauri::command]
fn tray_image_mode(state: State<'_, SharedRef>) -> bool {
    state.tray_image.load(Ordering::Relaxed)
}

/// "desktop" = widget pinned on the desktop, "floating" = above everything.
#[tauri::command]
fn set_presentation(app: AppHandle, mode: String) -> Result<String, String> {
    let presentation = Presentation::parse(&mode);
    let Some(webview) = app.get_webview_window(WINDOW) else {
        return Err("no window".into());
    };
    let _ = webview.set_always_on_top(presentation == Presentation::Floating);
    window::apply(&webview, presentation)?;
    debug_log(&format!("presentation -> {mode}"));
    Ok(mode)
}

/// Frontend hands its console output here so `FLASH_STATS_DEBUG=1` shows it
/// in the same terminal as the Rust logs.
#[tauri::command]
fn log_line(level: String, msg: String) {
    debug_log(&format!("[{level}] {msg}"));
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_activity_monitor() {
    if let  Err(error) = std::process::Command::new("open")
        .arg("-a")
        .arg("Activity Monitor")
        .spawn()
    {
        debug_log(&format!("could not open Activity Monitor: {error}"));
    }
}

// ------------------------------------------------------------------- tray

/// Compact menu-bar string: `↓1.4M/s ↑220K/s` (fallback for the canvas meter).
pub fn tray_title(snap: &Snapshot) -> String {
    badge(snap.net.down_bps, snap.net.up_bps)
}

fn tooltip(snap: &Snapshot) -> String {
    format!(
        "Flash Stats\n↓ {}\n↑ {}\n{}{}",
        human(snap.net.down_bps),
        human(snap.net.up_bps),
        snap.net.primary,
        snap.net
            .ipv4
            .as_ref()
            .map(|ip| format!(" · {ip}"))
            .unwrap_or_default()
    )
}

fn update_tray(shared: &Shared, handle: &AppHandle, snap: &Snapshot) {
    let show_title =
        shared.tray_net.load(Ordering::Relaxed) && !shared.tray_image.load(Ordering::Relaxed);
    let title = if show_title { tray_title(snap) } else { String::new() };
    let tooltip = tooltip(snap);
    {
        let mut shown = match shared.tray_shown.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if shown.as_ref() == Some(&(title.clone(), tooltip.clone())) {
            return;
        }
        *shown = Some((title.clone(), tooltip.clone()));
    }
    let Some(tray) = handle.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Err(error) = handle.run_on_main_thread(move || {
        if show_title {
            let _ = tray.set_title(Some(&title));
        }
        let _ = tray.set_tooltip(Some(&tooltip));
    }) {
        debug_log(&format!("tray update skipped: {error}"));
    }
}

/// Bring back the plain bar glyph when the canvas meter is switched off.
fn restore_template_icon(tray: &TrayIcon) {
    if let  Some(icon) = tray.app_handle().default_window_icon() {
        let _ = tray.set_icon_with_as_template(Some(icon.clone()), true);
    }
}

fn build_menu(app: &AppHandle, interval_ms: u64, tray_net: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle = MenuItem::with_id(app, "toggle", "Zobraziť / skryť widget", true, None::<&str>)?;
    let activity = MenuItem::with_id(
        app,
        "activity-monitor",
        "Otvoriť Monitor aktivít",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let header = MenuItem::with_id(app, "interval-header", "Frekvencia", false, None::<&str>)?;
    let i500 = CheckMenuItem::with_id(app, "interval-500", "0,5 s", true, interval_ms == 500, None::<&str>)?;
    let i1000 = CheckMenuItem::with_id(app, "interval-1000", "1 s", true, interval_ms == 1000, None::<&str>)?;
    let i2000 = CheckMenuItem::with_id(app, "interval-2000", "2 s", true, interval_ms == 2000, None::<&str>)?;
    let i5000 = CheckMenuItem::with_id(app, "interval-5000", "5 s", true, interval_ms == 5000, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let net = CheckMenuItem::with_id(
        app,
        "tray-net",
        "Meter siete v lište",
        true,
        tray_net,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Ukončiť Flash Stats", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &toggle,
            &activity,
            &sep1,
            &header,
            &i500,
            &i1000,
            &i2000,
            &i5000,
            &sep2,
            &net,
            &sep3,
            &quit,
        ],
    )
}

fn refresh_tray_menu(state: &SharedRef) {
    let interval = state.interval_ms.load(Ordering::Relaxed);
    let tray_net = state.tray_net.load(Ordering::Relaxed);
    if let  Ok(guard) = state.tray.lock() {
        if let  Some(tray) = guard.as_ref() {
            if let  Ok(menu) = build_menu(tray.app_handle(), interval, tray_net) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    }
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, 1000, true)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Flash Stats")
        .on_menu_event(|app, event| {
            let Some(state) = app.try_state::<SharedRef>() else {
                return;
            };
            match event.id.as_ref() {
                "toggle" => toggle_window(app),
                "settings" => {
                    if let Some(window) = app.get_webview_window(WINDOW) {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit("tray://settings", ());
                }
                "activity-monitor" => {
                    let _ = std::process::Command::new("open")
                        .arg("-a")
                        .arg("Activity Monitor")
                        .spawn();
                }
                "quit" => app.exit(0),
                "tray-net" => {
                    let enabled = !state.tray_net.load(Ordering::Relaxed);
                    state.tray_net.store(enabled, Ordering::Relaxed);
                    let _ = app.emit("tray://net", enabled);
                    refresh_tray_menu(&state.inner().clone());
                }
                id if id.starts_with("interval-") => {
                    if let  Ok(ms) = id.trim_start_matches("interval-").parse::<u64>() {
                        state.interval_ms.store(ms, Ordering::Relaxed);
                        let _ = app.emit("tray://interval", ms);
                        refresh_tray_menu(&state.inner().clone());
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let  tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let  Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).icon_as_template(true);
    }
    builder.build(app)
}

// ------------------------------------------------------------------ setup

/// `FLASH_STATS_DEBUG=1` prints sampling + frontend logs to stderr.
pub fn debug_log(msg: &str) {
    if std::env::var("FLASH_STATS_DEBUG").is_ok() {
        eprintln!("[flash-stats] {msg}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            read_meta,
            read_snapshot,
            read_history,
            sample_now,
            set_interval,
            set_tray_net,
            set_tray_image,
            tray_image_mode,
            set_presentation,
            log_line,
            quit_app,
            open_activity_monitor
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let tray = build_tray(&handle)?;
            let shared: SharedRef = Arc::new(Shared {
                sampler: Mutex::new(Sampler::new()),
                rings: Mutex::new(Rings::default()),
                last: Mutex::new(None),
                interval_ms: AtomicU64::new(1000),
                tray_net: AtomicBool::new(true),
                tray_image: AtomicBool::new(false),
                tray_shown: Mutex::new(None),
                tray: Mutex::new(Some(tray)),
            });
            app.manage(Arc::clone(&shared));

            // Start as a desktop widget unless the user asked otherwise.
            if let  Some(webview) = app.get_webview_window(WINDOW) {
                let _ = webview.set_always_on_top(false);
                window::apply(&webview, Presentation::Desktop)?;
            }

            std::thread::Builder::new()
                .name("sampler".into())
                .spawn(move || {
                    let mut failures = 0u32;
                    loop {
                        let interval = shared.interval_ms.load(Ordering::Relaxed).max(250);
                        let started = std::time::Instant::now();
                        let snap = match shared.sampler.lock() {
                            Ok(mut sampler) => sampler.tick(),
                            Err(_) => {
                                failures += 1;
                                if failures > 8 {
                                    debug_log("sampler lock poisoned, giving up");
                                    return;
                                }
                                std::thread::sleep(Duration::from_secs(1));
                                continue;
                            }
                        };
                        failures = 0;
                        if let  Ok(mut rings) = shared.rings.lock() {
                            rings.push_snapshot(&snap);
                        }
                        if let  Ok(mut last) = shared.last.lock() {
                            *last = Some(snap.clone());
                        }
                        update_tray(&shared, &handle, &snap);
                        debug_log(&format!(
                            "tick {:>4}ms  cpu {:>4.0}%  gpu {:>4}  ram {:>4.0}%  net {} / {}  \"{}\"  [{:>4}ms]",
                            snap.interval_ms,
                            snap.cpu.usage,
                            snap.gpu
                                .usage
                                .map(|v| format!("{v:.0}%"))
                                .unwrap_or_else(|| "n/a".into()),
                            if snap.memory.total > 0 {
                                snap.memory.used as f64 / snap.memory.total as f64 * 100.0
                            } else {
                                0.0
                            },
                            human(snap.net.down_bps),
                            human(snap.net.up_bps),
                            tray_title(&snap),
                            started.elapsed().as_millis(),
                        ));
                        let phases = shared
                            .sampler
                            .lock()
                            .map(|sampler| sampler.phase_ms)
                            .unwrap_or([0; 6]);
                        debug_log(&format!(
                            "   phases cpu/mem {}  net {}  disk {}  procs {}  temps {}  build {} ms",
                            phases[0], phases[1], phases[2], phases[3], phases[4], phases[5]
                        ));
                        let _ = handle.emit("telemetry", &snap);
                        std::thread::sleep(Duration::from_millis(interval));
                    }
                })?;

            debug_log(&format!("Flash Stats v{} started", env!("CARGO_PKG_VERSION")));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Flash Stats");
}
