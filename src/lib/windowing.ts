import { inTauri, logLine } from "./telemetry";
import type { Monitor } from "@tauri-apps/api/window";
import type { Anchor, Presentation } from "./settings";

/**
 * Window plumbing for a widget: it hugs its content (no scrollbars ever),
 * remembers where the user dropped it and can sit on the desktop itself.
 */

const SHELL_PADDING = 10;

/* Moves the widget makes on its own (fitting the content, landing on the grid)
   arrive as ordinary "window moved" events. Saving those as if the user had
   dragged the window is what made the widget crawl across the screen a few
   pixels at a time, so they are marked and ignored. */
let quietUntil = 0;

export function markProgrammaticMove(ms = 600) {
  quietUntil = Date.now() + ms;
}

export function isProgrammaticMove(): boolean {
  return Date.now() < quietUntil;
}

export async function getWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Natural height of the widget: bar + visible cards + paddings. */
export function measureHeight(): number {
  const shell = document.querySelector<HTMLElement>(".shell");
  const bar = document.querySelector<HTMLElement>(".bar");
  const stack = document.querySelector<HTMLElement>(".stack");
  if (!shell || !bar || !stack) return 0;
  const style = getComputedStyle(shell);
  const stackStyle = getComputedStyle(stack);
  const gap = parseFloat(stackStyle.rowGap || "0") || 0;
  const pads =
    (parseFloat(style.paddingTop) || 0) +
    (parseFloat(style.paddingBottom) || 0) +
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.borderBottomWidth) || 0);
  let total = pads + bar.offsetHeight + gap;
  let seen = 0;
  for (const child of Array.from(stack.children) as HTMLElement[]) {
    if (getComputedStyle(child).display === "none") continue;
    total += child.offsetHeight;
    seen += 1;
  }
  if (seen > 1) total += gap * (seen - 1);
  return Math.max(120, Math.ceil(total) + SHELL_PADDING);
}

/**
 * Fit the window to its content while the anchored corner stays exactly where
 * it is. AppKit resizes a window around its bottom-left origin, so a card that
 * opens or a wider widget used to push the top-right corner around; the window
 * is put back on the anchor right after the resize.
 */
