import { NextResponse } from "next/server";
import { isRenderSlotKey } from "@/lib/render-slots";
import { uploadRenderForSlot } from "@/lib/render-service";

type Params = { params: Promise<{ id: string }> };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const form = await req.formData();
  const slot = String(form.get("slot") ?? "");
  const file = form.get("file");

  if (!isRenderSlotKey(slot)) {
    return NextResponse.json({ error: "Invalid render slot" }, { status: 400 });
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Image must be JPEG, PNG, or WebP" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const updated = await uploadRenderForSlot(id, slot, buf, file.type);
  if (!updated) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    slot,
    filename: updated.renderSlots?.[slot],
    renderSlots: updated.renderSlots,
    renderMeta: updated.renderMeta,
  });
}
