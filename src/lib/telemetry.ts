import { useEffect, useRef, useState } from "react";
import type { History, Meta, Snapshot } from "../types";
import { EMPTY_HISTORY } from "../types";

export const MAX_POINTS = 180;

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Send frontend logs to the terminal when running under Tauri. */
export async function logLine(level: string, message: string) {
  if (!inTauri) {
    // eslint-disable-next-line no-console
    console.log(`[${level}] ${message}`);
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_line", { level, msg: message });
  } catch {
    /* logging must never break the UI */
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export type Telemetry = {
  snap: Snapshot | null;
  hist: History;
  meta: Meta | null;
  live: boolean;
};

/** Append one sample to every ring buffer, keeping the newest MAX_POINTS. */
function push(history: History, s: Snapshot): History {
  const add = (list: number[], value: number) => {
    const next = list.length >= MAX_POINTS ? list.slice(list.length - MAX_POINTS + 1) : list.slice();
    next.push(Number.isFinite(value) ? value : 0);
    return next;
  };
  return {
    cpu: add(history.cpu, s.cpu.usage),
    gpu: add(history.gpu, s.gpu.usage ?? 0),
    memory: add(history.memory, s.memory.total ? (s.memory.used / s.memory.total) * 100 : 0),
    temp: add(history.temp, s.cpu.tempC ?? 0),
    down: add(history.down, s.net.downBps),
    up: add(history.up, s.net.upBps),
    diskRead: add(history.diskRead, s.disk.readBps),
    diskWrite: add(history.diskWrite, s.disk.writeBps),
    battery: add(history.battery, s.battery.level),
    watts: add(history.watts, s.battery.watts),
  };
}

export function useTelemetry(intervalMs: number): Telemetry {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [hist, setHist] = useState<History>(EMPTY_HISTORY);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [live, setLive] = useState(inTauri);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    if (!inTauri) {
      // Plain browser (`npm run dev`): fake data so the design can be tuned.
      const tick = () => {
        const s = mockSnapshot();
        setSnap(s);
        setHist((h) => push(h, s));
      };
      tick();
      timer.current = window.setInterval(tick, Math.max(250, intervalMs));
      setMeta(mockMeta());
      return () => {
        if (timer.current) window.clearInterval(timer.current);
      };
    }

    void (async () => {
      try {
        const m = await call<Meta>("read_meta");
        const h = await call<History>("read_history");
        const s = await call<Snapshot>("sample_now");
        if (disposed) return;
        setMeta(m);
        setHist(h);
        setSnap(s);
        setLive(true);
      } catch (error) {
        console.error("telemetry bootstrap failed", error);
        setLive(false);
      }
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen<Snapshot>("telemetry", (event) => {
          setSnap(event.payload);
          setHist((prev) => push(prev, event.payload));
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) {
        console.error("subscription failed", error);
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [intervalMs]);

  return { snap, hist, meta, live };
}

// ------------------------------------------------------------------- mock

let phase = 0;
function wave(base: number, amp: number, speed = 1) {
  phase += 0.0001;
  const t = Date.now() / 1000;
  return Math.max(
    0,
    base + amp * (Math.sin(t * speed) * 0.6 + Math.sin(t * speed * 2.7 + 1.3) * 0.25 + Math.random() * 0.25),
  );
}

function mockMeta(): Meta {
  return {
    chip: "Apple M4",
    gpuName: "Apple M4",
    macosVersion: "26.6",
    hostname: "macbook",
    arch: "aarch64",
    physicalCores: 10,
    logicalCores: 10,
    perfCores: 4,
    effCores: 6,
    totalMemory: 34359738368,
    hasBattery: true,
    appVersion: "dev",
    effCoresFirst: true,
    maxCpuFreqMhz: 4512,
    sensorLabels: [],
  };
}

function mockSnapshot(): Snapshot {
  const cores = Array.from({ length: 10 }, (_, i) =>
    Math.min(100, wave(i < 4 ? 26 : 12, i < 4 ? 55 : 30, 0.6 + i * 0.11)),
  );
  const total = 34359738368;
  const used = total * (0.55 + 0.06 * Math.sin(Date.now() / 9000));
  const down = Math.max(0, wave(1.4e6, 6e6, 0.9));
  const up = Math.max(0, wave(1.8e5, 9e5, 1.4));
  return {
    tsMs: Date.now(),
    intervalMs: 1000,
    cpu: {
      usage: cores.reduce((a, b) => a + b, 0) / cores.length,
      cores,
      coreKinds: cores.map((_, i) => (i < 4 ? "performance" : "efficiency")),
      load1: 1.6 + Math.sin(Date.now() / 5000),
      load5: 1.4,
      load15: 1.2,
      freqMhz: 2200 + wave(600, 900),
      maxFreqMhz: 4512,
      tempC: 46 + wave(6, 9, 0.3),
      processes: 540,
      uptimeSecs: 3600 * 27 + 940,
      user: 18.4,
      system: 7.1,
      idle: 74.5,
      nice: 0,
    },
    gpu: {
      usage: wave(18, 45, 0.7),
      renderer: wave(15, 40, 0.8),
      tiler: wave(12, 30, 0.9),
      allocatedBytes: 2.2e9 + wave(4e8, 8e8),
      inUseBytes: 1.1e9,
      tempC: 48 + wave(5, 8, 0.3),
    },
    memory: {
      total,
      used,
      available: total - used,
      app: used * 0.62,
      wired: used * 0.24,
      compressed: used * 0.09,
      uncompressed: used * 0.32,
      cached: total * 0.18,
      swapTotal: 7e9,
      swapUsed: 1.2e9,
      pressure: 22 + wave(10, 20, 0.2),
      topProcesses: [
        { pid: 512, name: "WindowServer", cpu: 7.8, memBytes: 2.4e9, memPercent: 7.1 },
        { pid: 114, name: "Safari", cpu: 24.5, memBytes: 1.4e9, memPercent: 4.1 },
        { pid: 386, name: "Code Helper", cpu: 12.1, memBytes: 820e6, memPercent: 2.4 },
      ],
    },
    battery: {
      present: true,
      level: 74,
      charging: false,
      acConnected: false,
      watts: 8.4 + wave(1.5, 3, 0.5),
      voltageMv: 12420,
      amperageMa: -680,
      tempC: 31.4,
      health: 100,
      cycles: 28,
      designMah: 4629,
      nowMah: 3425,
      timeRemainingSecs: 4.5 * 3600,
    },
    net: {
      downBps: down,
      upBps: up,
      totalIn: 3.02e10,
      totalOut: 4.2e10,
      primary: "en0",
      ipv4: "10.1.1.127",
      primaryLabel: "Wi-Fi",
      kind: "wifi",
      ssid: "Kunovsky 5G",
      publicIp: "89.173.24.11",
      ssidBlocked: false,
      topProcesses: [
        { name: "Safari", pid: 114, downBps: 1.1e6, upBps: 84e3 },
        { name: "Spotify", pid: 902, downBps: 210e3, upBps: 9e3 },
        { name: "Dropbox", pid: 731, downBps: 41e3, upBps: 320e3 },
      ],
      interfaces: [
        {
          name: "en0",
          label: "Wi-Fi",
          kind: "wifi",
          downBps: down,
          upBps: up,
          totalIn: 3.02e10,
          totalOut: 4.2e10,
          ipv4: "10.1.1.127",
          active: true,
          isPrimary: true,
        },
      ],
    },
    topProcesses: [
      { pid: 114, name: "Safari", cpu: 24.5, memBytes: 1.4e9, memPercent: 4.1 },
      { pid: 386, name: "Code Helper", cpu: 12.1, memBytes: 820e6, memPercent: 2.4 },
      { pid: 512, name: "WindowServer", cpu: 7.8, memBytes: 640e6, memPercent: 1.9 },
      { pid: 240, name: "kernel_task", cpu: 3.2, memBytes: 320e6, memPercent: 0.9 },
    ],
    disk: {
      readBps: wave(2e5, 4e6, 1.1),
      writeBps: wave(6e5, 3e6, 0.8),
      totalRead: 8.4e11,
      totalWrite: 5.1e11,
      totalSpace: 994662584320,
      freeSpace: 4.1e11,
      name: "Macintosh HD",
    },
    sensors: [
      { id: "Tp01", label: "CPU 1", tempC: 48 + wave(4, 8, 0.4), group: "cpu" },
      { id: "Tp09", label: "CPU 2", tempC: 46 + wave(4, 8, 0.35), group: "cpu" },
      { id: "Tg04", label: "GPU", tempC: 47 + wave(4, 7, 0.3), group: "gpu" },
      { id: "Tm02", label: "Memory", tempC: 41 + wave(3, 4, 0.2), group: "memory" },
      { id: "TB0T", label: "Battery", tempC: 31 + wave(1, 1.5, 0.1), group: "battery" },
    ],
  };
}
