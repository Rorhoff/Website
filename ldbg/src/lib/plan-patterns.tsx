/** SVG pattern definitions for plan drawing textures. */

type PatternDefProps = { id: string };

export function ExistingHatchPattern({ id }: PatternDefProps) {
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width="8"
      height="8"
      patternTransform="rotate(45)"
    >
      <rect width="8" height="8" fill="#ffffff" opacity="0" />
      <line x1="0" y1="0" x2="0" y2="8" stroke="#999999" strokeWidth="0.8" opacity="0.45" />
    </pattern>
  );
}

export function TurfStipplePattern({ id }: PatternDefProps) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="12" height="12">
      <rect width="12" height="12" fill="#A8D5A2" opacity="0.15" />
      <circle cx="3" cy="3" r="0.8" fill="#5A9E5A" opacity="0.35" />
      <circle cx="9" cy="7" r="0.7" fill="#5A9E5A" opacity="0.3" />
      <circle cx="6" cy="10" r="0.6" fill="#4a8a4a" opacity="0.25" />
    </pattern>
  );
}

export function PaverRunningBondPattern({ id }: PatternDefProps) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="24" height="16">
      <rect width="24" height="16" fill="#B0B0B0" opacity="0.2" />
      <rect x="0" y="0" width="11" height="7" fill="#999" opacity="0.35" stroke="#777" strokeWidth="0.4" />
      <rect x="12" y="0" width="11" height="7" fill="#aaa" opacity="0.3" stroke="#777" strokeWidth="0.4" />
      <rect x="6" y="8" width="11" height="7" fill="#999" opacity="0.35" stroke="#777" strokeWidth="0.4" />
      <rect x="18" y="8" width="11" height="7" fill="#aaa" opacity="0.3" stroke="#777" strokeWidth="0.4" />
    </pattern>
  );
}

export function GravelPattern({ id }: PatternDefProps) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="10" height="10">
      <rect width="10" height="10" fill="#c4b8a8" opacity="0.2" />
      <circle cx="2" cy="4" r="1.1" fill="#9a9080" opacity="0.45" />
      <circle cx="7" cy="2" r="0.9" fill="#8a8070" opacity="0.4" />
      <circle cx="5" cy="8" r="1" fill="#a09888" opacity="0.4" />
      <circle cx="9" cy="6" r="0.7" fill="#8a8070" opacity="0.35" />
    </pattern>
  );
}

export function MulchPattern({ id }: PatternDefProps) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="14" height="14">
      <rect width="14" height="14" fill="#6b4f3a" opacity="0.15" />
      <ellipse cx="4" cy="5" rx="2" ry="1" fill="#5c4030" opacity="0.35" transform="rotate(-20 4 5)" />
      <ellipse cx="10" cy="9" rx="2.2" ry="1.1" fill="#4a3528" opacity="0.3" transform="rotate(15 10 9)" />
      <ellipse cx="7" cy="3" rx="1.5" ry="0.8" fill="#5c4030" opacity="0.28" />
    </pattern>
  );
}

export function WaterPattern({ id }: PatternDefProps) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="20" height="12">
      <rect width="20" height="12" fill="#5BA4D9" opacity="0.25" />
      <path
        d="M0 6 Q5 2 10 6 T20 6"
        fill="none"
        stroke="#2E6B9E"
        strokeWidth="0.6"
        opacity="0.45"
      />
      <path
        d="M0 10 Q5 7 10 10 T20 10"
        fill="none"
        stroke="#2E6B9E"
        strokeWidth="0.5"
        opacity="0.35"
      />
    </pattern>
  );
}

export function PlanPatternById({ id, patternId }: { id: string; patternId: string }) {
  switch (patternId) {
    case "existing-hatch":
      return <ExistingHatchPattern id={id} />;
    case "turf-stipple":
      return <TurfStipplePattern id={id} />;
    case "paver-running-bond":
      return <PaverRunningBondPattern id={id} />;
    case "gravel":
      return <GravelPattern id={id} />;
    case "mulch":
      return <MulchPattern id={id} />;
    case "water":
      return <WaterPattern id={id} />;
    default:
      return null;
  }
}

export function PlanPatternDefs() {
  return (
    <defs>
      <ExistingHatchPattern id="existing-hatch" />
      <TurfStipplePattern id="turf-stipple" />
      <PaverRunningBondPattern id="paver-running-bond" />
      <GravelPattern id="gravel" />
      <MulchPattern id="mulch" />
      <WaterPattern id="water" />

      <radialGradient id="tree-canopy-gradient" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#3d6b52" stopOpacity="0.55" />
        <stop offset="70%" stopColor="#2E6B4F" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#1B4332" stopOpacity="0.25" />
      </radialGradient>

      <filter id="plan-desaturate" colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values="0.33 0.33 0.33 0 0
                  0.33 0.33 0.33 0 0
                  0.33 0.33 0.33 0 0
                  0 0 0 1 0"
        />
      </filter>
    </defs>
  );
}

export function patternUrl(patternId?: string): string | undefined {
  if (!patternId) return undefined;
  return `url(#${patternId})`;
}
