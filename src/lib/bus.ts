//! Settings are shared between the widget window and the settings window.
//! Both windows keep their own React state; the plugin-store file is the
//! source of truth and every change is broadcast so the other window follows.

import { inTauri, type Settings } from "./settings";

type Apply = (settings: Settings) => void;

let applyRemote: Apply | null = null;

/** Remember who wants remote updates (the widget or the settings window). */
export function setRemoteTarget(apply: Apply | null) {
  applyRemote = apply;
}

export function publishSettings(settings: Settings) {
  if (!inTauri) return;
  void import("@tauri-apps/api/event")
    .then(({ emit }) => emit("settings://changed", settings))
    .catch(() => undefined);
}

export async function listenSettings(): Promise<() => void> {
  if (!inTauri) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Settings>("settings://changed", (event) => {
    applyRemote?.(event.payload);
  });
}
