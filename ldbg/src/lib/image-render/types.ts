export interface ImageRenderProvider {
  readonly id: string;
  readonly label: string;
  generate(prompt: string, referenceImage?: Buffer): Promise<Buffer>;
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
