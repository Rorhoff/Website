import type { RenderProviderId } from "@/config/features";
import { renderImg2imgEnabled, rendersFeatureEnabled } from "@/config/features";
import { readBlenderRenderBuffer } from "@/lib/blender-render-service";
import type { StoredDesignContent } from "@/lib/design-content-schema";
import type { Project, RenderMeta, RenderSlots } from "@/lib/project-schema";
import {
  getCachedRenderBuffer,
  renderCacheKey,
  saveCachedRender,
} from "@/lib/render/cache";
import { getRenderProvider } from "@/lib/render";
import type { RenderQuality } from "@/lib/render/types";
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
const ESTIMATED_RENDER_COST_FINAL_USD = 0.12;

export type RenderSuccess = {
  slot: RenderSlotKey;
  filename: string;
  cached: boolean;
  estimatedCostUsd?: number;
  modelNotes?: string;
  cacheKey?: string;
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

async function toPngReference(buf: Buffer): Promise<Buffer> {
  return sharp(buf).png().toBuffer();
}

async function loadReferenceImages(
  project: Project,
  slot: RenderSlotKey
): Promise<{ images: Buffer[]; blenderBase?: string }> {
  const images: Buffer[] = [];

  if (renderImg2imgEnabled()) {
    const blenderBuf = await readBlenderRenderBuffer(project.id, slot);
    if (blenderBuf?.length) {
      images.push(await toPngReference(blenderBuf));
      const blenderBase =
        project.blenderRenders?.[slot]?.filename ??
        `render-blender-${slot}.png`;
      return { images, blenderBase };
    }
  }

  const ref = project.images.clean ?? project.images.annotated;
  if (ref) {
    const buf = await getStorage().readProjectFile(project.id, ref.filename);
    if (buf?.length) {
      images.push(await toPngReference(buf));
    }
  }

  return { images };
}

export async function generateRenderForSlot(
  projectId: string,
  slot: RenderSlotKey,
  options?: {
    force?: boolean;
    provider?: RenderProviderId;
    quality?: RenderQuality;
  }
): Promise<RenderSuccess | RenderFailure> {
  if (!rendersFeatureEnabled()) {
    return {
      error:
        "AI renders are disabled. Set LDBG_RENDERS_ENABLED=true in .env.local to enable.",
    };
  }

  const quality: RenderQuality = options?.quality ?? "draft";
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const prompt = promptForSlot(project.designContent, slot);
  if (!prompt) {
    return {
      error: "Generate design content first — render prompts come from Milestone 5",
    };
  }

  const { images: referenceImages, blenderBase } = await loadReferenceImages(
    project,
    slot
  );
  const cacheKey = renderCacheKey(prompt, quality, referenceImages);

  if (!options?.force) {
    const cachedBuf = await getCachedRenderBuffer(projectId, cacheKey);
    if (cachedBuf?.length) {
      const outName = renderFilenameForSlot(slot, "png");
      await storage.saveProjectFile(projectId, outName, cachedBuf);

      const usedBlenderRef = renderImg2imgEnabled() && !!blenderBase;
      const providerId =
        options?.provider ?? project.renderSettings?.provider ?? "gemini";
      const renderSlots = { ...(project.renderSlots ?? {}), [slot]: outName };
      const renderMeta = {
        ...(project.renderMeta ?? {}),
        [slot]: {
          source: usedBlenderRef ? ("blender+gemini" as const) : ("generated" as const),
          generatedAt: new Date().toISOString(),
          provider: providerId,
          blenderBase: usedBlenderRef ? blenderBase : undefined,
        },
      };

      const updated: Project = {
        ...project,
        renderSlots,
        renderMeta,
        updatedAt: new Date().toISOString(),
      };
      await storage.saveProject(updated);

      return {
        slot,
        filename: outName,
        cached: true,
        cacheKey,
        renderSlots,
        renderMeta,
      };
    }
  }

  const rate = checkRenderRateLimit(projectId);
  if (!rate.allowed) {
    return {
      error: `Rate limited — wait ${rate.retryAfterSec}s before generating again`,
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const providerId =
    options?.provider ?? project.renderSettings?.provider ?? "gemini";

  const provider = getRenderProvider(quality, providerId);
  if (!provider) {
    return { error: "Rendering disabled" };
  }

  recordRenderCall(projectId);

  try {
    const result = await provider.generate({
      prompt,
      referenceImages,
      aspectRatio: "16:9",
      resolution: quality === "final" ? "4K" : "1K",
    });

    await saveCachedRender(projectId, cacheKey, result.image);
    const outName = renderFilenameForSlot(slot, "png");
    await storage.saveProjectFile(projectId, outName, result.image);

    const usedBlenderRef = renderImg2imgEnabled() && !!blenderBase;
    const renderSlots = { ...(project.renderSlots ?? {}), [slot]: outName };
    const renderMeta = {
      ...(project.renderMeta ?? {}),
      [slot]: {
        source: usedBlenderRef ? ("blender+gemini" as const) : ("generated" as const),
        generatedAt: new Date().toISOString(),
        provider: providerId,
        blenderBase: usedBlenderRef ? blenderBase : undefined,
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
      `[render] project=${projectId} slot=${slot} provider=${providerId} quality=${quality} cached=false`
    );

    return {
      slot,
      filename: outName,
      cached: false,
      cacheKey,
      modelNotes: result.modelNotes,
      estimatedCostUsd:
        quality === "final"
          ? ESTIMATED_RENDER_COST_FINAL_USD
          : ESTIMATED_RENDER_COST_USD,
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
