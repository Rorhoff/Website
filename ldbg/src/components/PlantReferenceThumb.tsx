import { plantPhotoUrl } from "@/lib/board-assets";
import { PlantReferenceSvg } from "@/components/PlantReferenceSvg";
import styles from "./board.module.css";

type Props = {
  commonName: string;
  featureType?: string;
  fill?: string;
  stroke?: string;
  className?: string;
};

/** Plant photo (bundled) or SVG fallback for board plant palette cards. */
export function PlantReferenceThumb({
  commonName,
  featureType,
  fill = "#8FBC8F",
  stroke = "#556B2F",
  className,
}: Props) {
  const photo = plantPhotoUrl(commonName, featureType);

  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={className ?? styles.plantThumb}
        src={photo}
        alt=""
        style={{ objectFit: "cover" }}
      />
    );
  }

  return (
    <PlantReferenceSvg
      featureType={featureType}
      fill={fill === "none" ? "#8FBC8F" : fill}
      stroke={stroke}
      className={className ?? styles.plantThumb}
    />
  );
}
