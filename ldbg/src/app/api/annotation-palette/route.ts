import { NextResponse } from "next/server";
import { parseAnnotationPalette } from "@/lib/annotation-palette";
import { getAnnotationPalette, getStorage } from "@/lib/storage";

export async function GET() {
  const palette = await getAnnotationPalette();
  return NextResponse.json(palette);
}

export async function PUT(req: Request) {
  let entries: unknown;
  try {
    entries = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const parsed = parseAnnotationPalette(entries);
    await getStorage().savePaletteOverrides(parsed);
    return NextResponse.json(await getAnnotationPalette());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid palette" },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  await getStorage().clearPaletteOverrides();
  return NextResponse.json(await getAnnotationPalette());
}
