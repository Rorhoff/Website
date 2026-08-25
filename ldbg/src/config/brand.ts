/**
 * Addendum B — brand identity for exported sheets.
 * No hardcoded strings in BoardTemplate; import from here only.
 */
export const BRAND = {
  businessName: "Modern Utah Landscape",
  tagline: "Where landscape becomes lifestyle.",
  website: "www.ModernUtahLandscape.com",
  websiteUrl: "https://www.ModernUtahLandscape.com",
  email: "",
  phone: "",
  logoMark: "/brand/logo-mark.png",
  logoPng: "/brand/logo-mark.png",
  accentColor: "#2B2B2B",
  logoIncludesWordmark: true,
  disclaimerShort:
    "Conceptual design for illustration only. Not construction documents. " +
    "Not prepared by a licensed landscape architect or engineer.",
} as const;

export type BrandConfig = typeof BRAND;

export function brandAssetUrl(basePath: string, path: string): string {
  const prefix = basePath.replace(/\/$/, "");
  return `${prefix}${path}`;
}
