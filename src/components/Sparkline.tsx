import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type Props = {
  data: number[];
  color: string;
  height?: number;
  /** Upper bound; omit to autoscale with a slow-falling peak. */
  max?: number;
  min?: number;
  fill?: boolean;
  className?: string;
  /** Fixed number of points to display (pads on the left). */
  window?: number;
};

/** Catmull-Rom -> cubic bezier, so 1 Hz samples still read as a smooth curve. */
function smoothPath(points: [number, number][], tension = 0.35): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Sparkline({
  data,
  color,
  height = 26,
  max,
  min = 0,
  fill = true,
  className,
  window: windowPoints,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const peak = useRef(1);

  // Ease the autoscale ceiling: jump up immediately, sink back slowly.
  const dataMax = useMemo(() => data.reduce((a, b) => Math.max(a, b), 0), [data]);
  useEffect(() => {
    if (max !== undefined) return;
    peak.current = Math.max(dataMax * 1.15, peak.current * 0.92, 1e-6);
  }, [dataMax, max]);

  const hi = max !== undefined ? max : Math.max(peak.current, dataMax * 1.05);
  const span = Math.max(hi - min, 1e-6);

  const points = useMemo<[number, number][]>(() => {
    if (width <= 0 || data.length === 0) return [];
    const shown = windowPoints ? data.slice(-windowPoints) : data;
    const n = shown.length;
    const pad = 1;
    return shown.map((value, i) => {
      const x = n === 1 ? width : (i / (n - 1)) * width;
      const ratio = Math.min(1, Math.max(0, (value - min) / span));
      const y = height - pad - ratio * (height - pad * 2);
      return [x, y];
    });
  }, [data, width, height, span, min, windowPoints]);

  const line = smoothPath(points);
  const area = line ? `${line} L ${width} ${height} L 0 ${height} Z` : "";
  const last = points[points.length - 1];

  return (
    <div ref={ref} className={className} style={{ height }} aria-hidden>
      {width > 0 && line ? (
        <svg width={width} height={height} className="spark">
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.42" />
              <stop offset="55%" stopColor={color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill ? <path d={area} fill={`url(#g${id})`} /> : null}
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.95"
          />
          {last ? <circle cx={last[0]} cy={last[1]} r="1.9" fill={color} /> : null}
        </svg>
      ) : null}
    </div>
  );
}
