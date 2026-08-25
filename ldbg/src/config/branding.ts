/**
 * LDBG branding — edit business name, tagline, accent, and logo path here.
 * Logo file lives in public/branding/ (served at /branding/ or /ldbg/branding/ with basePath).
 */
export type BrandingConfig = {
  businessName: string;
  tagline: string;
  accentColor: string;
  logoPath: string;
};

export const BRANDING: BrandingConfig = {
  businessName: "Switch2 Landscape Design",
  tagline: "Outdoor living, thoughtfully designed",
  accentColor: "#059669",
  logoPath: "/branding/logo.svg",
};

export function brandingLogoUrl(basePath = ""): string {
  const prefix = basePath.replace(/\/$/, "");
  return `${prefix}${BRANDING.logoPath}`;
}
