import type { Project } from "@/lib/project-schema";

export function validateAnnotatedDimensions(
  project: Project,
  width: number,
  height: number
): { ok: true } | { ok: false; error: string } {
  const base = project.annotationBase;
  if (!base) {
    return { ok: true };
  }

  if (width === base.width && height === base.height) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Annotated image must be exactly ${base.width}×${base.height}px (matches annotation-base.jpg). Your upload is ${width}×${height}px — re-export annotation base from the app and draw on that file without cropping or resizing.`,
  };
}

export function annotatedMatchesAnnotationBase(project: Project): boolean {
  const base = project.annotationBase;
  const ann = project.images.annotated;
  if (!base || !ann) return false;
  return ann.width === base.width && ann.height === base.height;
}
