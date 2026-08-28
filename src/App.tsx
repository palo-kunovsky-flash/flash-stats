import { Fragment, useEffect, useRef, useState } from "react";
import {
  BatteryWidget,
  CpuWidget,
  DiskWidget,
  GpuWidget,
  MemoryWidget,
  NetworkWidget,
  TempsWidget,
} from "./components/widgets";
import { useSettings } from "./lib/settings";
import { pushTrayMeter } from "./lib/trayMeter";
import { inTauri, logLine, useTelemetry } from "./lib/telemetry";
import {
  applyPresentation,
  measureHeight,
  moveWindowTo,
  onScreen,
  placeOnGrid,
  gridStep,
  isProgrammaticMove,
  resizeToContent,
  watchMoves,
} from "./lib/windowing";
import { bytes } from "./lib/format";
import { LangContext, translate } from "./lib/i18n";
import { UnitContext } from "./lib/units";

/* ------------------------------------------------------------------ hotkey */
/* React StrictMode mounts twice in development and macOS refuses duplicate
   global grabs, so the hotkey is leased through a refcount with a short grace
   period instead of being torn down on every effect run. */
let hotkeyLeases = 0;
let hotkeyActive: string | null = null;
let hotkeyRelease: ReturnType<typeof setTimeout> | null = null;
let hotkeyPending: Promise<string | null> | null = null;

async function doRegister(preferred: string, onPress: () => Promise<void>): Promise<string | null> {
  const { register } = await import("@tauri-apps/plugin-global-shortcut");
  const candidates = [
    preferred,
    "Alt+Command+F",
    "Alt+Command+Shift+S",
    "Control+Option+Command+S",
  ];
  for (const shortcut of candidates) {
    try {
      await register(shortcut, (event) => {
        if (event.state === "Pressed") void onPress();
      });
      hotkeyActive = shortcut;
      void logLine("ui", `global shortcut active: ${shortcut}`);
      return shortcut;
    } catch {
      /* occupied — try the next combination */
    }
  }
  void logLine("warn", "no global shortcut could be registered");
  return null;
}

async function acquireShortcut(
  preferred: string,
  onPress: () => Promise<void>,
): Promise<string | null> {
  hotkeyLeases += 1;
  if (hotkeyRelease) {
    clearTimeout(hotkeyRelease);
    hotkeyRelease = null;
  }
  if (hotkeyActive) return hotkeyActive;
  // One registration at a time, even when React mounts the effect twice.
  if (!hotkeyPending) {
    hotkeyPending = doRegister(preferred, onPress).finally(() => {
      hotkeyPending = null;
    });
  }
  return hotkeyPending;
}

async function releaseShortcut(): Promise<void> {
  hotkeyLeases = Math.max(0, hotkeyLeases - 1);
  if (hotkeyLeases > 0 || !hotkeyActive) return;
  const active = hotkeyActive;
  hotkeyActive = null;
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (hotkeyLeases > 0) return;
  try {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await unregister(active);
  } catch {
    /* already gone */
  }
}

