import { NextResponse } from "next/server";
import { z } from "zod";
import { isRenderSlotKey } from "@/lib/render-slots";
import {
  clearRenderSlot,
  generateRenderForSlot,
} from "@/lib/render-service";

type Params = { params: Promise<{ id: string }> };

const PostBodySchema = z.object({
  slot: z.string(),
  force: z.boolean().optional(),
  quality: z.enum(["draft", "final"]).optional(),
});

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid body — need slot (hero | entry | fire_pit | hero_dusk)" },
      { status: 400 }
    );
  }

  if (!isRenderSlotKey(body.slot)) {
    return NextResponse.json({ error: "Invalid render slot" }, { status: 400 });
  }

  const result = await generateRenderForSlot(id, body.slot, {
    force: body.force,
    quality: body.quality,
  });

  if ("error" in result) {
    const status = result.retryAfterSec ? 429 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const slot = new URL(req.url).searchParams.get("slot");
  if (!slot || !isRenderSlotKey(slot)) {
    return NextResponse.json({ error: "Invalid or missing slot" }, { status: 400 });
  }

  const updated = await clearRenderSlot(id, slot);
  if (!updated) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    renderSlots: updated.renderSlots,
    renderMeta: updated.renderMeta,
  });
}
