import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  buildDesignContentSystemPrompt,
  buildDesignContentUserPrompt,
  CLAUDE_DESIGN_CONTENT_HINT,
} from "@/lib/design-content-prompts";
import {
  DesignContentResultSchema,
  RenderPromptSchema,
  type StoredDesignContent,
} from "@/lib/design-content-schema";
import { estimateInterpretCostUsd } from "@/lib/interpret-cost";
import type { Project } from "@/lib/project-schema";
import {
  buildTakeoff,
  featuresSummaryForPrompt,
} from "@/lib/takeoff-builder";
import { getLegend, getStorage } from "@/lib/storage";
import {
  checkDesignContentRateLimit,
  recordDesignContentCall,
} from "@/lib/rate-limit";

export const DESIGN_CONTENT_MODEL =
  process.env.LDBG_DESIGN_CONTENT_MODEL ?? "claude-sonnet-4-20250514";

const ClaudePartialSchema = z.object({
  conceptOverview: DesignContentResultSchema.shape.conceptOverview,
  plantPalette: DesignContentResultSchema.shape.plantPalette,
  materialsAndFinishes: DesignContentResultSchema.shape.materialsAndFinishes,
  renderPrompts: z.array(RenderPromptSchema).length(3),
});

export type DesignContentSuccess = {
  designContent: StoredDesignContent;
  cached: boolean;
};

export type DesignContentFailure = {
  error: string;
  rawResponse?: string;
  retryAfterSec?: number;
};

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
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

function parsePartialDesignContent(text: string) {
  return ClaudePartialSchema.parse(JSON.parse(stripJsonFences(text)));
}

export async function runDesignContentForProject(
  projectId: string,
  options?: { force?: boolean }
): Promise<DesignContentSuccess | DesignContentFailure> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const features =
    project.features?.length
      ? project.features
      : project.interpretation?.features ?? [];
  if (features.length === 0) {
    return { error: "Project has no features — run interpret and edit first" };
  }

  if (!options?.force && project.designContent) {
    return { designContent: project.designContent, cached: true };
  }

  const rate = checkDesignContentRateLimit(projectId);
  if (!rate.allowed) {
    return {
      error: `Rate limited — wait ${rate.retryAfterSec}s before generating again`,
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "ANTHROPIC_API_KEY is not configured on the server" };
  }

  const legend = await getLegend();
  const ann = project.images.annotated;
  const imageW = ann?.width ?? 1000;
  const imageH = ann?.height ?? 1000;
  const takeoff = buildTakeoff(
    features,
    legend,
    imageW,
    imageH,
    project.calibration?.pixelsPerFoot
  );

  const featuresJson = featuresSummaryForPrompt(features, legend);
  const system = buildDesignContentSystemPrompt();
  const userText = buildDesignContentUserPrompt(
    project.metadata,
    featuresJson,
    takeoff,
    legend
  );

  const client = new Anthropic({ apiKey });
  const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
    model: DESIGN_CONTENT_MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userText }],
  };

  recordDesignContentCall(projectId);

  let rawResponse = "";
  try {
    let message = await callAnthropicWithRetry(client, baseParams);
    rawResponse = extractText(message);

    let partial;
    try {
      partial = parsePartialDesignContent(rawResponse);
    } catch {
      message = await callAnthropicWithRetry(client, {
        ...baseParams,
        messages: [
          ...baseParams.messages,
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `Invalid JSON. Return ONLY corrected JSON:\n${CLAUDE_DESIGN_CONTENT_HINT}`,
          },
        ],
      });
      rawResponse = extractText(message);
      try {
        partial = parsePartialDesignContent(rawResponse);
      } catch {
        return {
          error: "JSON validation failed after retry — see raw response",
          rawResponse,
        };
      }
    }

    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const estimatedCostUsd = estimateInterpretCostUsd(inputTokens, outputTokens);

    console.info(
      `[design-content] project=${projectId} model=${DESIGN_CONTENT_MODEL} in=${inputTokens} out=${outputTokens} cost≈$${estimatedCostUsd.toFixed(4)}`
    );

    const designContent: StoredDesignContent = {
      ...partial,
      takeoff,
      generatedAt: new Date().toISOString(),
      model: DESIGN_CONTENT_MODEL,
      tokenUsage: { input: inputTokens, output: outputTokens },
      estimatedCostUsd,
    };

    DesignContentResultSchema.parse(designContent);

    const updated: Project = {
      ...project,
      designContent,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveProject(updated);

    return { designContent, cached: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Design content generation failed";
    return { error: msg, rawResponse: rawResponse || undefined };
  }
}
