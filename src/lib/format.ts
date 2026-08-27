export function bytes(value: number, digits = 1): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = Math.max(0, value);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} B`;
  return `${v.toFixed(v < 10 ? digits : 0)} ${units[i]}`;
}

/** 1376256 -> "1.31 MB/s" */
export function bps(bytesPerSec: number, digits = 2): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  let v = Math.max(0, bytesPerSec);
  let i = 0;
  while (v >= 999.5 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} B/s`;
  return `${v.toFixed(v < 10 ? digits : 1)} ${units[i]}`;
}

/** Same but squeezed for the menu bar / narrow rows: "1.3M" */
export function bpsShort(bytesPerSec: number): string {
  const units = ["", "K", "M", "G", "T"];
  let v = Math.max(0, bytesPerSec);
  let i = 0;
  while (v >= 999.5 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)}B`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[i]}`;
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function ghz(mhz: number): string {
  if (!mhz || mhz <= 0) return "—";
  return `${(mhz / 1000).toFixed(2)} GHz`;
}

export function temp(c: number | null | undefined, digits = 0): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return "—";
  return `${c.toFixed(digits)}°`;
}

export function duration(secs: number | null | undefined): string {
  if (!secs || secs <= 0 || !Number.isFinite(secs)) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}
