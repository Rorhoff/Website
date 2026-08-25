import type { LegendEntry } from "@/config/legend";

const FALLBACK = {
  fill: "rgba(148, 163, 184, 0.45)",
  stroke: "#64748b",
  strokeWidth: 1.5,
  opacity: 1,
};

export function styleForFeatureType(
  featureType: string,
  legend: LegendEntry[],
  existing: boolean
): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
} {
  if (existing || featureType.startsWith("existing")) {
    return {
      fill: "rgba(100, 116, 139, 0.35)",
      stroke: "#475569",
      strokeWidth: 1.5,
      opacity: 1,
    };
  }
  const entry = legend.find((e) => e.featureType === featureType);
  if (!entry) return FALLBACK;
  const rs = entry.renderStyle;
  return {
    fill: rs.fill === "none" ? "transparent" : rs.fill,
    stroke: rs.stroke,
    strokeWidth: rs.strokeWidth ?? 1.5,
    opacity: rs.opacity ?? 0.75,
  };
}

export function labelForFeatureType(featureType: string, legend: LegendEntry[]): string {
  const entry = legend.find((e) => e.featureType === featureType);
  if (entry) return entry.label;
  return featureType.replace(/_/g, " ");
}
