import { inTauri } from "./telemetry";

/**
 * The menu-bar meter is drawn by us, not by AppKit: a canvas → PNG → tray icon
 * gives real SF glyphs, vector arrows, fixed advance widths (no jitter while
 * numbers change) and optional colour. The tray implementation scales the
 * bitmap to the 18 pt status-item height, so rendering at devicePixelRatio
 * means a 1:1 pixel match on retina displays.
 */

const HEIGHT_PT = 18;
/* Two lanes stacked inside the 18 pt status item, the way the system meters do
   it: half the width of a side-by-side readout and the eye finds "down" and
   "up" by position instead of by reading an arrow. */
const FONT_PT = 8.5;
const ARROW_PT = 6;
const GAP_ARROW = 1.5;
const GAP_SIDES = 3.5;
const LANE_CENTERS = [5.1, 13.2];
const FIELD_CHARS = 4;

const COLOR_DOWN = "#0a84ff";
const COLOR_UP = "#ff9f0a";

type Style = {
  colored: boolean;
  /** Menu bar appearance, so the plain text stays readable on both. */
  dark?: boolean;
};

let canvas: HTMLCanvasElement | null = null;
let lastSignature = "";

/** "842B" | "1.2K" | "12.4K" -> always exactly 4 characters, right aligned. */
export function rateField(bytesPerSec: number): string {
  const units = ["B", "K", "M", "G"];
  let value = Math.max(0, bytesPerSec);
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${text}${units[unit]}`.padStart(FIELD_CHARS, "\u2007");
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  up: boolean,
  dpr: number,
  color: string,
) {
  const height = 6.4 * dpr;
  const head = 3.1 * dpr;
  const width = 4.6 * dpr;
  const stem = 1.4 * dpr;
  const top = cy - height / 2;
  ctx.fillStyle = color;
  if (up) {
    ctx.fillRect(cx - stem / 2, top + head * 0.4, stem, height - head * 0.6);
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx - width / 2, top + head);
    ctx.lineTo(cx + width / 2, top + head);
  } else {
    ctx.fillRect(cx - stem / 2, top, stem, height - head * 0.6);
    ctx.beginPath();
    ctx.moveTo(cx, top + height);
    ctx.lineTo(cx - width / 2, top + height - head);
    ctx.lineTo(cx + width / 2, top + height - head);
  }
  ctx.closePath();
  ctx.fill();
}

export function renderMeter(
  down: number,
  up: number,
  style: Style,
): { png: string; text: string; width: number } {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 2));
  const height = Math.round(HEIGHT_PT * dpr);
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: true })!;

  const font = `590 ${Math.round(FONT_PT * dpr)}px "SF Mono", ui-monospace, Menlo, monospace`;
  ctx.font = font;
  const charWidth = ctx.measureText("0").width || 5 * dpr;
  const fieldWidth = charWidth * FIELD_CHARS;
  const arrowWidth = ARROW_PT * dpr;
  const textDown = rateField(down);
  const textUp = rateField(up);

  const width = Math.round(
    GAP_SIDES * dpr + arrowWidth + GAP_ARROW * dpr + fieldWidth + GAP_SIDES * dpr,
  );

  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // A template image is recoloured by AppKit, so black is the right ink there.
  // A coloured image keeps its own pixels and has to follow the menu bar.
  const ink = style.colored ? (style.dark === false ? "#000000" : "#ffffff") : "#000000";
  const lanes: { text: string; up: boolean; color: string; idle: boolean }[] = [
    { text: textDown, up: false, color: style.colored ? COLOR_DOWN : ink, idle: down < 512 },
    { text: textUp, up: true, color: style.colored ? COLOR_UP : ink, idle: up < 512 },
  ];

  lanes.forEach((lane, index) => {
    const cy = LANE_CENTERS[index] * dpr;
    // Almost idle links fade back so the active direction stands out.
    ctx.globalAlpha = lane.idle ? 0.45 : 1;
    drawArrow(ctx, GAP_SIDES * dpr + arrowWidth / 2, cy, lane.up, dpr, lane.color);
    ctx.fillStyle = ink;
    ctx.fillText(lane.text, GAP_SIDES * dpr + arrowWidth + GAP_ARROW * dpr, cy + 0.4 * dpr);
  });
  ctx.globalAlpha = 1;

  return { png: canvas.toDataURL("image/png"), text: `${textDown}/${textUp}`, width: width / dpr };
}

function base64ToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Redraw and push to the tray; skips the IPC when nothing changed. */
export async function pushTrayMeter(down: number, up: number, style: Style) {
  if (!inTauri) return;
  let rendered: { png: string; text: string; width: number };
  try {
    rendered = renderMeter(down, up, style);
  } catch (error) {
    console.error("tray meter render failed", error);
    return;
  }
  const signature = `${rendered.text}|${style.colored ? "c" : "t"}|${style.dark === false ? "l" : "d"}|${rendered.width}`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_image", {
      png: base64ToBytes(rendered.png),
      template: !style.colored,
    });
  } catch (error) {
    console.error("set_tray_image failed", error);
  }
}
