/**
 * The popover behind the menu-bar meter. Clicking the meter used to hide the
 * desktop widget, which is never what someone poking at a network readout
 * wants; it now opens this panel right under the status item instead.
 */
import { useEffect, useRef } from "react";
import { Sparkline } from "./components/Sparkline";
import { Copyable, ProcList, linkName } from "./components/widgets";
import { bps, bytes, clamp } from "./lib/format";
import { LangContext, translate } from "./lib/i18n";
import { useSettings } from "./lib/settings";
import { inTauri, useTelemetry } from "./lib/telemetry";

const WIDTH = 320;

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="nrow">
      <span className="k">{k}</span>
      <span className="v num">{v}</span>
    </div>
  );
}

export default function NetPanel() {
  const { settings, lang } = useSettings();
  const t = (key: string) => translate(lang, key);
  const { snap, hist } = useTelemetry(settings.intervalMs);

  // The window is built hidden on the first click and only shown once this
  // has painted — otherwise the click lands on a webview that is still loading
  // and the panel appears as unstyled markup.
  const announced = useRef(false);
  useEffect(() => {
    if (!inTauri || announced.current) return;
    announced.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void import("@tauri-apps/api/core").then(({ invoke }) =>
          invoke("show_net_panel").catch(() => undefined),
        );
      }),
    );
  }, []);

  // The panel hugs its content, the same way the widget does — but only when
  // the content really changed height. Resizing on a timer regardless meant an
  // IPC call twice a second and a window that never quite settled.
  const lastHeight = useRef(0);
  useEffect(() => {
    if (!inTauri) return;
    const fit = async () => {
      const shell = document.querySelector<HTMLElement>(".netpanel");
      if (!shell) return;
      const height = Math.max(160, Math.ceil(shell.getBoundingClientRect().height));
      if (Math.abs(height - lastHeight.current) < 1) return;
      lastHeight.current = height;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await getCurrentWindow().setSize(new LogicalSize(WIDTH, height));
    };
    void fit();
    const timer = window.setInterval(() => void fit(), 500);
    return () => window.clearInterval(timer);
  }, [snap]);

  // Same check the widget runs on its cards: a value that does not fit is
  // reported rather than silently shortened with an ellipsis.
  useEffect(() => {
    if (!inTauri || !snap) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!(await invoke<boolean>("audit_enabled"))) return;
      const short = [...document.querySelectorAll<HTMLElement>(".nrow .v, .copy .ctext, .ntitle")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map(
          (el) =>
            `«${el.textContent?.slice(0, 18)}» ${el.scrollWidth}>${el.clientWidth}`,
        );
      const shell = document.querySelector<HTMLElement>(".netpanel");
      await invoke("log_line", {
        level: "ui",
        msg:
          `net panel: ${Math.round(shell?.getBoundingClientRect().width ?? 0)}x` +
          `${Math.round(shell?.getBoundingClientRect().height ?? 0)}px, ` +
          `rows ${document.querySelectorAll(".nrow").length}, ` +
          `truncated ${short.length ? short.join(" ") : "none"}`,
      });
    })();
  }, [snap]);

  const n = snap?.net;
  const links = n ? n.interfaces.filter((i) => i.active || i.isPrimary) : [];
  const peak = Math.max(
    32 * 1024,
    ...hist.down,
    ...hist.up,
    n?.downBps ?? 0,
    n?.upBps ?? 0,
  );

  return (
    <LangContext.Provider value={lang}>
      <div className="netpanel">
        <header className="nhead">
          <span className="ntitle">
            {n ? linkName(t, n.kind, n.primaryLabel, n.ssid) : t("noNetwork")}
          </span>
          <span className="nkind">{n ? n.primary : ""}</span>
        </header>

        {n ? (
          <>
            <div className="nrates">
              <div className="nrate">
                <span className="arrow down">↓</span>
                <span className="num big">{bps(n.downBps, 1)}</span>
                <span className="bar">
                  <i style={{ transform: `scaleX(${clamp(n.downBps / peak, 0.015, 1)})` }} />
                </span>
              </div>
              <div className="nrate up">
                <span className="arrow up">↑</span>
                <span className="num big">{bps(n.upBps, 1)}</span>
                <span className="bar">
                  <i style={{ transform: `scaleX(${clamp(n.upBps / peak, 0.015, 1)})` }} />
                </span>
              </div>
            </div>

            <div className="chart">
              <div className="clegend">
                <span className="ckey">
                  <i style={{ background: "var(--down)" }} />
                  {t("down")}
                </span>
                <span className="cval num">{bps(n.downBps, 1)}</span>
              </div>
              <Sparkline data={hist.down} color="var(--down)" height={30} className="spark-wrap" />
            </div>
            <div className="chart">
              <div className="clegend">
                <span className="ckey">
                  <i style={{ background: "var(--up)" }} />
                  {t("up")}
                </span>
                <span className="cval num">{bps(n.upBps, 1)}</span>
              </div>
              <Sparkline data={hist.up} color="var(--up)" height={22} className="spark-wrap" />
            </div>

            <div className="nrows">
              {n.kind === "wifi" ? (
                <Row
                  k={t("wifiNetwork")}
                  v={
                    n.ssid ? (
                      <Copyable value={n.ssid} />
                    ) : (
                      t(n.ssidBlocked ? "ssidBlocked" : "ssidHidden")
                    )
                  }
                />
              ) : null}
              <Row k={t("link")} v={n.primaryLabel} />
              <Row k={t("interfaceRow")} v={n.primary} />
              <Row k={t("localIp")} v={<Copyable value={n.ipv4} />} />
              <Row k={t("publicIp")} v={<Copyable value={n.publicIp} />} />
              <Row k={`${t("total")} ↓`} v={bytes(n.totalIn, 1)} />
              <Row k={`${t("total")} ↑`} v={bytes(n.totalOut, 1)} />
            </div>

            {/* Same component and the same fixed row count as the widget card:
                a list that changes length resizes this window every few
                seconds, which is what made the panel twitch. */}
            <div className="subhead">{t("topTalkers")}</div>
            <ProcList
              empty={t("noTraffic")}
              slots={5}
              rows={n.topProcesses.map((p) => ({
                key: p.pid,
                name: p.name,
                a: `↓ ${bps(p.downBps, 0)}`,
                b: `↑ ${bps(p.upBps, 0)}`,
                title: `PID ${p.pid}`,
              }))}
            />

            {links.length > 1 ? (
              <>
                <div className="subhead">{t("activeLinks")}</div>
                <div className="nrows">
                  {links.map((i) => (
                    <Row
                      key={i.name}
                      k={`${i.isPrimary ? "▸ " : ""}${i.label}`}
                      v={`↓${bps(i.downBps)} ↑${bps(i.upBps)}`}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div className="nempty">{t("noNetwork")}</div>
        )}

        <footer className="nfoot">{t("netPanelHint")}</footer>
      </div>
    </LangContext.Provider>
  );
}
