import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string; filename: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, filename } = await params;
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const buf = await getStorage().readProjectFile(id, safe);
  if (!buf) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  const ext = safe.split(".").pop()?.toLowerCase();
  const type =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
