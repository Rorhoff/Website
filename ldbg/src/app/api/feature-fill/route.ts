import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fillAllEmptyFeatures,
  fillFeature,
  previewFeatureCrop,
} from "@/lib/feature-fill-service";
import { getStorage } from "@/lib/storage";

const BodySchema = z.object({
  projectId: z.string().uuid(),
  featureId: z.string().optional(),
  action: z.enum(["preview", "fill", "fill-all", "regenerate"]).default("fill"),
  quality: z.enum(["draft", "final"]).optional(),
});

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const storage = getStorage();
  const project = await storage.loadProject(body.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    if (body.action === "fill-all") {
      const result = await fillAllEmptyFeatures(body.projectId);
      const updated = await storage.loadProject(body.projectId);
      return NextResponse.json({
        queued: result.queued,
        featureFills: updated?.featureFills,
        featureFillTotalCostUsd: updated?.featureFillTotalCostUsd,
      });
    }

    if (!body.featureId) {
      return NextResponse.json({ error: "featureId required" }, { status: 400 });
    }

    if (body.action === "preview") {
      const result = await previewFeatureCrop(body.projectId, body.featureId);
      return NextResponse.json({
        entry: result.entry,
        cropPreviewFilename: result.cropPreviewFilename,
        cropBox: result.cropBox,
      });
    }

    const force = body.action === "regenerate";
    const { entry, project: updated } = await fillFeature(body.projectId, body.featureId, {
      force,
      quality: body.quality,
    });

    return NextResponse.json({
      entry,
      featureFills: updated.featureFills,
      featureFillTotalCostUsd: updated.featureFillTotalCostUsd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Feature fill failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
