/** Gemini image generation (style pass, feature fills, AI renders). Disabled by default. */

export function geminiEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_LDBG_GEMINI_ENABLED === "true";
  }
  return process.env.LDBG_GEMINI_ENABLED === "true";
}

export const GEMINI_DISABLED_MESSAGE =
  "Gemini image generation is disabled on this server. Upload renders manually or set LDBG_GEMINI_ENABLED=true.";
