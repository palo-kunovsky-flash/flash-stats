import { useEffect, useMemo, useState } from "react";
import type { Meta, Snapshot } from "../types";
import { Anchor, TempUnit, WIDTHS, inTauri, normalizeOrder, type LanguagePref, type Presentation, type Settings, type WidgetId } from "../lib/settings";
import { bytes, pct } from "../lib/format";
import { useT } from "../lib/i18n";
import { useTemp } from "../lib/units";
import { Group, Row, Segmented, Slider, Switch, prettyKeys } from "./controls";
import iconUrl from "../assets/app-icon.png";

type Update = (patch: Partial<Settings>) => void;

const CARDS: { id: WidgetId; key: string; hintKey: string }[] = [
  { id: "cpu", key: "cpu", hintKey: "cpuHint" },
  { id: "memory", key: "memory", hintKey: "memoryHint" },
  { id: "gpu", key: "gpu", hintKey: "gpuHint" },
  { id: "network", key: "network", hintKey: "networkHint" },
  { id: "battery", key: "battery", hintKey: "batteryHint" },
  { id: "disk", key: "disk", hintKey: "diskHint" },
  { id: "temps", key: "temps", hintKey: "tempsHint" },
];

const INTERVALS = ["500", "1000", "2000", "5000"];

type PaneId = "widget" | "look" | "tray" | "sampling" | "about";

/* Dots in the same accent colours as the widget cards, so the sidebar reads as
   part of the same app. */
const PANES: { id: PaneId; key: string; icon: string; accent: string }[] = [
  { id: "widget", key: "paneWidget", accent: "var(--cpu)", icon: "M2.5 3h11v3.5h-11zM2.5 8.5h11V12h-11z" },
  { id: "look", key: "paneLook", accent: "var(--gpu)", icon: "M8 2.2a5.8 5.8 0 100 11.6A5.8 5.8 0 008 2.2zM2.2 8h11.6" },
  { id: "tray", key: "paneTray", accent: "var(--down)", icon: "M2 3.5h12v3H2zM4 9.5h2.5M9.5 9.5H12" },
  { id: "sampling", key: "paneSampling", accent: "var(--ram)", icon: "M2 8h2.6l1.8-4.2L9 12l1.7-4H14" },
  { id: "about", key: "paneAbout", accent: "var(--up)", icon: "M8 7.2V12M8 4.4v.6M8 2.2a5.8 5.8 0 100 11.6A5.8 5.8 0 008 2.2z" },
];

