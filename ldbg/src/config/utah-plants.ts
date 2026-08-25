/** Common landscape plants for Utah County / Salt Lake County (Wasatch Front). */

export type UtahPlant = {
  id: string;
  commonName: string;
  botanicalName: string;
  featureType: "tree" | "tree_specimen";
  /** Typical mature canopy diameter in feet at landscape size. */
  canopyDiameterFt: number;
  sun: string;
  water: string;
};

export const UTAH_PLANT_PALETTE: UtahPlant[] = [
  {
    id: "quaking-aspen",
    commonName: "Quaking Aspen",
    botanicalName: "Populus tremuloides",
    featureType: "tree",
    canopyDiameterFt: 24,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "colorado-blue-spruce",
    commonName: "Colorado Blue Spruce",
    botanicalName: "Picea pungens",
    featureType: "tree_specimen",
    canopyDiameterFt: 18,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "rocky-mountain-juniper",
    commonName: "Rocky Mountain Juniper",
    botanicalName: "Juniperus scopulorum",
    featureType: "tree",
    canopyDiameterFt: 14,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "gambel-oak",
    commonName: "Gambel Oak",
    botanicalName: "Quercus gambelii",
    featureType: "tree",
    canopyDiameterFt: 16,
    sun: "Full sun–part shade",
    water: "Low–moderate",
  },
  {
    id: "bigtooth-maple",
    commonName: "Bigtooth Maple",
    botanicalName: "Acer grandidentatum",
    featureType: "tree_specimen",
    canopyDiameterFt: 20,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "honeylocust",
    commonName: "Honeylocust (thornless)",
    botanicalName: "Gleditsia triacanthos",
    featureType: "tree",
    canopyDiameterFt: 32,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "autumn-blaze-maple",
    commonName: "Autumn Blaze Maple",
    botanicalName: "Acer × freemanii",
    featureType: "tree",
    canopyDiameterFt: 30,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "crabapple",
    commonName: "Crabapple",
    botanicalName: "Malus spp.",
    featureType: "tree_specimen",
    canopyDiameterFt: 14,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "serviceberry",
    commonName: "Serviceberry",
    botanicalName: "Amelanchier spp.",
    featureType: "tree_specimen",
    canopyDiameterFt: 12,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "eastern-redbud",
    commonName: "Eastern Redbud",
    botanicalName: "Cercis canadensis",
    featureType: "tree_specimen",
    canopyDiameterFt: 18,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "purple-leaf-plum",
    commonName: "Purple Leaf Plum",
    botanicalName: "Prunus cerasifera",
    featureType: "tree_specimen",
    canopyDiameterFt: 16,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "austrian-pine",
    commonName: "Austrian Pine",
    botanicalName: "Pinus nigra",
    featureType: "tree",
    canopyDiameterFt: 28,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "pinyon-pine",
    commonName: "Pinyon Pine",
    botanicalName: "Pinus edulis",
    featureType: "tree",
    canopyDiameterFt: 16,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "linden",
    commonName: "American Linden",
    botanicalName: "Tilia americana",
    featureType: "tree",
    canopyDiameterFt: 34,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "hackberry",
    commonName: "Hackberry",
    botanicalName: "Celtis occidentalis",
    featureType: "tree",
    canopyDiameterFt: 30,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "london-planetree",
    commonName: "London Planetree",
    botanicalName: "Platanus × acerifolia",
    featureType: "tree",
    canopyDiameterFt: 36,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "japanese-zelkova",
    commonName: "Japanese Zelkova",
    botanicalName: "Zelkova serrata",
    featureType: "tree",
    canopyDiameterFt: 28,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "flowering-pear",
    commonName: "Flowering Pear",
    botanicalName: "Pyrus calleryana",
    featureType: "tree_specimen",
    canopyDiameterFt: 22,
    sun: "Full sun",
    water: "Moderate",
  },
];

export function getUtahPlant(id: string): UtahPlant | undefined {
  return UTAH_PLANT_PALETTE.find((p) => p.id === id);
}

export function isTreeFeatureType(featureType: string): boolean {
  return featureType === "tree" || featureType === "tree_specimen";
}
