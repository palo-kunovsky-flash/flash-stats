pub mod formatting;
pub mod i18n;
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
const SETTINGS: &str = "settings";

pub struct Shared {
    sampler: Mutex<Sampler>,
    rings: Mutex<Rings>,
    last: Mutex<Option<Snapshot>>,
    interval_ms: AtomicU64,
    tray_net: AtomicBool,
    /// Set once the frontend started drawing the menu-bar meter itself.
    tray_image: AtomicBool,
    /// The widget may be hidden by the user only; anything else (Mission
    /// Control, "show desktop", app hiding) gets undone by the sampler.
    want_visible: AtomicBool,
    /// True while the bar sits on the desktop layers; in plain window or
    /// floating mode the system is allowed to sweep it away.
    pinned: AtomicBool,
    /// Language of the tray menu, pushed by the frontend.
    lang: Mutex<i18n::Lang>,
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
    if let Some(state) = app.try_state::<SharedRef>() {
        state.pinned.store(
            matches!(
                presentation,
                Presentation::Desktop | Presentation::Wallpaper
            ),
            std::sync::atomic::Ordering::Relaxed,
        );
    }
    if let Some(window) = app.get_webview_window(WINDOW) {
        window::apply(&window, presentation)?;
    }
    Ok(format!("{presentation:?}"))
}

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
        // The title has to be cleared explicitly: leftover text would sit next
        // to the canvas meter and the bar would show the rates twice.
        let _ = tray.set_title(Some(if show_title { &title } else { "" }));
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

fn build_menu(
    app: &AppHandle,
    interval_ms: u64,
    tray_net: bool,
    lang: i18n::Lang,
) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle = MenuItem::with_id(app, "toggle", lang.toggle(), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", lang.settings(), true, None::<&str>)?;
    let activity = MenuItem::with_id(
        app,
        "activity-monitor",
        lang.activity_monitor(),
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let header = MenuItem::with_id(app, "interval-header", lang.frequency(), false, None::<&str>)?;
    let i500 = CheckMenuItem::with_id(app, "interval-500", "0,5 s", true, interval_ms == 500, None::<&str>)?;
    let i1000 = CheckMenuItem::with_id(app, "interval-1000", "1 s", true, interval_ms == 1000, None::<&str>)?;
    let i2000 = CheckMenuItem::with_id(app, "interval-2000", "2 s", true, interval_ms == 2000, None::<&str>)?;
    let i5000 = CheckMenuItem::with_id(app, "interval-5000", "5 s", true, interval_ms == 5000, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let net = CheckMenuItem::with_id(
        app,
        "tray-net",
        lang.network_meter(),
        true,
        tray_net,
        None::<&str>,
    )?;
    let place = MenuItem::with_id(app, "place", lang.place(), true, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", lang.quit(), true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &toggle,
            &settings,
            &activity,
            &sep1,
            &header,
            &i500,
            &i1000,
            &i2000,
            &i5000,
            &sep2,
            &net,
            &place,
            &sep3,
            &quit,
        ],
    )
}

fn refresh_tray_menu(state: &SharedRef) {
    let interval = state.interval_ms.load(Ordering::Relaxed);
    let tray_net = state.tray_net.load(Ordering::Relaxed);
    let lang = *state.lang.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            if let Ok(menu) = build_menu(tray.app_handle(), interval, tray_net, lang) {
                let _ = tray.set_menu(Some(menu));
            }
        }
    }
}

