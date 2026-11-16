import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Floor, Item } from '../core/types';
import type { Catalog } from '../core/catalog';
import { POINTS, itemById, materialById } from '../core/catalog';
import type { LayerKey, Sel } from '../store';
import { dist, norm, sub, centroid, bbox } from '../core/geom';
import { finishedCeiling, roomEdges } from '../core/measure';

const S = 0.001; // mm → m

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8, metalness: 0.02, ...opts });
}

function box(w: number, h: number, d: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, w) * S, Math.max(1, h) * S, Math.max(1, d) * S), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function itemMesh(it: Item, cat: Catalog): THREE.Object3D | null {
  const ci = itemById(cat, it.catalogId);
  if (!ci) return null;
  const color = materialById(cat, it.finish)?.color ?? ci.color;
  const m = mat(color, { roughness: materialById(cat, it.finish)?.glossy ? 0.25 : 0.75 });
  const g = new THREE.Group();
  const W = it.w, D = it.d, H = it.h;
  const at = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x * S, y * S, z * S); g.add(o); return o; };
  switch (ci.category) {
    case 'bed': {
      at(box(W, H * 0.55, D, mat('#8b6f55')), 0, H * 0.275, 0);
      at(box(W - 60, 200, D - 120, mat('#f1ede6')), 0, H * 0.55 + 100, -30);
      at(box(W, 1000, 80, m), 0, 500, D / 2 - 40);
      at(box(W * 0.35, 120, 400, mat('#ffffff')), -W * 0.22, H * 0.55 + 260, D / 2 - 300);
      at(box(W * 0.35, 120, 400, mat('#ffffff')), W * 0.22, H * 0.55 + 260, D / 2 - 300);
      break;
    }
    case 'sofa': {
      at(box(W, 420, D, m), 0, 210, 0);
      at(box(W, H - 420, 200, m), 0, 420 + (H - 420) / 2, D / 2 - 100);
      at(box(150, 600, D, m), -W / 2 + 75, 300, 0);
      at(box(150, 600, D, m), W / 2 - 75, 300, 0);
      break;
    }
    case 'dining': case 'coffee-table': case 'study': case 'balcony-set': case 'side-table': {
      const tw = ci.category === 'dining' ? W : W, td = ci.category === 'dining' ? Math.min(D, 1000) : D;
      at(box(tw, 40, td, m), 0, H - 20, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) at(box(50, H - 40, 50, mat('#4a3b2e')), sx * (tw / 2 - 60), (H - 40) / 2, sz * (td / 2 - 60));
      if (ci.category === 'dining') for (let k = 0; k < (W > 1500 ? 3 : 2); k++) for (const sz of [-1, 1]) { const x = -W / 2 + (W / (W > 1500 ? 3 : 2)) * (k + 0.5); at(box(420, 450, 420, mat('#b9a58a')), x, 225, sz * (td / 2 + 280)); at(box(420, 450, 40, mat('#b9a58a')), x, 675, sz * (td / 2 + 470)); }
      break;
    }
    case 'rug': at(box(W, 10, D, mat(color, { roughness: 1 })), 0, 5, 0); break;
    case 'curtain': at(box(W, H, 60, mat('#e9e1d2', { transparent: true, opacity: 0.85 })), 0, H / 2, D / 2 - 40); break;
    case 'shower': {
      at(box(W, 30, D, mat('#cfd6da')), 0, 15, 0);
      at(box(10, H, D, mat('#bfe0ee', { transparent: true, opacity: 0.35, roughness: 0.05 })), W / 2, H / 2, 0);
      break;
    }
    case 'plant': {
      at(box(W * 0.7, 450, D * 0.7, mat('#e8e1d6')), 0, 225, 0);
      const s = new THREE.Mesh(new THREE.SphereGeometry(W * 0.55 * S, 16, 12), mat('#4f7d48'));
      at(s, 0, 850, 0);
      break;
    }
    default: {
      const body = at(box(W, H, D, m), 0, H / 2, 0);
      if (ci.joinery) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry((body as THREE.Mesh).geometry), new THREE.LineBasicMaterial({ color: '#5a4a3a' }));
        body.add(edges);
        // shutter lines
        const n = Math.max(1, Math.round(W / (it.joinery?.shutter === 'sliding' ? 1000 : 450)));
        for (let k = 1; k < n; k++) at(box(6, H - 20, 4, mat('#5a4a3a')), -W / 2 + (W / n) * k, H / 2, -D / 2 - 2);
      }
    }
  }
  g.position.set(it.pos.x * S, it.elev * S, -it.pos.y * S);
  g.rotation.y = (it.rot * Math.PI) / 180;
  g.userData = { kind: 'item', id: it.id };
  return g;
}

