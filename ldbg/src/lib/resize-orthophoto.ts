/** Client-side resize/compress when combined size exceeds the upload ceiling. */

import {
  UPLOAD_MAX_BYTES,
  formatUploadMb,
  uploadPreflightError,
} from "@/lib/upload-limits";

export { UPLOAD_MAX_BYTES, formatUploadMb as formatMb };

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

/**
 * TIFF has to be handed to the server untouched. No browser decodes it, so
 * loadImage cannot measure or shrink one — it just reports the file as corrupt.
 * Drone exports are very often .tif, so this is a normal path, not an edge case.
 */
export function needsServerDecode(file: File): boolean {
  return file.type === "image/tiff" || /\.tiff?$/i.test(file.name);
}

export type OrthophotoCompressResult = {
  file: File;
  width: number;
  height: number;
  wasCompressed: boolean;
  originalBytes: number;
};

/**
 * Only compress when over budget. Under the 200 MB ceiling files upload as-is.
 */
export async function compressOrthophotoForUpload(
  file: File,
  options: CompressOptions = {}
): Promise<OrthophotoCompressResult> {
  const maxBytes = options.maxBytes ?? UPLOAD_MAX_BYTES;
  const img = await loadImage(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  if (file.size <= maxBytes) {
    return {
      file,
      width: naturalW,
      height: naturalH,
      wasCompressed: false,
      originalBytes: file.size,
    };
  }

  const longEdge = Math.max(naturalW, naturalH);
  let edge =
    options.maxLongEdge ??
    (longEdge > 8000 ? 5000 : longEdge > 6000 ? 5500 : 6000);

  let quality = 0.88;
  let blob = await renderToBlob(img, edge, quality);

  while (blob.size > maxBytes && quality > 0.45) {
    quality -= 0.05;
    blob = await renderToBlob(img, edge, quality);
  }

  while (blob.size > maxBytes && edge > 2000) {
    edge = Math.round(edge * 0.82);
    quality = 0.82;
    blob = await renderToBlob(img, edge, quality);
    while (blob.size > maxBytes && quality > 0.45) {
      quality -= 0.05;
      blob = await renderToBlob(img, edge, quality);
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(uploadPreflightError(file.size, file.name));
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

/** Shrink a pair of files only when their combined size exceeds the ceiling. */
export async function prepareOrthophotoPairForUpload(
  annotated: File,
  clean: File
): Promise<{ annotated: OrthophotoCompressResult; clean: OrthophotoCompressResult }> {
  const combined = annotated.size + clean.size;
  if (combined <= UPLOAD_MAX_BYTES) {
    const annImg = await loadImage(annotated);
    const cleanImg = await loadImage(clean);
    return {
      annotated: {
        file: annotated,
        width: annImg.naturalWidth,
        height: annImg.naturalHeight,
        wasCompressed: false,
        originalBytes: annotated.size,
      },
      clean: {
        file: clean,
        width: cleanImg.naturalWidth,
        height: cleanImg.naturalHeight,
        wasCompressed: false,
        originalBytes: clean.size,
      },
    };
  }

  const annBudget = Math.floor(UPLOAD_MAX_BYTES * 0.48);
  const ann = await compressOrthophotoForUpload(annotated, { maxBytes: annBudget });
  const cl = await compressOrthophotoForUpload(clean, {
    maxBytes: UPLOAD_MAX_BYTES - ann.file.size,
  });
  return { annotated: ann, clean: cl };
}