export default function App() {
  const { settings, update, ready, lang } = useSettings();
  const t = (key: string) => translate(lang, key);
  const { snap, hist, meta } = useTelemetry(settings.intervalMs);
  const placed = useRef(false);
  const lastHeight = useRef(0);
  /** Last width actually applied to the window. Changing only the width leaves
      the measured height identical, and the guard below would then skip the
      resize entirely — which is why the widget never got wider. */
  const lastWidth = useRef(0);
  /** Menu bar height in logical px; asked for once, used for placing and for
      capping the window to the screen. */
  const menuBar = useRef<number | null>(null);
  // The move listener is installed once, so it reads the settings it needs
  // through a ref instead of capturing them from the first render.
  const live = useRef({ snap: settings.snap, pos: settings.pos });
  live.current = { snap: settings.snap, pos: settings.pos };

  useEffect(() => {
    void logLine("ui", "App mounted");
  }, []);

  /* -------------------------------------------------- window: fit content */
  useEffect(() => {
    if (!inTauri || !ready) return;
    if (menuBar.current === null) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<number>("menu_bar_height")
          .then((value) => {
            menuBar.current = value;
          })
          .catch(() => {
            menuBar.current = 24;
          }),
      );
    }
    let frame = 0;
    const fit = () => {
      // Scrollbars are hidden throughout the widget, so when the stack is
      // capped it needs some other sign that the list carries on below.
      const stack = document.querySelector<HTMLElement>(".stack");
      if (stack) {
        stack.classList.toggle(
          "scrollable",
          stack.scrollHeight > stack.clientHeight + 2,
        );
      }
      const height = measureHeight();
      if (height <= 0) return;
      const resized = lastWidth.current !== settings.width;
      if (!resized && Math.abs(height - lastHeight.current) < 1) return;
      lastHeight.current = height;
      lastWidth.current = settings.width;
      void resizeToContent(settings.width, settings.anchor, menuBar.current ?? 0);
      void logLine("ui", `window ${settings.width}x${height} css`);
    };
    fit();
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    const observed = new WeakSet<Element>();
    const attach = () => {
      const nodes = document.querySelectorAll(".stack > *, .bar");
      nodes.forEach((node) => {
        if (!observed.has(node)) {
          observer.observe(node);
          observed.add(node);
        }
      });
    };
    attach();
    const mutations = new MutationObserver(attach);
    const stack = document.querySelector(".stack");
    if (stack) mutations.observe(stack, { childList: true, subtree: true, attributes: true });
    // The details panel animates its max-height, so keep an eye on it.
    const pulse = window.setInterval(fit, 240);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(pulse);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [ready, settings.width, settings.widgets, settings.anchor]);

  /* ------------------------------------------------ window: place & remember */
  // Put the widget on its grid slot: chosen corner, `slot` rows down. Also the
  // recovery action when it ends up behind the system widgets.
  const placeNow = async (preferPrimary?: boolean) => {
    if (menuBar.current === null && inTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      menuBar.current = await invoke<number>("menu_bar_height").catch(() => 24);
    }
    const height = await resizeToContent(settings.width, settings.anchor, menuBar.current ?? 0);
    const position = await placeOnGrid({
      anchor: settings.anchor,
      slot: settings.slot,
      width: settings.width,
      height: height || measureHeight(),
      preferPrimary: preferPrimary ?? !settings.pos,
      topInset: menuBar.current ?? 0,
    });
    if (position) {
      update({ pos: position });
      void logLine("ui", `placed on grid: ${settings.anchor} slot ${settings.slot} -> ${position.x},${position.y}`);
    }
    return position;
  };

  useEffect(() => {
    if (!inTauri || !ready || placed.current) return;
    placed.current = true;
    void (async () => {
      if (settings.pos && (await onScreen(settings.pos))) await moveWindowTo(settings.pos);
      else await placeNow();
    })();
    let timer: number | null = null;
    void watchMoves((position) => {
      // Our own resizes and grid placements arrive here too; saving those as a
      // user drag is what made the widget creep across the screen.
      if (isProgrammaticMove()) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Mission Control moves the window around as well; junk positions would
        // put the widget off-screen on the next start.
        void onScreen(position).then(async (ok) => {
          if (!ok) return;
          if (!live.current.snap) {
            update({ pos: position });
            return;
          }
          const step = await gridStep();
          const round = (value: number) => Math.round(value / step) * step;
          const snapped = { x: round(position.x), y: round(position.y) };
          const stored = live.current.pos;
          // Already where it should be: no move, no write, no new event.
          if (stored && stored.x === snapped.x && stored.y === snapped.y) return;
          update({ pos: snapped });
          if (snapped.x !== position.x || snapped.y !== position.y) void moveWindowTo(snapped);
        });
      }, 700);
    });
  }, [ready, settings.pos, settings.width, settings.snap, settings.anchor, settings.slot, update]);

  // The tray menu can put the widget back where it belongs when it is buried
  // under the system widgets and cannot be grabbed.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("widget://place", () => {
        // From the tray menu this means: bring it back where I can see it.
        void placeNow(true);
      }).then((fn) => {
        unlisten = fn;
      }),
    );
    return () => unlisten?.();
  });

  // Moving to another slot or corner is an instruction, not a preference to be
  // applied on the next start.
  const lastSlot = useRef<string | null>(null);
  useEffect(() => {
    if (!inTauri || !ready || !placed.current) return;
    const key = `${settings.anchor}:${settings.slot}`;
    if (lastSlot.current === null) {
      lastSlot.current = key;
      return;
    }
    if (lastSlot.current === key) return;
    lastSlot.current = key;
    void placeNow();
  }, [ready, settings.anchor, settings.slot]);

  /* ------------------------------------------------- window: desktop widget */
  useEffect(() => {
    if (!ready) return;
    void applyPresentation(settings.presentation);
  }, [ready, settings.presentation]);

  // The bar stays invisible until the real settings are on screen, otherwise
  // it flashes in the default style for a moment.
  useEffect(() => {
    if (!inTauri || !ready) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("show_widget"));
  }, [ready]);

  const auditDone = useRef(false);

  // Deep check of the expanded cards, opt-in with FLASH_STATS_AUDIT=1: a label
  // reaching over its value, or a row taller than its box, is text printed on
  // text — which is what the temperatures details used to do.
  useEffect(() => {
    if (!ready || auditDone.current) return;
    auditDone.current = true;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!(await invoke<boolean>("audit_enabled"))) return;
      // An occluded webview pauses transitions, so a measured panel would look
      // collapsed for the wrong reason. Freeze the animations instead.
      const still = document.createElement("style");
      still.textContent = "*{transition:none !important;animation:none !important}";
      document.head.appendChild(still);
      for (const card of [...document.querySelectorAll<HTMLElement>(".card")]) {
        const head = card.querySelector(".head")?.textContent?.trim() ?? "";
        card.click();
        await new Promise((resolve) => setTimeout(resolve, 550));
        const bad: string[] = [];
        for (const label of card.querySelectorAll<HTMLElement>(".kv .k")) {
          const value = label.parentElement?.querySelector<HTMLElement>(".v");
          if (!value) continue;
          const a = label.getBoundingClientRect();
          const b = value.getBoundingClientRect();
          if (a.right > b.left + 1)
            bad.push(`«${label.textContent?.slice(0, 12)}» +${Math.round(a.right - b.left)}px`);
        }
        const cut = [...card.querySelectorAll<HTMLElement>(".kv .v, .meta span, .proc")]
          .filter((el) => el.scrollHeight > el.clientHeight + 2).length;
        // Horizontal truncation matters as much: an address shown as "92.240…"
        // is worse than useless, since people copy those.
        const short = [
          ...card.querySelectorAll<HTMLElement>(".kv .v, .stat .sv, .copy .ctext, .linkname"),
        ]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `«${el.textContent?.slice(0, 18)}»`);
        // A panel that never opened would make every check below pass for the
        // wrong reason, so the state and the clipping of the panel itself are
        // part of the report.
        const panel = card.querySelector<HTMLElement>(".details");
        const cap = panel ? getComputedStyle(panel).maxHeight : "?";
        const clipped =
          panel && panel.scrollHeight > panel.clientHeight + 2
            ? ` CLIPPED ${panel.scrollHeight}>${panel.clientHeight} cap=${cap}`
            : "";
        await logLine(
          "ui",
          `card «${head}»: ${card.classList.contains("open") ? "open" : "CLOSED"} ` +
            `${Math.round(card.getBoundingClientRect().height)}px${clipped}, ` +
            `detail rows ${card.querySelectorAll(".kv .k").length}, ` +
            `collisions ${bad.length ? `OVERLAP [${bad.slice(0, 2).join(" | ")}]` : "none"}, ` +
            `cut ${cut}, truncated ${short.length ? short.join(" ") : "none"}`,
        );
        card.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      // Everything open at once is the worst case: the window must stay within
      // the screen and let the card stack scroll instead of growing past it.
      const cards = [...document.querySelectorAll<HTMLElement>(".card")];
      cards.forEach((card) => card.click());
      await new Promise((resolve) => setTimeout(resolve, 900));
      const stack = document.querySelector<HTMLElement>(".stack");
      const wanted = [...document.querySelectorAll<HTMLElement>(".card")].reduce(
        (total, card) => total + card.getBoundingClientRect().height,
        0,
      );
      await logLine(
        "ui",
        `all cards open: content ${Math.round(wanted)}px, window ${window.innerHeight}px, ` +
          `screen ${window.screen.height}px ` +
          `${window.innerHeight <= window.screen.height ? "within" : "OVERFLOWS"}, ` +
          `stack ${stack?.scrollHeight}/${stack?.clientHeight} ` +
          `${(stack?.scrollHeight ?? 0) > (stack?.clientHeight ?? 0) + 2 ? "scrolls" : "fits"}`,
      );
      cards.forEach((card) => card.click());

      // The width control lives in the settings window now, so the audit is
      // the only place that can prove a width change reaches the window.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const before = await getCurrentWindow().outerSize();
      const scale = await getCurrentWindow().scaleFactor();
      const original = settings.width;
      const other = original === 480 ? 360 : 480;
      update({ width: other });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const after = await getCurrentWindow().outerSize();
      await logLine(
        "ui",
        `width ${original} -> ${other}: window ${Math.round(before.width / scale)} -> ` +
          `${Math.round(after.width / scale)} ` +
          `${Math.abs(after.width / scale - other) < 2 ? "applied" : "IGNORED"}`,
      );
      update({ width: original });
      await new Promise((resolve) => setTimeout(resolve, 700));

      // The menu-bar panel lives in its own window; open it so it can audit
      // itself the same way.
      await invoke("toggle_net_panel").catch(() => undefined);
    })();
  }, [ready]);

  const reposition = async () => {
    await placeNow();
  };

  /* ---------------------------------------------------- tray meter & sync */
  useEffect(() => {
    if (!inTauri) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_tray_net", { enabled: settings.trayNet }).catch((error) =>
        void logLine("error", `tray toggle failed: ${error}`),
      );
    })();
  }, [settings.trayNet]);

  // The menu bar follows the system appearance, not the widget's own theme,
  // so a coloured meter has to ask the system which ink stays readable.
  const [barDark, setBarDark] = useState(
    typeof window === "undefined" || !window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setBarDark(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // The public-address lookup is the only thing this app sends anywhere, so
  // the switch reaches the sampler immediately instead of only hiding the row.
  useEffect(() => {
    if (!inTauri || !ready) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_public_ip", { enabled: settings.publicIp }).catch((error) =>
        void logLine("error", `public ip toggle failed: ${error}`),
      ),
    );
  }, [ready, settings.publicIp]);

  // Sampling per-process rates costs a subprocess, so it only runs while the
  // network card is visible and the row is switched on.
  useEffect(() => {
    if (!inTauri || !ready) return;
    const wanted = settings.netTop && settings.widgets.network;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_net_top", { enabled: wanted }).catch((error) =>
        void logLine("error", `net top toggle failed: ${error}`),
      ),
    );
  }, [ready, settings.netTop, settings.widgets.network]);

  useEffect(() => {
    if (!snap || !settings.trayNet) return;
    void pushTrayMeter(snap.net.downBps, snap.net.upBps, {
      colored: settings.trayColored,
      dark: barDark,
    });
  }, [snap, settings.trayNet, settings.trayColored, barDark]);

  useEffect(() => {
    if (!inTauri) return;
    let disposed = false;
    const stoppers: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const pushes: Array<Promise<() => void>> = [
        listen<number>("tray://interval", (event) => update({ intervalMs: event.payload })),
        listen<boolean>("tray://net", (event) => update({ trayNet: event.payload })),
        listen("widget://reposition", () => void reposition()),
      ];
      const fns = (await Promise.all(pushes)).filter(Boolean);
      if (disposed) fns.forEach((fn) => fn());
      else stoppers.push(...fns);
    })().catch(console.error);
    return () => {
      disposed = true;
      stoppers.forEach((fn) => fn());
    };
  }, [update]);

  /* ------------------------------------------------------ global shortcut */
  useEffect(() => {
    if (!inTauri || !settings.shortcut) return;
    void (async () => {
      await acquireShortcut(settings.shortcut, async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (await getCurrentWindow().isVisible()) await invoke("hide_widget");
        else await invoke("show_widget");
      });
    })().catch((error) => void logLine("error", `shortcut: ${error}`));
    return () => {
      void releaseShortcut();
    };
  }, [settings.shortcut]);

  /* ------------------------------------------------------------ shortcuts */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        void hideWidget();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chip = meta
    ? `${meta.chip} · ${meta.perfCores}P+${meta.effCores}E · ${bytes(meta.totalMemory, 0)}`
    : "Flash Stats";
  const spark = settings.showSpark;

  // One-line report of what the bar shows, readable from the terminal.
  useEffect(() => {
    if (!ready) return;
    const shown = [...document.querySelectorAll(".card .label")].map((el) =>
      el.textContent?.trim() ?? "",
    );
    const label = document.querySelector(".chipname")?.textContent?.trim() ?? "";
    const el = document.querySelector(".chipname") as HTMLElement | null;
    const need = el?.scrollWidth ?? 0;
    const have = el?.clientWidth ?? 0;
    void logLine(
      "ui",
      `widget rendered: ${shown.length} cards [${shown.join(", ")}], ` +
        `title «${label}» ${need}/${have}px${need > have + 1 ? " CLIPPED" : ""}`,
    );
  }, [ready, snap]);

  return (
    <LangContext.Provider value={lang}>
    <UnitContext.Provider value={settings.tempUnit}>
    {/* The title strip alone was a 16 px target and easy to miss, so the
        shell's padding and the gaps between the cards drag the widget too.
        Cards are children without the attribute, so their clicks still open
        the details. */}
    <div className="shell" data-tauri-drag-region>
      <header className="bar" data-tauri-drag-region>
        <span className="wordmark" data-tauri-drag-region>
          Flash Stats
        </span>
        <span className="chipname" data-tauri-drag-region title={chip}>
          {chip}
        </span>
        <span className="spacer" data-tauri-drag-region />
        <button
          className="iconbtn fade"
          title={t("settings")}
          onClick={() => void openSettings()}
          aria-label="Nastavenia"
        >
          <GearIcon />
        </button>
        <button
          className="iconbtn fade"
          title={t("hideWidget")}
          onClick={() => void hideWidget()}
          aria-label={t("hideWidget")}
        >
          <EyeIcon />
        </button>
      </header>

      <div className="stack" data-tauri-drag-region>
        {snap && ready ? (
          <>
            {settings.order
              .filter((id) => settings.widgets[id])
              .map((id) => (
              <Fragment key={id}>
                {id === "cpu" ? (
                  <CpuWidget
                    snap={snap}
                    hist={hist}
                    meta={meta}
                    spark={spark}
                    showCores={settings.showCores}
                    showTop={settings.showTop}
                  />
                ) : null}
                {id === "memory" ? (
                  <MemoryWidget
                    snap={snap}
                    hist={hist}
                    spark={spark}
                    showTop={settings.showTop}
                  />
                ) : null}
                {id === "gpu" ? (
                  <GpuWidget snap={snap} hist={hist} meta={meta} spark={spark} />
                ) : null}
                {id === "temps" ? <TempsWidget snap={snap} hist={hist} spark={spark} /> : null}
                {id === "network" ? (
                  <NetworkWidget
                    snap={snap}
                    hist={hist}
                    spark={spark}
                    showTop={settings.netTop}
                  />
                ) : null}
                {id === "battery" ? <BatteryWidget snap={snap} hist={hist} spark={spark} /> : null}
                {id === "disk" ? <DiskWidget snap={snap} hist={hist} spark={spark} /> : null}
              </Fragment>
            ))}
          </>
        ) : (
          <div className="card" style={{ height: 92 }} />
        )}
      </div>
    </div>
    </UnitContext.Provider>
    </LangContext.Provider>
  );
}

/* All visibility changes go through Rust: the sampler keeps the widget on the
   desktop and must know whether the user hid it on purpose. */
async function hideWidget() {
  if (!inTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("hide_widget");
}

function openSettings() {
  if (!inTauri) return;
  void import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("open_settings").catch((error) => void logLine("error", `open_settings: ${error}`)),
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.6 8s2.5-4.2 6.4-4.2S14.4 8 14.4 8s-2.5 4.2-6.4 4.2S1.6 8 1.6 8Z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

