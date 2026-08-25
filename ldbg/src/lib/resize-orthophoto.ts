/** Client-side resize/compress for large drone orthophotos before upload. */

const DEFAULT_MAX_LONG_EDGE = 6000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

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
      reject(new Error("Could not load image"));
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
};

/** Shrink 50MP+ JPEGs for upload while preserving aspect ratio. */
export async function compressOrthophotoForUpload(
  file: File,
  maxLongEdge = DEFAULT_MAX_LONG_EDGE,
  maxBytes = DEFAULT_MAX_BYTES
): Promise<OrthophotoCompressResult> {
  const img = await loadImage(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const needsResize = Math.max(naturalW, naturalH) > maxLongEdge;
  const needsCompress = file.size > maxBytes || file.type !== "image/jpeg";

  if (!needsResize && !needsCompress) {
    return { file, width: naturalW, height: naturalH, wasCompressed: false };
  }

  let edge = needsResize ? maxLongEdge : Math.max(naturalW, naturalH);
  let quality = 0.92;
  let blob = await renderToBlob(img, edge, quality);

  while (blob.size > maxBytes && quality > 0.5) {
    quality -= 0.06;
    blob = await renderToBlob(img, edge, quality);
  }

  while (blob.size > maxBytes && edge > 2400) {
    edge = Math.round(edge * 0.82);
    quality = 0.88;
    blob = await renderToBlob(img, edge, quality);
    while (blob.size > maxBytes && quality > 0.5) {
      quality -= 0.06;
      blob = await renderToBlob(img, edge, quality);
    }
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "orthophoto";
  const out = new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  const scale = edge / Math.max(naturalW, naturalH);
  const outW = Math.max(1, Math.round(naturalW * Math.min(1, scale)));
  const outH = Math.max(1, Math.round(naturalH * Math.min(1, scale)));

  return {
    file: out,
    width: outW,
    height: outH,
    wasCompressed: true,
  };
}

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
