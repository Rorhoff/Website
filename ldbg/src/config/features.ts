/** Feature flags and render provider selection. */

export type RenderProviderId = "gemini" | "flux" | "openai";

export function rendersFeatureEnabled(): boolean {
  return (
    process.env.LDBG_RENDERS_ENABLED === "true" ||
    process.env.ENABLE_IMAGE_RENDER === "true"
  );
}

/** When true, Gemini img2img uses Blender base render as reference (Addendum A6 step 2). */
export function renderImg2imgEnabled(): boolean {
  return process.env.LDBG_RENDER_IMG2IMG === "true";
}

export function defaultRenderProvider(): RenderProviderId {
  const p =
    process.env.LDBG_RENDER_PROVIDER ?? process.env.IMAGE_RENDER_PROVIDER;
  if (p === "flux" || p === "openai" || p === "gemini") return p;
  return "gemini";
}

export const RENDER_PROVIDER_LABELS: Record<RenderProviderId, string> = {
  gemini: "Google Gemini (image + reference)",
  flux: "Flux via Replicate (stub)",
  openai: "OpenAI Images (stub)",
};

export const IMPLEMENTED_RENDER_PROVIDERS: RenderProviderId[] = ["gemini"];
