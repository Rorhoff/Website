import sharp from "sharp";

const MAX_EDGE_PX = 1568;
const MAX_BYTES = 5 * 1024 * 1024;

export type PreparedImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  downscaleFactor: number;
};

function mediaTypeFromFilename(filename: string): PreparedImage["mediaType"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function encodeJpeg(buf: Buffer, width: number, height: number, quality: number) {
  return sharp(buf)
    .resize(width, height, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

export async function prepareImageForClaude(
  input: Buffer,
  filename: string
): Promise<PreparedImage> {
  const meta = await sharp(input).metadata();
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;
  if (!originalWidth || !originalHeight) {
    throw new Error("Could not read image dimensions");
  }

  const longEdge = Math.max(originalWidth, originalHeight);
  const edgeScale = longEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longEdge : 1;
  let targetWidth = Math.max(1, Math.round(originalWidth * edgeScale));
  let targetHeight = Math.max(1, Math.round(originalHeight * edgeScale));

  let quality = 85;
  let encoded = await encodeJpeg(input, targetWidth, targetHeight, quality);

  while (encoded.length > MAX_BYTES && quality > 40) {
    quality -= 10;
    encoded = await encodeJpeg(input, targetWidth, targetHeight, quality);
  }

  while (encoded.length > MAX_BYTES && Math.max(targetWidth, targetHeight) > 512) {
    targetWidth = Math.max(1, Math.round(targetWidth * 0.85));
    targetHeight = Math.max(1, Math.round(targetHeight * 0.85));
    encoded = await encodeJpeg(input, targetWidth, targetHeight, quality);
  }

  const outMeta = await sharp(encoded).metadata();
  const width = outMeta.width ?? targetWidth;
  const height = outMeta.height ?? targetHeight;
  const downscaleFactor =
    width > 0 && height > 0
      ? Math.max(originalWidth / width, originalHeight / height)
      : 1;

  const sourceType = mediaTypeFromFilename(filename);
  const mediaType: PreparedImage["mediaType"] =
    encoded.length < input.length || edgeScale < 1 ? "image/jpeg" : sourceType;

  return {
    base64: encoded.toString("base64"),
    mediaType,
    width,
    height,
    originalWidth,
    originalHeight,
    downscaleFactor: downscaleFactor > 1.001 ? downscaleFactor : 1,
  };
}
