import type { RenderProviderId } from "@/config/features";
import { geminiEnabled } from "@/config/ai-features";
import {
  defaultRenderProvider,
  rendersFeatureEnabled,
} from "@/config/features";
import { GeminiRenderProvider } from "@/lib/render/gemini";
import {
  FluxRenderProviderStub,
  OpenAiRenderProviderStub,
} from "@/lib/render/stubs";
import type { ImageRenderProvider, RenderQuality } from "@/lib/render/types";

export function getRenderProvider(
  quality: RenderQuality = "draft",
  providerId?: RenderProviderId
): ImageRenderProvider | null {
  if (!rendersFeatureEnabled()) return null;

  if (!geminiEnabled()) return null;

  const id = providerId ?? defaultRenderProvider();

  if (id === "gemini") {
    return new GeminiRenderProvider(quality);
  }
  if (id === "flux") return new FluxRenderProviderStub();
  if (id === "openai") return new OpenAiRenderProviderStub();

  throw new Error(`Unknown IMAGE_RENDER_PROVIDER: ${id}`);
}

/** @deprecated use getRenderProvider */
export function getImageRenderProvider(
  providerId?: RenderProviderId,
  quality: RenderQuality = "draft"
): ImageRenderProvider {
  const provider = getRenderProvider(quality, providerId);
  if (!provider) {
    throw new Error(
      "AI renders are disabled. Set LDBG_RENDERS_ENABLED=true in .env.local."
    );
  }
  return provider;
}

export type {
  ImageRenderProvider,
  RenderAspectRatio,
  RenderQuality,
  RenderRequest,
  RenderResolution,
  RenderResult,
} from "@/lib/render/types";
export { RenderProviderError } from "@/lib/render/types";
