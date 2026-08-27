import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Sparkline } from "./Sparkline";
import type { History, Meta, Snapshot } from "../types";
import { bps, bytes, clamp, duration, ghz, pct, temp } from "../lib/format";
import { useT } from "../lib/i18n";

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

/* ------------------------------------------------------------------ shell */

type WidgetProps = {
  label: string;
  accent: string;
  value: ReactNode;
  unit?: string;
  spark?: ReactNode;
  meta?: ReactNode;
  extra?: ReactNode;
  details?: ReactNode;
  hidden?: boolean;
  showSpark?: boolean;
};

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
      {details ? <div className="details">{details}</div> : null}
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

function SensorList({ snap }: { snap: Snapshot }) {
  const t = useT();
  if (!snap.sensors.length) return <KV k={t("sensors")} v={t("none")} />;
  return (
    <div className="sensors">
      {snap.sensors.map((s) => (
        <div className="kv" key={s.id}>
          <span className="k">{s.label}</span>
          <span />
          <span className={`v ${s.tempC > 85 ? "hot" : ""}`}>{temp(s.tempC, 1)}</span>
        </div>
      ))}
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
  const { cpu } = snap;
  const kinds = cpu.coreKinds.length === cpu.cores.length ? cpu.coreKinds : [];
  const perf = kinds.filter((k) => k === "performance").length;
  const eff = kinds.length - perf;
  const hot = (cpu.tempC ?? 0) > 85;

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
                <i style={{ height: `${clamp(usage, 2, 100)}%` }} />
              </span>
            ))}
          </div>
        ) : null
      }
      meta={
        <>
          <span title={t("avgFreq")}>{ghz(cpu.freqMhz)}</span>
          <Sep />
          <span title={t("load")}>load {cpu.load1.toFixed(2)}</span>
          <Sep />
          <span className={hot ? "hot" : ""} title={t("hottestSensor")}>
            {temp(cpu.tempC, cpu.tempC !== null && cpu.tempC < 100 ? 0 : 1)}
          </span>
        </>
      }
      details={
        <div className="kv">
          <KV k={t("load")} v={`${cpu.load1.toFixed(2)} · ${cpu.load5.toFixed(2)} · ${cpu.load15.toFixed(2)}`} />
          <KV k={t("cores")} v={meta ? `${meta.physicalCores}P+E / ${meta.logicalCores} log.` : cpu.cores.length} />
          {perf > 0 ? <KV k="P / E" v={`${perf} / ${eff}`} /> : null}
          <KV k={t("peakFreq")} v={ghz(cpu.maxFreqMhz)} />
          <KV k={t("processes")} v={cpu.processes} />
          <KV k={t("uptime")} v={duration(cpu.uptimeSecs)} />
          {spark ? (
            <>
              <div className="rule" />
              <Sparkline
                data={hist.temp}
                color="var(--batt-warn)"
                height={22}
                className="spark-wrap"
                min={20}
              />
            </>
          ) : null}
          {showTop && snap.topProcesses.length > 0 ? (
            <>
              <div className="rule" />
              <div className="procs">
                {snap.topProcesses.map((p) => (
                  <div className="proc" key={p.pid} title={`PID ${p.pid}`}>
                    <span className="pname">{p.name}</span>
                    <span className="pnum">{p.cpu.toFixed(0)}%</span>
                    <span className="pnum dim">{bytes(p.memBytes, 0)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="rule" />
          <SensorList snap={snap} />
        </div>
      }
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
  const { gpu } = snap;
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
      meta={
        <>
          <span title={t("gpuMemory")}>{gpu.allocatedBytes ? bytes(gpu.allocatedBytes) : "—"}</span>
          <Sep />
          <span title={t("renderer")}>R {pct(gpu.renderer ?? 0)}%</span>
          <Sep />
          <span title={t("tiler")}>T {pct(gpu.tiler ?? 0)}%</span>
        </>
      }
      details={
        <div className="kv">
          <KV k={t("model")} v={meta?.gpuName ?? "—"} />
          <KV k={t("allocated")} v={bytes(gpu.allocatedBytes ?? 0)} />
          <KV k={t("memoryUsed")} v={bytes(gpu.inUseBytes ?? 0)} />
          <KV k={t("temperature")} v={temp(gpu.tempC, 1)} />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------- RAM */

export function MemoryWidget({
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
  const m = snap.memory;
  const usedPct = m.total ? (m.used / m.total) * 100 : 0;
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
      extra={
        <div className="split" title={[t("app"), t("wired"), t("compressed"), t("cached")].join(" / ")}>
          {parts.map((p) => (
            <span
              key={p.name}
              style={{ flexGrow: Math.max(0, p.value) / shownTotal, background: p.color, flexBasis: 0 }}
            />
          ))}
        </div>
      }
      meta={
        <>
          <span>z {bytes(m.total, 0)}</span>
          <Sep />
          <span title={t("memoryActivity")}>
            <Dot color={pressureColor} /> {usedPct.toFixed(0)}%
          </span>
          {m.swapUsed > 0 ? (
            <>
              <Sep />
              <span title={t("swap")}>swap {bytes(m.swapUsed, 0)}</span>
            </>
          ) : null}
        </>
      }
      details={
        <div className="kv">
          {parts.map((p) => (
            <KV key={p.name} k={p.name} v={bytes(p.value, 1)} />
          ))}
          <KV k={t("uncompressed")} v={bytes(m.uncompressed, 1)} />
          <KV k={t("free")} v={bytes(m.available, 1)} />
          <KV k={t("pressure")} v={`${m.pressure.toFixed(0)} %`} />
          <KV k={t("swap")} v={`${bytes(m.swapUsed, 1)} / ${bytes(m.swapTotal, 0)}`} />
        </div>
      }
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
            {temp(b.tempC, 1)}
          </span>
        </>
      }
      details={
        <div className="kv">
          <KV k={t("voltage")} v={`${(b.voltageMv / 1000).toFixed(2)} V`} />
          <KV k={t("current")} v={`${(b.amperageMa / 1000).toFixed(2)} A`} />
          <KV k={t("power")} v={`${b.watts.toFixed(2)} W`} />
          <KV k={t("capacity")} v={`${b.nowMah.toFixed(0)} / ${b.designMah.toFixed(0)} mAh`} />
          <KV k={t("state")} v={b.charging ? t("charging") : b.acConnected ? t("pluggedIn") : t("discharging")} />
          <KV k={t("temperature")} v={temp(b.tempC, 1)} />
        </div>
      }
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
        <i style={{ width: `${clamp(ratio * 100, 1.5, 100)}%` }} />
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

export function NetworkWidget({
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
  const n = snap.net;
  const peak = usePeak([...hist.down, ...hist.up]);
  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("network")}
      accent={COLORS.down}
      value={<span style={{ fontSize: 11 }}>{n.primary}</span>}
      spark={
        <>
          <Sparkline data={hist.down} color={COLORS.down} height={18} className="spark-wrap" />
          <Sparkline data={hist.up} color={COLORS.up} height={14} className="spark-wrap" />
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
          <span title={t("totalDown")}>{bytes(n.totalIn, 0)} ↓</span>
          <Sep />
          <span title={t("totalUp")}>{bytes(n.totalOut, 0)} ↑</span>
          {n.ipv4 ? (
            <>
              <Sep />
              <span className="right" title={t("address")}>
                {n.ipv4}
              </span>
            </>
          ) : null}
        </>
      }
      details={
        <div className="kv">
          {n.interfaces.map((i) => (
            <KV
              key={i.name}
              k={`${i.isPrimary ? "▸ " : ""}${i.name}`}
              v={`↓${bps(i.downBps)} ↑${bps(i.upBps)}`}
            />
          ))}
          <div className="rule" />
          <KV k="IPv4" v={n.ipv4 ?? "—"} />
          <KV k={`${t("total")} ↓`} v={bytes(n.totalIn, 1)} />
          <KV k={`${t("total")} ↑`} v={bytes(n.totalOut, 1)} />
        </div>
      }
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
  return (
    <Widget
      hidden={hidden}
      showSpark={spark}
      label={t("disk")}
      accent={COLORS.disk}
      value={<span style={{ fontSize: 11 }}>{d.name}</span>}
      spark={
        <>
          <Sparkline data={hist.diskRead} color="var(--down)" height={14} className="spark-wrap" />
          <Sparkline data={hist.diskWrite} color="var(--up)" height={14} className="spark-wrap" />
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
          <span>{bytes(d.freeSpace, 0)} voľné</span>
          <Sep />
          <span>{bytes(d.totalSpace, 0)} celkom</span>
        </>
      }
      details={
        <div className="kv">
          <KV k={t("read")} v={`${bps(d.readBps)} ({t("sinceBoot")} ${bytes(d.totalRead, 1)})`} />
          <KV k={t("write")} v={`${bps(d.writeBps)} ({t("sinceBoot")} ${bytes(d.totalWrite, 1)})`} />
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------- temperatures */

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
  const sorted = [...snap.sensors].sort((a, b) => b.tempC - a.tempC);
  const hot = sorted[0];
  const peak = usePeak([...(hist?.temp ?? []), hot?.tempC ?? 0]);
  return (
    <Widget
      label={t("temps")}
      accent={COLORS.hot}
      value={hot ? Math.round(hot.tempC) : "\u2014"}
      unit="\u00b0C"
      showSpark={spark}
      hidden={hidden}
      spark={
        hist ? (
          <Sparkline
            data={[...(hist.temp ?? []), hot?.tempC ?? 0]}
            color={COLORS.hot}
            max={Math.max(70, peak)}
            height={20}
            className="spark-wrap"
          />
        ) : null
      }
      meta={
        <>
          <span className={hot && hot.tempC > 85 ? "hot" : ""}>
            {hot ? hot.label : t("none")}
          </span>
          <Sep />
          <span title={t("peak")}>{Math.round(peak)} \u00b0C</span>
        </>
      }
      details={
        <>
          {sorted.slice(0, 7).map((sensor) => (
            <KV key={sensor.id} k={sensor.label} v={temp(sensor.tempC, 1)} />
          ))}
        </>
      }
    />
  );
}
