import { useEffect, useState } from "react";
import { inTauri } from "./telemetry";

/**
 * Whether this window is really on screen, as reported by the Rust side.
 *
 * `document.visibilityState` cannot answer this. The widget lives at the
 * desktop icon level, which macOS treats as occluded, so WebKit calls it hidden
 * the whole time it is plainly visible — gating the cards on it renders an
 * empty widget. Rust is the one place that knows: it owns show and hide.
 *
 * The default is `true`, so a missed event costs a little drawing rather than a
 * blank window.
 */
export function useVisible(event: string): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!inTauri) return;
    let stop: (() => void) | null = null;
    let disposed = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<boolean>(event, (message) => setVisible(message.payload)).then((fn) => {
        if (disposed) fn();
        else stop = fn;
      }),
    );
    return () => {
      disposed = true;
      stop?.();
    };
  }, [event]);
  return visible;
}
