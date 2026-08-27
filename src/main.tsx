import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { logLine } from "./lib/telemetry";

// Surface render problems in the terminal (FLASH_STATS_DEBUG=1).
window.addEventListener("error", (event) => {
  void logLine("error", `${event.message} @ ${event.filename}:${event.lineno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  void logLine("error", `unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
