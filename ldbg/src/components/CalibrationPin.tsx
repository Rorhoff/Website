type Point = { x: number; y: number };

type Props = {
  label: string;
  point: Point;
  color: string;
};

/** Small crosshair pin — center marks the exact normalized point. */
export function CalibrationPin({ label, point, color }: Props) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
    >
      <div className="relative h-0 w-0">
        <span
          className="absolute left-0 top-0 block h-2 w-px -translate-x-1/2 -translate-y-1/2"
          style={{ backgroundColor: color }}
        />
        <span
          className="absolute left-0 top-0 block h-px w-2 -translate-x-1/2 -translate-y-1/2"
          style={{ backgroundColor: color }}
        />
        <span
          className="absolute left-0 top-0 block h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white"
          style={{ backgroundColor: color }}
        />
        <span
          className="absolute left-2 top-[-10px] text-[10px] font-semibold leading-none drop-shadow-sm"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
