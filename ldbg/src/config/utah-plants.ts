/** Common landscape plants for Utah County / Salt Lake County (Wasatch Front). */

export type PlantFeatureType =
  | "tree"
  | "tree_specimen"
  | "ornamental_grass"
  | "lavender"
  | "blue_grass"
  | "sagebrush"
  | "boxwood"
  | "daylily"
  | "rabbitbrush"
  | "manzanita"
  | "lantana";

export type UtahPlant = {
  id: string;
  commonName: string;
  botanicalName: string;
  featureType: PlantFeatureType;
  /** Typical planting size canopy/spread diameter in feet (not full mature). */
  canopyDiameterFt: number;
  sun: string;
  water: string;
};

/**
 * New-install sizes, not mature catalog sizes. Trees are all drawn at a 6 ft
 * canopy: a plan showing 20 ft canopies reads as a finished landscape twenty
 * years out and hides the ground the client is actually buying.
 */
export const UTAH_PLANT_PALETTE: UtahPlant[] = [
  {
    id: "quaking-aspen",
    commonName: "Quaking Aspen",
    botanicalName: "Populus tremuloides",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "colorado-blue-spruce",
    commonName: "Colorado Blue Spruce",
    botanicalName: "Picea pungens",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "rocky-mountain-juniper",
    commonName: "Rocky Mountain Juniper",
    botanicalName: "Juniperus scopulorum",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "gambel-oak",
    commonName: "Gambel Oak",
    botanicalName: "Quercus gambelii",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun–part shade",
    water: "Low–moderate",
  },
  {
    id: "bigtooth-maple",
    commonName: "Bigtooth Maple",
    botanicalName: "Acer grandidentatum",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "honeylocust",
    commonName: "Honeylocust (thornless)",
    botanicalName: "Gleditsia triacanthos",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "autumn-blaze-maple",
    commonName: "Autumn Blaze Maple",
    botanicalName: "Acer × freemanii",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "crabapple",
    commonName: "Crabapple",
    botanicalName: "Malus spp.",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "serviceberry",
    commonName: "Serviceberry",
    botanicalName: "Amelanchier spp.",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "eastern-redbud",
    commonName: "Eastern Redbud",
    botanicalName: "Cercis canadensis",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "purple-leaf-plum",
    commonName: "Purple Leaf Plum",
    botanicalName: "Prunus cerasifera",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "austrian-pine",
    commonName: "Austrian Pine",
    botanicalName: "Pinus nigra",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "pinyon-pine",
    commonName: "Pinyon Pine",
    botanicalName: "Pinus edulis",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "linden",
    commonName: "American Linden",
    botanicalName: "Tilia americana",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "hackberry",
    commonName: "Hackberry",
    botanicalName: "Celtis occidentalis",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Low–moderate",
  },
  {
    id: "london-planetree",
    commonName: "London Planetree",
    botanicalName: "Platanus × acerifolia",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "japanese-zelkova",
    commonName: "Japanese Zelkova",
    botanicalName: "Zelkova serrata",
    featureType: "tree",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "flowering-pear",
    commonName: "Flowering Pear",
    botanicalName: "Pyrus calleryana",
    featureType: "tree_specimen",
    canopyDiameterFt: 6,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "lavender-munstead",
    commonName: "Lavender (Munstead)",
    botanicalName: "Lavandula angustifolia",
    featureType: "lavender",
    canopyDiameterFt: 2,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "ornamental-grass-karl-foerster",
    commonName: "Karl Foerster",
    botanicalName: "Calamagrostis × acutiflora 'Karl Foerster'",
    featureType: "ornamental_grass",
    canopyDiameterFt: 2,
    sun: "Full sun",
    water: "Moderate",
  },
  {
    id: "boxwood-bush",
    commonName: "Boxwood Bush",
    botanicalName: "Buxus microphylla",
    featureType: "boxwood",
    canopyDiameterFt: 3,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "daylily",
    commonName: "Daylily",
    botanicalName: "Hemerocallis spp.",
    featureType: "daylily",
    canopyDiameterFt: 2,
    sun: "Full sun–part shade",
    water: "Moderate",
  },
  {
    id: "blue-grama-grass",
    commonName: "Blue Grama Grass",
    botanicalName: "Bouteloua gracilis",
    featureType: "blue_grass",
    canopyDiameterFt: 1.5,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "sagebrush-wyoming",
    commonName: "Wyoming Big Sagebrush",
    botanicalName: "Artemisia tridentata wyomingensis",
    featureType: "sagebrush",
    canopyDiameterFt: 3,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "rabbitbrush",
    commonName: "Rabbitbrush",
    botanicalName: "Ericameria nauseosa",
    featureType: "rabbitbrush",
    canopyDiameterFt: 3,
    sun: "Full sun",
    water: "Low",
  },
  {
    id: "manzanita",
    commonName: "Manzanita",
    botanicalName: "Arctostaphylos patula",
    featureType: "manzanita",
    canopyDiameterFt: 3,
    sun: "Full sun–part shade",
    water: "Low",
  },
  {
    id: "lantana",
    commonName: "Lantana",
    botanicalName: "Lantana camara",
    featureType: "lantana",
    canopyDiameterFt: 2,
    sun: "Full sun",
    water: "Low–moderate",
  },
];

export function getUtahPlant(id: string): UtahPlant | undefined {
  return UTAH_PLANT_PALETTE.find((p) => p.id === id);
}

export function isTreeFeatureType(featureType: string): boolean {
  return featureType === "tree" || featureType === "tree_specimen";
}

export function isPlantPointFeatureType(featureType: string): boolean {
  return UTAH_PLANT_PALETTE.some((p) => p.featureType === featureType);
}

export function isUtahTree(plant: UtahPlant): boolean {
  return isTreeFeatureType(plant.featureType);
}

export const UTAH_TREES = UTAH_PLANT_PALETTE.filter(isUtahTree);

export const UTAH_GROUNDCOVER = UTAH_PLANT_PALETTE.filter((p) => !isUtahTree(p));
