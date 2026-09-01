import { PlanPatternById } from "@/lib/plan-patterns";
import styles from "./board.module.css";

type Props = {
  patternId?: string;
  fill: string;
  stroke?: string;
  uniqueId: string;
};

/** 36×36 swatch using the same SVG hatch/pattern as the plan legend. */
export function MaterialPatternSwatch({ patternId, fill, stroke, uniqueId }: Props) {
  const patternRef = patternId ? `${uniqueId}-${patternId}` : undefined;
  const baseFill = fill === "none" ? "#e7e5e4" : fill;

  return (
    <svg
      className={styles.swatchSvg}
      viewBox="0 0 36 36"
      width={36}
      height={36}
      aria-hidden
    >
      {patternRef ? (
        <defs>
          <PlanPatternById id={patternRef} patternId={patternId!} />
        </defs>
      ) : null}
      <rect
        x={0.5}
        y={0.5}
        width={35}
        height={35}
        rx={2}
        fill={patternRef ? `url(#${patternRef})` : baseFill}
        stroke={stroke ?? "#d6d3d1"}
        strokeWidth={1}
      />
    </svg>
  );
}
