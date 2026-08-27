import { withBasePath } from "@/lib/paths";

/** Encode a project-relative path as URL segments (supports derived/… nested paths). */
export function projectFilePathSegments(filename: string): string {
  return filename
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function readImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image dimensions"));
    };
    img.src = url;
  });
}

export function projectImageUrl(projectId: string, filename: string) {
  return withBasePath(
    `/api/projects/${encodeURIComponent(projectId)}/files/${projectFilePathSegments(filename)}`
  );
}
