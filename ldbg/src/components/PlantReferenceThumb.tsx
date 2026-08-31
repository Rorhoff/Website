import { PlantReferenceSvg } from "@/components/PlantReferenceSvg";
import styles from "./board.module.css";

type Props = {
  commonName: string;
  featureType?: string;
  fill?: string;
  stroke?: string;
  className?: string;
};

/** Stylized plant illustration for board plant palette cards (PDF-safe). */
export function PlantReferenceThumb({
  featureType,
  fill = "#8FBC8F",
  stroke = "#556B2F",
  className,
}: Props) {
  return (
    <PlantReferenceSvg
      featureType={featureType}
      fill={fill === "none" ? "#8FBC8F" : fill}
      stroke={stroke}
      className={className ?? styles.plantThumb}
    />
  );
}
