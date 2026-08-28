import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SettingsWindow from "./SettingsWindow";
import NetPanel from "./NetPanel";
import "./styles.css";
import { logLine } from "./lib/telemetry";

// Surface render problems in the terminal (FLASH_STATS_DEBUG=1).
window.addEventListener("error", (event) => {
  void logLine("error", `${event.message} @ ${event.filename}:${event.lineno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  void logLine("error", `unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`);
});

/* One bundle, two windows: the widget bar and the settings window differ by
   the query the Rust side puts in the URL. */
const view = new URLSearchParams(window.location.search).get("view");
const isSettings = view === "settings";
const isNet = view === "net";
if (isSettings) {
  document.documentElement.dataset.view = "settings";
  document.title = "Flash Stats";
}
if (isNet) {
  document.documentElement.dataset.view = "net";
  document.title = "Network";
}
const Root = isSettings ? SettingsWindow : isNet ? NetPanel : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Reveal only once the styled tree has actually been painted, so the bar never
// shows up as raw markup while the stylesheet is still on its way.
requestAnimationFrame(() =>
  requestAnimationFrame(() => document.documentElement.classList.add("ready")),
);
