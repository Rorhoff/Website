import { z } from "zod";
import defaultPalette from "@/config/annotation-palette.json";

export const GeometryTypeSchema = z.enum(["area", "line", "point"]);
export type GeometryType = z.infer<typeof GeometryTypeSchema>;

export const AnnotationPaletteEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  hexRef: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  hueRange: z.tuple([z.number(), z.number()]),
  satMin: z.number().min(0).max(1),
  valRange: z.tuple([z.number(), z.number()]),
  geometryType: GeometryTypeSchema,
  featureType: z.string().min(1),
  maxLabDistance: z.number().positive(),
});

export type AnnotationPaletteEntry = z.infer<typeof AnnotationPaletteEntrySchema>;

export const AnnotationPaletteSchema = z.array(AnnotationPaletteEntrySchema).min(1);

export const DEFAULT_ANNOTATION_PALETTE: AnnotationPaletteEntry[] =
  AnnotationPaletteSchema.parse(defaultPalette);

export function parseAnnotationPalette(raw: unknown): AnnotationPaletteEntry[] {
  return AnnotationPaletteSchema.parse(raw);
}

export function paletteEntryByFeatureType(
  palette: AnnotationPaletteEntry[],
  featureType: string
): AnnotationPaletteEntry | undefined {
  return palette.find((e) => e.featureType === featureType);
}
