// CAT-01 / GEN-34 / BOQ-10: buildable catalog items with locked specifications.
// Rates are indicative INR placeholders for a firm to overwrite in its rate library (BOQ-03).

import type { Trade, PointKind } from './types';

export const CATALOG_VERSION = 'cat-2026.11.1';

export type Tier = 'economy' | 'standard' | 'premium' | 'luxury';

export interface Spec { brand: string; series: string; grade: string; thickness?: string; warranty?: string; care?: string }

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  trade: Trade;
  kind: 'sku' | 'custom-joinery';
  w: number; d: number; h: number; elev?: number;
  minW?: number; maxW?: number; module?: number; // parametric sizing (GEN-12)
  unit: 'each' | 'sqft-front' | 'rft';
  rate: number;
  tier: Tier;
  themes?: string[];
  rooms?: string[];
  clearance?: number; // front clearance required
  color: string;
  spec: Spec;
  sku?: string;
  joinery?: boolean;
  wallMounted?: boolean;
  low?: boolean; // can sit under a window / does not block walkways (rugs)
}

export interface Material {
  id: string;
  name: string;
  kind: 'floor' | 'paint' | 'wallpaper' | 'tile' | 'ceiling' | 'laminate' | 'veneer' | 'skirting' | 'stone';
  code: string;
  color: string;
  rate: number; // INR per sq ft (or rft for skirting)
  wastage: number; // fraction
  tier: Tier;
  tile?: { w: number; h: number };
  glossy?: boolean;
  spec: Spec;
}

const S = (brand: string, series: string, grade: string, thickness?: string, warranty?: string, care?: string): Spec => ({ brand, series, grade, thickness, warranty, care });
const PLY = S('Firm approved make', 'BWP plywood + laminate', 'IS 710 BWP, 1 mm HPL outside, 0.8 mm liner', '18 mm carcass / 6 mm back', '10 years carcass', 'Wipe with a damp cloth; avoid standing water on edges.');
const PLY_KITCHEN = S('Firm approved make', 'BWP plywood + laminate', 'IS 710 BWP (marine), 1 mm HPL, 2 mm ABS edge band', '18 mm', '10 years carcass', 'Keep sink base dry; check hinge screws yearly.');

