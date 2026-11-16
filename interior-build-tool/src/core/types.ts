// Core data model (PRD 9.2): Project → Floor → Room → Elements.
// All geometry is stored in millimetres, plan coordinates with +y up (as in CAD).

export interface Vec2 { x: number; y: number }

export type Trade =
  | 'civil' | 'carpentry' | 'electrical' | 'plumbing' | 'hvac' | 'painting' | 'furniture' | 'decor';

export const TRADES: Trade[] = ['civil', 'carpentry', 'electrical', 'plumbing', 'hvac', 'painting', 'furniture', 'decor'];

/** Provenance of anything the importer or the AI produced (IMP-15, IMP-41, NFR-21, REL-07). */
export interface Detection {
  confidence: number; // 0..1
  source: 'dxf' | 'image' | 'user' | 'site';
  layer?: string;
  reason?: string;
  confirmed?: { by: string; at: string };
}

export interface Wall {
  id: string;
  a: Vec2; // centreline start
  b: Vec2; // centreline end
  thickness: number;
  structural: boolean; // IMP-40: read-only structural layer
  exterior: boolean;
  status: 'existing' | 'new' | 'demolish';
  det?: Detection;
}

export interface Opening {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'opening';
  offset: number; // centre distance from wall.a along the wall, mm
  width: number;
  height: number;
  sill: number;
  swing?: { hinge: 'a' | 'b'; side: 1 | -1 };
  det?: Detection;
}

export interface Column {
  id: string;
  center: Vec2;
  w: number;
  d: number;
  kind: 'column' | 'shear-wall' | 'shaft' | 'beam';
  det?: Detection;
}

export type RoomType =
  | 'living' | 'dining' | 'bedroom' | 'kitchen' | 'toilet' | 'passage' | 'foyer'
  | 'balcony' | 'utility' | 'study' | 'pooja' | 'shaft' | 'other';

export type RoomStatus = 'concept' | 'design' | 'approved' | 'execution' | 'done';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  polygon: Vec2[]; // inner faces, CCW
  ceilingHeight: number; // floor to slab soffit
  falseCeiling: { enabled: boolean; drop: number; cove: boolean };
  finishes: { floor: string; wall: string; ceiling: string; skirting: string; accentWall?: number; accent?: string };
  wallFinishOverrides: Record<number, string>; // edge index → material id
  status: RoomStatus;
  det?: Detection;
}

export interface Provenance {
  engine: string;
  version: string;
  seed: number;
  catalogVersion: string;
  rulePack: string;
  at: string;
}

export interface JoineryConfig {
  shutter: 'hinged' | 'sliding' | 'open' | 'drawer';
  shutters?: number;
  internal?: string[]; // accessories
  handle?: string;
}

export interface Item {
  id: string;
  roomId: string;
  catalogId: string;
  pos: Vec2; // centre of footprint
  rot: number; // degrees, CCW. At 0, the front faces +y.
  w: number;
  d: number;
  h: number;
  elev: number; // bottom above FFL
  finish?: string; // material id
  joinery?: JoineryConfig;
  draft?: boolean; // GEN-20: AI drafts until accepted
  existing?: boolean;
  reason?: string; // NFR-21: why it was placed
  prov?: Provenance;
}

export type PointKind =
  | 'light' | 'cove' | 'fan' | 'exhaust' | 'switchboard' | 'socket6' | 'socket16' | 'ac' | 'tv' | 'data' | 'db'
  | 'geyser' | 'inlet-cold' | 'inlet-hot' | 'outlet' | 'floor-trap' | 'ac-drain' | 'earth';

export interface MepPoint {
  id: string;
  roomId?: string;
  kind: PointKind;
  pos: Vec2;
  height: number; // above FFL (ceiling points use the ceiling height)
  watts?: number;
  circuit?: string; // assigned circuit id
  circuitManual?: boolean;
  label?: string;
  draft?: boolean;
}

