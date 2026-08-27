import { useCallback, useEffect, useRef, useState } from "react";
import { publishSettings, setRemoteTarget } from "./bus";
import { resolveLanguage, type LanguagePref } from "./i18n";
import type { TempUnit } from "./units";

export type { LanguagePref };
export type { TempUnit } from "./units";

/** Widths the widget can be; the stored value is always snapped to one. */
export const WIDTHS = [360, 400, 440, 480];

export function snapWidth(value: number): number {
  return WIDTHS.reduce((best, width) =>
    Math.abs(width - value) < Math.abs(best - value) ? width : best,
  );
}

export type WidgetId = "cpu" | "gpu" | "memory" | "battery" | "network" | "disk" | "temps";

/** Default card order, top to bottom; people can rearrange them. */
export const CARD_IDS: WidgetId[] = ["cpu", "memory", "gpu", "temps", "network", "battery", "disk"];

/**
 * Saved card order, cleaned up: unknown ids dropped, cards added by an update
 * appended at the end, so an upgrade never silently loses a card.
 */
export function normalizeOrder(order?: WidgetId[]): WidgetId[] {
  const known = (order ?? []).filter((id) => CARD_IDS.includes(id));
  return [...known, ...CARD_IDS.filter((id) => !known.includes(id))];
}
export type Presentation = "desktop" | "wallpaper" | "floating" | "normal";

export type Settings = {
  intervalMs: number;
  theme: "auto" | "dark" | "light";
  opacity: number;
  blur: number;
  /** How the window sits on the desktop. */
  presentation: Presentation;
  /** Logical width in px; the height always fits the content. */
  width: number;
  showCores: boolean;
  showSpark: boolean;
  showTop: boolean;
  trayNet: boolean;
  trayColored: boolean;
  widgets: Record<WidgetId, boolean>;
  /** Temperature unit shown everywhere; sensors are stored in °C. */
  tempUnit: TempUnit;
  /** Card order, top to bottom. */
  order: WidgetId[];
  /** Remembered window position (physical px). */
  pos: { x: number; y: number } | null;
  /** Global hotkey that hides / shows the widget. */
  shortcut: string;
  /** Interface language; auto follows the system. */
  language: LanguagePref;
  /** Bumped when stored defaults change, see SCHEMA below. */
  schema: number;
};

/** Stored settings carry a schema version so upgrades can move defaults. */
export const SCHEMA = 3;

/**
 * The desktop icon layer is the only level that behaves like a macOS widget:
 * "show desktop" keeps it on screen and Mission Control moves it with the
 * desktop. A stored "wallpaper" value is therefore always corrected — that
 * level hides the widget on ⌘F3, which is never what people want here.
 */
function migratePresentation(stored: Partial<Settings>): Presentation {
  const value = stored.presentation ?? DEFAULTS.presentation;
  return value === "wallpaper" ? "desktop" : value;
}

export const DEFAULTS: Settings = {
  intervalMs: 1000,
  theme: "auto",
  opacity: 0.62,
  blur: 34,
  presentation: "wallpaper",
  width: 400,
  showCores: true,
  showSpark: true,
  showTop: true,
  trayNet: true,
  trayColored: true,
  order: CARD_IDS,
  tempUnit: "c",
  widgets: { cpu: true, gpu: true, memory: true, battery: true, network: true, disk: false, temps: true },
  pos: null,
  shortcut: "Alt+Command+S",
  language: "en",
  schema: 3,
};

const FILE = "settings.json";
const KEY = "settings";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StoreHandle = {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  save: () => Promise<void>;
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(!inTauri);
  const store = useRef<StoreHandle | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    void (async () => {
      try {
        const { load } = await import("@tauri-apps/plugin-store");
        const handle = (await load(FILE, { autoSave: false })) as unknown as StoreHandle;
        store.current = handle;
        const stored = await handle.get<Partial<Settings>>(KEY);
        if (stored) {
          setSettings((prev) => ({
            ...prev,
            ...stored,
            presentation: migratePresentation(stored),
            // v2 also standardised on English and a wider bar.
            language: (stored.schema ?? 1) < 2 ? "en" : (stored.language ?? DEFAULTS.language),
            width: (stored.schema ?? 1) < 2 ? 400 : snapWidth(stored.width ?? DEFAULTS.width),
            schema: SCHEMA,
            widgets: { ...DEFAULTS.widgets, ...(stored.widgets ?? {}) },
            order: normalizeOrder(stored.order),
          }));
        }
      } catch (error) {
        console.error("could not load settings", error);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Another window (widget or settings) may change the same file.
  useEffect(() => {
    setRemoteTarget(setSettings);
    let unlisten: (() => void) | null = null;
    void import("./bus").then(({ listenSettings }) =>
      listenSettings().then((fn) => {
        unlisten = fn;
      }),
    );
    return () => {
      setRemoteTarget(null);
      unlisten?.();
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      publishSettings(next);
      if (!inTauri) return next;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        const handle = store.current;
        if (!handle) return;
        void handle
          .set(KEY, next)
          .then(() => handle.save())
          .catch((error) => console.error("could not save settings", error));
      }, 400);
      return next;
    });
  }, []);

  // Theme + translucency.
  useEffect(() => {
    const root = document.documentElement;
    const resolved =
      settings.theme === "auto"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : settings.theme;
    root.dataset.theme = resolved;
    root.style.setProperty("--bg-blur", `${settings.blur}px`);
    root.style.setProperty(
      "--surface",
      resolved === "light"
        ? `rgba(246,247,250,${0.32 + settings.opacity * 0.42})`
        : `rgba(18,20,26,${0.16 + settings.opacity * 0.58})`,
    );
  }, [settings.theme, settings.opacity, settings.blur]);

  const lang = resolveLanguage(
    settings.language,
    typeof navigator === "undefined" ? "en" : navigator.language,
  );

  // The tray menu is drawn by AppKit, so it needs to be told as well.
  useEffect(() => {
    if (!inTauri) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_language", { code: lang }))
      .catch(() => undefined);
  }, [lang]);

  return { settings, update, ready, lang };
}
