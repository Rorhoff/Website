import styles from "./board.module.css";

type Props = {
  barPx: number;
  feet: number;
};

/** Graphic scale bar — stays correct when PDF is printed at fit-to-page (B6). */
export function GraphicScaleBar({ barPx, feet }: Props) {
  const label =
    feet >= 1
      ? `${feet}'`
      : `${Math.round(feet * 12)}"`;

  return (
    <div className={styles.graphicScaleBar} style={{ width: barPx }}>
      <div className={styles.graphicScaleBarLine}>
        <span className={styles.graphicScaleTick} />
        <span className={styles.graphicScaleTick} />
      </div>
      <div className={styles.graphicScaleLabel}>0 — {label}</div>
    </div>
  );
}
