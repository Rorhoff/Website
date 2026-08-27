import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

type Params = { params: Promise<{ id: string; path: string[] }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, path: segments } = await params;
  if (!segments?.length) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (segments.some((s) => s === ".." || s === ".")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const rel = segments.join("/");
  const buf = await getStorage().readProjectFile(id, rel);
  if (!buf) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = rel.split(".").pop()?.toLowerCase();
  const type =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : ext === "json"
          ? "application/json"
          : "image/jpeg";

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