export interface Annotation { id: string; a: Vec2; b: Vec2; text?: string }

export interface SiteMeasure {
  id: string;
  roomId: string;
  edge: number;
  plan: number;
  site: number;
  by: string;
  at: string;
  resolution?: 'accept-site' | 'keep-plan';
  note?: string;
}

export interface DimCheck { id: string; a: Vec2; b: Vec2; written: number; drawn: number; ok: boolean }

export interface UnderlayLine { a: Vec2; b: Vec2; layer: string }
export interface Underlay {
  lines: UnderlayLine[];
  texts: { pos: Vec2; text: string; h: number; layer: string }[];
  image?: { dataUrl: string; x: number; y: number; w: number; h: number };
}

export interface Floor {
  id: string;
  name: string;
  level: number; // FFL above ground, mm
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  rooms: Room[];
  items: Item[];
  points: MepPoint[];
  annotations: Annotation[];
  siteMeasures: SiteMeasure[];
  dimChecks: DimCheck[];
  outline?: Vec2[];
  builtUpArea?: number; // mm²
  northDeg: number; // direction of true north on the plan, degrees CCW from +x (90 = up)
  source?: { fileName: string; hash: string; importedAt: string; units: string; layerMap: Record<string, LayerRole> };
}

export type LayerRole =
  | 'wall' | 'door' | 'window' | 'column' | 'room' | 'furniture' | 'plumbing' | 'electrical' | 'annotation' | 'ignore';

export interface StyleRef {
  id: string;
  name: string;
  thumb: string; // small data URL
  palette: string[];
  tags: string[];
  roomId?: string;
}

export interface Brief {
  familySize: number;
  members: string;
  accessibility: boolean;
  mustHaves: string[];
  storage: 'low' | 'medium' | 'high';
  budgetBand: 'economy' | 'standard' | 'premium' | 'luxury';
  budget: number; // INR, total
  vastu: boolean;
  likes: string;
  dislikes: string;
  version: number;
}

export interface Version {
  id: string;
  name: string;
  at: string;
  by: string;
  hash: string;
  floors: Floor[];
  boqTotal: number;
  boqLines?: BoqLineSnapshot[];
}

export interface BoqLineSnapshot { key: string; desc: string; qty: number; unit: string; rate: number; amount: number; trade: Trade; room: string }

export type ApprovalSubject = 'design' | 'quote' | 'change-order' | 'submittal' | 'drawing' | 'inclusions';

export interface Approval {
  id: string;
  subject: ApprovalSubject;
  refId: string;
  revision: string; // exact version/revision hash approved
  approver: string;
  channel: 'whatsapp' | 'in-app' | 'email' | 'in-person';
  status: 'requested' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  note?: string;
}

export interface ChangeOrder {
  id: string;
  no: number;
  title: string;
  baseVersionId: string;
  createdAt: string;
  lines: { key: string; desc: string; before: number; after: number; delta: number; change: 'added' | 'removed' | 'changed' }[];
  costDelta: number;
  timeImpactDays: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected';
}

export interface Task {
  id: string;
  name: string;
  trade: Trade | 'site';
  duration: number; // days
  deps: string[];
  status: 'todo' | 'doing' | 'blocked' | 'done';
  vendor?: string;
  start?: string;
  roomId?: string;
}

export interface Snag {
  id: string;
  floorId: string;
  pos: Vec2;
  title: string;
  trade: Trade;
  due: string;
  status: 'open' | 'fixed' | 'closed';
  photo?: string;
  closePhoto?: string;
  createdAt: string;
}

export interface Submittal {
  id: string;
  type: 'shop-drawing' | 'sample' | 'substitution' | 'factory-drawing';
  title: string;
  trade: Trade;
  status: 'submitted' | 'approved' | 'rejected' | 'resubmit';
  trail: { at: string; by: string; status: string; note?: string }[];
}

