/** Compute pixels per foot from two normalized image points and real-world distance. */
export function computePixelsPerFoot(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
  distanceFeet: number
): number {
  const dx = (pointB.x - pointA.x) * imageWidth;
  const dy = (pointB.y - pointA.y) * imageHeight;
  const pixelDistance = Math.hypot(dx, dy);
  if (pixelDistance <= 0 || distanceFeet <= 0) {
    throw new Error("Invalid calibration points or distance");
  }
  return pixelDistance / distanceFeet;
}
