/** @deprecated Import from @/config/brand instead. */
import { BRAND, brandAssetUrl } from "@/config/brand";

export const BRANDING = {
  businessName: BRAND.businessName,
  tagline: BRAND.tagline,
  accentColor: BRAND.accentColor,
  logoPath: BRAND.logoMark,
};

export function brandingLogoUrl(basePath = ""): string {
  return brandAssetUrl(basePath, BRAND.logoMark);
}
