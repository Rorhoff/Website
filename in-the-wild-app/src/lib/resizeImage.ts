/** Resize/compress an image file for avatar upload. */

const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_DIM = 800;

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
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

function renderToBlob(img: HTMLImageElement, maxDim: number, quality: number): Promise<Blob> {
  let w = img.naturalWidth || 0;
  let h = img.naturalHeight || 0;
  if (!w || !h) return Promise.reject(new Error('Invalid image dimensions'));
  const scale = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not process image'));
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not compress image'))),
      'image/jpeg',
      quality,
    );
  });
}

export async function compressImageForUpload(
  file: File,
  maxBytes = DEFAULT_MAX_BYTES,
  maxDim = DEFAULT_MAX_DIM,
): Promise<File> {
  const img = await loadImage(file);
  let dim = maxDim;
  let quality = 0.88;
  let blob = await renderToBlob(img, dim, quality);
  while (blob.size > maxBytes && quality > 0.45) {
    quality -= 0.08;
    blob = await renderToBlob(img, dim, quality);
  }
  while (blob.size > maxBytes && dim > 256) {
    dim = Math.round(dim * 0.75);
    quality = 0.85;
    blob = await renderToBlob(img, dim, quality);
  }
  if (blob.size > maxBytes) {
    throw new Error('Photo is still too large. Try a smaller image.');
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'avatar';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}
