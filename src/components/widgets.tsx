import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Sparkline } from "./Sparkline";
import type { History, Meta, Sensor, Snapshot } from "../types";
import { copyText } from "../lib/clipboard";
import { bps, bytes, clamp, duration, ghz, pct } from "../lib/format";
import { useT } from "../lib/i18n";
import { toUnit, useTemp, useTempUnit } from "../lib/units";

export const COLORS = {
  cpu: "var(--cpu)",
  gpu: "var(--gpu)",
  ram: "var(--ram)",
  batt: "var(--batt)",
  down: "var(--down)",
  up: "var(--up)",
  disk: "var(--disk)",
  hot: "var(--batt-warn)",
} as const;

/** Second series of a card (system time, tiler, wired memory …). */
const SECOND = "rgba(255,255,255,0.42)";

/* ------------------------------------------------------------------ shell */

type WidgetProps = {
  label: string;
  accent: string;
  value: ReactNode;
  unit?: string;
  spark?: ReactNode;
  meta?: ReactNode;
  extra?: ReactNode;
  /** Built only while the card is open: rendering every row of every panel on
      every tick was the single most expensive thing the widget did. */
  details?: () => ReactNode;
  hidden?: boolean;
  showSpark?: boolean;
};

/**
 * Every card is laid out the same way, top to bottom: title + headline number,
 * the card's own graphic, the sparkline, one line of context, and — once it is
 * opened — the detail panel. Cards used to arrange these differently, which is
 * what made the numbers feel scattered.
 */
export function Widget({
  label,
  accent,
  value,
  unit,
  spark,
  meta,
  extra,
  details,
  hidden,
  showSpark = true,
}: WidgetProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <section
      className={`card ${open ? "open" : ""}`}
      style={{ ["--accent" as string]: accent } as React.CSSProperties}
      onClick={() => details && setOpen((v) => !v)}
      title={details ? t("hoverDetails") : undefined}
    >
      <header className="head">
        <span className="label">
          <i className="dot" />
          {label}
        </span>
        <span className="value num">
          {value}
          {unit ? <span className="unit">{unit}</span> : null}
        </span>
      </header>
      {extra}
      {showSpark ? spark : null}
      {meta ? <div className="meta num">{meta}</div> : null}
      {/* Open is the resting state and the animation is decoration: a window on
          the desktop level counts as occluded, where WebKit throttles rAF, so
          anything that waits for a frame to apply the open state can simply
          never arrive — and the panel stays shut. */}
      {details && open ? <div className="details">{details()}</div> : null}
    </section>
  );
}

const Dot = ({ color }: { color: string }) => (
  <i
    style={{
      width: 5,
      height: 5,
      borderRadius: 2,
      background: color,
      display: "inline-block",
    }}
  />
);

const Sep = () => <span className="sep">·</span>;

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <span className="k">{k}</span>
      <span />
      <span className="v num">{v}</span>
    </>
  );
}

/** The headline numbers of a detail panel, so the same facts sit in the same
    place on every card. */
function Stats({ items }: { items: { k: string; v: ReactNode; color?: string }[] }) {
  return (
    <div className="stats">
      {items.map((item) => (
        <div className="stat" key={item.k}>
          <span className="sv num" style={item.color ? { color: item.color } : undefined}>
            {item.v}
          </span>
          <span className="sk">{item.k}</span>
        </div>
      ))}
    </div>
  );
}

const Sub = ({ title }: { title: string }) => <div className="subhead">{title}</div>;

/** Name plus two numbers — the same shape the CPU card uses for its hungriest
    processes, so the network one reads identically. */
