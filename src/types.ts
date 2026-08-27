// Mirrors src-tauri/src/models.rs (serde camelCase).

export type SensorGroup = "cpu" | "gpu" | "memory" | "battery" | "airflow" | "other";

export interface Sensor {
  id: string;
  label: string;
  tempC: number;
  group: SensorGroup;
}

export interface CpuInfo {
  usage: number;
  cores: number[];
  coreKinds: string[];
  load1: number;
  load5: number;
  load15: number;
  freqMhz: number;
  maxFreqMhz: number;
  tempC: number | null;
  processes: number;
  uptimeSecs: number;
}

export interface GpuInfo {
  usage: number | null;
  renderer: number | null;
  tiler: number | null;
  allocatedBytes: number | null;
  inUseBytes: number | null;
  tempC: number | null;
}

export interface MemoryInfo {
  total: number;
  used: number;
  available: number;
  app: number;
  wired: number;
  compressed: number;
  /** Value of the compressed pool once unpacked. */
  uncompressed: number;
  cached: number;
  swapTotal: number;
  swapUsed: number;
  pressure: number;
}

export interface BatteryInfo {
  present: boolean;
  level: number;
  charging: boolean;
  acConnected: boolean;
  watts: number;
  voltageMv: number;
  amperageMa: number;
  tempC: number | null;
  health: number;
  cycles: number | null;
  designMah: number;
  nowMah: number;
  timeRemainingSecs: number | null;
}

export interface NetInterface {
  name: string;
  downBps: number;
  upBps: number;
  totalIn: number;
  totalOut: number;
  isPrimary: boolean;
}

export interface NetInfo {
  downBps: number;
  upBps: number;
  totalIn: number;
  totalOut: number;
  primary: string;
  ipv4: string | null;
  interfaces: NetInterface[];
}

export interface DiskInfo {
  readBps: number;
  writeBps: number;
  totalRead: number;
  totalWrite: number;
  totalSpace: number;
  freeSpace: number;
  name: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  /** Percent of a single core, like Activity Monitor. */
  cpu: number;
  memBytes: number;
  memPercent: number;
}

export interface Snapshot {
  tsMs: number;
  intervalMs: number;
  cpu: CpuInfo;
  gpu: GpuInfo;
  memory: MemoryInfo;
  battery: BatteryInfo;
  net: NetInfo;
  disk: DiskInfo;
  sensors: Sensor[];
  topProcesses: ProcessInfo[];
}

export interface Meta {
  chip: string;
  gpuName: string;
  macosVersion: string;
  hostname: string;
  effCoresFirst: boolean;
  arch: string;
  physicalCores: number;
  logicalCores: number;
  perfCores: number;
  effCores: number;
  totalMemory: number;
  hasBattery: boolean;
  appVersion: string;
  maxCpuFreqMhz: number;
  sensorLabels: string[];
}

export interface History {
  cpu: number[];
  gpu: number[];
  memory: number[];
  temp: number[];
  down: number[];
  up: number[];
  diskRead: number[];
  diskWrite: number[];
  battery: number[];
  watts: number[];
}

export const EMPTY_HISTORY: History = {
  cpu: [],
  gpu: [],
  memory: [],
  temp: [],
  down: [],
  up: [],
  diskRead: [],
  diskWrite: [],
  battery: [],
  watts: [],
};
