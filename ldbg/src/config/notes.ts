/** Addendum B4 — general notes catalog (numbers assigned at render time). */

export type GeneralNote = {
  id: string;
  text: string;
  defaultOn: boolean;
  category: string;
};

export const GENERAL_NOTES: readonly GeneralNote[] = [
  {
    id: "concept",
    defaultOn: true,
    category: "scope",
    text:
      "This drawing is a conceptual design prepared for client review and " +
      "illustrative purposes only. It is not a construction document and shall " +
      "not be used for bidding, permitting, or construction.",
  },
  {
    id: "not-licensed",
    defaultOn: true,
    category: "scope",
    text:
      "Prepared by a landscape designer. Not prepared by, or under the " +
      "supervision of, a licensed landscape architect, engineer, or surveyor.",
  },
  {
    id: "not-survey",
    defaultOn: true,
    category: "accuracy",
    text:
      "Property lines, structures, and existing conditions are approximate, " +
      "derived from aerial imagery and available public records. This is not a " +
      "boundary survey. Verify all boundaries, setbacks, and easements with a " +
      "licensed surveyor prior to construction.",
  },
  {
    id: "walls",
    defaultOn: true,
    category: "structural",
    text:
      "Retaining walls, structural elements, and any wall exceeding 4 feet in " +
      "exposed height require design and stamping by a licensed engineer. Shown " +
      "here as design intent only.",
  },
  {
    id: "grading",
    defaultOn: true,
    category: "structural",
    text:
      "Grading, drainage, and stormwater management by others. Verify all " +
      "drainage patterns on site.",
  },
  {
    id: "blue-stakes",
    defaultOn: true,
    category: "safety",
    text:
      "Call Blue Stakes of Utah (811) for utility locates a minimum of two " +
      "business days before any excavation.",
  },
  {
    id: "quantities",
    defaultOn: true,
    category: "accuracy",
    text:
      "Quantities, plant counts, areas, and material takeoffs are preliminary " +
      "estimates for planning purposes and may change during design development. " +
      "Contractor to verify all field dimensions and quantities.",
  },
  {
    id: "plants",
    defaultOn: true,
    category: "materials",
    text:
      "Plant material subject to availability. Substitutions to be approved " +
      "by owner.",
  },
  {
    id: "compliance",
    defaultOn: true,
    category: "compliance",
    text:
      "Owner is responsible for compliance with all applicable HOA covenants, " +
      "municipal codes, permits, and water use restrictions.",
  },
  {
    id: "ai-style-pass",
    defaultOn: false,
    category: "accuracy",
    text:
      "Plan graphics include AI-generated renderings for illustrative purposes. All dimensions, areas, and quantities are derived from measured design geometry, not from rendered imagery.",
  },
  {
    id: "ai-feature-fill",
    defaultOn: false,
    category: "accuracy",
    text:
      "Plan graphics include AI-generated material fills clipped to measured feature boundaries for illustrative purposes. All dimensions, areas, and quantities are derived from measured design geometry, not from rendered imagery.",
  },
] as const;

export function defaultEnabledNoteIds(): string[] {
  return GENERAL_NOTES.filter((n) => n.defaultOn).map((n) => n.id);
}
