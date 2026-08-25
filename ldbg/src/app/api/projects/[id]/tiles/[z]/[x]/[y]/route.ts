import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { readTileFile } from "@/lib/tile-pyramid-service";

type Params = { params: Promise<{ id: string; z: string; x: string; y: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, z, x, y: yRaw } = await params;
  const yMatch = yRaw.match(/^(\d+)\.jpg$/i);
  if (!yMatch) {
    return NextResponse.json({ error: "Invalid tile path" }, { status: 400 });
  }

  const project = await getStorage().loadProject(id);
  if (!project?.tilePyramid) {
    return NextResponse.json({ error: "No tile pyramid" }, { status: 404 });
  }

  const zi = Number(z);
  const xi = Number(x);
  const yi = Number(yMatch[1]);
  if (
    !Number.isInteger(zi) ||
    !Number.isInteger(xi) ||
    !Number.isInteger(yi) ||
    zi < project.tilePyramid.minZoom ||
    zi > project.tilePyramid.maxZoom
  ) {
    return NextResponse.json({ error: "Tile out of range" }, { status: 404 });
  }

  const buf = await readTileFile(id, zi, xi, yi);
  if (!buf) {
    return NextResponse.json({ error: "Tile not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
