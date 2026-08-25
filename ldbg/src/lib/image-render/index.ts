import type { RenderProviderId } from "@/config/features";
import { defaultRenderProvider } from "@/config/features";
import {
  FluxRenderProviderStub,
  GeminiImageRenderProvider,
  OpenAiRenderProviderStub,
} from "@/lib/image-render/providers";
import type { ImageRenderProvider } from "@/lib/image-render/types";

export function getImageRenderProvider(
  providerId?: RenderProviderId
): ImageRenderProvider {
  const id = providerId ?? defaultRenderProvider();

  if (id === "gemini") {
    const key =
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Gemini renders"
      );
    }
    return new GeminiImageRenderProvider(key);
  }

  if (id === "flux") return new FluxRenderProviderStub();
  return new OpenAiRenderProviderStub();
}

export type { ImageRenderProvider } from "@/lib/image-render/types";
export { RenderProviderError } from "@/lib/image-render/types";