/// FLASH_STATS_SELFTEST=1 exercises the window plumbing without any clicking:
/// the preferences window may only hide (never quit the app), and the widget
/// must come back when the system sweeps it away.
fn selftest(app: AppHandle) {
    std::thread::spawn(move || {
        let mut failures: Vec<String> = Vec::new();
        let mut check = |name: &str, ok: bool| {
            debug_log(&format!(
                "selftest {} {}",
                if ok { "ok  " } else { "FAIL" },
                name
            ));
            if !ok {
                failures.push(name.to_string());
            }
        };

        std::thread::sleep(Duration::from_millis(4500));

        if let Ok(monitors) = app.available_monitors() {
            for monitor in monitors {
                debug_log(&format!(
                    "monitor {:?} pos={:?} size={:?} scale={:.2}",
                    monitor.name(),
                    monitor.position(),
                    monitor.size(),
                    monitor.scale_factor(),
                ));
            }
        }
        if let Some(widget) = app.get_webview_window(WINDOW) {
            debug_log(&format!(
                "widget frame pos={:?} size={:?}",
                widget.outer_position().ok(),
                widget.outer_size().ok(),
            ));
        }

        let widget = app.get_webview_window(WINDOW);
        check("widget window exists", widget.is_some());
        if let Some(widget) = widget {
            check("widget visible", widget.is_visible().unwrap_or(false));
            // Stand in for Mission Control / "show desktop" hiding the window.
            let _ = widget.hide();
            check(
                "watchdog put the widget back",
                {
                    std::thread::sleep(Duration::from_millis(2800));
                    widget.is_visible().unwrap_or(false)
                },
            );
        }

        match open_settings(app.clone()) {
            Ok(()) => {
                std::thread::sleep(Duration::from_millis(600));
                let settings = app.get_webview_window(SETTINGS);
                check("settings window exists", settings.is_some());
                if let Some(settings) = settings {
                    check("settings visible", settings.is_visible().unwrap_or(false));
                    let _ = settings.close();
                    std::thread::sleep(Duration::from_millis(800));
                    let after = app.get_webview_window(SETTINGS);
                    check(
                        "closing settings kept the window alive",
                        after.is_some(),
                    );
                    check(
                        "settings hidden after close",
                        after.map(|window| !window.is_visible().unwrap_or(true)).unwrap_or(false),
                    );
                }
            }
            Err(error) => {
                debug_log(&format!("selftest open_settings error: {error}"));
                check("open_settings succeeded", false);
            }
        }

        check("tray meter still registered", app.tray_by_id(TRAY_ID).is_some());
        if failures.is_empty() {
            debug_log("SELFTEST PASS");
        } else {
            debug_log(&format!("SELFTEST FAIL ({}): {:?}", failures.len(), failures));
        }
        app.exit(0);
    });
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    set_widget_visible(app, !visible);
}

/// The only place that decides whether the widget may be on screen.
fn set_widget_visible(app: &AppHandle, visible: bool) {
    if let Some(state) = app.try_state::<SharedRef>() {
        state.want_visible.store(visible, std::sync::atomic::Ordering::Relaxed);
    }
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if visible {
        let _ = window.show();
    } else {
        let _ = window.hide();
    }
}

/// macOS sweeps windows away on ⌘F3 / "show desktop" and when an app is
/// hidden. A desktop widget is meant to stay, so it is put back every tick.
fn keep_on_desktop(app: &AppHandle) {
    let Some(state) = app.try_state::<SharedRef>() else {
        return;
    };
    let relaxed = std::sync::atomic::Ordering::Relaxed;
    if !state.pinned.load(relaxed) || !state.want_visible.load(relaxed) {
        return;
    }
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        // Visible is not enough: on show desktop the window can be sent to the
        // back of the desktop layer, behind the wallpaper and the icons.
        window::reassert(&window);
        return;
    }
    debug_log("widget disappeared, putting it back on the desktop");
    let _ = window.show();
}

/// Frontend tells us which language the interface is in.
#[tauri::command]
fn set_language(app: tauri::AppHandle, state: tauri::State<'_, SharedRef>, code: String) -> Result<(), String> {
    let lang = i18n::Lang::parse(&code);
    {
        let mut guard = state.lang.lock().map_err(|error| error.to_string())?;
        *guard = lang;
    }
    debug_log(&format!("interface language -> {:?}", lang));
    refresh_tray_menu(&state);
    if let Some(window) = app.get_webview_window(SETTINGS) {
        let _ = window.set_title(lang.settings_window_title());
    }
    Ok(())
}

