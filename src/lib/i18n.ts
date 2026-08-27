//! Tiny translation layer. English is the default, Slovak ships alongside it
//! and "auto" follows the system language.

import { createContext, useContext, useCallback } from "react";

export type Lang = "en" | "sk";
export type LanguagePref = "auto" | Lang;

/** [english, slovak] */
const STRINGS: Record<string, [string, string]> = {
  // widget bar
  settings: ["Settings", "Nastavenia"],
  widgetSize: ["Widget size", "Veľkosť widgetu"],
  hideWidget: ["Hide widget (⌘W)", "Skryť widget (⌘W)"],
  hoverDetails: ["Hover for details", "Prejdi myšou pre detaily"],

  // card titles
  cpu: ["CPU", "Procesor"],
  memory: ["Memory", "Pamäť"],
  gpu: ["GPU", "Grafika"],
  network: ["Network", "Sieť"],
  battery: ["Battery", "Batéria"],
  disk: ["Disk", "Disk"],
  temps: ["Temperatures", "Teploty"],

  // rows
  usage: ["Usage", "Využitie"],
  load: ["Load 1 / 5 / 15", "Priemer 1 / 5 / 15"],
  cores: ["Cores", "Jadrá"],
  peakFreq: ["Peak clock", "Frekvencia max"],
  processes: ["Processes", "Procesy"],
  hottest: ["Hottest processes", "Najžravejšie procesy"],
  sensors: ["Sensors", "Senzory"],
  temperature: ["Temperature", "Teplota"],
  memoryUsed: ["In use", "Používaná"],
  gpuMemory: ["Used by GPU", "Používaná GPU"],
  renderer: ["Renderer", "Renderer"],
  tiler: ["Tiler", "Tiler"],
  app: ["App", "Aplikácie"],
  wired: ["Wired", "Uzamknutá"],
  compressed: ["Compressed", "Zbalená"],
  cached: ["Cached", "Skladom"],
  swap: ["Swap", "Swap"],
  free: ["Free", "Voľné"],
  pressure: ["Pressure", "Tlak"],
  memoryActivity: ["Memory activity", "Aktivita pamäte"],
  batteryHealth: ["Battery health", "Zdravie batérie"],
  cycles: ["Cycles", "Cykly"],
  batteryTemp: ["Battery temperature", "Teplota batérie"],
  voltage: ["Voltage", "Napätie"],
  current: ["Current", "Prúd"],
  power: ["Power", "Výkon"],
  capacity: ["Capacity", "Kapacita"],
  state: ["State", "Stav"],
  charging: ["Charging", "Nabíja"],
  discharging: ["On battery", "Na batérii"],
  charged: ["Charged", "Nabité"],
  pluggedIn: ["Plugged in", "V sieti"],
  timeToEmpty: ["Time to empty", "Vybitie za"],
  timeToFull: ["Time to full", "Nabitie za"],
  totalDown: ["Total downloaded", "Celkom stiahnuté"],
  totalUp: ["Total uploaded", "Celkom odoslané"],
  interfaces: ["Interfaces", "Rozhrania"],
  address: ["IPv4 address", "IPv4 adresa"],
  read: ["Read", "Čítanie"],
  write: ["Write", "Zápis"],
  uptime: ["Uptime", "Chod"],
  hottestSensor: ["Hottest sensor", "Najteplejší senzor"],
  ofCapacity: ["of {value}", "z {value}"],

  cpuHint: ["load, clocks, hottest cores", "load, hodiny, najžravejšie jadrá"],
  memoryHint: ["compression and split", "kompresia a rozdelenie"],
  gpuHint: ["load and VRAM", "využitie a VRAM"],
  networkHint: ["rates and interfaces", "rýchlosti a rozhrania"],
  batteryHint: ["power draw and health", "príkon a zdravie"],
  diskHint: ["read and write", "čítanie a zápis"],
  tempsHint: ["all sensors in one place", "všetky snímače na jednom mieste"],
  lookLead: ["Colour scheme and how much glass shows through.", "Farebná schéma a priehľadnosť skla."],
  peak: ["peak", "max"],
  model: ["Model", "Model"],
  allocated: ["Allocated", "Alokovaná"],
  uncompressed: ["Uncompressed size", "Veľkosť po rozbalení"],
  total: ["Total", "Celkom"],
  sinceBoot: ["since boot", "od štartu"],
  none: ["none", "žiadne"],
  hottestOf: ["{name} right now", "práve teraz {name}"],
  avgFreq: ["average clock of busy cores", "priemerná frekvencia zatížených jadier"],
  acShort: ["AC", "sieť"],
  sideFoot: ["no root, no daemon", "bez rootu, bez démona"],
  // settings window
  anchor: ["Anchor", "Zakotvenie"],
  side: ["Side", "Strana"],
  sideRight: ["Right", "Vpravo"],
  sideLeft: ["Left", "Vľavo"],
  edge: ["Edge", "Hrana"],
  edgeTop: ["Top", "Hore"],
  edgeBottom: ["Bottom", "Dole"],
  slot: ["Grid slot", "Slot mriežky"],
  slotHint: ["rows down from the corner", "riadkov pod rohom"],
  snap: ["Snap to grid", "Zarovnať na mriežku"],
  snapHint: ["8 px lattice while dragging", "zarovnáva ťahanie na 8 px"],
  placeNow: ["Place on the grid", "Umiestniť na mriežku"],
  gridLead: ["The widget lands on a slot of the grid, like the system widgets.", "Widget dosadne na slot mriežky, ako systémové widgety."],

  tempUnit: ["Temperature unit", "Jednotka teploty"],

  orderHint: ["click the arrows to reorder the cards", "šipkami zoradíš karty"],
  moveUp: ["Move up", "Posunúť hore"],
  moveDown: ["Move down", "Posunúť dole"],

  auto: ["Auto", "Auto"],
  blur: ["Blur", "Rozostrenie"],
  cards: ["Cards", "Karty"],
  chip: ["Processor", "Procesor"],
  coloured: ["Coloured", "Farebný"],
  colouredHint: ["off = monochrome, follows the bar", "vypnuté = čiernobiele, prispôsobí sa lište"],
  coresOf: ["{perf} efficiency + {perf2} performance", "{perf} úsporné + {perf2} výkonové"],
  desktopMode: ["On the desktop", "Na ploche"],
  floatingMode: ["On top of windows", "Navrchu"],
  frequency: ["Rate", "Frekvencia"],
  graphics: ["Graphics", "Grafika"],
  hardwareLead: ["Hardware and data sources.", "Hardvér a zdroje dát."],
  hoverExtras: ["Details on hover", "Detaily po prejdení myšou"],
  language: ["Language", "Jazyk"],
  miniCharts: ["Mini charts", "Mini grafy"],
  netMeter: ["Network meter", "Meter siete"],
  opacity: ["Opacity", "Priehľadnosť"],
  position: ["Position", "Pozícia"],
  positionHint: ["drag the bar to move it", "presuň myšou, uloží sa automaticky"],
  preview: ["Preview in the bar", "Náhľad v lište"],
  ram: ["Memory", "Pamäť"],
  reposition: ["Back to top right", "Vrátiť doprava nahor"],
  samplingHint: ["temperatures read every third tick", "teploty sa čítajú každým tretím tickom"],
  samplingLead: ["How often sensors are read.", "Ako často sa čítajú senzory."],
  shortcut: ["Shortcut", "Skratka"],
  shortcutHint: ["hides / shows the widget", "skryje / ukáže widget"],
  sources: ["Data: IOKit (GPU, battery), IOHID (temperatures), host_statistics64 (memory), sysinfo (CPU, network, disks). No sudo, no daemon.", "Dáta: IOKit (GPU, batéria), IOHID (teploty), host_statistics64 (pamäť), sysinfo (CPU, siete, disky). Bez sudo, bez démona."],
  theme: ["Theme", "Téma"],
  themeDark: ["Dark", "Tmavá"],
  themeLight: ["Light", "Svetlá"],
  trayLead: ["Network rates next to the clock.", "Rýchlosti siete vedľa hodín."],
  wallpaperMode: ["Behind the icons", "Za ikonami"],
  width: ["Width", "Šírka"],
  windowMode: ["Plain window", "Okno"],
  settingsTitle: ["Settings", "Nastavenia"],
  paneWidget: ["Widget", "Widget"],
  paneLook: ["Appearance", "Vzhľad"],
  paneTray: ["Menu bar", "Lišta"],
  paneSampling: ["Sampling", "Odber"],
  paneTemps: ["Temperatures", "Teploty"],
  paneAbout: ["About", "Info"],
  widgetLead: ["Where it sits, how wide, what is inside.", "Kde sedí, aký je široký, čo je vnútri."],
  placement: ["Placement", "Umiestnenie"],
  mode: ["Mode", "Režim"],
  modeHint: ["desktop level: stays for show desktop, travels with the desktop", "patrí k ploche: viditeľné pri zobrazení plochy, v Mission Control sa hýbe s ňou"],
  quit: ["Quit", "Ukončiť"],
  shortcutFooter: ["Shortcut {keys}", "Skratka {keys}"],
  coresFooter: ["{count} cores", "{count} jadier"],
  noSensors: ["No data — start the widget.", "Žiadne dáta — spusti widget."],
};

export const LangContext = createContext<Lang>("en");

export function resolveLanguage(pref: LanguagePref, system: string): Lang {
  if (pref === "en" || pref === "sk") return pref;
  return system.toLowerCase().startsWith("sk") ? "sk" : "en";
}

export function translate(
  lang: Lang,
  key: keyof typeof STRINGS | string,
  vars?: Record<string, string | number>,
): string {
  const pair = STRINGS[key];
  let text = pair ? (lang === "sk" ? pair[1] : pair[0]) : key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export function useT() {
  const lang = useContext(LangContext);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
}

export function useLang() {
  return useContext(LangContext);
}
