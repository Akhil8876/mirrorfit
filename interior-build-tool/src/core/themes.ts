// GEN-01: starter theme library. Each theme maps to real catalog materials so options are costable.

export interface Theme {
  id: string;
  name: string;
  description: string;
  palette: string[]; // dominant → accent
  floor: string; // material ids
  floorAlt: string;
  wall: string;
  accent: string;
  laminate: string;
  laminateAlt: string;
  ceiling: 'cove' | 'flat' | 'none';
  cct: number; // colour temperature, K
  tags: string[];
  preferItems: string[]; // catalog ids preferred by the theme
  density: 'sparse' | 'balanced' | 'layered';
}

export const THEMES: Theme[] = [
  { id: 'modern', name: 'Modern', description: 'Clean lines, neutral base, matte finishes and one bold accent.', palette: ['#f3efe6', '#b8b6b1', '#4a4a48', '#c9a77c'], floor: 'fl-vit-grey', floorAlt: 'fl-concrete', wall: 'pt-white', accent: 'pt-charcoal', laminate: 'lam-grey', laminateAlt: 'lam-white', ceiling: 'cove', cct: 4000, tags: ['matte', 'neutral', 'clean lines'], preferItems: ['sofa-l', 'bed-king', 'wardrobe-sliding'], density: 'balanced' },
  { id: 'contemporary', name: 'Contemporary', description: 'Current, soft-edged and layered with warm metallics.', palette: ['#efe8dc', '#d6cfc4', '#8a6446', '#34445e'], floor: 'fl-vit-ivory', floorAlt: 'fl-wood-oak', wall: 'pt-greige', accent: 'pt-navy', laminate: 'lam-walnut', laminateAlt: 'lam-oak', ceiling: 'cove', cct: 3500, tags: ['soft', 'layered', 'metal accents'], preferItems: ['sofa-3', 'bed-king', 'wardrobe-hinged'], density: 'balanced' },
  { id: 'minimalist', name: 'Minimalist', description: 'Few pieces, hidden storage, white and pale wood.', palette: ['#f5f3ee', '#e6dccb', '#c9a77c', '#7a7e82'], floor: 'fl-vit-ivory', floorAlt: 'fl-wood-oak', wall: 'pt-white', accent: 'pt-greige', laminate: 'lam-white', laminateAlt: 'lam-oak', ceiling: 'flat', cct: 4000, tags: ['handle-less', 'white', 'sparse'], preferItems: ['sofa-3', 'bed-queen', 'wardrobe-sliding'], density: 'sparse' },
  { id: 'scandinavian', name: 'Scandinavian', description: 'Light oak, soft whites, textiles and plants.', palette: ['#f3efe6', '#c9a77c', '#a9b59a', '#7a7e82'], floor: 'fl-wood-oak', floorAlt: 'fl-lam-walnut', wall: 'pt-white', accent: 'pt-sage', laminate: 'lam-oak', laminateAlt: 'lam-white', ceiling: 'flat', cct: 3000, tags: ['light wood', 'textiles', 'plants'], preferItems: ['sofa-3', 'bed-queen', 'wardrobe-hinged', 'plant'], density: 'balanced' },
  { id: 'japandi', name: 'Japandi', description: 'Japanese restraint meets Scandinavian warmth; low furniture, cane and oak.', palette: ['#e6dccb', '#c9a77c', '#6e4e36', '#a9b59a'], floor: 'fl-wood-oak', floorAlt: 'fl-kota', wall: 'pt-greige', accent: 'wp-cane', laminate: 'lam-oak', laminateAlt: 'lam-walnut', ceiling: 'cove', cct: 2700, tags: ['cane', 'low furniture', 'earthy'], preferItems: ['sofa-wood', 'bed-queen', 'wardrobe-sliding'], density: 'sparse' },
  { id: 'industrial', name: 'Industrial', description: 'Concrete, charcoal, black metal and exposed character.', palette: ['#9a9a96', '#4a4a48', '#6b4a32', '#c07a5a'], floor: 'fl-concrete', floorAlt: 'fl-vit-grey', wall: 'pt-greige', accent: 'pt-charcoal', laminate: 'lam-walnut', laminateAlt: 'lam-grey', ceiling: 'none', cct: 3000, tags: ['concrete', 'black metal', 'raw'], preferItems: ['sofa-l', 'bed-queen', 'wardrobe-hinged'], density: 'balanced' },
  { id: 'midcentury', name: 'Mid-century', description: 'Walnut, tapered legs, mustard and teal.', palette: ['#efe8dc', '#6b4a32', '#d8b26a', '#2f6f73'], floor: 'fl-lam-walnut', floorAlt: 'fl-wood-oak', wall: 'pt-white', accent: 'pt-terracotta', laminate: 'lam-walnut', laminateAlt: 'lam-oak', ceiling: 'flat', cct: 3000, tags: ['walnut', 'tapered legs', 'retro colour'], preferItems: ['sofa-3', 'bed-queen', 'armchair'], density: 'balanced' },
  { id: 'traditional', name: 'Traditional Indian', description: 'Teak, brass, jaali patterns and rich earth tones.', palette: ['#efe2c8', '#a06a3a', '#c07a5a', '#7a2e2e'], floor: 'fl-marble', floorAlt: 'fl-kota', wall: 'pt-white', accent: 'pt-terracotta', laminate: 'ven-teak', laminateAlt: 'lam-walnut', ceiling: 'cove', cct: 2700, tags: ['teak', 'brass', 'jaali'], preferItems: ['sofa-wood', 'bed-traditional', 'pooja-unit', 'wardrobe-hinged'], density: 'layered' },
  { id: 'classic', name: 'Classic / Neo-classical', description: 'Mouldings, symmetry, marble and soft gold.', palette: ['#f4efe6', '#eeeae4', '#c9b07a', '#34445e'], floor: 'fl-marble', floorAlt: 'fl-vit-ivory', wall: 'pt-luxury', accent: 'pt-navy', laminate: 'lam-acrylic', laminateAlt: 'lam-white', ceiling: 'cove', cct: 3000, tags: ['mouldings', 'symmetry', 'marble'], preferItems: ['sofa-3', 'bed-king', 'wardrobe-hinged'], density: 'layered' },
  { id: 'bohemian', name: 'Bohemian', description: 'Collected, colourful, cane and plants everywhere.', palette: ['#efe2c8', '#c07a5a', '#5d8a5a', '#d8b26a'], floor: 'fl-kota', floorAlt: 'fl-lam-walnut', wall: 'pt-white', accent: 'wp-cane', laminate: 'lam-oak', laminateAlt: 'lam-sage', ceiling: 'none', cct: 2700, tags: ['pattern', 'plants', 'cane'], preferItems: ['sofa-wood', 'bed-queen', 'rug', 'plant'], density: 'layered' },
  { id: 'coastal', name: 'Coastal', description: 'Breezy whites, sea blues and natural fibres.', palette: ['#f5f3ee', '#9fc3d6', '#e6dccb', '#34445e'], floor: 'fl-vit-ivory', floorAlt: 'fl-wood-oak', wall: 'pt-white', accent: 'pt-sky', laminate: 'lam-white', laminateAlt: 'lam-oak', ceiling: 'flat', cct: 4000, tags: ['blue', 'natural fibres', 'airy'], preferItems: ['sofa-3', 'bed-queen', 'wardrobe-sliding'], density: 'balanced' },
  { id: 'luxury', name: 'Luxury', description: 'Statement marble, fluted panels, acrylic and layered light.', palette: ['#eeeae4', '#6e4e36', '#2d2d2d', '#c9b07a'], floor: 'fl-marble', floorAlt: 'fl-wood-oak', wall: 'pt-luxury', accent: 'wp-fluted', laminate: 'lam-acrylic', laminateAlt: 'ven-teak', ceiling: 'cove', cct: 3000, tags: ['marble', 'fluted', 'gloss'], preferItems: ['sofa-l', 'bed-king', 'wardrobe-sliding', 'bar-unit'], density: 'layered' },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** Budget bands → indicative fit-out rate per sq ft of carpet area (INR). */
export const BUDGET_BANDS = {
  economy: { label: 'Economy', perSqft: 1400 },
  standard: { label: 'Standard', perSqft: 2200 },
  premium: { label: 'Premium', perSqft: 3500 },
  luxury: { label: 'Luxury', perSqft: 5500 },
} as const;
