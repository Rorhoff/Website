import type { Project, ScaleVerification } from "@/lib/project-schema";
import { isGeoreferenced } from "@/lib/georef";

/** Pass when measured/expected is within this fraction of 1.0 (±2%). */
export const SCALE_VERIFY_TOLERANCE = 0.02;

export const PHOTOGRAMMETRY_DISCLAIMER =
  "Derived from aerial photogrammetry — not a boundary survey. Subject to verification.";

export function pixelDistanceFeet(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
  pixelsPerFoot: number
): number {
  const dx = (pointB.x - pointA.x) * imageWidth;
  const dy = (pointB.y - pointA.y) * imageHeight;
  return Math.hypot(dx, dy) / pixelsPerFoot;
}

export function evaluateScaleVerification(input: {
  description: string;
  pointA: { x: number; y: number };
  pointB: { x: number; y: number };
  expectedFeet: number;
  imageWidth: number;
  imageHeight: number;
  pixelsPerFoot: number;
}): ScaleVerification {
  const measuredFeet = pixelDistanceFeet(
    input.pointA,
    input.pointB,
    input.imageWidth,
    input.imageHeight,
    input.pixelsPerFoot
  );
  const ratio = measuredFeet / input.expectedFeet;
  const passed = Math.abs(ratio - 1) <= SCALE_VERIFY_TOLERANCE;

  return {
    description: input.description.trim(),
    pointA: input.pointA,
    pointB: input.pointB,
    expectedFeet: input.expectedFeet,
    measuredFeet,
    ratio,
    passed,
    verifiedAt: new Date().toISOString(),
  };
}

export function scaleVerificationPassed(project: Project): boolean {
  return project.scaleVerification?.passed === true;
}

/** Georeferenced WebODM projects must pass an independent scale check before export. */
export function requiresScaleVerification(project: Project): boolean {
  return isGeoreferenced(project);
}

export function canExportBoard(project: Project): {
  allowed: boolean;
  reason?: string;
} {
  if (!requiresScaleVerification(project)) {
    return { allowed: true };
  }

  const sv = project.scaleVerification;
  if (!sv) {
    return {
      allowed: false,
      reason:
        "Complete an independent scale verification before exporting (Addendum A2).",
    };
  }

  if (!sv.passed) {
    const pct = Math.abs(sv.ratio - 1) * 100;
    return {
      allowed: false,
      reason: `Scale check failed — measured ${sv.measuredFeet.toFixed(1)} ft vs expected ${sv.expectedFeet.toFixed(1)} ft (${pct.toFixed(1)}% off). Re-check your points or expected dimension.`,
    };
  }

  return { allowed: true };
}

export function formatScaleVerificationSummary(sv: ScaleVerification): string {
  const pct = (sv.ratio - 1) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sv.description}: expected ${sv.expectedFeet.toFixed(1)} ft, measured ${sv.measuredFeet.toFixed(1)} ft (${sign}${pct.toFixed(1)}%)`;
}
