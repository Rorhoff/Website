import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/anthropic-env";
import {
  buildInterpretSystemPrompt,
  buildInterpretUserPrompt,
  INTERPRET_JSON_SCHEMA_HINT,
} from "@/lib/interpret-prompts";
import { prepareImageForClaude } from "@/lib/interpret-image";
import { estimateInterpretCostUsd } from "@/lib/interpret-cost";
import {
  ClaudeInterpretationResultSchema,
  normalizeInterpretationToOriginal,
  type StoredInterpretation,
} from "@/lib/interpret-schema";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import { convertFeaturesToProjected } from "@/lib/feature-georef";
import type { Project } from "@/lib/project-schema";
import { getLegend, getStorage } from "@/lib/storage";
import {
  checkInterpretRateLimit,
  recordInterpretCall,
} from "@/lib/rate-limit";

export const INTERPRET_MODEL = (() => {
  const raw = process.env.LDBG_INTERPRET_MODEL?.trim();
  // Retired snapshot id — fall back to the same model family AIRevolution uses.
  if (!raw || raw.includes("20250514")) return "claude-sonnet-4-6";
  return raw;
})();

export type InterpretSuccess = {
  interpretation: StoredInterpretation;
  cached: boolean;
};

export type InterpretFailure = {
  error: string;
  rawResponse?: string;
  retryAfterSec?: number;
};

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function parseInterpretJson(text: string) {
  return ClaudeInterpretationResultSchema.parse(JSON.parse(stripJsonFences(text)));
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function callAnthropicWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastErr = err;
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status?: number }).status
          : undefined;
      if (status !== 429 && status !== 529) throw err;
      if (attempt === 2) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function runInterpretForProject(
  projectId: string,
  options?: { force?: boolean }
): Promise<InterpretSuccess | InterpretFailure> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const annotated = project.images.annotated;
  if (!annotated) {
    if (project.webodm) {
      return {
        error:
          "Upload your annotated sketch first — export annotation-base.jpg, draw on it, then upload.",
      };
    }
    return { error: "Project has no annotated image" };
  }

  if (!options?.force && project.interpretation) {
    return { interpretation: project.interpretation, cached: true };
  }

  const rate = checkInterpretRateLimit(projectId);
  if (!rate.allowed) {
    return {
      error: `Rate limited — wait ${rate.retryAfterSec}s before interpreting again`,
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY is not configured on the server" };
  }

  const fileBuf = await storage.readProjectFile(projectId, annotated.filename);
  if (!fileBuf) return { error: "Annotated image file missing on disk" };

  let prepared;
  try {
    prepared = await prepareImageForClaude(fileBuf, annotated.filename);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Image preparation failed",
    };
  }

  const legend = await getLegend();
  const system = buildInterpretSystemPrompt(legend);
  const userText = buildInterpretUserPrompt(project.metadata);
  const client = new Anthropic({ apiKey });

  const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
    model: INTERPRET_MODEL,
    max_tokens: 8000,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: prepared.mediaType,
              data: prepared.base64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  recordInterpretCall(projectId);

  let rawResponse = "";
  try {
    let message = await callAnthropicWithRetry(client, baseParams);
    rawResponse = extractText(message);

    let parsed;
    try {
      parsed = parseInterpretJson(rawResponse);
    } catch {
      message = await callAnthropicWithRetry(client, {
        ...baseParams,
        messages: [
          ...baseParams.messages,
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `That response was not valid JSON for this schema. Return ONLY corrected JSON, no markdown:\n${INTERPRET_JSON_SCHEMA_HINT}`,
          },
        ],
      });
      rawResponse = extractText(message);
      try {
        parsed = parseInterpretJson(rawResponse);
      } catch {
        return {
          error: "JSON validation failed after retry — see raw response",
          rawResponse,
        };
      }
    }

    const coordWidth = prepared.originalWidth;
    const coordHeight = prepared.originalHeight;

    if (coordWidth !== annotated.width || coordHeight !== annotated.height) {
      console.warn(
        `[interpret] project=${projectId} stored annotated dims ${annotated.width}×${annotated.height} differ from file bytes ${coordWidth}×${coordHeight} — using file bytes for coordinate conversion`
      );
    }

    console.info(
      `[interpret] project=${projectId} coordSpace=${coordWidth}×${coordHeight} sentToClaude=${prepared.width}×${prepared.height} downscale=${prepared.downscaleFactor.toFixed(3)} (prepareImageForClaude → normalized 0–1, not clean ortho dims)`
    );

    const normalized = normalizeInterpretationToOriginal(
      parsed,
      coordWidth,
      coordHeight
    );

    const georefCtx = getGeorefDisplayContext(
      project,
      coordWidth,
      coordHeight
    );
    const projectedFeatures = georefCtx
      ? convertFeaturesToProjected(
          normalized.features,
          coordWidth,
          coordHeight,
          georefCtx
        )
      : normalized.features;

    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const estimatedCostUsd = estimateInterpretCostUsd(inputTokens, outputTokens);

    console.info(
      `[interpret] project=${projectId} model=${INTERPRET_MODEL} in=${inputTokens} out=${outputTokens} cost≈$${estimatedCostUsd.toFixed(4)} downscale=${prepared.downscaleFactor.toFixed(3)}`
    );

    const interpretation: StoredInterpretation = {
      ...normalized,
      features: projectedFeatures,
      interpretedAt: new Date().toISOString(),
      model: INTERPRET_MODEL,
      downscaleFactor:
        prepared.downscaleFactor > 1 ? prepared.downscaleFactor : undefined,
      interpretImageSpace: {
        coordWidth,
        coordHeight,
        sentWidth: prepared.width,
        sentHeight: prepared.height,
        downscaleFactor: prepared.downscaleFactor,
        storedAnnotatedWidth: annotated.width,
        storedAnnotatedHeight: annotated.height,
      },
      tokenUsage: { input: inputTokens, output: outputTokens },
      estimatedCostUsd,
    };

    const updated: Project = {
      ...project,
      interpretation,
      features: projectedFeatures,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveProject(updated);

    return { interpretation, cached: false };
  } catch (e) {
    let msg = e instanceof Error ? e.message : "Interpretation failed";
    if (msg.includes("not_found_error") || msg.includes("404")) {
      msg =
        `Claude model unavailable (${INTERPRET_MODEL}). Deploy the latest LDBG build or set LDBG_INTERPRET_MODEL=claude-sonnet-4-6 on the server.`;
    }
    return { error: msg, rawResponse: rawResponse || undefined };
  }
}

