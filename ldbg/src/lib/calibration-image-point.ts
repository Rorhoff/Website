export type NormalizedPoint = { x: number; y: number };

/** Map a click to normalized image coords (0–1), accounting for object-contain letterboxing. */
export function normalizedImagePointFromClick(
  e: React.MouseEvent,
  imageEl: HTMLImageElement | null
): NormalizedPoint | null {
  if (!imageEl) return null;
  const rect = imageEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}
