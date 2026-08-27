import { Circle, Group, Line, Rect } from "react-konva";
import type { RenderStyle } from "@/config/legend";

type Point = { x: number; y: number };

/** Konva markup for decorative point objects in the feature editor. */
export function DecorativeObjectKonva({
  featureType,
  x,
  y,
  radius,
  style,
  strokeOverride,
  strokeWidth = 2,
}: {
  featureType: string;
  x: number;
  y: number;
  radius: number;
  style: RenderStyle;
  strokeOverride?: string;
  strokeWidth?: number;
}) {
  const stroke = strokeOverride ?? style.stroke;
  const fill = style.fill;
  const r = Math.max(4, radius);

  switch (featureType) {
    case "putting_green_flag":
      return (
        <Group x={x} y={y}>
          <Line points={[0, r * 0.5, 0, -r * 0.9]} stroke="#5c4033" strokeWidth={2} />
          <Line
            points={[0, -r * 0.9, r * 0.55, -r * 0.55, 0, -r * 0.2]}
            closed
            fill="#ef4444"
            stroke="#b91c1c"
            strokeWidth={1}
          />
          <Circle x={0} y={r * 0.5} radius={Math.max(2, r * 0.12)} fill="#374151" />
        </Group>
      );
    case "lawn_chair":
      return (
        <Group x={x} y={y}>
          <Rect
            x={-r * 0.55}
            y={-r * 0.15}
            width={r * 1.1}
            height={r * 0.45}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            cornerRadius={2}
          />
          <Rect
            x={-r * 0.5}
            y={-r * 0.75}
            width={r * 1}
            height={r * 0.55}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            cornerRadius={2}
            opacity={0.9}
          />
        </Group>
      );
    case "fire_pit_round":
      return (
        <Group x={x} y={y}>
          <Circle radius={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
          <Circle
            radius={r * 0.55}
            fill="#f97316"
            stroke="#c2410c"
            strokeWidth={1.5}
            opacity={0.85}
          />
        </Group>
      );
    case "fire_pit_square":
      return (
        <Group x={x} y={y}>
          <Rect
            x={-r}
            y={-r}
            width={r * 2}
            height={r * 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            cornerRadius={3}
          />
          <Circle radius={r * 0.45} fill="#f97316" stroke="#c2410c" strokeWidth={1.5} />
        </Group>
      );
    case "flagstone_step_rock":
      return (
        <Group x={x} y={y} rotation={-8}>
          <Rect
            x={-r * 0.85}
            y={-r * 0.55}
            width={r * 1.7}
            height={r * 1.1}
            fill="#a8a29e"
            stroke="#57534e"
            strokeWidth={strokeWidth}
            cornerRadius={4}
          />
          <Line
            points={[-r * 0.3, -r * 0.1, r * 0.2, r * 0.15]}
            stroke="#78716c"
            strokeWidth={1}
            opacity={0.7}
          />
        </Group>
      );
    default:
      return (
        <Circle
          x={x}
          y={y}
          radius={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={style.opacity}
        />
      );
  }
}

/** SVG markup for decorative objects on plan sheets. */
export function DecorativeObjectSvg({
  featureType,
  center,
  radius,
  style,
}: {
  featureType: string;
  center: Point;
  radius: number;
  style: RenderStyle;
}) {
  const { x, y } = center;
  const r = Math.max(3, radius);
  const stroke = style.stroke;
  const fill = style.fill;

  switch (featureType) {
    case "putting_green_flag":
      return (
        <g>
          <line x1={x} y1={y + r * 0.5} x2={x} y2={y - r * 0.9} stroke="#5c4033" strokeWidth={1.5} />
          <polygon
            points={`${x},${y - r * 0.2} ${x + r * 0.55},${y - r * 0.55} ${x},${y - r * 0.9}`}
            fill="#ef4444"
            stroke="#b91c1c"
            strokeWidth={0.8}
          />
          <circle cx={x} cy={y + r * 0.5} r={Math.max(1.5, r * 0.12)} fill="#374151" />
        </g>
      );
    case "lawn_chair":
      return (
        <g>
          <rect
            x={x - r * 0.55}
            y={y - r * 0.15}
            width={r * 1.1}
            height={r * 0.45}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            rx={2}
          />
          <rect
            x={x - r * 0.5}
            y={y - r * 0.75}
            width={r}
            height={r * 0.55}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            rx={2}
          />
        </g>
      );
    case "fire_pit_round":
      return (
        <g>
          <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.2} />
          <circle cx={x} cy={y} r={r * 0.55} fill="#f97316" stroke="#c2410c" strokeWidth={1} />
        </g>
      );
    case "fire_pit_square":
      return (
        <g>
          <rect
            x={x - r}
            y={y - r}
            width={r * 2}
            height={r * 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.2}
            rx={3}
          />
          <circle cx={x} cy={y} r={r * 0.45} fill="#f97316" stroke="#c2410c" strokeWidth={1} />
        </g>
      );
    case "flagstone_step_rock":
      return (
        <g transform={`rotate(-8 ${x} ${y})`}>
          <rect
            x={x - r * 0.85}
            y={y - r * 0.55}
            width={r * 1.7}
            height={r * 1.1}
            fill="#a8a29e"
            stroke="#57534e"
            strokeWidth={1}
            rx={4}
          />
        </g>
      );
    default:
      return <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={1.2} />;
  }
}
