import { plantReferenceImageUrl } from "@/lib/plant-reference-images";
import styles from "./board.module.css";

type Props = {
  commonName: string;
  featureType?: string;
  fill?: string;
  stroke?: string;
  className?: string;
};

/** Reference photo or stylized fallback for board plant palette cards. */
export function PlantReferenceThumb({
  commonName,
  featureType,
  fill = "#8FBC8F",
  stroke = "#556B2F",
  className,
}: Props) {
  const src = plantReferenceImageUrl(commonName, featureType);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className ?? styles.plantThumb}
        src={src}
        alt=""
        style={{ objectFit: "cover" }}
      />
    );
  }

  return (
    <div
      className={className ?? styles.plantThumb}
      style={{
        background:
          fill === "none" ? "linear-gradient(135deg,#e7e5e4,#d6d3d1)" : fill,
        boxShadow: `inset 0 0 0 2px ${stroke}`,
      }}
      aria-hidden
    />
  );
}