export function SettingsView({
  settings,
  update,
  meta,
  snapshot,
  shortcut,
  onReposition,
}: {
  settings: Settings;
  update: Update;
  meta: Meta | null;
  snapshot: Snapshot | null;
  shortcut: string;
  onReposition: () => void;
}) {
  const t = useT();
  const tu = useTemp();
  const [pane, setPane] = useState<PaneId>("widget");

  const order = useMemo(() => normalizeOrder(settings.order), [settings.order]);
  const ordered = useMemo(
    () => order.map((id) => CARDS.find((card) => card.id === id)).filter((card) => !!card),
    [order],
  );

  const move = (index: number, delta: number) => {
    const next = [...order];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    update({ order: next });
  };

  const sensors = useMemo(
    () => [...(snapshot?.sensors ?? [])].sort((a, b) => b.tempC - a.tempC),
    [snapshot],
  );

  return (
    <div className="settings">
      <nav className="side" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img src={iconUrl} alt="" width="38" height="38" />
          <div data-tauri-drag-region>
            <b data-tauri-drag-region>Flash Stats</b>
            <small data-tauri-drag-region>v{meta?.appVersion ?? "dev"}</small>
          </div>
        </div>
        <div className="side-nav">
          {PANES.map((item) => (
            <button
              key={item.id}
              className={`side-item ${pane === item.id ? "on" : ""}`}
              style={{ ["--acc" as string]: item.accent } as React.CSSProperties}
              onClick={() => setPane(item.id)}
            >
              <i className="dot" />
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
                <path d={item.icon} />
              </svg>
              <span>{t(item.key)}</span>
            </button>
          ))}
        </div>
        <span className="side-foot" data-tauri-drag-region>
          {t("sideFoot")}
        </span>
      </nav>

      <main className="pane" data-tauri-drag-region>
        {pane === "widget" ? (
          <>
            <h2>{t("paneWidget")}</h2>
            <p className="lead">{t("widgetLead")}</p>

            <Group title={t("placement")}>
              <Row name={t("mode")} hint={t("modeHint")}>
                <Segmented
                  value={settings.presentation}
                  options={[
                    { value: "desktop", label: t("desktopMode") },
                    { value: "floating", label: t("floatingMode") },
                    { value: "normal", label: t("windowMode") },
                  ]}
                  onChange={(value) => update({ presentation: value as Presentation })}
                />
              </Row>
              <Row name={t("width")}>
                <Segmented
                  value={String(settings.width)}
                  options={WIDTHS.map((width) => ({ value: String(width), label: String(width) }))}
                  onChange={(value) => update({ width: Number(value) })}
                />
              </Row>
              <Row name={t("side")} hint={t("gridLead")}>
                <Segmented
                  value={settings.anchor.endsWith("right") ? "right" : "left"}
                  options={[
                    { value: "right", label: t("sideRight") },
                    { value: "left", label: t("sideLeft") },
                  ]}
                  onChange={(value) =>
                    update({ anchor: `${settings.anchor.split("-")[0]}-${value}` as Anchor })
                  }
                />
              </Row>
              <Row name={t("edge")}>
                <Segmented
                  value={settings.anchor.startsWith("top") ? "top" : "bottom"}
                  options={[
                    { value: "top", label: t("edgeTop") },
                    { value: "bottom", label: t("edgeBottom") },
                  ]}
                  onChange={(value) =>
                    update({ anchor: `${value}-${settings.anchor.split("-")[1]}` as Anchor })
                  }
                />
              </Row>
              <Row name={t("slot")} hint={t("slotHint")}>
                <span className="crow-control">
                  <span className="order-btns">
                    <button
                      className="obtn"
                      title={t("moveUp")}
                      disabled={settings.slot <= 0}
                      onClick={() => update({ slot: Math.max(0, settings.slot - 1) })}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 7.5 6 4l3.5 3.5" />
                      </svg>
                    </button>
                    <button
                      className="obtn"
                      title={t("moveDown")}
                      disabled={settings.slot >= 7}
                      onClick={() => update({ slot: Math.min(7, settings.slot + 1) })}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </button>
                  </span>
                  <b>{settings.slot + 1}</b>
                </span>
              </Row>
              <Row name={t("snap")} hint={t("snapHint")}>
                <Switch on={settings.snap} onChange={(on) => update({ snap: on })} />
              </Row>
              <Row name={t("position")} hint={t("positionHint")}>
                <button className="btn" onClick={onReposition}>
                  {t("placeNow")}
                </button>
              </Row>
            </Group>

            <Group title={t("cards")}>
              <p className="group-hint">{t("orderHint")}</p>
              {ordered.map((card, index) => (
                <div className="crow order-row" key={card.id}>
                  <span className="grip" aria-hidden="true" />
                  <div className="crow-label">
                    <span>{t(card.key)}</span>
                    <small>{t(card.hintKey)}</small>
                  </div>
                  <div className="crow-control">
                  <span className="order-btns">
                    <button
                      className="obtn"
                      title={t("moveUp")}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 7.5 6 4l3.5 3.5" />
                      </svg>
                    </button>
                    <button
                      className="obtn"
                      title={t("moveDown")}
                      disabled={index === ordered.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </button>
                  </span>
                  <Switch
                    on={settings.widgets[card.id]}
                    onChange={(on) => update({ widgets: { ...settings.widgets, [card.id]: on } })}
                  />
                  </div>
                </div>
              ))}
            </Group>

            <Group title={t("hoverExtras")}>
              <Row name={t("miniCharts")}>
                <Switch on={settings.showSpark} onChange={(on) => update({ showSpark: on })} />
              </Row>
              <Row name={t("cores")}>
                <Switch on={settings.showCores} onChange={(on) => update({ showCores: on })} />
              </Row>
              <Row name={t("hottest")}>
                <Switch on={settings.showTop} onChange={(on) => update({ showTop: on })} />
              </Row>
            </Group>
          </>
        ) : null}

        {pane === "look" ? (
          <>
            <h2>{t("paneLook")}</h2>
            <p className="lead">{t("lookLead")}</p>
            <Group>
              <Row name={t("language")}>
                <Segmented
                  value={settings.language}
                  options={[
                    { value: "auto", label: t("auto") },
                    { value: "en", label: "EN" },
                    { value: "sk", label: "SK" },
                  ]}
                  onChange={(value) => update({ language: value as LanguagePref })}
                />
              </Row>
              <Row name={t("theme")}>
                <Segmented
                  value={settings.theme}
                  options={[
                    { value: "auto", label: t("auto") },
                    { value: "dark", label: t("themeDark") },
                    { value: "light", label: t("themeLight") },
                  ]}
                  onChange={(value) => update({ theme: value as Settings["theme"] })}
                />
              </Row>
              <Row name={t("tempUnit")}>
                <Segmented
                  value={settings.tempUnit}
                  options={[
                    { value: "c", label: "°C" },
                    { value: "f", label: "°F" },
                  ]}
                  onChange={(value) => update({ tempUnit: value as TempUnit })}
                />
              </Row>
              <Row name={t("opacity")}>
                <Slider
                  min={25}
                  max={100}
                  suffix=" %"
                  value={Math.round(settings.opacity * 100)}
                  onChange={(value) => update({ opacity: value / 100 })}
                />
              </Row>
              <Row name={t("blur")}>
                <Slider
                  min={0}
                  max={60}
                  suffix=" px"
                  value={settings.blur}
                  onChange={(value) => update({ blur: value })}
                />
              </Row>
            </Group>
          </>
        ) : null}

        {pane === "tray" ? (
          <>
            <h2>{t("paneTray")}</h2>
            <p className="lead">{t("trayLead")}</p>
            <Group>
              <Row name={t("netMeter")}>
                <Switch on={settings.trayNet} onChange={(on) => update({ trayNet: on })} />
              </Row>
              <Row name={t("coloured")} hint={t("colouredHint")}>
                <Switch on={settings.trayColored} onChange={(on) => update({ trayColored: on })} />
              </Row>
              <Row name={t("publicIp")} hint={t("publicIpHint")}>
                <Switch on={settings.publicIp} onChange={(on) => update({ publicIp: on })} />
              </Row>
              <Row name={t("topTalkers")} hint={t("topTalkersHint")}>
                <Switch on={settings.netTop} onChange={(on) => update({ netTop: on })} />
              </Row>
            </Group>
            <MeterPreview settings={settings} snapshot={snapshot} label={t("preview")} />
          </>
        ) : null}

        {pane === "sampling" ? (
          <>
            <h2>{t("paneSampling")}</h2>
            <p className="lead">{t("samplingLead")}</p>
            <Group>
              <Row name={t("frequency")} hint={t("samplingHint")}>
                <Segmented
                  value={String(settings.intervalMs)}
                  options={INTERVALS.map((ms) => ({
                    value: ms,
                    label: `${Number(ms) / 1000}s`,
                  }))}
                  onChange={(value) => update({ intervalMs: Number(value) })}
                />
              </Row>
            </Group>
          </>
        ) : null}

        {pane === "about" ? (
          <>
            <h2>{t("paneAbout")}</h2>
            <p className="lead">{t("hardwareLead")}</p>
            <Group>
              <Row name={t("chip")}>
                <b>{meta ? meta.chip : "—"}</b>
              </Row>
              <Row
                name={t("cores")}
                hint={meta ? t("coresOf", { perf: meta.effCores, perf2: meta.perfCores }) : undefined}
              >
                <b>{meta ? meta.logicalCores : "—"}</b>
              </Row>
              <Row name={t("graphics")}>
                <b>{meta ? meta.gpuName : "—"}</b>
              </Row>
              <Row name={t("ram")}>
                <b>{meta ? bytes(meta.totalMemory, 0) : "—"}</b>
              </Row>
              <Row name="macOS">
                <b>{meta ? meta.macosVersion : "—"}</b>
              </Row>
              <Row name={t("batteryHealth")}>
                <b>
                  {snapshot
                    ? `${pct(snapshot.battery.health)} · ${snapshot.battery.cycles ?? "—"} ${t("cycles").toLowerCase()}`
                    : "—"}
                </b>
              </Row>
              <Row name={t("shortcut")} hint={t("shortcutHint")}>
                <b>{prettyKeys(shortcut)}</b>
              </Row>
            </Group>
            <Group title={t("paneTemps")}>
              {sensors.length === 0 ? (
                <div className="empty">{t("noSensors")}</div>
              ) : (
                sensors.map((sensor) => (
                  <div className="sensor" key={sensor.id}>
                    <span className="sensor-name">{sensor.label}</span>
                    <span className="sensor-bar">
                      <i
                        style={{
                          width: `${Math.max(2, Math.min(100, ((sensor.tempC - 20) / 70) * 100))}%`,
                        }}
                      />
                    </span>
                    <span className="sensor-value">{tu(sensor.tempC, 1)}</span>
                  </div>
                ))
              )}
            </Group>
            <p className="lead">{t("sources")}</p>
            <div className="statusline">
              <span>
                {meta
                  ? `${meta.chip} · ${t("coresFooter", { count: meta.logicalCores })} · macOS ${meta.macosVersion}`
                  : ""}
              </span>
              <span className="grow" />
              <span className="hint">{t("shortcutFooter", { keys: prettyKeys(shortcut) })}</span>
              {inTauri ? (
                <button
                  className="btn danger"
                  onClick={() =>
                    void import("@tauri-apps/api/core").then(({ invoke }) =>
                      invoke("quit_app").catch(() => undefined),
                    )
                  }
                >
                  {t("quit")}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function MeterPreview({
  settings,
  snapshot,
  label,
}: {
  settings: Settings;
  snapshot: Snapshot | null;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const down = snapshot?.net.downBps ?? 1_400_000;
  const up = snapshot?.net.upBps ?? 220_000;

  useEffect(() => {
    void import("../lib/trayMeter")
      .then(({ renderMeter }) => {
        setUrl(renderMeter(down, up, { colored: settings.trayColored }).png);
      })
      .catch(() => setUrl(null));
  }, [down, up, settings.trayColored]);

  return (
    <Group title={label}>
      <div className="preview">
        <div className="preview-bar">
          <span className="preview-clock">
            {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
          {url ? <img src={url} alt="" style={{ height: 18 }} /> : null}
        </div>
      </div>
    </Group>
  );
}
