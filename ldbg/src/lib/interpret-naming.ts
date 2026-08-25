import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getAnthropicApiKey } from "@/lib/anthropic-env";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { INTERPRET_MODEL } from "@/lib/interpret-service";

const COORD_ARRAY_PATTERN = /\[\s*[\d.\-]+(\s*,\s*[\d.\-]+)+\s*\]/;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function rejectCoordinateArrays(text: string): void {
  if (COORD_ARRAY_PATTERN.test(text)) {
    throw new Error("LLM response contained coordinate arrays — rejected");
  }
}

async function cropFeatureThumb(
  imageBuf: Buffer,
  feature: InterpretFeature,
  imageWidth: number,
  imageHeight: number
): Promise<string> {
  if (!("points" in feature.geometry)) {
    throw new Error("Naming requires normalized geometry");
  }
  const pts = feature.geometry.points;
  const xs = pts.map((p) => p.x * imageWidth);
  const ys = pts.map((p) => p.y * imageHeight);
  const pad = 24;
  const left = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const top = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const right = Math.min(imageWidth, Math.ceil(Math.max(...xs) + pad));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(...ys) + pad));
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const jpeg = await sharp(imageBuf)
    .extract({ left, top, width: w, height: h })
    .jpeg({ quality: 82 })
    .toBuffer();
  return jpeg.toString("base64");
}

/** Narrow LLM pass: descriptive names + material guess only — never coordinates. */
export async function nameImportedFeatures(
  _projectId: string,
  features: InterpretFeature[],
  annotatedBuf: Buffer
): Promise<InterpretFeature[]> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey || features.length === 0) return features;

  const meta = await sharp(annotatedBuf).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;

  const client = new Anthropic({ apiKey });
  const named: InterpretFeature[] = [];

  for (const feature of features) {
    try {
      const b64 = await cropFeatureThumb(annotatedBuf, feature, w, h);
      const message = await client.messages.create({
        model: INTERPRET_MODEL,
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: b64,
                },
              },
              {
                type: "text",
                text: `This crop is a landscape design annotation labeled "${feature.label}" (type: ${feature.featureType}).
Return JSON only: {"label":"short descriptive name","material":"material guess","notes":"optional brief note"}
Do NOT include coordinates, points, polygons, or numeric arrays.`,
              },
            ],
          },
        ],
      });
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      rejectCoordinateArrays(text);
      const parsed = JSON.parse(stripJsonFences(text)) as {
        label?: string;
        material?: string;
        notes?: string;
      };
      named.push({
        ...feature,
        label: parsed.label?.trim() || feature.label,
        notes: [feature.notes, parsed.material, parsed.notes].filter(Boolean).join(" — "),
      });
    } catch {
      named.push(feature);
    }
  }

  return named;
}
