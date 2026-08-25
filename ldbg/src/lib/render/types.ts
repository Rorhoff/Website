// Provider interface. Everything downstream depends on this, not on Gemini.
// Swapping to GPT Image / FLUX later means writing one new file.

export type RenderAspectRatio = "16:9" | "4:3" | "3:2" | "1:1" | "3:4";
export type RenderResolution = "1K" | "2K" | "4K";
export type RenderQuality = "draft" | "final";

export interface RenderRequest {
  prompt: string;
  referenceImages?: Buffer[];
  aspectRatio?: RenderAspectRatio;
  resolution?: RenderResolution;
}

export interface RenderResult {
  image: Buffer;
  mimeType: string;
  modelNotes?: string;
}

export interface ImageRenderProvider {
  readonly id: string;
  readonly label: string;
  generate(req: RenderRequest): Promise<RenderResult>;
}

export class RenderProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "RenderProviderError";
  }
}
