import type { ReactNode } from "react";

export function Row({
  name,
  hint,
  children,
}: {
  name: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="crow">
      <div className="crow-label">
        <span>{name}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div className="crow-control">{children}</div>
    </div>
  );
}

export function Group({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="group">
      {title ? <h3>{title}</h3> : null}
      <div className="box">{children}</div>
    </section>
  );
}

export function Switch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      className={`switch ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <b>
        {value}
        {suffix ?? ""}
      </b>
    </label>
  );
}

export function prettyKeys(shortcut: string): string {
  const map: Record<string, string> = {
    alt: "\u2325",
    option: "\u2325",
    command: "\u2318",
    cmd: "\u2318",
    super: "\u2318",
    control: "\u2303",
    ctrl: "\u2303",
    shift: "\u21e7",
  };
  return shortcut
    .split("+")
    .map((part) => map[part.trim().toLowerCase()] ?? part.trim().toUpperCase())
    .join("");
}
