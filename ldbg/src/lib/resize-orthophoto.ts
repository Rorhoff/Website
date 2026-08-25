/** Client-side resize/compress for large drone orthophotos before upload. */

/** Stay under default nginx 12MB until /ldbg 200M location is installed. */
export const UPLOAD_SAFE_COMBINED_BYTES = 10 * 1024 * 1024;

const DEFAULT_MAX_LONG_EDGE = 5000;

export type CompressOptions = {
  maxLongEdge?: number;
  maxBytes?: number;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not load ${file.name} — file may be corrupt`));
    };
    img.src = url;
  });
}

function renderToBlob(
  img: HTMLImageElement,
  maxLongEdge: number,
  quality: number
): Promise<Blob> {
  let w = img.naturalWidth || 0;
  let h = img.naturalHeight || 0;
  if (!w || !h) return Promise.reject(new Error("Invalid image dimensions"));

  const scale = Math.min(1, maxLongEdge / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not process image"));
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not compress image")),
      "image/jpeg",
      quality
    );
  });
}

export type OrthophotoCompressResult = {
  file: File;
  width: number;
  height: number;
  wasCompressed: boolean;
  originalBytes: number;
};

/**
 * Shrink desktop full-size drone JPEGs (often 20–50 MB) before upload.
 * Mobile gallery picks are usually pre-shrunk by the OS — this matches that behavior.
 */
export async function compressOrthophotoForUpload(
  file: File,
  options: CompressOptions = {}
): Promise<OrthophotoCompressResult> {
  const maxBytes = options.maxBytes ?? UPLOAD_SAFE_COMBINED_BYTES / 2;
  const img = await loadImage(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const longEdge = Math.max(naturalW, naturalH);

  let edge =
    options.maxLongEdge ??
    (longEdge > 8000 ? 4500 : longEdge > 6000 ? 5000 : DEFAULT_MAX_LONG_EDGE);

  if (file.size > 15 * 1024 * 1024) {
    edge = Math.min(edge, 4500);
  }

  let quality = file.size > 10 * 1024 * 1024 ? 0.82 : 0.88;
  let blob = await renderToBlob(img, edge, quality);

  while (blob.size > maxBytes && quality > 0.45) {
    quality -= 0.05;
    blob = await renderToBlob(img, edge, quality);
  }

  while (blob.size > maxBytes && edge > 2000) {
    edge = Math.round(edge * 0.8);
    quality = 0.8;
    blob = await renderToBlob(img, edge, quality);
    while (blob.size > maxBytes && quality > 0.45) {
      quality -= 0.05;
      blob = await renderToBlob(img, edge, quality);
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(
      `${file.name} is still ${formatMb(blob.size)} MB after compression — try a smaller export from your drone app.`
    );
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "orthophoto";
  const out = new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  const scale = edge / longEdge;
  const outW = Math.max(1, Math.round(naturalW * Math.min(1, scale)));
  const outH = Math.max(1, Math.round(naturalH * Math.min(1, scale)));

  return {
    file: out,
    width: outW,
    height: outH,
    wasCompressed: true,
    originalBytes: file.size,
  };
}

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
