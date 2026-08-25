import sharp from "sharp";
import {
  toDimensionRecord,
  type ImageDimensionRecord,
} from "@/lib/image-dimensions";

export async function readImageDimensionsFromBuffer(
  buffer: Buffer
): Promise<ImageDimensionRecord> {
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("Could not read image dimensions from file bytes");
  }
  return toDimensionRecord(width, height);
}