export interface Rfi {
  id: string;
  title: string;
  question: string;
  trade: Trade;
  raisedBy: string;
  photo?: string;
  answer?: string;
  status: 'open' | 'answered';
  at: string;
  roomId?: string;
}

export interface ProgressLog { id: string; at: string; by: string; roomId?: string; taskId?: string; note: string; photo?: string }

export interface CommentPin { id: string; floorId: string; pos: Vec2; targetId?: string; author: string; text: string; at: string; resolved?: boolean }

export interface Revision {
  id: string;
  no: number;
  trade: Trade | 'all';
  at: string;
  by: string;
  hash: string;
  note: string;
  ifc: boolean; // issued for construction
  sigs: Record<string, string>; // element signatures, used to draw revision clouds on the next issue
  viewers: { by: string; at: string }[];
  floors?: Floor[]; // snapshot trades see (EXP-04: always the latest issued revision)
}

export interface StructuralFlag {
  id: string;
  elementId: string;
  action: string;
  sourceNote: string;
  raisedBy: string;
  at: string;
  reviewed?: { by: string; at: string };
}

export interface AuditEntry { at: string; by: string; action: string }

export interface QuoteSettings {
  model: 'itemised' | 'turnkey-sqft' | 'design-fee-pct' | 'lump-sum' | 'design-only';
  turnkeyRate: number; // INR / sq ft carpet
  feePct: number;
  lumpSum: number;
  designOnlyRate: number; // INR / sq ft
  milestones: { label: string; pct: number }[];
  inclusions: string[];
  exclusions: string[];
  terms: string;
}

export interface RulePack {
  id: string;
  edition: string;
  city: string;
  minHabitableArea: number; // m²
  minKitchenArea: number;
  minHabitableCeiling: number; // mm
  minToiletCeiling: number;
  minWindowRatio: number; // window area / floor area
  walkway: number;
  wardrobeFront: number;
  bedSide: number;
  switchMin: number;
  switchMax: number;
  counterMin: number;
  counterMax: number;
}

export type Role = 'owner' | 'admin' | 'designer' | 'viewer' | 'client' | 'trade';

export interface Settings {
  user: string;
  role: Role;
  tradeView: Trade;
  displayUnits: 'mm' | 'm' | 'ftin';
  gstPct: number;
  marginPct: number;
  siteTolerance: number;
  firmName: string;
  firmLogo?: string;
  layerStandard: Record<string, string>;
  drawingStandard: 'IS' | 'BS' | 'ANSI';
  rulePack: RulePack;
  projectStart: string;
  defaultCeiling: number;
  sheetLanguage: 'en' | 'hi';
}

export interface GenOption {
  id: string;
  roomId: string;
  label: string;
  variant: number;
  items: Item[];
  points: MepPoint[];
  finishes: Room['finishes'];
  falseCeiling: Room['falseCeiling'];
  cost: number;
  score: number;
  issues: number;
  summary: string;
  skuCount: number;
  customCount: number;
}

export interface Project {
  id: string;
  name: string;
  client: { name: string; phone: string; email: string };
  address: string;
  createdAt: string;
  updatedAt: string;
  floors: Floor[];
  theme: string;
  brief: Brief;
  prompt: string;
  refs: StyleRef[];
  styleTags: string[];
  generation: Record<string, GenOption[]>; // by room id
  versions: Version[];
  approvedVersionId?: string;
  approvals: Approval[];
  changeOrders: ChangeOrder[];
  tasks: Task[];
  snags: Snag[];
  submittals: Submittal[];
  rfis: Rfi[];
  progress: ProgressLog[];
  comments: CommentPin[];
  revisions: Revision[];
  flags: StructuralFlag[];
  audit: AuditEntry[];
  quote: QuoteSettings;
  settings: Settings;
  catalogOverrides: Record<string, { rate?: number; brand?: string; series?: string }>;
  customCatalog: import('./catalog').CatalogItem[];
}
