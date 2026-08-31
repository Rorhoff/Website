/** Inline SVG plant illustrations — work in PDF export (no external URLs). */

type Props = {
  featureType?: string;
  fill?: string;
  stroke?: string;
  className?: string;
};

function TreeSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <ellipse cx="50" cy="38" rx="28" ry="24" fill={fill} stroke={stroke} strokeWidth="2" />
      <ellipse cx="42" cy="32" rx="14" ry="12" fill={fill} opacity="0.85" />
      <rect x="46" y="52" width="8" height="16" fill="#6B5344" />
    </>
  );
}

function ShrubSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <ellipse cx="50" cy="42" rx="30" ry="22" fill={fill} stroke={stroke} strokeWidth="2" />
      <ellipse cx="38" cy="38" rx="12" ry="10" fill={fill} opacity="0.9" />
      <ellipse cx="62" cy="40" rx="10" ry="9" fill={fill} opacity="0.9" />
    </>
  );
}

function GrassSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <path
        d="M20 58 Q28 20 36 58 M44 58 Q52 18 60 58 M68 58 Q76 22 84 58"
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M18 58 H82" stroke={fill} strokeWidth="4" strokeLinecap="round" />
    </>
  );
}

function FlowerSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <circle cx="50" cy="36" r="10" fill={fill} stroke={stroke} strokeWidth="1.5" />
      {[0, 72, 144, 216, 288].map((deg) => (
        <ellipse
          key={deg}
          cx="50"
          cy="36"
          rx="8"
          ry="14"
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
          transform={`rotate(${deg} 50 36)`}
          opacity="0.9"
        />
      ))}
      <line x1="50" y1="46" x2="50" y2="62" stroke="#6B8E23" strokeWidth="3" />
    </>
  );
}

function DefaultPlantSvg({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <circle cx="50" cy="40" r="22" fill={fill} stroke={stroke} strokeWidth="2" />
      <line x1="50" y1="62" x2="50" y2="72" stroke={stroke} strokeWidth="2" />
    </>
  );
}

function pickIllustration(featureType?: string) {
  if (!featureType) return DefaultPlantSvg;
  if (featureType === "tree" || featureType === "tree_specimen") return TreeSvg;
  if (
    featureType === "boxwood" ||
    featureType === "sagebrush" ||
    featureType === "lavender"
  ) {
    return ShrubSvg;
  }
  if (featureType === "ornamental_grass" || featureType === "blue_grass") {
    return GrassSvg;
  }
  if (featureType === "daylily") return FlowerSvg;
  return DefaultPlantSvg;
}

export function PlantReferenceSvg({
  featureType,
  fill = "#8FBC8F",
  stroke = "#556B2F",
  className,
}: Props) {
  const Illustration = pickIllustration(featureType);
  return (
    <svg
      className={className}
      viewBox="0 0 100 72"
      width="100%"
      height="100%"
      aria-hidden
      role="img"
    >
      <rect width="100" height="72" fill="#f5f5f4" />
      <Illustration fill={fill} stroke={stroke} />
    </svg>
  );
}
