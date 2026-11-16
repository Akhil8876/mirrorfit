# Interior Build Studio

A browser app built from the *Interior Design & Build Management Tool – Product Requirements* (Nov 2026). One model per project: the imported CAD drawing drives the 3D design, the BOQ, and the drawings for each trade. Change it once and every output updates.

```
DXF import → detection review & sign-off → brief + theme + reference images → 3 generated options per room
→ 2D/3D editor (edit everything) → BOQ & quotation → approvals, tasks, snags → trade drawing packages (PDF / DXF / CSV / GLB)
```

## Run it

You need Node.js 20 or newer.

```bash
npm install
npm run dev        # opens on http://localhost:5173
```

Other scripts: `npm test` runs 32 tests covering detection accuracy, generation, BOQ, the cut list, the DXF round-trip and the orchestrator. `npm run build` does a type check and a production build into `dist/`. `npm run preview` serves that build.

Click **Open sample 2BHK** on the home screen to see the whole loop. The sample is a DXF drawn the way architects draw: double-line walls, door and window blocks, columns, room labels, and one dimension that is deliberately wrong.

### Putting it in `C:\Users\anilkumar\Desktop\Akhil` (Windows)

```powershell
cd C:\Users\anilkumar\Desktop
git clone -b claude/awesome-pascal-pjp0p8 https://github.com/akhil8876/akhil.git Akhil
cd Akhil\interior-build-tool
npm install
npm run dev
```

The tool is self-contained in `interior-build-tool/`. It has its own `package.json`, and nothing in it depends on the rest of the repository. To make it a separate GitHub repository, copy this folder out, then run `git init` and push it to a new repo.

## What's implemented (by PRD ID)

| Area | Requirements | How |
|---|---|---|
| **Import** | IMP-01, 06, 10–16, 20–24, 30–32 | DXF reader (R12–current; blocks are exploded; LINE/LWPOLYLINE/POLYLINE/TEXT/MTEXT/ARC/CIRCLE/INSERT/DIMENSION). Editable layer → role mapping. Walls come from paired face lines, with thickness. Gaps holding door/window symbols become openings, with door swing. Columns. Rooms are detected by 10 mm raster flood-fill, named from text labels, then snapped to wall faces (sample walls land within ±5 mm, and a test checks this). Shafts. Existing WC/basin/sink/AC blocks. Units come from `$INSUNITS` or are guessed from plan size, and you can calibrate by picking two points. Confidence per element, with low-confidence items highlighted. Written-vs-drawn dimension check. Multi-plan files split into floors. Original drawing kept as an underlay. Re-import compares walls (added/moved/removed) and keeps the design work. |
| **Structure & site** | IMP-40, 41, 42, 43, 44 | Structural walls and columns are read-only. Changing one needs a source note and raises a licensed-engineer review flag that blocks IFC. AI-detected elements must be confirmed, and the confirmer and time are logged; unconfirmed rooms stay out of measured BOQ lines. Site re-measure per wall: anything over tolerance blocks carpentry until resolved, and "use site value" re-fits the joinery. Area statement gives carpet, RERA carpet and built-up area, with CSV and PDF. Bye-law hints come from a versioned, editable rule pack. |
| **Generation** | GEN-01–05, 10–16, 20–22, 30, 31, 34 | 12 themes. Reference images give a palette (k-means) and style tags, and the closest theme is suggested; all of this runs locally. Brief (family, must-haves, storage, budget band, Vastu, accessibility). Free-text prompt. A constraint solver places **real catalog items sized to the walls** (wardrobes in modules, kitchen L/parallel/straight runs, sink under the window, work triangle). Clearances, door swings, columns and windows are respected. 3 options per room (theme / alternate / value-engineered); each option keeps the best of 4 seeded candidates, scored on rules + budget + style. Cost per option against budget, with SKU vs custom-joinery counts. "Try another" regenerates a single element, and "Try other finishes" changes only the finishes. Whole-home apply. AI output stays a draft until accepted. Vastu 16-zone overlay with advisory flags. |
| **Editor** | EDT-01–04, 10–18, 20–22, 24 | 2D plan and 3D (Three.js) side by side (orbit, walk-through, top view, saved views, evening lighting preview). Layers by trade. Snapping to walls and grid, with live distances while dragging. Property panel with exact values in mm, m or ft-in. Swap from catalog, finish per item, shutters/handles for joinery. Bulk finish for a room or the whole project. Undo/redo. Named versions with side-by-side compare. Live rule checks and live cost. Ctrl+K command search and shortcuts (V/W/M/R/Del/Ctrl+D). Comment pins. Lumen-method lighting check. Clash checks (points behind joinery). DB, MCB/RCCB circuits and earthing, with automatic circuit assignment you can override. |
| **BOQ & PM** | CAT-01/02, BOQ-01–06, 10–12, PM-01–08, 10–13 | Catalog with locked specs (brand, series, IS grade, thickness) and an editable rate library; firm items import from CSV. BOQ by item, room and trade, with wastage, margin and GST. Quotation with 5 pricing models, milestones, and a signed inclusion/exclusion list; print/PDF. Budget alerts. Lock an approved baseline, and every later change drafts a change order with cost and time impact. Tasks with dependencies, a timeline, vendors and package links. WhatsApp approval deep links that log the approver, time and exact revision hash. Submittal register with audit trail. Snag list pinned on the plan, with a close-out photo required. Site queries with photos. Progress log. Role preview (owner/admin/designer/viewer/client/trade). |
| **Exports** | EXP-01–06, 20–23, 30–33, 35, 36, PM-12 | A3 sheets with title block, scale, north arrow, legend, revision table, IFC stamp and a QR code. Packages for civil (demolition / new construction / flooring with tile start points / RCP / sections / quantities + waterproofing and anti-termite specs), carpentry (layout, joinery elevations, wall elevations, cut list with grain/edge band/laminate per face, hardware, board estimate, CNC nesting on 8×4 boards), electrical (layout, lighting, DB/conduit, switchboard elevations, point/load/DB schedules), plumbing, HVAC, painter, client (renders, mood board, quote) and handover pack. Schedule engine for doors, windows, finishes, sanitary, lighting, appliances, furniture, points and pipes. Layered DXF keeps blocks, mm units and the firm layer standard. CSV schedules, GLB model, CNC nesting DXF. Issuing a revision runs the REL-06 gate. Trades and clients see the last issued snapshot, and who viewed it is recorded. Revision clouds mark what changed since the last issue. Hindi labels on trade sheets. |
| **Agents** | AGT-01/02/03/05/07, REL-01–05, 07, SPD-01 | Task-graph orchestrator: independent room tasks run in parallel on a Web Worker pool. Each result is schema-checked and validated before it merges. Retries with backoff, timeouts, checkpoint/resume, priority lanes and live progress. A QA pass runs after generation. Every generated item records engine, seed, catalog version and rule pack, and gives a plain-English reason for where it was placed. |

