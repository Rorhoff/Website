import type { RenderProviderId } from "@/config/features";
import { rendersFeatureEnabled } from "@/config/features";
import { getImageRenderProvider } from "@/lib/image-render";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import type { Project, RenderMeta, RenderSlots } from "@/lib/project-schema";
import {
  checkRenderRateLimit,
  recordRenderCall,
} from "@/lib/rate-limit";
import {
  renderFilenameForSlot,
  SLOT_TO_PROMPT_ID,
  type RenderSlotKey,
} from "@/lib/render-slots";
import { getStorage } from "@/lib/storage";
import sharp from "sharp";

/** Rough Gemini image gen cost placeholder (USD). */
const ESTIMATED_RENDER_COST_USD = 0.04;

export type RenderSuccess = {
  slot: RenderSlotKey;
  filename: string;
  cached: boolean;
  estimatedCostUsd?: number;
  renderSlots?: RenderSlots;
  renderMeta?: RenderMeta;
};

export type RenderFailure = {
  error: string;
  retryAfterSec?: number;
};

function promptForSlot(
  designContent: StoredDesignContent | undefined,
  slot: RenderSlotKey
): string | null {
  if (!designContent) return null;
  const promptId = SLOT_TO_PROMPT_ID[slot];
  const entry = designContent.renderPrompts.find((r) => r.id === promptId);
  return entry?.prompt ?? null;
}

async function loadReferenceImage(project: Project): Promise<Buffer | undefined> {
  const ref = project.images.clean ?? project.images.annotated;
  if (!ref) return undefined;
  const buf = await getStorage().readProjectFile(project.id, ref.filename);
  if (!buf) return undefined;
  return sharp(buf).jpeg({ quality: 85 }).toBuffer();
}

export async function generateRenderForSlot(
  projectId: string,
  slot: RenderSlotKey,
  options?: { force?: boolean; provider?: RenderProviderId }
): Promise<RenderSuccess | RenderFailure> {
  if (!rendersFeatureEnabled()) {
    return {
      error:
        "AI renders are disabled. Set LDBG_RENDERS_ENABLED=true in .env.local to enable.",
    };
  }

  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const filename =
    project.renderSlots?.[slot] ?? renderFilenameForSlot(slot);
  const exists = await storage.projectFileExists(projectId, filename);

  if (!options?.force && exists) {
    return {
      slot,
      filename,
      cached: true,
      renderSlots: project.renderSlots,
      renderMeta: project.renderMeta,
    };
  }

  const rate = checkRenderRateLimit(projectId);
  if (!rate.allowed) {
    return {
      error: `Rate limited — wait ${rate.retryAfterSec}s before generating again`,
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const prompt = promptForSlot(project.designContent, slot);
  if (!prompt) {
    return {
      error: "Generate design content first — render prompts come from Milestone 5",
    };
  }

  const providerId =
    options?.provider ?? project.renderSettings?.provider ?? "gemini";

  let provider;
  try {
    provider = getImageRenderProvider(providerId);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Render provider unavailable",
    };
  }

  recordRenderCall(projectId);

  try {
    const reference = await loadReferenceImage(project);
    const imageBuf = await provider.generate(prompt, reference);
    const outName = renderFilenameForSlot(slot, "png");
    await storage.saveProjectFile(projectId, outName, imageBuf);

    const renderSlots = { ...(project.renderSlots ?? {}), [slot]: outName };
    const renderMeta = {
      ...(project.renderMeta ?? {}),
      [slot]: {
        source: "generated" as const,
        generatedAt: new Date().toISOString(),
        provider: providerId,
      },
    };

    const updated: Project = {
      ...project,
      renderSlots,
      renderMeta,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveProject(updated);

    console.info(
      `[render] project=${projectId} slot=${slot} provider=${providerId} cached=false`
    );

    return {
      slot,
      filename: outName,
      cached: false,
      estimatedCostUsd: ESTIMATED_RENDER_COST_USD,
      renderSlots,
      renderMeta,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Render generation failed",
    };
  }
}

export async function uploadRenderForSlot(
  projectId: string,
  slot: RenderSlotKey,
  file: Buffer,
  mimeType: string
): Promise<Project | null> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return null;

  const ext =
    mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const outName = renderFilenameForSlot(slot, ext);
  await storage.saveProjectFile(projectId, outName, file);

  const renderSlots = { ...(project.renderSlots ?? {}), [slot]: outName };
  const renderMeta = {
    ...(project.renderMeta ?? {}),
    [slot]: {
      source: "upload" as const,
      generatedAt: new Date().toISOString(),
    },
  };

  const updated: Project = {
    ...project,
    renderSlots,
    renderMeta,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return updated;
}

export async function clearRenderSlot(
  projectId: string,
  slot: RenderSlotKey
): Promise<Project | null> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return null;

  const renderSlots = { ...(project.renderSlots ?? {}) };
  delete renderSlots[slot];

  const renderMeta = { ...(project.renderMeta ?? {}) };
  delete renderMeta[slot];

  const updated: Project = {
    ...project,
    renderSlots,
    renderMeta,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return updated;
}
