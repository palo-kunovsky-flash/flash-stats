import { useRef, useEffect, useState } from "react";
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

  const auditDone = useRef(false);

  /// One line about what is really on screen, so a headless run can tell a
  /// rendered panel from a blank one.
  const report = async (audited: boolean) => {
    const rows = document.querySelectorAll(".crow").length;
    const panes = document.querySelectorAll(".side-item").length;
    const icon = document.querySelector<HTMLImageElement>(".brand img");
    // A camelCase word in a label means a translation key reached the screen.
    const brands = ["macOS", "iPadOS", "iOS", "watchOS", "CPU", "GPU", "RAM"];
    const leaked = [...document.querySelectorAll(".side-item span, .crow-label > span")]
      .map((el) => el.textContent?.trim() ?? "")
      .filter((text) => /^[a-zA-Z]+[A-Z][a-zA-Z]*$/.test(text) && !brands.includes(text));
    const side = getComputedStyle(document.querySelector(".side")!);
    const active = document.querySelector(".side-item.on");
    await logLine(
      "ui",
      `settings rendered${audited ? " (audited)" : ""}: ${panes} panes, ${rows} rows, ` +
        `icon ${icon?.naturalWidth ?? 0}px, lang ${lang}, ` +
        `sidebar ${side.flexDirection} ${side.width}, active «${active?.textContent?.trim() ?? "-"}»` +
        `${leaked.length ? `, LEAKED KEYS ${leaked.join(",")}` : ""}`,
    );
  };

  // Geometry audit: walks every pane and measures what is drawn. Past-edge means
  // text is cut by the window, cut means shorter than its own content, overlaps
  // mean two things printed on each other. It clicks through the panels, so it
  // only runs when asked for with FLASH_STATS_AUDIT=1 and never twice.
  useEffect(() => {
    if (!ready || auditDone.current) return;
    auditDone.current = true;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!(await invoke<boolean>("audit_enabled"))) {
        await report(false);
        return;
      }
      const items = [...document.querySelectorAll<HTMLElement>(".side-item")];
      const restore = (document.querySelector(".side-item.on") as HTMLElement | null)?.dataset.index;
      items.forEach((el, i) => {
        el.dataset.index = String(i);
      });
      for (const item of items) {
        item.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        const root = document.querySelector<HTMLElement>(".pane") ?? document.body;
        const short = (el: Element) => (el.textContent ?? "").trim().slice(0, 14);
        const pick = (sel: string, bad: (el: HTMLElement) => boolean) =>
          [...root.querySelectorAll<HTMLElement>(sel)].filter(bad).map((el) => `${el.className}:${short(el)}`);
        const clipped = pick(".crow, .kv, p", (el) => el.scrollWidth > el.clientWidth + 2);
        const cut = pick(".crow-label, .kv, p", (el) => el.scrollHeight > el.clientHeight + 2);
        const past = pick(".crow, .kv", (el) => el.getBoundingClientRect().right > window.innerWidth + 1);
        const overlaps: string[] = [];
        for (const row of root.querySelectorAll<HTMLElement>(".crow")) {
          const kids = [...row.children] as HTMLElement[];
          for (let i = 0; i < kids.length; i++)
            for (let j = i + 1; j < kids.length; j++) {
              const a = kids[i].getBoundingClientRect();
              const b = kids[j].getBoundingClientRect();
              if (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
              )
                overlaps.push(`${kids[i].className}~${kids[j].className}`);
            }
        }
        const bad = [
          clipped.length && `clipped ${clipped.length} [${clipped.slice(0, 2).join(" | ")}]`,
          cut.length && `cut ${cut.length} [${cut.slice(0, 2).join(" | ")}]`,
          past.length && `past-edge ${past.length} [${past.slice(0, 2).join(" | ")}]`,
          overlaps.length && `overlaps ${overlaps.length} [${overlaps.slice(0, 2).join(" | ")}]`,
        ].filter(Boolean);
        await logLine(
          "ui",
          `pane «${item.textContent?.trim()}»: ${bad.length ? bad.join(", ") : "clean"}`,
        );
      }
      if (restore !== undefined) {
        document.querySelector<HTMLElement>(`.side-item[data-index="${restore}"]`)?.click();
      }
      await report(true);
    })();
  }, [ready, lang]);

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
