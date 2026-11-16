// EDT-22 / EXP-36: DB location, MCB/RCCB circuits, earthing and circuit assignment for every point.

import type { Floor, MepPoint } from './types';
import { POINTS } from './catalog';

export interface Circuit {
  id: string;
  type: 'lighting' | 'power' | 'dedicated';
  label: string;
  mcb: number; // A, C-curve
  cable: string;
  rccb: string;
  points: string[];
  load: number; // W connected
  rooms: string[];
}

export interface ElectricalDesign {
  circuits: Circuit[];
  assignments: Record<string, string>; // point id → circuit id
  rccbs: { id: string; rating: string; covers: string[] }[];
  mainSwitch: string;
  earthing: { id: string; type: string; note: string }[];
  connectedLoad: number;
  demandLoad: number;
  db?: MepPoint;
}

const LIGHTING: MepPoint['kind'][] = ['light', 'cove', 'fan', 'exhaust'];
const DEDICATED: MepPoint['kind'][] = ['ac', 'geyser', 'socket16'];
const POWER: MepPoint['kind'][] = ['socket6', 'tv'];

export function designElectrical(f: Floor): ElectricalDesign {
  const roomName = (id?: string) => f.rooms.find((r) => r.id === id)?.name ?? '—';
  const circuits: Circuit[] = [];
  const assignments: Record<string, string> = {};
  const W = (p: MepPoint) => p.watts ?? POINTS[p.kind].watts;

  // Respect manual assignments first.
  const manual = f.points.filter((p) => p.circuitManual && p.circuit);
  for (const p of manual) assignments[p.id] = p.circuit!;

  const auto = f.points.filter((p) => !(p.circuitManual && p.circuit));
  // Lighting circuits: max 10 points / 800 W per circuit, grouped by room order.
  let cur: Circuit | undefined;
  const byRoom = (a: MepPoint, b: MepPoint) => (a.roomId ?? '').localeCompare(b.roomId ?? '');
  for (const p of auto.filter((p) => LIGHTING.includes(p.kind)).sort(byRoom)) {
    if (!cur || cur.points.length >= 10 || cur.load + W(p) > 800) {
      cur = { id: `L${circuits.filter((c) => c.type === 'lighting').length + 1}`, type: 'lighting', label: 'Lighting & fans', mcb: 10, cable: '1.5 mm² Cu FRLS', rccb: 'RCCB-2', points: [], load: 0, rooms: [] };
      circuits.push(cur);
    }
    cur.points.push(p.id); cur.load += W(p); assignments[p.id] = cur.id;
    if (!cur.rooms.includes(roomName(p.roomId))) cur.rooms.push(roomName(p.roomId));
  }
  // 6 A socket circuits: max 8 points per circuit.
  cur = undefined;
  for (const p of auto.filter((p) => POWER.includes(p.kind)).sort(byRoom)) {
    if (!cur || cur.points.length >= 8) {
      cur = { id: `P${circuits.filter((c) => c.type === 'power').length + 1}`, type: 'power', label: '6 A sockets', mcb: 16, cable: '2.5 mm² Cu FRLS', rccb: 'RCCB-1', points: [], load: 0, rooms: [] };
      circuits.push(cur);
    }
    cur.points.push(p.id); cur.load += W(p); assignments[p.id] = cur.id;
    if (!cur.rooms.includes(roomName(p.roomId))) cur.rooms.push(roomName(p.roomId));
  }
  // Dedicated circuits for AC, geyser and 16 A appliances.
  for (const p of auto.filter((p) => DEDICATED.includes(p.kind))) {
    const n = circuits.filter((c) => c.type === 'dedicated').length + 1;
    const mcb = 20;
    const c: Circuit = { id: `D${n}`, type: 'dedicated', label: `${POINTS[p.kind].name.split('(')[0].trim()} – ${roomName(p.roomId)}`, mcb, cable: '4 mm² Cu FRLS', rccb: 'RCCB-1', points: [p.id], load: W(p), rooms: [roomName(p.roomId)] };
    circuits.push(c);
    assignments[p.id] = c.id;
  }
  // Manual circuits that don't exist yet get created as power circuits.
  for (const p of manual) {
    let c = circuits.find((c) => c.id === p.circuit);
    if (!c) { c = { id: p.circuit!, type: 'power', label: 'Manual circuit', mcb: 16, cable: '2.5 mm² Cu FRLS', rccb: 'RCCB-1', points: [], load: 0, rooms: [] }; circuits.push(c); }
    c.points.push(p.id); c.load += W(p);
    if (!c.rooms.includes(roomName(p.roomId))) c.rooms.push(roomName(p.roomId));
  }
  const connected = circuits.reduce((s, c) => s + c.load, 0);
  const rccbs = [
    { id: 'RCCB-1', rating: '63 A DP, 30 mA (sockets, wet areas, appliances)', covers: circuits.filter((c) => c.rccb === 'RCCB-1').map((c) => c.id) },
    { id: 'RCCB-2', rating: '40 A DP, 100 mA (lighting)', covers: circuits.filter((c) => c.rccb === 'RCCB-2').map((c) => c.id) },
  ];
  return {
    circuits, assignments, rccbs,
    mainSwitch: connected > 9000 ? '63 A DP isolator' : '40 A DP isolator',
    earthing: [
      { id: 'E1', type: 'Chemical earthing pit', note: 'Body earthing for DB and all 3-pin points (IS 3043)' },
      { id: 'E2', type: 'Chemical earthing pit', note: 'Second electrode, interconnected; resistance < 1 Ω' },
    ],
    connectedLoad: connected,
    demandLoad: Math.round(connected * 0.7),
    db: f.points.find((p) => p.kind === 'db'),
  };
}