/** CLI / test script entry — interpret a raw image buffer without a saved project. */
export async function runInterpretOnBuffer(
  imageBuffer: Buffer,
  filename: string,
  metadata: Project["metadata"]
): Promise<StoredInterpretation | InterpretFailure> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY is not configured" };
  }

  const prepared = await prepareImageForClaude(imageBuffer, filename);
  const legend = await getLegend();
  const system = buildInterpretSystemPrompt(legend);
  const userText = buildInterpretUserPrompt(metadata);
  const client = new Anthropic({ apiKey });

  const message = await callAnthropicWithRetry(client, {
    model: INTERPRET_MODEL,
    max_tokens: 8000,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: prepared.mediaType,
              data: prepared.base64,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const rawResponse = extractText(message);
  let parsed;
  try {
    parsed = parseInterpretJson(rawResponse);
  } catch {
    return { error: "JSON validation failed", rawResponse };
  }

  const normalized = normalizeInterpretationToOriginal(
    parsed,
    prepared.originalWidth,
    prepared.originalHeight
  );

  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;

  return {
    ...normalized,
    interpretedAt: new Date().toISOString(),
    model: INTERPRET_MODEL,
    downscaleFactor:
      prepared.downscaleFactor > 1 ? prepared.downscaleFactor : undefined,
    tokenUsage: { input: inputTokens, output: outputTokens },
    estimatedCostUsd: estimateInterpretCostUsd(inputTokens, outputTokens),
  };
}
