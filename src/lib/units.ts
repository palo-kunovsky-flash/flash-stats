//! Temperature unit. Sensors are always collected in °C and converted only at
//! the moment they are shown, so sparkline scales and thresholds stay stable.

import { createContext, useContext } from "react";

export type TempUnit = "c" | "f";

export const UnitContext = createContext<TempUnit>("c");

export function toUnit(c: number, unit: TempUnit): number {
  return unit === "f" ? (c * 9) / 5 + 32 : c;
}

export function tempIn(c: number | null | undefined, unit: TempUnit, digits = 0): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return "—";
  return `${toUnit(c, unit).toFixed(digits)}°${unit.toUpperCase()}`;
}

/** Formatter bound to the configured unit. */
export function useTemp() {
  const unit = useContext(UnitContext);
  return (c: number | null | undefined, digits = 0) => tempIn(c, unit, digits);
}

/** Threshold comparison helper: thresholds in the code are written in °C. */
export function useHot() {
  // Limits in the code are written in °C, values arrive in °C.
  return (c: number | null | undefined, celsiusLimit: number) =>
    c !== null && c !== undefined && c >= celsiusLimit;
}

/** The configured unit itself, for places that print number and unit apart. */
export function useTempUnit(): TempUnit {
  return useContext(UnitContext);
}