export function ProcList({
  rows,
  empty,
  slots,
}: {
  rows: { key: string | number; name: string; a: string; b: string; title?: string }[];
  empty: string;
  /** Keep this many rows' worth of height even when fewer are busy. A list
      whose length changes every few seconds resizes the card, and the window
      follows its content — which reads as the whole widget twitching. */
  slots?: number;
}) {
  // The empty state reserves the same height as a full list, otherwise the
  // first sample landing a second after the panel opens resizes the window.
  const padding = Math.max(0, (slots ?? rows.length) - rows.length);
  if (!rows.length) {
    return (
      <div className="procs">
        <div className="proc empty-row">
          <span className="pname">{empty}</span>
        </div>
        {Array.from({ length: Math.max(0, padding - 1) }, (_, i) => (
          <div className="proc placeholder" key={`pad${i}`} aria-hidden>
            <span className="pname">—</span>
            <span className="pnum">—</span>
            <span className="pnum dim">—</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="procs">
      {rows.map((row) => (
        <div className="proc" key={row.key} title={row.title}>
          <span className="pname">{row.name}</span>
          <span className="pnum">{row.a}</span>
          <span className="pnum dim">{row.b}</span>
        </div>
      ))}
      {Array.from({ length: padding }, (_, i) => (
        <div className="proc placeholder" key={`pad${i}`} aria-hidden>
          <span className="pname">—</span>
          <span className="pnum">—</span>
          <span className="pnum dim">—</span>
        </div>
      ))}
    </div>
  );
}

function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      {done ? (
        <path d="M2.5 6.4 4.7 8.6 9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <rect x="4.2" y="1.4" width="6.4" height="6.4" rx="1.6" />
          <path d="M7.8 10.6H3a1.6 1.6 0 0 1-1.6-1.6V4.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * A value worth pasting somewhere else — an address, a network name. One click
 * copies it.
 *
 * The icon is always drawn, at low contrast until the row is hovered: revealing
 * it on hover changed the width of the value and made the whole row jump. It
 * sits before the text so the numbers stay flush against the right edge, and
 * the click is stopped from also toggling the card open.
 */
export function Copyable({ value, children }: { value: string | null; children?: ReactNode }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  if (!value) return <>{children ?? "—"}</>;
  return (
    <button
      type="button"
      className={`copy ${done ? "done" : ""}`}
      title={t("copyHint")}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value).then((ok) => {
          if (!ok) return;
          setDone(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      <span className="cicon">
        <CopyGlyph done={done} />
      </span>
      <span className="ctext">{children ?? value}</span>
    </button>
  );
}

/** A chart with its own caption, because two stacked unlabelled sparklines do
    not say which one is which. */
function Chart({
  title,
  color,
  value,
  children,
}: {
  title: string;
  color: string;
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="chart">
      <div className="clegend">
        <span className="ckey">
          <i style={{ background: color }} />
          {title}
        </span>
        {value !== undefined ? <span className="cval num">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A single 0..100 level. Not a Split: renderer and tiler are two independent
    utilisations, and stacking them would claim they add up to the total. */
function Meter({ value, color, title }: { value: number; color: string; title?: string }) {
  return (
    <div className="split" title={title}>
      <span style={{ flexGrow: clamp(value, 0, 100), background: color, flexBasis: 0 }} />
      <span style={{ flexGrow: Math.max(0, 100 - clamp(value, 0, 100)), background: "transparent", flexBasis: 0 }} />
    </div>
  );
}

/** Proportional bar; the parts are named so the tooltip explains the colours. */
function Split({
  parts,
  total,
}: {
  parts: { name: string; value: number; color: string }[];
  total: number;
}) {
  const span = Math.max(total, 1e-6);
  return (
    <div className="split" title={parts.map((p) => p.name).join(" / ")}>
      {parts.map((p) => (
        <span
          key={p.name}
          style={{ flexGrow: Math.max(0, p.value) / span, background: p.color, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

/** Scrollable sensor table; the full list lives on the Temperatures card, so
    a card only ever shows the sensors that belong to it. */
function SensorList({ sensors }: { sensors: Sensor[] }) {
  const t = useT();
  const tu = useTemp();
  if (!sensors.length) return <div className="kv"><KV k={t("sensors")} v={t("none")} /></div>;
  return (
    <div className="sensors">
      <div className="kv">
        {sensors.map((s) => (
          <KV key={s.id} k={s.label} v={<span className={s.tempC > 85 ? "hot" : ""}>{tu(s.tempC, 1)}</span>} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- CPU */

export function CpuWidget({
  snap,
  hist,
  spark,
  meta,
  showCores,
  showTop,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  meta: Meta | null;
  showCores: boolean;
  showTop: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const tu = useTemp();
  const { cpu } = snap;
  const kinds = cpu.coreKinds.length === cpu.cores.length ? cpu.coreKinds : [];
  const perf = kinds.filter((k) => k === "performance").length;
  const eff = kinds.length - perf;
  const hot = (cpu.tempC ?? 0) > 85;
  const user = cpu.user + cpu.nice;
  // Where the load actually sits, which is more use here than repeating the
  // sensor table that the Temperatures card already shows in full.
  const average = (list: number[]) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const perfLoad = average(cpu.cores.filter((_, i) => kinds[i] === "performance"));
  const effLoad = average(cpu.cores.filter((_, i) => kinds[i] === "efficiency"));
  const busiest = cpu.cores.reduce(
    (best, usage, index) => (usage > best.usage ? { usage, index } : best),
    { usage: 0, index: 0 },
  );
  const busyCores = cpu.cores.filter((usage) => usage >= 50).length;

  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("cpu")}
      accent={COLORS.cpu}
      value={pct(cpu.usage, cpu.usage < 10 ? 1 : 0)}
      unit="%"
      spark={
        <Sparkline
          data={hist.cpu}
          color={COLORS.cpu}
          max={100}
          height={26}
          className="spark-wrap"
        />
      }
      extra={
        showCores && cpu.cores.length ? (
          <div className="cores">
            {cpu.cores.map((usage, i) => (
              <span
                key={i}
                className={`core ${kinds[i] === "efficiency" ? "eff" : ""}`}
                title={`${kinds[i] ?? "core"} ${i}: ${usage.toFixed(0)}%`}
              >
                <i style={{ transform: `scaleY(${clamp(usage, 2, 100) / 100})` }} />
              </span>
            ))}
          </div>
        ) : null
      }
      meta={
        <>
          <span title={t("userTime")}>
            <Dot color={COLORS.cpu} /> {t("userShort")} {user.toFixed(0)}%
          </span>
          <Sep />
          <span title={t("systemTime")}>
            <Dot color={SECOND} /> {t("systemShort")} {cpu.system.toFixed(0)}%
          </span>
          <Sep />
          <span title={t("avgFreq")}>{ghz(cpu.freqMhz)}</span>
          <span className={`right ${hot ? "hot" : ""}`} title={t("hottestSensor")}>
            {tu(cpu.tempC, cpu.tempC !== null && cpu.tempC < 100 ? 0 : 1)}
          </span>
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("userTime"), v: `${user.toFixed(1)} %`, color: "var(--cpu)" },
              { k: t("systemTime"), v: `${cpu.system.toFixed(1)} %` },
              { k: t("idleTime"), v: `${cpu.idle.toFixed(1)} %` },
            ]}
          />
          <Split
            total={100}
            parts={[
              { name: t("userTime"), value: user, color: "var(--cpu)" },
              { name: t("systemTime"), value: cpu.system, color: SECOND },
            ]}
          />
          <div className="kv">
            <KV
              k={t("load")}
              v={`${cpu.load1.toFixed(2)} · ${cpu.load5.toFixed(2)} · ${cpu.load15.toFixed(2)}`}
            />
            <KV
              k={t("cores")}
              v={meta ? `${meta.physicalCores}P+E / ${meta.logicalCores} log.` : cpu.cores.length}
            />
            {perf > 0 ? <KV k="P / E" v={`${perf} / ${eff}`} /> : null}
            <KV k={t("peakFreq")} v={ghz(cpu.maxFreqMhz)} />
            <KV k={t("processes")} v={cpu.processes} />
            <KV k={t("uptime")} v={duration(cpu.uptimeSecs)} />
          </div>
          <Sub title={t("whereTheLoad")} />
          <div className="kv">
            {perf > 0 ? (
              <>
                <KV
                  k={t("perfCluster", { count: perf })}
                  v={`${perfLoad.toFixed(0)} %`}
                />
                <KV
                  k={t("effCluster", { count: eff })}
                  v={`${effLoad.toFixed(0)} %`}
                />
              </>
            ) : null}
            <KV k={t("busiestCore")} v={`#${busiest.index} · ${busiest.usage.toFixed(0)} %`} />
            <KV k={t("coresOver50")} v={`${busyCores} / ${cpu.cores.length}`} />
          </div>
          {showTop && snap.topProcesses.length > 0 ? (
            <>
              <Sub title={t("hottest")} />
              <ProcList
                empty={t("none")}
                rows={snap.topProcesses.map((p) => ({
                  key: p.pid,
                  name: p.name,
                  a: `${p.cpu.toFixed(0)}%`,
                  b: bytes(p.memBytes, 0),
                  title: `PID ${p.pid}`,
                }))}
              />
            </>
          ) : null}
        </div>
      )}
    />
  );
}

/* -------------------------------------------------------------------- GPU */

export function GpuWidget({
  snap,
  hist,
  spark,
  meta,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  meta: Meta | null;
  hidden?: boolean;
}) {
  const t = useT();
  const tu = useTemp();
  const { gpu } = snap;
  const renderer = gpu.renderer ?? 0;
  const tiler = gpu.tiler ?? 0;
  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("gpu")}
      accent={COLORS.gpu}
      value={gpu.usage === null ? "—" : pct(gpu.usage, gpu.usage < 10 ? 1 : 0)}
      unit="%"
      spark={
        <Sparkline data={hist.gpu} color={COLORS.gpu} max={100} height={22} className="spark-wrap" />
      }
      extra={<Meter value={gpu.usage ?? 0} color="var(--gpu)" title={t("usage")} />}
      meta={
        <>
          <span title={t("renderer")}>R {pct(renderer)}%</span>
          <Sep />
          <span title={t("tiler")}>T {pct(tiler)}%</span>
          <Sep />
          <span title={t("gpuMemory")}>{gpu.allocatedBytes ? bytes(gpu.allocatedBytes) : "—"}</span>
          <span className="right" title={t("temperature")}>
            {tu(gpu.tempC, 0)}
          </span>
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("usage"), v: gpu.usage === null ? "—" : `${gpu.usage.toFixed(0)} %`, color: "var(--gpu)" },
              { k: t("allocated"), v: bytes(gpu.allocatedBytes ?? 0, 1) },
              { k: t("temperature"), v: tu(gpu.tempC, 0) },
            ]}
          />
          <div className="kv">
            <KV k={t("model")} v={meta?.gpuName ?? "—"} />
            <KV k={t("renderer")} v={`${renderer.toFixed(0)} %`} />
            <KV k={t("tiler")} v={`${tiler.toFixed(0)} %`} />
            <KV k={t("allocated")} v={bytes(gpu.allocatedBytes ?? 0, 1)} />
            <KV k={t("memoryUsed")} v={bytes(gpu.inUseBytes ?? 0, 1)} />
            <KV k={t("temperature")} v={tu(gpu.tempC, 1)} />
          </div>
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------------- RAM */

export function MemoryWidget({
  snap,
  hist,
  spark,
  showTop,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  showTop: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const m = snap.memory;
  const usedPct = m.total ? (m.used / m.total) * 100 : 0;
  const freePct = m.total ? (m.available / m.total) * 100 : 0;
  const pressureColor =
    m.pressure > 66 ? "var(--batt-crit)" : m.pressure > 33 ? "var(--batt-warn)" : "var(--batt)";
  const parts = [
    { name: t("app"), value: m.app, color: "var(--ram)" },
    { name: t("wired"), value: m.wired, color: "#0f8ecb" },
    { name: t("compressed"), value: m.compressed, color: "#ff9f0a" },
    { name: t("cached"), value: m.cached, color: "#7f8c9b" },
  ];
  const shownTotal = Math.max(m.total, m.used + m.cached);

  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("memory")}
      accent={COLORS.ram}
      value={bytes(m.used, 1).replace(/ (GB|MB|TB|PB)/, "")}
      unit={bytes(m.used, 1).split(" ")[1] ?? ""}
      spark={
        <Sparkline data={hist.memory} color={COLORS.ram} max={100} height={22} className="spark-wrap" />
      }
      extra={<Split parts={parts} total={shownTotal} />}
      meta={
        <>
          <span title={t("memoryActivity")}>
            <Dot color={pressureColor} /> {usedPct.toFixed(0)}%
          </span>
          <Sep />
          <span title={t("availableMem")}>
            {t("availableShort")} {bytes(m.available, 1)}
          </span>
          <Sep />
          <span>{t("ofCapacity", { value: bytes(m.total, 0) })}</span>
          {m.swapUsed > 0 ? (
            <span className="right" title={t("swap")}>
              swap {bytes(m.swapUsed, 0)}
            </span>
          ) : null}
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("used"), v: `${usedPct.toFixed(0)} %`, color: "var(--ram)" },
              { k: t("availableMem"), v: `${freePct.toFixed(0)} %` },
              { k: t("pressure"), v: `${m.pressure.toFixed(0)} %`, color: pressureColor },
            ]}
          />
          <div className="kv">
            {parts.map((p) => (
              <KV key={p.name} k={p.name} v={bytes(p.value, 1)} />
            ))}
            <KV k={t("uncompressed")} v={bytes(m.uncompressed, 1)} />
            <KV k={t("availableMem")} v={`${bytes(m.available, 1)} · ${freePct.toFixed(0)} %`} />
            <KV k={t("used")} v={`${bytes(m.used, 1)} · ${usedPct.toFixed(0)} %`} />
            <KV k={t("total")} v={bytes(m.total, 0)} />
            <KV k={t("swap")} v={`${bytes(m.swapUsed, 1)} / ${bytes(m.swapTotal, 0)}`} />
          </div>
          {showTop ? (
            <>
              <Sub title={t("memoryHogs")} />
              <ProcList
                empty={t("none")}
                slots={5}
                rows={m.topProcesses.map((p) => ({
                  key: p.pid,
                  name: p.name,
                  a: bytes(p.memBytes, 1),
                  b: `${p.memPercent.toFixed(1)} %`,
                  title: `PID ${p.pid}`,
                }))}
              />
            </>
          ) : null}
        </div>
      )}
    />
  );
}

/* --------------------------------------------------------------- Battery */

function BatteryGlyph({ level, charging, color }: { level: number; charging: boolean; color: string }) {
  const w = 34;
  const h = 16;
  const inner = w - 6;
  const fillWidth = Math.max(2, (clamp(level, 0, 100) / 100) * (inner - 3));
  return (
    <svg className="glyph" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <rect x="0.75" y="0.75" width={inner} height={h - 1.5} rx="4.2" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" />
      <rect x="2.5" y="2.5" width={fillWidth} height={h - 5} rx="2.6" fill={color} />
      <path d={`M ${inner + 2} ${h / 2 - 2.6} q 2.4 2.6 0 5.2 z`} fill="currentColor" fillOpacity="0.35" />
      {charging ? (
        <path
          d={`M ${inner / 2 + 1} 3 l -4 6 h 3 l -1.6 5 5.2 -7 h -3 z`}
          fill="#0b0d10"
          fillOpacity="0.85"
        />
      ) : null}
    </svg>
  );
}

export function BatteryWidget({
  snap,
  hist,
  spark,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const tu = useTemp();
  const b = snap.battery;
  if (!b.present) return null;
  const color =
    b.charging || b.acConnected
      ? "var(--batt)"
      : b.level <= 10
        ? "var(--batt-crit)"
        : b.level <= 25
          ? "var(--batt-warn)"
          : "var(--batt)";
  const discharging = !b.acConnected;
  const watts = discharging ? Math.max(0, b.watts) : b.watts;

  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("battery")}
      accent={color}
      value={b.level.toFixed(0)}
      unit="%"
      spark={
        <Sparkline
          data={hist.watts}
          color={color}
          height={20}
          className="spark-wrap"
          max={undefined}
        />
      }
      extra={
        <div className="battwrap" style={{ color: "var(--muted)" }}>
          <BatteryGlyph level={b.level} charging={b.charging} color={color} />
          <div className="stack2">
            <div className="split" style={{ marginTop: 0 }}>
              <span style={{ flexGrow: clamp(b.level, 0, 100), background: color, flexBasis: 0 }} />
              <span style={{ flexGrow: Math.max(0, 100 - b.level), background: "transparent", flexBasis: 0 }} />
            </div>
          </div>
          <span className="num" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text)" }}>
            {Math.abs(watts).toFixed(watts < 10 ? 2 : 1)} W
          </span>
        </div>
      }
      meta={
        <>
          <span title={discharging ? t("timeToEmpty") : t("timeToFull")}>
            {b.timeRemainingSecs ? duration(b.timeRemainingSecs) : b.acConnected ? t("acShort") : "—"}
          </span>
          <Sep />
          <span title={t("batteryHealth")}>{b.health.toFixed(0)} %</span>
          {b.cycles !== null ? (
            <>
              <Sep />
              <span title={t("cycles")}>{b.cycles}</span>
            </>
          ) : null}
          <span className="right" title={t("batteryTemp")}>
            {tu(b.tempC, 1)}
          </span>
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("power"), v: `${Math.abs(watts).toFixed(1)} W`, color },
              { k: t("batteryHealth"), v: `${b.health.toFixed(0)} %` },
              {
                k: discharging ? t("timeToEmpty") : t("timeToFull"),
                v: b.timeRemainingSecs ? duration(b.timeRemainingSecs) : "—",
              },
            ]}
          />
          <div className="kv">
            <KV k={t("voltage")} v={`${(b.voltageMv / 1000).toFixed(2)} V`} />
            <KV k={t("current")} v={`${(b.amperageMa / 1000).toFixed(2)} A`} />
            <KV k={t("power")} v={`${b.watts.toFixed(2)} W`} />
            <KV k={t("capacity")} v={`${b.nowMah.toFixed(0)} / ${b.designMah.toFixed(0)} mAh`} />
            <KV k={t("cycles")} v={b.cycles ?? "—"} />
            <KV k={t("state")} v={b.charging ? t("charging") : b.acConnected ? t("pluggedIn") : t("discharging")} />
            <KV k={t("temperature")} v={tu(b.tempC, 1)} />
          </div>
        </div>
      )}
    />
  );
}

/* ---------------------------------------------------------------- Network */

function NetRow({
  arrow,
  value,
  ratio,
  color,
}: {
  arrow: string;
  value: number;
  ratio: number;
  color: string;
}) {
  return (
    <div className="netrow" style={{ ["--accent" as string]: color } as React.CSSProperties}>
      <span className="arrow">{arrow}</span>
      <span className="barwrap">
        <i style={{ transform: `scaleX(${clamp(ratio, 0.015, 1)})` }} />
      </span>
      <span className="val num">{bps(value)}</span>
    </div>
  );
}

/** Bars keep a sane scale: 0 B/s … a slow-falling recent peak. */
function usePeak(values: number[]) {
  const peak = useRef(1024);
  const max = values.reduce((a, b) => Math.max(a, b), 0);
  peak.current = Math.max(max, peak.current * 0.9, 32 * 1024);
  return peak.current;
}

/** How the link is named in the UI: the Wi-Fi network first, then the port. */
export function linkName(
  t: (key: string) => string,
  kind: string,
  label: string,
  ssid: string | null,
): string {
  if (kind === "wifi") return ssid ?? t("kindWifi");
  if (label && label !== "—") return label;
  return t(kind === "vpn" ? "kindVpn" : kind === "ethernet" ? "kindEthernet" : "kindOther");
}

export function NetworkWidget({
  snap,
  hist,
  spark,
  showTop,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  showTop: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const n = snap.net;
  const peak = usePeak([...hist.down, ...hist.up]);
  // Only the links that are actually up; a Mac lists a dozen ports it never uses.
  const links = n.interfaces.filter((i) => i.active || i.isPrimary);
  const name = linkName(t, n.kind, n.primaryLabel, n.ssid);
  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("network")}
      accent={COLORS.down}
      value={<span className="linkname">{name}</span>}
      spark={
        <>
          <Chart title={t("down")} color={COLORS.down} value={bps(n.downBps, 1)}>
            <Sparkline data={hist.down} color={COLORS.down} height={18} className="spark-wrap" />
          </Chart>
          <Chart title={t("up")} color={COLORS.up} value={bps(n.upBps, 1)}>
            <Sparkline data={hist.up} color={COLORS.up} height={14} className="spark-wrap" />
          </Chart>
        </>
      }
      extra={
        <>
          <NetRow arrow="↓" value={n.downBps} ratio={n.downBps / peak} color={COLORS.down} />
          <NetRow arrow="↑" value={n.upBps} ratio={n.upBps / peak} color={COLORS.up} />
        </>
      }
      meta={
        <>
          <span title={t("link")}>{n.primary}</span>
          <Sep />
          <span title={t("totalDown")}>{bytes(n.totalIn, 0)} ↓</span>
          <Sep />
          <span title={t("totalUp")}>{bytes(n.totalOut, 0)} ↑</span>
          {n.ipv4 ? (
            <span className="right" title={t("address")}>
              {n.ipv4}
            </span>
          ) : null}
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("down"), v: bps(n.downBps, 1), color: "var(--down)" },
              { k: t("up"), v: bps(n.upBps, 1), color: "var(--up)" },
              { k: `${t("total")} ↓`, v: bytes(n.totalIn, 0) },
            ]}
          />
          <div className="kv">
            <KV
              k={n.kind === "wifi" ? t("wifiNetwork") : t("link")}
              v={
                n.kind === "wifi" && !n.ssid ? (
                  t(n.ssidBlocked ? "ssidBlocked" : "ssidHidden")
                ) : (
                  <Copyable value={name} />
                )
              }
            />
            <KV k={t("interfaceRow")} v={`${n.primary} · ${n.primaryLabel}`} />
            <KV k={t("localIp")} v={<Copyable value={n.ipv4} />} />
            <KV k={t("publicIp")} v={<Copyable value={n.publicIp} />} />
            <KV k={`${t("total")} ↓`} v={bytes(n.totalIn, 1)} />
            <KV k={`${t("total")} ↑`} v={bytes(n.totalOut, 1)} />
          </div>
          {showTop ? (
            <>
              <Sub title={t("topTalkers")} />
              <ProcList
                empty={t("noTraffic")}
                slots={5}
                rows={n.topProcesses.map((p) => ({
                  key: p.pid,
                  name: p.name,
                  a: `↓ ${bps(p.downBps, 0)}`,
                  b: `↑ ${bps(p.upBps, 0)}`,
                  title: `PID ${p.pid}`,
                }))}
              />
            </>
          ) : null}
          {links.length > 1 ? (
            <>
              <Sub title={t("activeLinks")} />
              {/* Same two aligned columns as the process lists: a link and a
                  process are both "a thing moving bytes", and reading them in
                  two different shapes on one card is needless work. */}
              <ProcList
                empty={t("none")}
                rows={links.map((i) => ({
                  key: i.name,
                  name: `${i.isPrimary ? "▸ " : ""}${i.label}`,
                  a: `↓ ${bps(i.downBps, 0)}`,
                  b: `↑ ${bps(i.upBps, 0)}`,
                  title: i.name,
                }))}
              />
            </>
          ) : null}
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------------- Disk */

export function DiskWidget({
  snap,
  hist,
  spark,
  hidden,
}: {
  snap: Snapshot;
  hist: History;
  spark: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const d = snap.disk;
  const peak = usePeak([...hist.diskRead, ...hist.diskWrite]);
  const usedPct = d.totalSpace ? ((d.totalSpace - d.freeSpace) / d.totalSpace) * 100 : 0;
  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("disk")}
      accent={COLORS.disk}
      value={<span className="linkname">{d.name}</span>}
      spark={
        <>
          <Chart title={t("read")} color="var(--down)" value={bps(d.readBps, 1)}>
            <Sparkline data={hist.diskRead} color="var(--down)" height={14} className="spark-wrap" />
          </Chart>
          <Chart title={t("write")} color="var(--up)" value={bps(d.writeBps, 1)}>
            <Sparkline data={hist.diskWrite} color="var(--up)" height={14} className="spark-wrap" />
          </Chart>
        </>
      }
      extra={
        <>
          <NetRow arrow="↓" value={d.readBps} ratio={d.readBps / peak} color="var(--down)" />
          <NetRow arrow="↑" value={d.writeBps} ratio={d.writeBps / peak} color="var(--up)" />
        </>
      }
      meta={
        <>
          <span title={t("used")}>{usedPct.toFixed(0)}%</span>
          <Sep />
          <span title={t("free")}>
            {t("freeShort")} {bytes(d.freeSpace, 0)}
          </span>
          <Sep />
          <span>{t("ofCapacity", { value: bytes(d.totalSpace, 0) })}</span>
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("read"), v: bps(d.readBps, 1), color: "var(--down)" },
              { k: t("write"), v: bps(d.writeBps, 1), color: "var(--up)" },
              { k: t("free"), v: bytes(d.freeSpace, 1) },
            ]}
          />
          <div className="kv">
            <KV k={t("read")} v={`${bps(d.readBps)} · ${bytes(d.totalRead, 1)} ${t("sinceBoot")}`} />
            <KV k={t("write")} v={`${bps(d.writeBps)} · ${bytes(d.totalWrite, 1)} ${t("sinceBoot")}`} />
            <KV k={t("free")} v={bytes(d.freeSpace, 1)} />
            <KV k={t("total")} v={bytes(d.totalSpace, 1)} />
          </div>
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------- temperatures */

/** Warmest reading seen recently, in °C — never below a sane floor so the
    sparkline does not zoom into the noise. */
function useTempPeak(values: number[]) {
  const peak = useRef(0);
  const max = values.reduce((a, b) => Math.max(a, b), 0);
  peak.current = Math.max(max, peak.current * 0.995, 40);
  return peak.current;
}

export function TempsWidget({
  snap,
  hist,
  spark,
  hidden,
}: {
  snap: Snapshot;
  hist: History | null;
  spark: boolean;
  hidden?: boolean;
}) {
  const t = useT();
  const tu = useTemp();
  const sorted = [...snap.sensors].sort((a, b) => b.tempC - a.tempC);
  const hot = sorted[0];
  const series = [...(hist?.temp ?? []).filter((v) => v > 0), hot?.tempC ?? 0];
  const peak = useTempPeak(series);
  const tempUnit = useTempUnit();
  const average = sorted.length
    ? sorted.reduce((a, s) => a + s.tempC, 0) / sorted.length
    : 0;
  return (
    <Widget
      label={t("temps")}
      accent={COLORS.hot}
      value={hot ? toUnit(hot.tempC, tempUnit).toFixed(0) : "—"}
      unit={`°${tempUnit.toUpperCase()}`}
      showSpark={spark}
      hidden={hidden}
      spark={
        hist ? (
          <Sparkline
            data={series}
            color={COLORS.hot}
            max={Math.max(70, peak * 1.1)}
            min={20}
            height={20}
            className="spark-wrap"
          />
        ) : null
      }
      meta={
        <>
          <span className={hot && hot.tempC > 85 ? "hot" : ""}>{hot ? hot.label : t("none")}</span>
          <Sep />
          <span title={t("average")}>
            {t("averageShort")} {tu(average, 0)}
          </span>
          <span className="right" title={t("peak")}>
            {t("peak")} {tu(peak, 0)}
          </span>
        </>
      }
      details={() => (
        <div className="detail">
          <Stats
            items={[
              { k: t("hottestSensor"), v: tu(hot?.tempC ?? null, 0), color: COLORS.hot },
              { k: t("average"), v: tu(average, 0) },
              { k: t("peak"), v: tu(peak, 0) },
            ]}
          />
          <SensorList sensors={sorted} />
        </div>
      )}
    />
  );
}

