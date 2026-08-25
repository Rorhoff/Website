import { formatScaleVerificationStamp } from "@/lib/scale-verification";
import type { ScaleVerification } from "@/lib/project-schema";
import styles from "./board.module.css";

type Props = {
  scaleVerification?: ScaleVerification;
  requiresVerification: boolean;
  calibrated?: boolean;
};

export function ScaleVerificationStamp({
  scaleVerification,
  requiresVerification,
  calibrated,
}: Props) {
  if (scaleVerification?.passed) {
    return (
      <p className={styles.scaleStampOk}>
        {formatScaleVerificationStamp(scaleVerification)}
      </p>
    );
  }

  if (requiresVerification) {
    return <p className={styles.scaleStampFail}>SCALE NOT VERIFIED</p>;
  }

  if (calibrated) {
    return (
      <p className={styles.scaleStampMuted}>
        Scale set by manual calibration — independent field verification recommended.
      </p>
    );
  }

  return <p className={styles.scaleStampFail}>SCALE NOT VERIFIED</p>;
}
