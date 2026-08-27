import { Fragment, useEffect, useRef } from "react";
import {
  BatteryWidget,
  CpuWidget,
  DiskWidget,
  GpuWidget,
  MemoryWidget,
  NetworkWidget,
  TempsWidget,
} from "./components/widgets";
import { DEFAULTS, WIDTHS, useSettings } from "./lib/settings";
import { pushTrayMeter } from "./lib/trayMeter";
import { inTauri, logLine, useTelemetry } from "./lib/telemetry";
import {
  applyPresentation,
  measureHeight,
  moveWindowTo,
  onScreen,
  placeOnGrid,
  snapToGrid,
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

  useEffect(() => {
    void logLine("ui", "App mounted");
  }, []);

  /* -------------------------------------------------- window: fit content */
  useEffect(() => {
    if (!inTauri || !ready) return;
    let frame = 0;
    const fit = () => {
      const height = measureHeight();
      if (height <= 0) return;
      if (Math.abs(height - lastHeight.current) < 1) return;
      lastHeight.current = height;
      void resizeToContent(settings.width);
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
  }, [ready, settings.width, settings.widgets]);

  /* ------------------------------------------------ window: place & remember */
  // Put the widget on its grid slot: chosen corner, `slot` rows down. Also the
  // recovery action when it ends up behind the system widgets.
  const placeNow = async (preferPrimary?: boolean) => {
    const height = await resizeToContent(settings.width);
    const position = await placeOnGrid({
      anchor: settings.anchor,
      slot: settings.slot,
      width: settings.width,
      height: height || measureHeight(),
      preferPrimary: preferPrimary ?? !settings.pos,
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
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Mission Control moves the window around as well; junk positions would
        // put the widget off-screen on the next start.
        void onScreen(position).then((ok) => {
          if (!ok) return;
          if (!settings.snap) {
            update({ pos: position });
            return;
          }
          const snapped = { x: snapToGrid(position.x), y: snapToGrid(position.y) };
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
    const key = `${settings.anchor}:${settings.slot}:${settings.width}`;
    if (lastSlot.current === null) {
      lastSlot.current = key;
      return;
    }
    if (lastSlot.current === key) return;
    lastSlot.current = key;
    void placeNow();
  }, [ready, settings.anchor, settings.slot, settings.width]);

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
        await logLine(
          "ui",
          `card «${head}»: open ${Math.round(card.getBoundingClientRect().height)}px, ` +
            `detail rows ${card.querySelectorAll(".kv .k").length}, ` +
            `collisions ${bad.length ? `OVERLAP [${bad.slice(0, 2).join(" | ")}]` : "none"}, cut ${cut}`,
        );
        card.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
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

  useEffect(() => {
    if (!snap || !settings.trayNet) return;
    void pushTrayMeter(snap.net.downBps, snap.net.upBps, { colored: settings.trayColored });
  }, [snap, settings.trayNet, settings.trayColored]);

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
    <div className="shell">
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
          title={t("widgetSize")}
          onClick={() => {
            const index = WIDTHS.indexOf(settings.width);
            const next = WIDTHS[(index + 1) % WIDTHS.length] ?? DEFAULTS.width;
            update({ width: next });
          }}
          aria-label={t("widgetSize")}
        >
          <ResizeIcon />
        </button>
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

      <div className="stack">
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
                {id === "memory" ? <MemoryWidget snap={snap} hist={hist} spark={spark} /> : null}
                {id === "gpu" ? (
                  <GpuWidget snap={snap} hist={hist} meta={meta} spark={spark} />
                ) : null}
                {id === "temps" ? <TempsWidget snap={snap} hist={hist} spark={spark} /> : null}
                {id === "network" ? <NetworkWidget snap={snap} hist={hist} spark={spark} /> : null}
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

function ResizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2.6 6V2.6H6M13.4 10v3.4H10" />
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.2" strokeOpacity="0.4" />
    </svg>
  );
}