#[tauri::command]
fn show_widget(app: tauri::AppHandle) {
    set_widget_visible(&app, true);
}

#[tauri::command]
fn hide_widget(app: tauri::AppHandle) {
    set_widget_visible(&app, false);
}

/// Real settings window, like every other macOS app has. It is declared in
/// tauri.conf.json (with native vibrancy) and only ever shown or hidden here.
#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(SETTINGS) else {
        return Err("settings window is missing".into());
    };
    let _ = window.unminimize();
    let _ = window.show();
    window::raise(&app, SETTINGS);
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, 1000, true, i18n::Lang::En)?;

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
                    if let Err(error) = open_settings(app.clone()) {
                        debug_log(&format!("open settings failed: {error}"));
                    }
                }
                "activity-monitor" => {
                    let _ = std::process::Command::new("open")
                        .arg("-a")
                        .arg("Activity Monitor")
                        .spawn();
                }
                "place" => {
                    // The widget can end up buried under the system widgets and
                    // then cannot be grabbed; put it back on its grid slot.
                    set_widget_visible(app, true);
                    if let Some(window) = app.get_webview_window(WINDOW) {
                        window::reassert(&window);
                    }
                    let _ = app.emit("widget://place", ());
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

/// The pane walk in the settings window clicks through every panel, so it only
/// runs when someone asks for it with FLASH_STATS_AUDIT=1.
#[tauri::command]
fn audit_enabled() -> bool {
    std::env::var("FLASH_STATS_AUDIT").is_ok()
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
            set_language,
            show_widget,
            hide_widget,
            open_settings,
            log_line,
            audit_enabled,
            quit_app,
            open_activity_monitor
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Menu bar app: no Dock tile. The bar lives on the desktop and the settings
// window comes from the tray menu, so a Dock icon is noise — and a regular
// policy app also gets swept away by "show desktop".
app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let tray = build_tray(&handle)?;
            #[cfg(target_os = "macos")]
            unsafe {
                use objc2::msg_send;
                use objc2::runtime::AnyObject;
                let ns_app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
                let policy: isize = msg_send![ns_app, activationPolicy];
                debug_log(&format!("activation policy -> {policy} (1 = accessory, no Dock tile)"));
            }
            let shared: SharedRef = Arc::new(Shared {
                sampler: Mutex::new(Sampler::new()),
                rings: Mutex::new(Rings::default()),
                last: Mutex::new(None),
                interval_ms: AtomicU64::new(1000),
                tray_net: AtomicBool::new(true),
                tray_image: AtomicBool::new(false),
                want_visible: AtomicBool::new(false),
                pinned: AtomicBool::new(true),
                lang: Mutex::new(i18n::Lang::En),
                tray_shown: Mutex::new(None),
                tray: Mutex::new(Some(tray)),
            });
            app.manage(Arc::clone(&shared));

            // Start as a desktop widget unless the user asked otherwise.
            if let  Some(webview) = app.get_webview_window(WINDOW) {
                let _ = webview.set_always_on_top(false);
                window::apply(&webview, Presentation::Desktop)?;
                // FLASH_STATS_SETTINGS=1 opens the preference window straight
                // away — handy while working on it.
                if std::env::var("FLASH_STATS_SETTINGS").is_ok() {
                    if let Err(error) = open_settings(handle.clone()) {
                        debug_log(&format!("settings window failed: {error}"));
                    }
                }
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
                        keep_on_desktop(&handle);
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
            if std::env::var("FLASH_STATS_SELFTEST").is_ok() {
                selftest(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the preferences window only hides it — the widget and
                // the menu bar meter keep running.
                if window.label() == SETTINGS {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Flash Stats")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // A tray-only app must survive the last window being closed.
                // app.exit(0) from the tray menu carries a code and still quits.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
