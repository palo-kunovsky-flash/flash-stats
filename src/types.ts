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
  /** Where the busy time went, 0..=100 each (Activity Monitor's split). */
  user: number;
  system: number;
  idle: number;
  nice: number;
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
  /** Processes holding the most memory. */
  topProcesses: ProcessInfo[];
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

export type NetKind = "wifi" | "ethernet" | "vpn" | "bridge" | "other";

export interface NetProcess {
  name: string;
  pid: number;
  downBps: number;
  upBps: number;
}

export interface NetInterface {
  name: string;
  /** Hardware port name ("Wi-Fi", "Thunderbolt Bridge", …). */
  label: string;
  kind: NetKind;
  downBps: number;
  upBps: number;
  totalIn: number;
  totalOut: number;
  ipv4: string | null;
  active: boolean;
  isPrimary: boolean;
}

export interface NetInfo {
  downBps: number;
  upBps: number;
  totalIn: number;
  totalOut: number;
  primary: string;
  ipv4: string | null;
  /** Human name of the primary link. */
  primaryLabel: string;
  kind: NetKind;
  /** Wi-Fi network the primary link is joined to, when macOS discloses it. */
  ssid: string | null;
  /** Address the internet sees; null while unknown or switched off. */
  publicIp: string | null;
  /** macOS is withholding the Wi-Fi name for want of Location Services access. */
  ssidBlocked: boolean;
  /** Processes moving the most data right now. */
  topProcesses: NetProcess[];
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
