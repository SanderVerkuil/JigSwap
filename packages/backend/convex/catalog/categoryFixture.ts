// Fixture data for the generic catalog taxonomy (`adminCategories`), applied by
// catalog/seedCategories. Array order is the sortOrder (index + 1). `aggregateId` pins a target to
// a row that already exists on dev and prod (same ids on both), so it is renamed in place instead
// of duplicated. Colours sit on the admin list's swatch, so they are mid-tone and distinct.

interface Localized {
  readonly en: string;
  readonly nl: string;
}

export interface CategoryFixtureEntry {
  readonly aggregateId?: string;
  readonly name: Localized;
  readonly description: Localized;
  readonly color: string;
}

export const CATEGORY_FIXTURE: readonly CategoryFixtureEntry[] = [
  {
    aggregateId: "2a85ac94-8641-4548-ad7c-57bb3a4131c8", // was "Animals"
    name: { en: "Animals", nl: "Dieren" },
    description: {
      en: "Pets, wildlife and birds",
      nl: "Huisdieren, wilde dieren en vogels",
    },
    color: "#F97316",
  },
  {
    aggregateId: "19261ebd-353a-478c-b4a4-04e11a94ecb7", // was "Landscape"
    name: { en: "Nature & Landscapes", nl: "Natuur & landschappen" },
    description: {
      en: "Mountains, forests, coasts and skies",
      nl: "Bergen, bossen, kusten en luchten",
    },
    color: "#22C55E",
  },
  {
    aggregateId: "497af941-c5da-4c32-9735-661a55a075bb", // was "Flowers"
    name: { en: "Flowers & Gardens", nl: "Bloemen & tuinen" },
    description: {
      en: "Bouquets, blooms and garden scenes",
      nl: "Boeketten, bloemen en tuinen",
    },
    color: "#EC4899",
  },
  {
    aggregateId: "0160a2fd-6d91-4fde-a012-b2526402c830", // was "Traveling"
    name: { en: "Cities & Landmarks", nl: "Steden & bezienswaardigheden" },
    description: {
      en: "Skylines, streets and famous places",
      nl: "Skylines, straten en bekende plekken",
    },
    color: "#64748B",
  },
  {
    name: { en: "Maps", nl: "Landkaarten" },
    description: {
      en: "World maps, atlases and globes",
      nl: "Wereldkaarten, atlassen en globes",
    },
    color: "#0EA5E9",
  },
  {
    name: { en: "Fine Art", nl: "Kunst" },
    description: {
      en: "Classic and modern paintings",
      nl: "Klassieke en moderne schilderijen",
    },
    color: "#8B5CF6",
  },
  {
    aggregateId: "78612f07-55ca-4997-bc86-3085547d9f87", // was "Fantasy"
    name: { en: "Fantasy & Fairy Tales", nl: "Fantasie & sprookjes" },
    description: {
      en: "Dragons, castles and enchanted worlds",
      nl: "Draken, kastelen en betoverde werelden",
    },
    color: "#D946EF",
  },
  {
    name: { en: "Sci-fi & Space", nl: "Sciencefiction & ruimte" },
    description: {
      en: "Planets, stars and futuristic worlds",
      nl: "Planeten, sterren en futuristische werelden",
    },
    color: "#6366F1",
  },
  {
    name: { en: "Food & Drink", nl: "Eten & drinken" },
    description: {
      en: "Sweets, kitchens, cafés and markets",
      nl: "Lekkernijen, keukens, cafés en markten",
    },
    color: "#EF4444",
  },
  {
    name: { en: "Nostalgia & History", nl: "Nostalgie & geschiedenis" },
    description: {
      en: "Vintage scenes and bygone days",
      nl: "Vintage taferelen en vervlogen tijden",
    },
    color: "#B45309",
  },
  {
    name: { en: "Cottages & Country Life", nl: "Rustiek & landelijk" },
    description: {
      en: "Cottages, farms and village life",
      nl: "Cottages, boerderijen en dorpsleven",
    },
    color: "#84CC16",
  },
  {
    name: { en: "Seasons & Holidays", nl: "Seizoenen & feestdagen" },
    description: {
      en: "Christmas, Easter and the four seasons",
      nl: "Kerst, Pasen en de vier seizoenen",
    },
    color: "#F59E0B",
  },
  {
    name: { en: "Transport", nl: "Vervoer" },
    description: {
      en: "Trains, cars, ships and planes",
      nl: "Treinen, auto's, schepen en vliegtuigen",
    },
    color: "#3B82F6",
  },
  {
    name: { en: "Film, TV & Characters", nl: "Film, tv & personages" },
    description: {
      en: "Movies, series and well-known characters",
      nl: "Films, series en bekende personages",
    },
    color: "#F43F5E",
  },
  {
    name: { en: "Cartoon & Humour", nl: "Cartoon & humor" },
    description: {
      en: "Cartoons, comics and funny scenes",
      nl: "Cartoons, strips en grappige taferelen",
    },
    color: "#EAB308",
  },
  {
    aggregateId: "bafb20f9-618d-4303-a236-0af303a5a32a", // was "Colourfull"
    name: { en: "Patterns & Colour", nl: "Patronen & kleur" },
    description: {
      en: "Gradients, mosaics and abstract designs",
      nl: "Kleurverlopen, mozaïeken en abstracte ontwerpen",
    },
    color: "#14B8A6",
  },
  {
    name: { en: "Music, Sports & Hobbies", nl: "Muziek, sport & hobby's" },
    description: {
      en: "Instruments, sports and pastimes",
      nl: "Instrumenten, sport en hobby's",
    },
    color: "#06B6D4",
  },
];

// Rows that leave the taxonomy. Deactivated (hidden), never deleted, so any reference survives.
// Matched like the targets: by aggregateId first, then by case-insensitive English name.
export const RETIRED_CATEGORIES: readonly {
  readonly aggregateId: string;
  readonly en: string;
}[] = [
  { aggregateId: "9718ab40-2753-4825-ad6a-2b16be863307", en: "Nature" },
  { aggregateId: "20f75ac7-d8e8-4257-b108-f67d3f1dff0a", en: "Cats" },
  { aggregateId: "9ea17db4-2468-4be1-9de0-da16909913c1", en: "Dogs" },
  { aggregateId: "4c9d591a-c542-445f-bda4-d2da4a3babdd", en: "Easy puzzles" },
];
