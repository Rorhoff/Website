import type { ImageRenderProvider } from "@/lib/image-render/types";
import { RenderProviderError } from "@/lib/image-render/types";

const MODEL =
  process.env.LDBG_GEMINI_IMAGE_MODEL ??
  "gemini-2.0-flash-preview-image-generation";

function extractImageBuffer(data: unknown): Buffer | null {
  if (!data || typeof data !== "object") return null;
  const candidates = (data as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates)) return null;
  for (const c of candidates) {
    const parts = (c as { content?: { parts?: unknown[] } }).content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } })
        .inlineData;
      if (inline?.data) {
        return Buffer.from(inline.data, "base64");
      }
    }
  }
  return null;
}

export class GeminiImageRenderProvider implements ImageRenderProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";

  constructor(private apiKey: string) {}

  async generate(prompt: string, referenceImage?: Buffer): Promise<Buffer> {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
      [{ text: prompt }];

    if (referenceImage?.length) {
      parts.unshift({
        inlineData: {
          mimeType: "image/jpeg",
          data: referenceImage.toString("base64"),
        },
      });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          }),
        });

        if (res.status === 429 || res.status === 503) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            continue;
          }
          throw new RenderProviderError(
            `Gemini rate limited (${res.status})`,
            this.id,
            true
          );
        }

        const json = await res.json();
        if (!res.ok) {
          const msg =
            (json as { error?: { message?: string } }).error?.message ??
            `Gemini HTTP ${res.status}`;
          throw new RenderProviderError(msg, this.id);
        }

        const buf = extractImageBuffer(json);
        if (!buf?.length) {
          throw new RenderProviderError(
            "Gemini returned no image data in response",
            this.id
          );
        }
        return buf;
      } catch (e) {
        lastErr = e;
        if (e instanceof RenderProviderError && e.retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Gemini render failed");
  }
}

export class FluxRenderProviderStub implements ImageRenderProvider {
  readonly id = "flux";
  readonly label = "Flux (Replicate)";

  async generate(): Promise<Buffer> {
    throw new RenderProviderError(
      "Flux provider is not implemented yet. Set LDBG_RENDER_PROVIDER=gemini or upload renders manually.",
      this.id
    );
  }
}

export class OpenAiRenderProviderStub implements ImageRenderProvider {
  readonly id = "openai";
  readonly label = "OpenAI Images";

  async generate(): Promise<Buffer> {
    throw new RenderProviderError(
      "OpenAI image provider is not implemented yet. Set LDBG_RENDER_PROVIDER=gemini or upload renders manually.",
      this.id
    );
  }
}