export const ITEMS: CatalogItem[] = [
  // Beds
  { id: 'bed-king', name: 'King bed with storage', category: 'bed', trade: 'furniture', kind: 'sku', sku: 'BED-K-1820', w: 1950, d: 2150, h: 450, unit: 'each', rate: 58000, tier: 'standard', themes: ['modern', 'contemporary', 'luxury', 'classic'], rooms: ['bedroom'], clearance: 600, color: '#b08a66', spec: S('Catalog', 'Hydraulic storage bed', 'Engineered wood, 1830 × 1980 mattress', undefined, '5 years', 'Do not overload the hydraulic lift.') },
  { id: 'bed-queen', name: 'Queen bed', category: 'bed', trade: 'furniture', kind: 'sku', sku: 'BED-Q-1520', w: 1650, d: 2100, h: 450, unit: 'each', rate: 42000, tier: 'standard', themes: ['modern', 'minimalist', 'scandinavian', 'japandi', 'industrial', 'midcentury', 'coastal', 'bohemian'], rooms: ['bedroom'], clearance: 600, color: '#c4a27a', spec: S('Catalog', 'Platform bed', 'Solid wood frame, 1520 × 1980 mattress', undefined, '3 years') },
  { id: 'bed-traditional', name: 'Sheesham four-post bed', category: 'bed', trade: 'furniture', kind: 'sku', sku: 'BED-TR-1520', w: 1700, d: 2150, h: 500, unit: 'each', rate: 68000, tier: 'premium', themes: ['traditional', 'classic', 'bohemian'], rooms: ['bedroom'], clearance: 600, color: '#7a4a2a', spec: S('Catalog', 'Handcrafted', 'Seasoned sheesham, PU finish', undefined, '5 years') },
  { id: 'bed-single', name: 'Single bed', category: 'bed', trade: 'furniture', kind: 'sku', sku: 'BED-S-0920', w: 1050, d: 2050, h: 450, unit: 'each', rate: 24000, tier: 'economy', rooms: ['bedroom'], clearance: 600, color: '#c9ad8a', spec: S('Catalog', 'Single bed', 'Engineered wood, 910 × 1980 mattress') },
  { id: 'side-table', name: 'Bedside table', category: 'side-table', trade: 'furniture', kind: 'sku', sku: 'BST-450', w: 450, d: 400, h: 500, unit: 'each', rate: 6500, tier: 'standard', rooms: ['bedroom'], color: '#a88462', spec: S('Catalog', 'Bedside table', 'Engineered wood, one drawer') },
  // Wardrobes (custom joinery, parametric)
  { id: 'wardrobe-hinged', name: 'Wardrobe – hinged shutters', category: 'wardrobe', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1800, d: 600, h: 2400, minW: 900, maxW: 3600, module: 450, unit: 'sqft-front', rate: 1650, tier: 'standard', rooms: ['bedroom'], clearance: 900, color: '#d9c7ad', spec: PLY },
  { id: 'wardrobe-sliding', name: 'Wardrobe – sliding shutters', category: 'wardrobe', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 2100, d: 650, h: 2400, minW: 1200, maxW: 3600, module: 600, unit: 'sqft-front', rate: 1950, tier: 'premium', rooms: ['bedroom'], clearance: 600, color: '#cfc2b0', spec: { ...PLY, series: 'BWP plywood + sliding system', grade: 'IS 710 BWP, aluminium-profile sliding shutters, soft-close' } },
  { id: 'dresser', name: 'Dresser with mirror', category: 'dresser', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 900, d: 450, h: 800, minW: 600, maxW: 1200, module: 300, unit: 'sqft-front', rate: 1500, tier: 'standard', rooms: ['bedroom'], clearance: 750, color: '#d5c3a5', spec: PLY },
  { id: 'study-table', name: 'Study table with overhead shelf', category: 'study', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1200, d: 600, h: 750, minW: 900, maxW: 1800, module: 300, unit: 'sqft-front', rate: 1400, tier: 'standard', rooms: ['bedroom', 'study'], clearance: 750, color: '#c8b08c', spec: PLY },
  { id: 'tv-panel-bed', name: 'Wall-mounted TV panel', category: 'tv-unit', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1500, d: 350, h: 450, elev: 300, minW: 1200, maxW: 2400, module: 300, unit: 'sqft-front', rate: 1450, tier: 'standard', rooms: ['bedroom', 'living'], clearance: 750, color: '#8f7a64', wallMounted: true, low: true, spec: PLY },
  // Living
  { id: 'sofa-3', name: '3-seater sofa', category: 'sofa', trade: 'furniture', kind: 'sku', sku: 'SOF-3-2100', w: 2100, d: 900, h: 850, unit: 'each', rate: 62000, tier: 'standard', themes: ['modern', 'contemporary', 'minimalist', 'scandinavian', 'japandi', 'midcentury', 'coastal'], rooms: ['living'], clearance: 450, color: '#8c9aa6', spec: S('Catalog', 'Fabric sofa', 'Kiln-dried hardwood frame, 40-density foam', undefined, '3 years', 'Vacuum weekly; spot clean only.') },
  { id: 'sofa-l', name: 'L-shaped sectional sofa', category: 'sofa', trade: 'furniture', kind: 'sku', sku: 'SOF-L-2600', w: 2600, d: 1650, h: 850, unit: 'each', rate: 98000, tier: 'premium', themes: ['modern', 'contemporary', 'luxury', 'industrial'], rooms: ['living'], clearance: 450, color: '#6f7d88', spec: S('Catalog', 'Sectional', 'Hardwood frame, high-resilience foam, performance fabric', undefined, '5 years') },
  { id: 'sofa-wood', name: 'Teak sofa with cane back', category: 'sofa', trade: 'furniture', kind: 'sku', sku: 'SOF-TK-2000', w: 2000, d: 850, h: 850, unit: 'each', rate: 72000, tier: 'premium', themes: ['traditional', 'classic', 'bohemian', 'japandi', 'coastal'], rooms: ['living'], clearance: 450, color: '#8a5a32', spec: S('Catalog', 'Handcrafted', 'Teak, natural cane, cushions in cotton', undefined, '5 years') },
  { id: 'armchair', name: 'Accent armchair', category: 'armchair', trade: 'furniture', kind: 'sku', sku: 'ARM-750', w: 750, d: 800, h: 800, unit: 'each', rate: 22000, tier: 'standard', rooms: ['living'], clearance: 450, color: '#b9875c', spec: S('Catalog', 'Accent chair', 'Solid wood legs, fabric') },
  { id: 'coffee-table', name: 'Coffee table', category: 'coffee-table', trade: 'furniture', kind: 'sku', sku: 'CT-1200', w: 1200, d: 600, h: 400, unit: 'each', rate: 14000, tier: 'standard', rooms: ['living'], color: '#a07850', low: true, spec: S('Catalog', 'Coffee table', 'Solid wood top') },
  { id: 'tv-unit', name: 'TV unit with back panel', category: 'tv-unit', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1800, d: 450, h: 450, elev: 0, minW: 1500, maxW: 3000, module: 300, unit: 'sqft-front', rate: 1500, tier: 'standard', rooms: ['living'], clearance: 750, color: '#7d6b58', low: true, spec: PLY },
  { id: 'dining-6', name: 'Dining table, 6 seats (with chairs)', category: 'dining', trade: 'furniture', kind: 'sku', sku: 'DIN-6-1800', w: 1800, d: 2100, h: 750, unit: 'each', rate: 56000, tier: 'standard', rooms: ['living', 'dining'], clearance: 750, color: '#9b7350', spec: S('Catalog', 'Dining set', 'Solid wood, 6 upholstered chairs') },
  { id: 'dining-4', name: 'Dining table, 4 seats (with chairs)', category: 'dining', trade: 'furniture', kind: 'sku', sku: 'DIN-4-1200', w: 1200, d: 1900, h: 750, unit: 'each', rate: 36000, tier: 'economy', rooms: ['living', 'dining'], clearance: 750, color: '#a8825c', spec: S('Catalog', 'Dining set', 'Engineered wood, 4 chairs') },
  { id: 'pooja-unit', name: 'Pooja unit', category: 'pooja', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 750, d: 450, h: 1800, minW: 600, maxW: 1200, module: 150, unit: 'sqft-front', rate: 2200, tier: 'premium', rooms: ['living', 'pooja', 'dining'], clearance: 900, color: '#d8b26a', spec: { ...PLY, series: 'Veneer + CNC jaali', grade: 'IS 710 BWP, natural veneer, PU polish' } },
  { id: 'shoe-rack', name: 'Shoe cabinet', category: 'shoe-rack', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 900, d: 350, h: 1000, minW: 600, maxW: 1500, module: 300, unit: 'sqft-front', rate: 1300, tier: 'standard', rooms: ['living', 'foyer', 'passage'], clearance: 750, color: '#c7b394', spec: PLY },
  { id: 'bar-unit', name: 'Bar unit', category: 'bar', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1200, d: 450, h: 2100, minW: 900, maxW: 1800, module: 300, unit: 'sqft-front', rate: 2100, tier: 'premium', rooms: ['living', 'dining'], clearance: 750, color: '#5b4636', spec: PLY },
  { id: 'bookshelf', name: 'Bookshelf', category: 'bookshelf', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1200, d: 350, h: 2100, minW: 600, maxW: 2400, module: 300, unit: 'sqft-front', rate: 1350, tier: 'standard', rooms: ['study', 'living', 'bedroom'], clearance: 750, color: '#b59a78', spec: PLY },
  { id: 'rug', name: 'Area rug', category: 'rug', trade: 'decor', kind: 'sku', sku: 'RUG-2015', w: 2000, d: 1500, h: 10, unit: 'each', rate: 12000, tier: 'standard', rooms: ['living', 'bedroom'], color: '#c9b79c', low: true, spec: S('Catalog', 'Area rug', 'Hand-tufted wool') },
  { id: 'curtains', name: 'Curtains (per window)', category: 'curtain', trade: 'decor', kind: 'sku', sku: 'CUR-STD', w: 1800, d: 150, h: 2700, unit: 'each', rate: 9500, tier: 'standard', color: '#e6dccb', low: true, spec: S('Catalog', 'Curtains with track', 'Blackout lining, ripple-fold') },
  { id: 'plant', name: 'Floor planter', category: 'plant', trade: 'decor', kind: 'sku', sku: 'PLN-450', w: 450, d: 450, h: 1200, unit: 'each', rate: 4500, tier: 'standard', color: '#5d8a5a', spec: S('Catalog', 'Planter', 'Fibreglass pot, live plant') },
  // Kitchen (custom joinery)
  { id: 'kitchen-base', name: 'Kitchen base run', category: 'kitchen-base', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 2400, d: 600, h: 850, minW: 600, maxW: 6000, module: 600, unit: 'sqft-front', rate: 2100, tier: 'standard', rooms: ['kitchen'], clearance: 1000, color: '#e2d6c2', low: true, spec: { ...PLY_KITCHEN, series: 'Modular base units, quartz counter' } },
  { id: 'kitchen-wall', name: 'Kitchen wall units', category: 'kitchen-wall', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 2400, d: 350, h: 700, elev: 1450, minW: 600, maxW: 6000, module: 600, unit: 'sqft-front', rate: 1700, tier: 'standard', rooms: ['kitchen'], color: '#efe6d6', wallMounted: true, spec: PLY_KITCHEN },
  { id: 'tall-unit', name: 'Tall pantry unit', category: 'kitchen-tall', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 600, d: 600, h: 2150, minW: 450, maxW: 900, module: 150, unit: 'sqft-front', rate: 2300, tier: 'premium', rooms: ['kitchen'], clearance: 1000, color: '#e8dcc8', spec: PLY_KITCHEN },
  { id: 'sink', name: 'Stainless sink with tap', category: 'sink', trade: 'plumbing', kind: 'sku', sku: 'SNK-SS-860', w: 860, d: 500, h: 200, elev: 650, unit: 'each', rate: 14500, tier: 'standard', rooms: ['kitchen'], color: '#b9c2c9', low: true, spec: S('Catalog', 'Single bowl + drainboard', 'SS 304, 1.0 mm, with pull-out tap', undefined, '10 years') },
  { id: 'hob', name: 'Built-in hob, 3 burner', category: 'hob', trade: 'electrical', kind: 'sku', sku: 'HOB-3B-750', w: 750, d: 500, h: 100, elev: 850, unit: 'each', rate: 24000, tier: 'standard', rooms: ['kitchen'], color: '#2d2d2d', low: true, spec: S('Catalog', 'Glass hob', 'Toughened glass, brass burners', undefined, '2 years') },
  { id: 'chimney', name: 'Kitchen chimney', category: 'chimney', trade: 'electrical', kind: 'sku', sku: 'CHM-900', w: 900, d: 480, h: 450, elev: 1600, unit: 'each', rate: 22000, tier: 'standard', rooms: ['kitchen'], color: '#555', wallMounted: true, spec: S('Catalog', 'Auto-clean chimney', '1200 m³/h suction', undefined, '5 years motor') },
  { id: 'fridge-space', name: 'Refrigerator space', category: 'fridge', trade: 'furniture', kind: 'sku', sku: 'APP-FRG', w: 750, d: 700, h: 1800, unit: 'each', rate: 0, tier: 'standard', rooms: ['kitchen'], clearance: 1000, color: '#dfe4e8', spec: S('Client supplied', 'Double door', 'Space provision only') },
  // Toilet
  { id: 'wc', name: 'Wall-hung WC with concealed cistern', category: 'wc', trade: 'plumbing', kind: 'sku', sku: 'WC-WH-520', w: 380, d: 540, h: 400, unit: 'each', rate: 26000, tier: 'standard', rooms: ['toilet'], clearance: 600, color: '#f4f4f4', spec: S('Catalog', 'Wall-hung WC', 'Vitreous china, dual flush, concealed cistern', undefined, '10 years', 'Use non-abrasive cleaners.') },
  { id: 'basin', name: 'Counter basin with vanity', category: 'basin', trade: 'plumbing', kind: 'sku', sku: 'BSN-VAN-600', w: 600, d: 450, h: 850, unit: 'each', rate: 18500, tier: 'standard', rooms: ['toilet'], clearance: 600, color: '#f0ede8', spec: S('Catalog', 'Vanity basin', 'Ceramic basin, WPC vanity, pillar tap', undefined, '5 years') },
  { id: 'shower', name: 'Shower area with glass partition', category: 'shower', trade: 'plumbing', kind: 'sku', sku: 'SHW-GL-900', w: 900, d: 900, h: 2000, unit: 'each', rate: 32000, tier: 'standard', rooms: ['toilet'], color: '#cfe3ec', low: true, spec: S('Catalog', 'Shower enclosure', '8 mm toughened glass, thermostatic mixer, rain shower', undefined, '5 years') },
  { id: 'geyser', name: 'Water heater, 25 L', category: 'geyser', trade: 'electrical', kind: 'sku', sku: 'GYS-25', w: 400, d: 400, h: 500, elev: 1800, unit: 'each', rate: 11000, tier: 'standard', rooms: ['toilet'], color: '#fafafa', wallMounted: true, spec: S('Catalog', 'Storage water heater', '25 L, 5-star, 2 kW', undefined, '7 years tank') },
  { id: 'mirror', name: 'Mirror cabinet', category: 'mirror', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 600, d: 150, h: 750, elev: 1150, unit: 'sqft-front', rate: 1800, tier: 'standard', rooms: ['toilet'], color: '#cdd9df', wallMounted: true, spec: { ...PLY, series: 'Mirror cabinet', grade: 'HDHMR, 5 mm mirror shutter' } },
  // Utility / balcony
  { id: 'washing', name: 'Washing machine space', category: 'washing', trade: 'plumbing', kind: 'sku', sku: 'APP-WM', w: 650, d: 650, h: 900, unit: 'each', rate: 0, tier: 'standard', rooms: ['utility', 'balcony'], clearance: 750, color: '#e8ecef', spec: S('Client supplied', 'Front load', 'Space and point provision only') },
  { id: 'balcony-chairs', name: 'Balcony chair set', category: 'balcony-set', trade: 'furniture', kind: 'sku', sku: 'BAL-SET', w: 1200, d: 600, h: 750, unit: 'each', rate: 14000, tier: 'standard', rooms: ['balcony'], color: '#9e8b6a', spec: S('Catalog', 'Outdoor set', 'Powder-coated aluminium, weatherproof cushions') },
  // HVAC
  { id: 'ac-split', name: 'Split AC indoor unit', category: 'ac', trade: 'hvac', kind: 'sku', sku: 'AC-SPLIT', w: 1000, d: 250, h: 320, elev: 2150, unit: 'each', rate: 42000, tier: 'standard', color: '#f7f7f7', wallMounted: true, spec: S('Catalog', 'Inverter split AC', '5-star, R32; tonnage per schedule', undefined, '5 years compressor', 'Clean filters monthly in summer.') },
  // Flat 409 / Japandi concept pieces
  { id: 'console-foyer', name: 'Charcoal foyer console with bronze dots', category: 'console', trade: 'carpentry', kind: 'custom-joinery', joinery: true, w: 1800, d: 400, h: 800, unit: 'each', rate: 55000, tier: 'premium', themes: ['japandi'], rooms: ['living', 'foyer'], clearance: 600, color: '#34312d', spec: S('Firm approved make', 'Custom console', 'Charcoal matt lacquer, brushed bronze dot inlay') },
  { id: 'dining-round-6', name: 'Round travertine dining table Ø1400 + 6 bouclé chairs', category: 'dining', trade: 'furniture', kind: 'sku', sku: 'DIN-RD-1400', w: 1800, d: 2100, h: 750, unit: 'each', rate: 272000, tier: 'luxury', themes: ['japandi'], rooms: ['living', 'dining'], clearance: 750, color: '#d9cdb8', spec: S('Catalog', 'Travertine top, walnut drum base', 'Honed travertine; chairs bouclé on walnut frame', undefined, '2 years', 'Seal travertine yearly; wipe spills quickly.') },
  { id: 'bar-stool', name: 'Rust leather bar stool', category: 'stool', trade: 'furniture', kind: 'sku', sku: 'STL-BAR-RL', w: 450, d: 450, h: 750, unit: 'each', rate: 14000, tier: 'premium', rooms: ['living', 'kitchen'], color: '#b07a5a', spec: S('Catalog', 'Bar stool', 'Leather seat, black metal frame') },
  { id: 'rod-shelf', name: 'Black rod shelving, 5 tiers', category: 'shelf', trade: 'carpentry', kind: 'custom-joinery', joinery: false, w: 600, d: 300, h: 2700, unit: 'each', rate: 28000, tier: 'standard', rooms: ['living'], color: '#34312d', spec: S('Firm approved make', 'Rod shelving', 'Matt black MS rods, walnut shelves') },
];

