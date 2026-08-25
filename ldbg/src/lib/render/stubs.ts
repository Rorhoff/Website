import type { ImageRenderProvider } from "@/lib/render/types";
import { RenderProviderError } from "@/lib/render/types";

export class FluxRenderProviderStub implements ImageRenderProvider {
  readonly id = "flux";
  readonly label = "Flux (Replicate)";

  async generate(): Promise<never> {
    throw new RenderProviderError(
      "Flux provider is not implemented yet. Set LDBG_RENDER_PROVIDER=gemini or upload renders manually.",
      this.id
    );
  }
}

export class OpenAiRenderProviderStub implements ImageRenderProvider {
  readonly id = "openai";
  readonly label = "OpenAI Images";

  async generate(): Promise<never> {
    throw new RenderProviderError(
      "OpenAI image provider is not implemented yet. Set LDBG_RENDER_PROVIDER=gemini or upload renders manually.",
      this.id
    );
  }
}
