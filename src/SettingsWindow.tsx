import { useEffect, useState } from "react";
import { SettingsView } from "./components/SettingsView";
import { useSettings, inTauri } from "./lib/settings";
import type { Snapshot, Meta } from "./types";
import { LangContext } from "./lib/i18n";
import { logLine } from "./lib/telemetry";

/**
 * Preferences live in their own window so the panel can breathe; the widget
 * itself stays a slim bar on the desktop.
 */
export default function SettingsWindow() {
  const { settings, update, ready, lang } = useSettings();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      invoke<Meta>("read_meta")
        .then(setMeta)
        .catch(() => undefined);
      invoke<Snapshot>("read_snapshot")
        .then(setSnapshot)
        .catch(() => undefined);
      const stop = await listen<Snapshot>("telemetry", (event) => setSnapshot(event.payload));
      if (disposed) stop();
      else unlisten = stop;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const reposition = () => {
    if (!inTauri) return;
    void import("@tauri-apps/api/event").then(({ emit }) => emit("widget://reposition", null));
  };

  // Reported once so a headless run can tell a rendered panel from a blank one.
  useEffect(() => {
    if (!ready) return;
    const rows = document.querySelectorAll(".crow").length;
    const panes = document.querySelectorAll(".side-item").length;
    const icon = document.querySelector<HTMLImageElement>(".brand img");
    void logLine(
      "ui",
      `settings rendered: ${panes} panes, ${rows} rows, icon ${icon?.naturalWidth ?? 0}px, lang ${lang}`,
    );
  }, [ready, lang, snapshot]);

  if (!ready) return <div className="settings loading" />;

  return (
    <LangContext.Provider value={lang}>
      <div className="settings-shell">
        <SettingsView
          settings={settings}
          update={update}
          meta={meta}
          snapshot={snapshot}
          shortcut={settings.shortcut}
          onReposition={reposition}
        />
      </div>
    </LangContext.Provider>
  );
}
