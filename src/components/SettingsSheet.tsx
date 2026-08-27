import type { ReactNode } from "react";
import type { Meta } from "../types";
import type { Presentation, Settings, WidgetId } from "../lib/settings";
import { inTauri } from "../lib/telemetry";

type Update = (patch: Partial<Settings>) => void;

const WIDGETS: { id: WidgetId; name: string }[] = [
  { id: "cpu", name: "Procesor" },
  { id: "memory", name: "Pamäť" },
  { id: "gpu", name: "Grafika" },
  { id: "network", name: "Sieť" },
  { id: "battery", name: "Batéria" },
  { id: "disk", name: "Disk" },
];

const INTERVALS = [500, 1000, 2000, 5000];
const WIDTHS = [280, 320, 380, 440];

export function SettingsSheet({
  settings,
  update,
  meta,
  shortcut,
  onClose,
}: {
  settings: Settings;
  update: Update;
  meta: Meta | null;
  shortcut: string;
  onClose: () => void;
}) {
  return (
    <div className="sheet">
      <div className="row">
        <h3>Nastavenia</h3>
        <span style={{ flex: 1 }} />
        <button className="iconbtn" onClick={onClose} aria-label="Zavrieť">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <Section title="Správanie">
        <Row name="Kde widget je">
          <Segmented
            value={settings.presentation}
            options={[
              { value: "desktop", label: "Na ploche" },
              { value: "floating", label: "Navrchu" },
              { value: "normal", label: "Okno" },
            ]}
            onChange={(value) => update({ presentation: value as Presentation })}
          />
        </Row>
        <Row name="Šírka">
          <Segmented
            value={String(settings.width)}
            options={WIDTHS.map((width) => ({ value: String(width), label: String(width) }))}
            onChange={(value) => update({ width: Number(value) })}
          />
        </Row>
        <Row name="Frekvencia">
          <Segmented
            value={String(settings.intervalMs)}
            options={INTERVALS.map((ms) => ({
              value: String(ms),
              label: ms < 1000 ? `${ms / 1000}s` : `${ms / 1000}s`,
            }))}
            onChange={(value) => update({ intervalMs: Number(value) })}
          />
        </Row>
      </Section>

      <Section title="Widgety">
        {WIDGETS.map((widget) => (
          <Row key={widget.id} name={widget.name}>
            <Switch
              on={settings.widgets[widget.id]}
              onChange={(on) => update({ widgets: { ...settings.widgets, [widget.id]: on } })}
            />
          </Row>
        ))}
      </Section>

      <Section title="Detaily">
        <Row name="Grafy">
          <Switch on={settings.showSpark} onChange={(on) => update({ showSpark: on })} />
        </Row>
        <Row name="Jadrá v CPU">
          <Switch on={settings.showCores} onChange={(on) => update({ showCores: on })} />
        </Row>
        <Row name="Najžravejšie procesy">
          <Switch on={settings.showTop} onChange={(on) => update({ showTop: on })} />
        </Row>
      </Section>

      <Section title="Menu bar">
        <Row name="Meter siete">
          <Switch on={settings.trayNet} onChange={(on) => update({ trayNet: on })} />
        </Row>
        <Row name="Farebný">
          <Switch on={settings.trayColored} onChange={(on) => update({ trayColored: on })} />
        </Row>
      </Section>

      <Section title="Vzhľad">
        <Row name="Téma">
          <Segmented
            value={settings.theme}
            options={[
              { value: "auto", label: "Auto" },
              { value: "dark", label: "Tmavá" },
              { value: "light", label: "Svetlá" },
            ]}
            onChange={(value) => update({ theme: value as Settings["theme"] })}
          />
        </Row>
        <Row name="Priehľadnosť">
          <Slider
            min={25}
            max={100}
            value={Math.round(settings.opacity * 100)}
            onChange={(value) => update({ opacity: value / 100 })}
          />
        </Row>
        <Row name="Rozostrenie">
          <Slider min={0} max={60} value={settings.blur} onChange={(value) => update({ blur: value })} />
        </Row>
      </Section>

      <div className="foot">
        <span>
          v{meta?.appVersion ?? "dev"} · {meta?.macosVersion ? `macOS ${meta.macosVersion}` : "browser"}
          {!inTauri ? " (mock)" : ""}
        </span>
        <span className="grow" />
        <span title={shortcut}>{prettyKeys(shortcut)}</span>
        {inTauri ? (
          <button
            className="danger"
            onClick={() =>
              void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("quit_app").catch(console.error),
              )
            }
          >
            Ukončiť
          </button>
        ) : null}
      </div>
    </div>
  );
}

function prettyKeys(shortcut: string): string {
  const map: Record<string, string> = {
    alt: "⌥",
    option: "⌥",
    command: "⌘",
    cmd: "⌘",
    super: "⌘",
    control: "⌃",
    ctrl: "⌃",
    shift: "⇧",
  };
  return shortcut
    .split("+")
    .map((part) => map[part.trim().toLowerCase()] ?? part.trim().toUpperCase())
    .join("");
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="name">{name}</span>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className={`switch ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}