export async function resizeToContent(
  width: number,
  anchor?: Anchor,
  topInset = 0,
): Promise<number> {
  if (!inTauri) return measureHeight();
  const natural = measureHeight();
  if (natural <= 0) return 0;
  try {
    const win = await getWindow();
    const { LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/dpi");
    // Never taller than the screen it is on: an expanded card used to push the
    // widget past the bottom edge, where the rest of it simply could not be
    // read. Capped, the card stack scrolls instead.
    const height = Math.min(natural, await availableHeight(topInset));
    const before = await win.outerPosition().catch(() => null);
    const sizeBefore = await win.outerSize().catch(() => null);
    markProgrammaticMove();
    await win.setSize(new LogicalSize(width, height));
    const after = await win.outerPosition().catch(() => null);
    const sizeAfter = await win.outerSize().catch(() => null);
    if (before && after && sizeBefore && sizeAfter) {
      // Keep the corner the widget is anchored to, not always the top left.
      const keepRight = anchor?.endsWith("right") ?? false;
      const keepBottom = anchor?.startsWith("bottom") ?? false;
      const x = keepRight
        ? before.x + sizeBefore.width - sizeAfter.width
        : before.x;
      const y = keepBottom
        ? before.y + sizeBefore.height - sizeAfter.height
        : before.y;
      if (x !== after.x || y !== after.y) {
        markProgrammaticMove();
        await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      }
    }
  } catch (error) {
    void logLine("error", `resize failed: ${error}`);
  }
  return Math.min(natural, await availableHeight(topInset));
}

/** Usable height in logical px on the display the widget is on. */
async function availableHeight(topInset: number): Promise<number> {
  try {
    const win = await getWindow();
    const { currentMonitor, primaryMonitor } = await import("@tauri-apps/api/window");
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    if (!monitor) return Number.MAX_SAFE_INTEGER;
    const scale = monitor.scaleFactor || (await win.scaleFactor());
    return Math.max(
      MIN_HEIGHT,
      monitor.size.height / scale - topInset - MENU_BAR_GAP - EDGE_MARGIN * 2,
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Grid step in physical px for the display the widget is on. */
export async function gridStep(): Promise<number> {
  if (!inTauri) return GRID;
  try {
    const win = await getWindow();
    const scale = await win.scaleFactor();
    return Math.max(1, Math.round(GRID * scale));
  } catch {
    return GRID;
  }
}

/** Lattice the widget snaps to, in logical px — same idea as the system grid. */
export const GRID = 8;
/** Gap between two stacked slots, in logical px. */
export const SLOT_GAP = 16;
/** Distance from the screen edge, in logical px. */
const EDGE_MARGIN = 20;
/** Extra air under the menu bar for the top row, so the drag strip of the
    widget never ends up tucked against (or behind) the bar. */
const MENU_BAR_GAP = 12;
/** However small the screen, the widget stays usable. */
const MIN_HEIGHT = 160;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * Put the widget on its grid slot: against the chosen corner, `slot` rows down,
 * one row being the widget's own height plus the gap. Works in physical px, the
 * way window positions do, and clamps so the widget can never end up off screen.
 */
export async function placeOnGrid(options: {
  anchor: Anchor;
  slot: number;
  width: number;
  height: number;
  /** Recovery: jump back to the display with the menu bar. */
  preferPrimary?: boolean;
  /** Menu bar height in logical px, so a top slot starts under it. */
  topInset?: number;
}): Promise<{ x: number; y: number } | null> {
  if (!inTauri) return null;
  try {
    const { availableMonitors, getCurrentWindow } = await import("@tauri-apps/api/window");
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    const win = await getCurrentWindow();
    const monitors = await availableMonitors();
    if (!monitors.length) return null;
    // Stay on the display the widget is on now.
    const here = await win.outerPosition().catch(() => null);
    const { primaryMonitor } = await import("@tauri-apps/api/window");
    const primary = await primaryMonitor().catch(() => null);
    // The display the widget overlaps the most. Probing a single point was not
    // enough: at the edge of two displays, or right after Mission Control moved
    // the window, it answered with a different screen and the widget jumped.
    const size = await win.outerSize().catch(() => null);
    let current: Monitor | null = null;
    if (here && size) {
      let best = 0;
      for (const candidate of monitors) {
        const overlap =
          Math.max(
            0,
            Math.min(here.x + size.width, candidate.position.x + candidate.size.width) -
              Math.max(here.x, candidate.position.x),
          ) *
          Math.max(
            0,
            Math.min(here.y + size.height, candidate.position.y + candidate.size.height) -
              Math.max(here.y, candidate.position.y),
          );
        if (overlap > best) {
          best = overlap;
          current = candidate;
        }
      }
    }
    // Recovery placement goes to the display with the menu bar — when the
    // widget is buried or parked on a screen that is switched off, that is the
    // one the user is actually looking at.
    const monitor = ((options.preferPrimary ? primary : current) ??
      current ??
      primary ??
      monitors[0]) as Monitor;
    const scale = monitor.scaleFactor;
    const left = monitor.position.x;
    const top = monitor.position.y;
    const right = left + monitor.size.width;
    const bottom = top + monitor.size.height;
    const margin = Math.round(EDGE_MARGIN * scale);
    const width = Math.round(options.width * scale);
    const height = Math.round(options.height * scale);
    const pitch = height + Math.round(SLOT_GAP * scale);
    const x = options.anchor.endsWith("right")
      ? right - width - margin
      : left + margin;
    // The menu bar belongs to the topmost display; a top slot must start under
    // it, otherwise the widget sits behind the bar and its top row is unreadable.
    const menuBarScreen = monitors.every((m) => monitor.position.y <= m.position.y);
    const topInset = options.anchor.startsWith("top") && menuBarScreen
      ? Math.round(((options.topInset ?? 0) + MENU_BAR_GAP) * scale)
      : 0;
    const rawY = options.anchor.startsWith("top")
      ? top + topInset + margin + options.slot * pitch
      : bottom - height - margin - options.slot * pitch;
    // Clamp on both axes: whatever the monitor arrangement or the scale factor
    // reports, the widget must stay fully visible.
    const clamp = (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), Math.max(low, high));
    const boundX = [left + margin, Math.max(left + margin, right - width - margin)] as const;
    const boundY = [top + margin, Math.max(top + margin, bottom - height - margin)] as const;
    // Snapping happens inside the bounds, never across them.
    const point = {
      x: clamp(snapToGrid(x), boundX[0], boundX[1]),
      y: clamp(snapToGrid(rawY), boundY[0], boundY[1]),
    };
    markProgrammaticMove();
    await win.setPosition(new PhysicalPosition(point.x, point.y));
    void logLine(
      "ui",
      `grid: monitor ${monitor.name ?? "?"} ${monitor.position.x},${monitor.position.y} ` +
        `${monitor.size.width}x${monitor.size.height}@${scale} topInset ${topInset} -> ` +
        `${point.x},${point.y} ` +
        `(slot ${options.slot}, ${options.anchor}, ${options.width}x${Math.round(options.height)})`,
    );
    return point;
  } catch (error) {
    void logLine("error", `grid placement failed: ${error}`);
    return null;
  }
}

/** First run: park the widget in the top-right corner, under the menu bar. */
export async function placeTopRight(width: number) {
  if (!inTauri) return null;
  try {
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const win = await getWindow();
    const monitor = await currentMonitor();
    if (!monitor) return null;
    const scale = monitor.scaleFactor;
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    const x = Math.round(
      monitor.position.x + monitor.size.width * scale - width * scale - 20 * scale,
    );
    const y = Math.round(monitor.position.y + 30 * scale);
    await win.setPosition(new PhysicalPosition(x, y));
    return { x, y };
  } catch (error) {
    void logLine("error", `placement failed: ${error}`);
    return null;
  }
}

export async function moveWindowTo(position: { x: number; y: number }) {
  if (!inTauri) return;
  try {
    const win = await getWindow();
    const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
    markProgrammaticMove();
    await win.setPosition(new PhysicalPosition(position.x, position.y));
  } catch (error) {
    void logLine("error", `move failed: ${error}`);
  }
}

export async function watchMoves(onMoved: (pos: { x: number; y: number }) => void) {
  if (!inTauri) return () => undefined;
  try {
    const win = await getWindow();
    return await win.onMoved(({ payload }) => onMoved({ x: payload.x, y: payload.y }));
  } catch (error) {
    void logLine("error", `move watcher failed: ${error}`);
    return () => undefined;
  }
}

export async function applyPresentation(mode: Presentation) {
  if (!inTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_presentation", { mode });
  } catch (error) {
    void logLine("error", `presentation failed: ${error}`);
  }
}

/**
 * A remembered position can be nonsense: a disconnected display, or a move
 * event fired by the Mission Control animation. Only points that are really on
 * a screen are trusted, otherwise the widget would be placed off-screen and
 * look like it vanished.
 */
export async function onScreen(position: { x: number; y: number }): Promise<boolean> {
  if (!inTauri) return true;
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
    const monitors = await availableMonitors();
    return monitors.some((monitor) => {
      const left = monitor.position.x;
      const top = monitor.position.y;
      const right = left + monitor.size.width;
      const bottom = top + monitor.size.height;
      return (
        position.x > left - 40 &&
        position.x < right - 80 &&
        position.y > top - 20 &&
        position.y < bottom - 40
      );
    });
  } catch (error) {
    void logLine("error", `position check failed: ${error}`);
    return false;
  }
}