## Not in this build (needs a back end or licences)

- **DWG**: reading and writing it needs the licensed ODA SDK. Export DXF from CAD instead; DXF output opens in AutoCAD.
- **PDF and raster plans**: a plan image can go in as a calibrated underlay and be traced with the wall tool. AI vectorisation (IMP-02/03) and IFC/SketchUp/LiDAR import are not built.
- **Rendering**: photoreal rendering and 360° panoramas need a GPU render farm. The client package uses WebGL captures.
- **Multi-user**: sign-in, real-time co-editing, the WhatsApp Business API and payment/Tally integrations need the hosted services. Approvals currently use `wa.me` deep links plus a recorded reply.
- **Data storage**: everything is kept in the browser's localStorage. Use **Settings → Export project file** for backups.
- **Rates and building code**: catalog rates are indicative placeholders, and the building-code edition (NBC 2016 vs SP 7:2026) is unconfirmed. Both are editable and need checking before real use.

## Code map

```
src/core/      pure TypeScript, no UI — testable and runs in Web Workers
  dxf.ts         DXF reader + R12 writer
  detect.ts      walls/openings/columns/rooms/fixtures, re-import diff, calibration
  measure.ts     room edges, areas, wall areas, area statement
  generator.ts   constraint layout solver (options, scoring, regenerate one item)
  rules.ts       rule pack + checker (clearances, door swing, columns, clashes, bye-laws)
  boq.ts         BOQ, change orders, quotation models
  joinery.ts     cut list, hardware, nesting
  schedules.ts   schedule engine
  electrical.ts  circuits, MCB/RCCB, load schedule
  orchestrator.ts task graph + worker pool
  exportDxf.ts   layered DXF + CNC nesting DXF
src/ui/        React screens: Import, Brief, Design (Plan.tsx + View3D.tsx), BOQ, Project, Exports (Sheets.tsx)
tests/         vitest
```
