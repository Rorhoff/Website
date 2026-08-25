import { GoogleGenAI } from "@google/genai";
import type {
  ImageRenderProvider,
  RenderRequest,
  RenderResult,
} from "@/lib/render/types";
import { RenderProviderError } from "@/lib/render/types";

const MODEL_FINAL =
  process.env.LDBG_GEMINI_MODEL_FINAL ?? "gemini-3-pro-image";
const MODEL_DRAFT =
  process.env.LDBG_GEMINI_MODEL_DRAFT ?? "gemini-3.1-flash-image";

export class GeminiRenderProvider implements ImageRenderProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";

  private ai: GoogleGenAI;

  constructor(private quality: "draft" | "final" = "draft") {
    const apiKey =
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(req: RenderRequest): Promise<RenderResult> {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    for (const buf of req.referenceImages ?? []) {
      parts.push({
        inlineData: { mimeType: "image/png", data: buf.toString("base64") },
      });
    }
    parts.push({ text: req.prompt });

    const model = this.quality === "final" ? MODEL_FINAL : MODEL_DRAFT;
    const resolution =
      req.resolution ?? (this.quality === "final" ? "4K" : "1K");

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model,
          contents: parts,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: req.aspectRatio ?? "16:9",
              imageSize: resolution,
            },
          },
        });

        let image: Buffer | null = null;
        let modelNotes = "";

        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if ("text" in part && part.text) {
            modelNotes += part.text;
          } else if ("inlineData" in part && part.inlineData?.data) {
            image = Buffer.from(part.inlineData.data, "base64");
          }
        }

        if (!image?.length) {
          throw new RenderProviderError(
            `Gemini returned no image. Text response: ${modelNotes.slice(0, 500)}`,
            this.id
          );
        }

        return {
          image,
          mimeType: "image/png",
          modelNotes: modelNotes || undefined,
        };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const retryable =
          /429|503|rate|quota|unavailable/i.test(msg) &&
          !(e instanceof RenderProviderError && !e.retryable);

        if (retryable && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }

        if (e instanceof RenderProviderError) throw e;
        throw new RenderProviderError(msg, this.id, retryable);
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new RenderProviderError("Gemini render failed", this.id);
  }
}