export const MATERIALS: Material[] = [
  { id: 'fl-vit-grey', name: 'Vitrified tile 800×1600, matt grey', kind: 'floor', code: 'VT-8016-GM', color: '#b8b6b1', rate: 185, wastage: 0.08, tier: 'standard', tile: { w: 800, h: 1600 }, spec: S('Firm approved make', 'Large format GVT', 'IS 15622, matt, 9 mm', '9 mm', '—', 'Mop with neutral pH cleaner.') },
  { id: 'fl-vit-ivory', name: 'Vitrified tile 600×1200, ivory', kind: 'floor', code: 'VT-6012-IV', color: '#e6dccb', rate: 150, wastage: 0.08, tier: 'economy', tile: { w: 600, h: 1200 }, glossy: true, spec: S('Firm approved make', 'GVT', 'IS 15622, glossy, 9 mm', '9 mm') },
  { id: 'fl-wood-oak', name: 'Engineered oak flooring, natural', kind: 'floor', code: 'EW-OAK-190', color: '#c9a77c', rate: 340, wastage: 0.07, tier: 'premium', tile: { w: 190, h: 1900 }, spec: S('Firm approved make', 'Engineered wood', '3 mm oak wear layer, click-lock', '14 mm', '15 years', 'Use felt pads; no wet mopping.') },
  { id: 'fl-lam-walnut', name: 'Laminate flooring, walnut', kind: 'floor', code: 'LF-WAL-8', color: '#8a6446', rate: 160, wastage: 0.07, tier: 'standard', tile: { w: 195, h: 1380 }, spec: S('Firm approved make', 'Laminate floor', 'AC4, HDF core', '8 mm', '10 years') },
  { id: 'fl-marble', name: 'Italian marble, Statuario', kind: 'floor', code: 'MB-STAT-18', color: '#eeeae4', rate: 480, wastage: 0.12, tier: 'luxury', tile: { w: 1200, h: 1200 }, glossy: true, spec: S('Firm approved make', 'Imported marble', 'Mirror polish, 18 mm', '18 mm', '—', 'Seal yearly; avoid acidic cleaners.') },
  { id: 'fl-kota', name: 'Kota stone, honed', kind: 'floor', code: 'KS-HON-25', color: '#7e8a78', rate: 95, wastage: 0.1, tier: 'economy', tile: { w: 600, h: 600 }, spec: S('Local quarry', 'Kota stone', 'Honed, 25 mm', '25 mm') },
  { id: 'fl-concrete', name: 'Concrete-look tile 600×600', kind: 'floor', code: 'VT-6060-CN', color: '#9a9a96', rate: 140, wastage: 0.08, tier: 'standard', tile: { w: 600, h: 600 }, spec: S('Firm approved make', 'GVT', 'IS 15622, concrete look, R10', '9 mm') },
  { id: 'fl-antiskid', name: 'Anti-skid ceramic tile 300×300', kind: 'floor', code: 'CT-3030-AS', color: '#c8c2b8', rate: 95, wastage: 0.1, tier: 'standard', tile: { w: 300, h: 300 }, spec: S('Firm approved make', 'Ceramic', 'IS 15622, R11 anti-skid', '8 mm') },
  { id: 'wt-dado', name: 'Wall tile 300×600 to 2100 mm', kind: 'tile', code: 'WT-3060-WH', color: '#ecebe7', rate: 115, wastage: 0.1, tier: 'standard', tile: { w: 300, h: 600 }, glossy: true, spec: S('Firm approved make', 'Ceramic wall tile', 'IS 15622, glossy', '8 mm') },
  { id: 'pt-white', name: 'Premium emulsion, warm white', kind: 'paint', code: 'PE-L101', color: '#f3efe6', rate: 28, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats over putty + primer', undefined, '7 years', 'Washable; wipe with damp cloth.') },
  { id: 'pt-greige', name: 'Premium emulsion, greige', kind: 'paint', code: 'PE-N208', color: '#d6cfc4', rate: 28, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-sage', name: 'Premium emulsion, sage green', kind: 'paint', code: 'PE-G412', color: '#a9b59a', rate: 30, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-terracotta', name: 'Premium emulsion, terracotta', kind: 'paint', code: 'PE-R317', color: '#c07a5a', rate: 30, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-navy', name: 'Premium emulsion, deep navy', kind: 'paint', code: 'PE-B520', color: '#34445e', rate: 32, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-charcoal', name: 'Premium emulsion, charcoal', kind: 'paint', code: 'PE-K602', color: '#4a4a48', rate: 32, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-sky', name: 'Premium emulsion, coastal blue', kind: 'paint', code: 'PE-B214', color: '#9fc3d6', rate: 30, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium emulsion', 'Low-VOC, 2 coats', undefined, '7 years') },
  { id: 'pt-economy', name: 'Acrylic distemper, white', kind: 'paint', code: 'AD-W001', color: '#f5f3ee', rate: 16, wastage: 0.05, tier: 'economy', spec: S('Firm approved make', 'Acrylic distemper', '2 coats over primer') },
  { id: 'pt-luxury', name: 'Luxury emulsion, silk finish', kind: 'paint', code: 'LE-S110', color: '#efe8dc', rate: 42, wastage: 0.05, tier: 'luxury', glossy: true, spec: S('Firm approved make', 'Luxury emulsion', 'Silk sheen, stain-proof', undefined, '10 years') },
  { id: 'wp-cane', name: 'Wallpaper, cane weave', kind: 'wallpaper', code: 'WP-CN-07', color: '#d2b48c', rate: 125, wastage: 0.12, tier: 'premium', spec: S('Firm approved make', 'Non-woven wallpaper', 'Class B fire rated') },
  { id: 'wp-fluted', name: 'Fluted wall panel, walnut', kind: 'wallpaper', code: 'FP-WAL-12', color: '#6e4e36', rate: 260, wastage: 0.1, tier: 'premium', spec: S('Firm approved make', 'WPC fluted panel', 'Termite-proof WPC', '12 mm') },
  { id: 'cl-gypsum', name: 'Gypsum board ceiling, painted', kind: 'ceiling', code: 'GB-125', color: '#fbfbfa', rate: 110, wastage: 0.06, tier: 'standard', spec: S('Firm approved make', 'Gypsum false ceiling', '12.5 mm board, GI channels, IS 2095', '12.5 mm', '—', 'Do not hang loads from the board.') },
  { id: 'cl-paint', name: 'Ceiling paint, white', kind: 'ceiling', code: 'CP-W100', color: '#ffffff', rate: 22, wastage: 0.05, tier: 'economy', spec: S('Firm approved make', 'Ceiling emulsion', '2 coats') },
  { id: 'lam-oak', name: 'Laminate, natural oak', kind: 'laminate', code: 'LM-1104-SF', color: '#c9a77c', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Suede finish') },
  { id: 'lam-walnut', name: 'Laminate, dark walnut', kind: 'laminate', code: 'LM-2209-SF', color: '#6b4a32', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Suede finish') },
  { id: 'lam-white', name: 'Laminate, frosty white', kind: 'laminate', code: 'LM-0001-MT', color: '#f2f1ec', rate: 0, wastage: 0.1, tier: 'economy', spec: S('Firm approved make', 'HPL 1 mm', 'Matt') },
  { id: 'lam-grey', name: 'Laminate, slate grey', kind: 'laminate', code: 'LM-3310-MT', color: '#7a7e82', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Matt') },
  { id: 'lam-sage', name: 'Laminate, sage', kind: 'laminate', code: 'LM-4402-MT', color: '#9fac94', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Matt') },
  { id: 'lam-acrylic', name: 'Acrylic, high-gloss white', kind: 'laminate', code: 'AC-1001-HG', color: '#fafafa', rate: 0, wastage: 0.1, tier: 'premium', glossy: true, spec: S('Firm approved make', 'Acrylic 1.5 mm', 'High gloss') },
  { id: 'ven-teak', name: 'Veneer, teak with PU', kind: 'veneer', code: 'VN-TK-PU', color: '#a06a3a', rate: 0, wastage: 0.12, tier: 'luxury', spec: S('Firm approved make', 'Natural veneer', 'Burma teak, matt PU') },
  { id: 'sk-tile', name: 'Tile skirting, 100 mm', kind: 'skirting', code: 'SK-100-T', color: '#b8b6b1', rate: 55, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Cut tile skirting', '100 mm high') },
  { id: 'sk-wood', name: 'Wooden skirting, 75 mm', kind: 'skirting', code: 'SK-75-W', color: '#8a6446', rate: 90, wastage: 0.05, tier: 'premium', spec: S('Firm approved make', 'Solid wood skirting', '75 mm, PU finish') },
  // Flat 409 / Japandi concept finishes
  { id: 'fl-marble-porcelain', name: 'Porcelain 800×1600, matt marble-look', kind: 'floor', code: 'PT-8016-MW', color: '#ece7df', rate: 260, wastage: 0.08, tier: 'premium', tile: { w: 800, h: 1600 }, spec: S('Firm approved make', 'Large-format porcelain', 'Matt, warm white with soft grey veins, laid continuous', '9 mm', '—', 'Neutral pH cleaner; avoid acid.') },
  { id: 'fl-dark-stone', name: 'Dark textured stone tile 600×600, anti-skid', kind: 'floor', code: 'ST-6060-DK', color: '#6f6a63', rate: 150, wastage: 0.1, tier: 'standard', tile: { w: 600, h: 600 }, spec: S('Firm approved make', 'Porcelain stone-look', 'R11 anti-skid, linear drain', '9 mm') },
  { id: 'fl-wpc-teak', name: 'Teak-tone WPC deck', kind: 'floor', code: 'WPC-TK-140', color: '#9c6b43', rate: 320, wastage: 0.05, tier: 'premium', tile: { w: 140, h: 2200 }, spec: S('Firm approved make', 'WPC decking', 'Capped WPC on aluminium sub-frame', '25 mm', '10 years') },
  { id: 'wt-stone-1200', name: 'Stone-look porcelain 600×1200, walls', kind: 'tile', code: 'SP-6012-GR', color: '#bdb5a8', rate: 190, wastage: 0.1, tier: 'premium', tile: { w: 600, h: 1200 }, spec: S('Firm approved make', 'Porcelain wall tile', 'Greige stone look, matt, full height in showers', '9 mm') },
  { id: 'pt-washi', name: 'Premium matt emulsion, Washi White', kind: 'paint', code: 'PE-F3EFE8', color: '#f3efe8', rate: 34, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium matt emulsion', 'Low-VOC, 2 coats putty + primer + 2 coats', undefined, '7 years') },
  { id: 'pt-oat-greige', name: 'Premium matt emulsion, Oat Greige', kind: 'paint', code: 'PE-D6C9B9', color: '#d6c9b9', rate: 34, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Premium matt emulsion', 'Low-VOC', undefined, '7 years') },
  { id: 'wp-fluted-white', name: 'Grooved panels + fluted dado, warm white', kind: 'wallpaper', code: 'MDF-FL-WW', color: '#efe9df', rate: 560, wastage: 0.08, tier: 'premium', spec: S('Firm approved make', 'MDF grooved / fluted panels', 'PU warm white, fluted dado to 900 mm') },
  { id: 'wp-microcement', name: 'Grey microcement / limewash, vertical grooves', kind: 'wallpaper', code: 'MC-CFC8BC', color: '#cfc8bc', rate: 380, wastage: 0.05, tier: 'premium', spec: S('Firm approved make', 'Microcement system', 'Sealed matt, cove-lit') },
  { id: 'wp-wave-relief', name: 'Sculpted wave relief panel, warm white', kind: 'wallpaper', code: 'CNC-WAVE', color: '#f0ebe2', rate: 950, wastage: 0.05, tier: 'luxury', spec: S('Firm approved make', 'CNC / cast relief', 'Warm white, grazed by cove light') },
  { id: 'wp-wave-fluted', name: 'Wave-fluted bed wall, warm white', kind: 'wallpaper', code: 'CNC-WFL', color: '#ece6dc', rate: 600, wastage: 0.05, tier: 'premium', spec: S('Firm approved make', 'CNC fluted MDF', 'PU warm white, cove wash') },
  { id: 'wp-grid-greige', name: 'Grid mouldings, painted Oat Greige', kind: 'wallpaper', code: 'MLD-GRID', color: '#d6c9b9', rate: 260, wastage: 0.05, tier: 'standard', spec: S('Firm approved make', 'Moulding grid', 'PU/MDF mouldings, Oat Greige') },
  { id: 'wp-limewash-grey', name: 'Grey limewash feature wall', kind: 'wallpaper', code: 'LW-CFC8BC', color: '#c9c2b6', rate: 320, wastage: 0.05, tier: 'premium', spec: S('Firm approved make', 'Limewash / microcement texture', 'Grey, matt') },
  { id: 'ven-walnut', name: 'Walnut veneer, matt PU (Smoked Walnut)', kind: 'veneer', code: 'VN-WAL-6B4A33', color: '#6b4a33', rate: 0, wastage: 0.12, tier: 'luxury', spec: S('Firm approved make', 'Natural walnut veneer', 'Matt PU, handle-less groove') },
  { id: 'ven-oak', name: 'Oak veneer, natural', kind: 'veneer', code: 'VN-OAK-C49A6C', color: '#c49a6c', rate: 0, wastage: 0.12, tier: 'premium', spec: S('Firm approved make', 'Natural oak veneer', 'Matt PU') },
  { id: 'lam-greige', name: 'Laminate, greige matt with oak band', kind: 'laminate', code: 'LM-D6C9B9-MT', color: '#d6c9b9', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Greige matt, oak band, bronze pulls') },
  { id: 'lam-charcoal', name: 'Laminate, Sumi Charcoal matt', kind: 'laminate', code: 'LM-34312D-MT', color: '#34312d', rate: 0, wastage: 0.1, tier: 'standard', spec: S('Firm approved make', 'HPL 1 mm', 'Matt black') },
];

export const LAMINATE_KINDS = ['laminate', 'veneer'];

/** Electrical / plumbing point catalogue: rates per point for the BOQ, default watts for load schedules (EDT-22). */
export const POINTS: Record<PointKind, { name: string; trade: Trade; rate: number; watts: number; symbol: string; color: string; spec: Spec }> = {
  light: { name: 'Light point + LED downlight 12 W', trade: 'electrical', rate: 1950, watts: 12, symbol: 'L', color: '#f0b400', spec: S('Firm approved make', 'FRLS Cu wiring 1.5 mm² + LED downlight', 'IS 694 cable, 3000–4000 K, CRI ≥ 90') },
  cove: { name: 'Cove LED strip point (per room)', trade: 'electrical', rate: 1100, watts: 40, symbol: 'CV', color: '#ffcf4a', spec: S('Firm approved make', 'LED strip 14 W/m + driver', 'IP20, 2700–3000 K') },
  fan: { name: 'Fan point + ceiling fan', trade: 'electrical', rate: 4600, watts: 35, symbol: 'F', color: '#7a9cc6', spec: S('Firm approved make', 'BLDC fan + point wiring', '5-star BLDC, 1200 mm sweep') },
  exhaust: { name: 'Exhaust fan point', trade: 'electrical', rate: 2900, watts: 40, symbol: 'EX', color: '#7a9cc6', spec: S('Firm approved make', 'Exhaust fan + wiring', '200 mm, with louvre') },
  switchboard: { name: 'Modular switchboard (plate + switches)', trade: 'electrical', rate: 1600, watts: 0, symbol: 'SB', color: '#555', spec: S('Firm approved make', 'Modular switches', 'IS 3854, 6/8 module plate') },
  socket6: { name: '6 A socket point', trade: 'electrical', rate: 1250, watts: 100, symbol: 'S6', color: '#2b7bd6', spec: S('Firm approved make', 'FRLS Cu 2.5 mm²', 'IS 1293 5/6 A socket') },
  socket16: { name: '16 A power point', trade: 'electrical', rate: 1850, watts: 1500, symbol: 'P16', color: '#d1452f', spec: S('Firm approved make', 'FRLS Cu 4 mm²', 'IS 1293 16 A socket') },
  ac: { name: 'AC power point (20 A) + piping provision', trade: 'electrical', rate: 4200, watts: 1800, symbol: 'AC', color: '#00a3a3', spec: S('Firm approved make', 'FRLS Cu 4 mm², 20 A socket, Cu piping sleeve', 'IS 1293') },
  tv: { name: 'TV point (power + DTH/HDMI conduit)', trade: 'electrical', rate: 1600, watts: 150, symbol: 'TV', color: '#6e57c7', spec: S('Firm approved make', '6 A socket + 25 mm conduit', '—') },
  data: { name: 'Data point (Cat6)', trade: 'electrical', rate: 1400, watts: 0, symbol: 'D', color: '#6e57c7', spec: S('Firm approved make', 'Cat6 UTP + RJ45 module', 'TIA-568') },
  db: { name: 'Distribution board, 12-way SPN', trade: 'electrical', rate: 9500, watts: 0, symbol: 'DB', color: '#222', spec: S('Firm approved make', 'Double-door DB', 'IS/IEC 61439') },
  geyser: { name: 'Geyser point (20 A)', trade: 'electrical', rate: 2600, watts: 2000, symbol: 'G', color: '#d1452f', spec: S('Firm approved make', 'FRLS Cu 4 mm² + DP switch', 'IS 1293') },
  'inlet-cold': { name: 'Cold water inlet point (CPVC)', trade: 'plumbing', rate: 1500, watts: 0, symbol: 'CW', color: '#1f77d0', spec: S('Firm approved make', 'CPVC SDR 11', 'IS 15778, 15–20 mm') },
  'inlet-hot': { name: 'Hot water inlet point (CPVC)', trade: 'plumbing', rate: 1650, watts: 0, symbol: 'HW', color: '#d0451f', spec: S('Firm approved make', 'CPVC SDR 11', 'IS 15778, 15 mm, insulated') },
  outlet: { name: 'Drain outlet point (uPVC)', trade: 'plumbing', rate: 1300, watts: 0, symbol: 'O', color: '#5a5a5a', spec: S('Firm approved make', 'uPVC SWR', 'IS 13592, 40–110 mm') },
  'floor-trap': { name: 'Floor trap with grating', trade: 'plumbing', rate: 1150, watts: 0, symbol: 'FT', color: '#5a5a5a', spec: S('Firm approved make', 'Multi-floor trap + SS anti-cockroach grating', 'IS 13592') },
  'ac-drain': { name: 'AC drain outlet', trade: 'hvac', rate: 900, watts: 0, symbol: 'AD', color: '#00a3a3', spec: S('Firm approved make', 'uPVC 20 mm drain', '1:100 slope') },
  earth: { name: 'Earthing pit (pipe/plate)', trade: 'electrical', rate: 7500, watts: 0, symbol: 'E', color: '#2e7d32', spec: S('Firm approved make', 'Chemical earthing', 'IS 3043, < 1 Ω') },
};

export interface Catalog { items: CatalogItem[]; materials: Material[] }

export function buildCatalog(overrides: Record<string, { rate?: number; brand?: string; series?: string }> = {}, custom: CatalogItem[] = []): Catalog {
  const apply = <T extends { id: string; rate: number; spec: Spec }>(x: T): T => {
    const o = overrides[x.id];
    if (!o) return x;
    return { ...x, rate: o.rate ?? x.rate, spec: { ...x.spec, brand: o.brand ?? x.spec.brand, series: o.series ?? x.spec.series } };
  };
  return { items: [...ITEMS, ...custom].map(apply), materials: MATERIALS.map(apply) };
}

export const DEFAULT_CATALOG = buildCatalog();

export function itemById(cat: Catalog, id: string): CatalogItem | undefined { return cat.items.find((i) => i.id === id); }
export function materialById(cat: Catalog, id: string | undefined): Material | undefined { return id ? cat.materials.find((m) => m.id === id) : undefined; }

/** CAT-02: import firm items from CSV with header id,name,category,trade,w,d,h,rate,unit[,brand,series,grade,sku]. */
export function catalogFromCsv(rows: string[][]): CatalogItem[] {
  const [head, ...body] = rows;
  const idx = (k: string) => head.findIndex((h) => h.trim().toLowerCase() === k);
  const req = ['id', 'name', 'category', 'w', 'd', 'h', 'rate'];
  for (const k of req) if (idx(k) < 0) throw new Error(`CSV is missing the "${k}" column`);
  return body.map((r) => {
    const g = (k: string) => (idx(k) >= 0 ? r[idx(k)]?.trim() ?? '' : '');
    const unit = (g('unit') || 'each') as CatalogItem['unit'];
    return {
      id: 'firm-' + g('id'), name: g('name'), category: g('category'), trade: ((g('trade') || 'furniture') as Trade),
      kind: unit === 'sqft-front' ? 'custom-joinery' : 'sku', sku: g('sku') || undefined,
      w: +g('w'), d: +g('d'), h: +g('h'), unit, rate: +g('rate'), tier: 'standard', color: '#a3a3a3',
      joinery: unit === 'sqft-front',
      spec: { brand: g('brand') || 'Firm catalog', series: g('series') || '', grade: g('grade') || '' },
    } satisfies CatalogItem;
  });
}