export function buildScene(f: Floor, cat: Catalog, layers: Partial<Record<LayerKey, boolean>>, opts: { evening?: boolean; selection?: Sel | null } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.evening ? '#1d2230' : '#dcd8cf');
  const H = Math.max(...f.rooms.map((r) => r.ceilingHeight), 3000);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8ad9c', opts.evening ? 0.25 : 1.6));
  const sun = new THREE.DirectionalLight('#fff6e8', opts.evening ? 0.1 : 1.6);
  const b = bbox(f.rooms.flatMap((r) => r.polygon).concat(f.walls.flatMap((w) => [w.a, w.b])));
  const cx = ((b.minX + b.maxX) / 2) * S, cz = (-(b.minY + b.maxY) / 2) * S;
  sun.position.set(cx + 6, 12, cz + 8);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(b.maxX - b.minX, b.maxY - b.minY) * S;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
  scene.add(sun, sun.target);
  // floors
  for (const r of f.rooms) {
    const shape = new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x * S, p.y * S)));
    const geo = new THREE.ShapeGeometry(shape);
    const fm = materialById(cat, r.finishes.floor);
    const mesh = new THREE.Mesh(geo, mat(fm?.color ?? '#ccc', { roughness: fm?.glossy ? 0.3 : 0.85, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'room', id: r.id };
    scene.add(mesh);
    // wall finishes as thin panels on each room edge
    if (layers.civil !== false) for (const e of roomEdges(f, r)) {
      const id = r.wallFinishOverrides[e.i] ?? (r.finishes.accentWall === e.i && r.finishes.accent ? r.finishes.accent : r.finishes.wall);
      const wm = materialById(cat, id);
      const ch = finishedCeiling(r);
      const segs: [number, number, number, number][] = []; // s0, s1, y0, y1
      let s = 0;
      for (const o of [...e.openings].sort((a, c) => a.s - c.s)) {
        if (o.s > s) segs.push([s, o.s, 0, ch]);
        if (o.sill > 0) segs.push([o.s, o.e, 0, o.sill]);
        if (o.sill + o.height < ch) segs.push([o.s, o.e, o.sill + o.height, ch]);
        s = Math.max(s, o.e);
      }
      if (s < e.len) segs.push([s, e.len, 0, ch]);
      for (const [s0, s1, y0, y1] of segs) {
        const geo2 = new THREE.PlaneGeometry((s1 - s0) * S, (y1 - y0) * S);
        const pm = new THREE.Mesh(geo2, mat(wm?.color ?? '#eee', { side: THREE.DoubleSide }));
        const mid = { x: e.a.x + e.dir.x * ((s0 + s1) / 2) + e.n.x * 3, y: e.a.y + e.dir.y * ((s0 + s1) / 2) + e.n.y * 3 };
        pm.position.set(mid.x * S, ((y0 + y1) / 2) * S, -mid.y * S);
        pm.rotation.y = Math.atan2(e.dir.y, e.dir.x);
        pm.receiveShadow = true;
        scene.add(pm);
      }
    }
    if (r.falseCeiling.enabled && layers.civil !== false) {
      const c = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat('#fbfbf9', { side: THREE.DoubleSide, transparent: true, opacity: 0.18 }));
      c.rotation.x = -Math.PI / 2;
      c.position.y = finishedCeiling(r) * S;
      scene.add(c);
    }
  }
  // walls with openings
  if (layers.civil !== false) for (const w of f.walls) {
    if (w.status === 'demolish') continue;
    const L = dist(w.a, w.b);
    const d = norm(sub(w.b, w.a));
    const ang = Math.atan2(d.y, d.x);
    const m = mat(w.status === 'new' ? '#d7e8d9' : '#f2efe9');
    const ops = f.openings.filter((o) => o.wallId === w.id).sort((a, c) => a.offset - c.offset);
    const add = (s0: number, s1: number, y0: number, y1: number) => {
      if (s1 - s0 < 1 || y1 - y0 < 1) return;
      const mesh = box(s1 - s0, y1 - y0, w.thickness, m);
      const mid = (s0 + s1) / 2;
      mesh.position.set((w.a.x + d.x * mid) * S, ((y0 + y1) / 2) * S, -(w.a.y + d.y * mid) * S);
      mesh.rotation.y = ang;
      mesh.userData = { kind: 'wall', id: w.id };
      scene.add(mesh);
    };
    let s = w.exterior ? -w.thickness / 2 : 0;
    for (const o of ops) {
      const a0 = o.offset - o.width / 2, a1 = o.offset + o.width / 2;
      add(s, a0, 0, H);
      add(a0, a1, 0, o.sill);
      add(a0, a1, o.sill + o.height, H);
      if (o.kind === 'window') {
        const g = box(a1 - a0, o.height, 10, mat('#a9cfe0', { transparent: true, opacity: 0.3, roughness: 0.05 }));
        const mid = (a0 + a1) / 2;
        g.position.set((w.a.x + d.x * mid) * S, (o.sill + o.height / 2) * S, -(w.a.y + d.y * mid) * S);
        g.rotation.y = ang;
        scene.add(g);
      }
      s = a1;
    }
    add(s, L + (w.exterior ? w.thickness / 2 : 0), 0, H);
  }
  if (layers.civil !== false) for (const c of f.columns) {
    const mesh = box(c.w, H, c.d, mat('#c9c2b6'));
    mesh.position.set(c.center.x * S, (H / 2) * S, -c.center.y * S);
    scene.add(mesh);
  }
  // items
  for (const it of f.items) {
    const ci = itemById(cat, it.catalogId);
    if (!ci) continue;
    const lk = (ci.trade === 'decor' ? 'decor' : ci.trade === 'carpentry' ? 'carpentry' : ci.trade === 'plumbing' ? 'plumbing' : ci.trade === 'hvac' ? 'hvac' : ci.trade === 'electrical' ? 'electrical' : 'furniture') as LayerKey;
    if (layers[lk] === false) continue;
    const m = itemMesh(it, cat);
    if (!m) continue;
    if (opts.selection?.kind === 'item' && opts.selection.id === it.id) {
      const bh = new THREE.BoxHelper(m, '#2f9e88');
      scene.add(m); scene.add(bh);
    } else scene.add(m);
  }
  // lights & points
  let lights = 0;
  for (const p of f.points) {
    const P = POINTS[p.kind];
    if (p.kind === 'light' || p.kind === 'cove') {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16), new THREE.MeshStandardMaterial({ color: '#fff', emissive: new THREE.Color('#ffe9c4'), emissiveIntensity: opts.evening ? 2 : 0.6 }));
      disc.position.set(p.pos.x * S, (p.height - 5) * S, -p.pos.y * S);
      scene.add(disc);
      if (opts.evening && lights < 14) {
        const pl = new THREE.PointLight(p.kind === 'cove' ? '#ffcf8a' : '#ffe2b8', 2.2, 5, 1.6);
        pl.position.set(p.pos.x * S, (p.height - 200) * S, -p.pos.y * S);
        scene.add(pl);
        lights++;
      }
      continue;
    }
    if (P.trade === 'electrical' && layers.electrical === false) continue;
    if (P.trade === 'plumbing' && layers.plumbing === false) continue;
    if (P.trade === 'hvac' && layers.hvac === false) continue;
    const mk = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ color: P.color, emissive: new THREE.Color(P.color), emissiveIntensity: 0.4 }));
    mk.position.set(p.pos.x * S, p.height * S, -p.pos.y * S);
    mk.userData = { kind: 'point', id: p.id };
    scene.add(mk);
  }
  const center = new THREE.Vector3(cx, 1.2, cz);
  return { scene, center, extent: ext };
}

