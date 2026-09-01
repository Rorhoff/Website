import { BRAND, brandAssetUrl } from "@/config/brand";
import { BOARD_RENDER_PPI } from "@/lib/board-sizes";
import { computeArchScaleLabel } from "@/lib/plan-layout";
import type { BoardSettings, ProjectMetadata } from "@/lib/project-schema";
import styles from "./board.module.css";

type Props = {
  metadata: ProjectMetadata;
  boardSettings?: BoardSettings;
  scaleLabel?: string;
  basePath?: string;
};

export function TitleBlock({
  metadata,
  boardSettings,
  scaleLabel = "Scale N/A",
  basePath = "",
}: Props) {
  const logoUrl = brandAssetUrl(basePath, BRAND.logoMark);
  const contactParts = [BRAND.phone, BRAND.email].filter(Boolean);

  const rows: { label: string; value: string }[] = [
    { label: "PROJECT", value: metadata.projectTitle || "—" },
    { label: "CLIENT", value: metadata.clientName || "—" },
    { label: "LOCATION", value: metadata.propertyAddress || "—" },
    { label: "REVISION", value: boardSettings?.revision ?? "Rev 1" },
    { label: "DRAWN BY", value: boardSettings?.designer || "—" },
    { label: "SCALE", value: scaleLabel },
  ];

  return (
    <div
      className={styles.titleBlock}
      style={{ "--brand-accent": BRAND.accentColor } as React.CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.titleBlockLogo} src={logoUrl} alt="" />
      <hr className={styles.titleBlockRule} />
      {!BRAND.logoIncludesWordmark ? (
        <div className={styles.titleBlockBusiness}>{BRAND.businessName.toUpperCase()}</div>
      ) : null}
      <div className={styles.titleBlockTagline}>{BRAND.tagline}</div>
      <a
        className={styles.titleBlockWebsite}
        href={BRAND.websiteUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {BRAND.website}
      </a>
      {contactParts.length > 0 ? (
        <div className={styles.titleBlockContact}>{contactParts.join(" · ")}</div>
      ) : null}
      <hr className={styles.titleBlockRule} />

      <table className={styles.titleBlockTable}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function computeBoardScaleLabel(
  planWidthPx: number,
  pixelsPerFoot: number | undefined,
  planPrintWidthIn = 20
): string {
  if (!pixelsPerFoot || pixelsPerFoot <= 0) return "Scale N/A";
  return computeArchScaleLabel(planWidthPx, pixelsPerFoot, planPrintWidthIn * BOARD_RENDER_PPI, BOARD_RENDER_PPI);
}
