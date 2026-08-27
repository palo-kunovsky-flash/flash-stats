import { useCallback, useEffect, useRef, useState } from "react";

export type WidgetId = "cpu" | "gpu" | "memory" | "battery" | "network" | "disk";
export type Presentation = "desktop" | "floating" | "normal";

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
  /** Remembered window position (physical px). */
  pos: { x: number; y: number } | null;
  /** Global hotkey that hides / shows the widget. */
  shortcut: string;
};

export const DEFAULTS: Settings = {
  intervalMs: 1000,
  theme: "auto",
  opacity: 0.62,
  blur: 34,
  presentation: "desktop",
  width: 320,
  showCores: true,
  showSpark: true,
  showTop: true,
  trayNet: true,
  trayColored: true,
  widgets: { cpu: true, gpu: true, memory: true, battery: true, network: true, disk: false },
  pos: null,
  shortcut: "Alt+Command+S",
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
            widgets: { ...DEFAULTS.widgets, ...(stored.widgets ?? {}) },
          }));
        }
      } catch (error) {
        console.error("could not load settings", error);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
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

  return { settings, update, ready };
}