export type CamMode = 'orbit' | 'walk' | 'top';
export interface SavedView { name: string; pos: [number, number, number]; target: [number, number, number] }

export function View3D({ floor, cat, layers, selection, onSelect, register }: { floor: Floor; cat: Catalog; layers: Partial<Record<LayerKey, boolean>>; selection?: Sel | null; onSelect?: (s: Sel | null) => void; register?: (api: { snapshot: () => string; exportGlb: () => Promise<Blob> }) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const R = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls; scene?: THREE.Scene; keys: Set<string>; yaw: number; pitch: number } | null>(null);
  const [mode, setMode] = useState<CamMode>('orbit');
  const [evening, setEvening] = useState(false);
  const [views, setViews] = useState<SavedView[]>(() => { try { return JSON.parse(localStorage.getItem('ibt:views:' + floor.id) ?? '[]'); } catch { return []; } });
  const [fps, setFps] = useState(0);
  const [glError, setGlError] = useState<string | null>(null);
  const fitted = useRef<string>('');

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setGlError('WebGL is not available in this browser, so the 3D view is off. The 2D editor still works.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    R.current = { renderer, camera, controls, keys: new Set(), yaw: 0, pitch: 0 };
    fitted.current = ''; // a fresh camera needs framing (also after StrictMode remounts)
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0, frames = 0, t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const st = R.current!;
      if (modeRef.current === 'walk') {
        const sp = 0.05;
        const fwd = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
        const right = new THREE.Vector3(Math.cos(st.yaw), 0, -Math.sin(st.yaw));
        if (st.keys.has('w') || st.keys.has('arrowup')) camera.position.addScaledVector(fwd, sp);
        if (st.keys.has('s') || st.keys.has('arrowdown')) camera.position.addScaledVector(fwd, -sp);
        if (st.keys.has('a') || st.keys.has('arrowleft')) camera.position.addScaledVector(right, -sp);
        if (st.keys.has('d') || st.keys.has('arrowright')) camera.position.addScaledVector(right, sp);
        camera.position.y = 1.6;
        camera.rotation.set(st.pitch, st.yaw, 0, 'YXZ');
      } else controls.update();
      if (st.scene) renderer.render(st.scene, camera);
      frames++;
      const now = performance.now();
      if (now - t0 > 1000) { setFps(Math.round((frames * 1000) / (now - t0))); frames = 0; t0 = now; }
    };
    loop();
    const kd = (e: KeyboardEvent) => { if (modeRef.current === 'walk' && !(e.target instanceof HTMLInputElement)) R.current?.keys.add(e.key.toLowerCase()); };
    const ku = (e: KeyboardEvent) => R.current?.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    register?.({
      snapshot: () => renderer.domElement.toDataURL('image/png'),
      exportGlb: () => new Promise((res, rej) => new GLTFExporter().parse(R.current!.scene!, (g) => res(new Blob([g as ArrayBuffer], { type: 'model/gltf-binary' })), rej, { binary: true })),
    });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); };
  }, []);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    const { scene, center, extent } = buildScene(floor, cat, layers, { evening, selection });
    st.scene?.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); });
    st.scene = scene;
    if (fitted.current !== floor.id) {
      fitted.current = floor.id;
      st.controls.target.copy(center);
      st.camera.position.set(center.x + extent * 0.55, extent * 0.95, center.z + extent * 0.75);
    }
  }, [floor, cat, layers, evening, selection]);

  useEffect(() => {
    const st = R.current;
    if (!st) return;
    st.controls.enabled = mode !== 'walk';
    const c = centroid(floor.rooms.flatMap((r) => r.polygon).length ? floor.rooms.flatMap((r) => r.polygon) : [{ x: 0, y: 0 }]);
    if (mode === 'top') { st.controls.target.set(c.x * S, 0, -c.y * S); st.camera.position.set(c.x * S, 16, -c.y * S + 0.01); }
    if (mode === 'walk') {
      const r = floor.rooms.find((x) => x.type === 'living') ?? floor.rooms[0];
      const p = r ? centroid(r.polygon) : c;
      st.camera.position.set(p.x * S, 1.6, -p.y * S); st.yaw = 0; st.pitch = 0;
    }
    if (mode === 'orbit') { st.controls.target.set(c.x * S, 1.2, -c.y * S); }
  }, [mode]);

  // pointer: select in orbit mode, look around in walk mode
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pd = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const pm = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    if (mode === 'walk' && R.current) { R.current.yaw -= (e.clientX - d.x) * 0.005; R.current.pitch = Math.max(-1.2, Math.min(1.2, R.current.pitch - (e.clientY - d.y) * 0.005)); d.x = e.clientX; d.y = e.clientY; }
  };
  const pu = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !R.current?.scene || !onSelect) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), R.current.camera);
    const hits = ray.intersectObjects(R.current.scene.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData?.kind) o = o.parent;
      if (o?.userData?.kind) { onSelect({ kind: o.userData.kind, id: o.userData.id }); return; }
    }
    onSelect(null);
  };
  const saveView = () => {
    const st = R.current!;
    const name = prompt('Name this camera view', `View ${views.length + 1}`);
    if (!name) return;
    const nv = [...views, { name, pos: st.camera.position.toArray() as [number, number, number], target: st.controls.target.toArray() as [number, number, number] }];
    setViews(nv);
    try { localStorage.setItem('ibt:views:' + floor.id, JSON.stringify(nv)); } catch { /* ignore */ }
  };
  const goView = (v: SavedView) => { const st = R.current!; setMode('orbit'); st.camera.position.fromArray(v.pos); st.controls.target.fromArray(v.target); };

  return (
    <div className="v3d" ref={host} onPointerDown={pd} onPointerMove={pm} onPointerUp={pu}>
      {glError && <div className="banner warn" style={{ position: 'absolute', inset: 20, height: 'fit-content' }}>{glError}</div>}
      <div className="overlay-tr no-print">
        <div className="seg">{(['orbit', 'walk', 'top'] as CamMode[]).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'orbit' ? 'Orbit' : m === 'walk' ? 'Walk' : 'Top'}</button>)}</div>
        <button className={'btn sm' + (evening ? ' on' : '')} onClick={() => setEvening(!evening)} title="Lighting scene preview">☾ Lighting</button>
        <button className="btn sm" onClick={saveView}>Save view</button>
      </div>
      <div className="overlay no-print">
        {views.map((v) => <button key={v.name} className="chip" onClick={() => goView(v)}>{v.name}</button>)}
        <span className="chip">{fps} fps{mode === 'walk' ? ' · WASD to walk, drag to look' : ''}</span>
      </div>
    </div>
  );
}
