import { inTauri, logLine } from "./telemetry";
import type { Presentation } from "./settings";

/**
 * Window plumbing for a widget: it hugs its content (no scrollbars ever),
 * remembers where the user dropped it and can sit on the desktop itself.
 */

const SHELL_PADDING = 10;

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

export async function resizeToContent(width: number): Promise<number> {
  if (!inTauri) return measureHeight();
  const height = measureHeight();
  if (height <= 0) return 0;
  try {
    const win = await getWindow();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(width, height));
  } catch (error) {
    void logLine("error", `resize failed: ${error}`);
  }
  return height;
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
