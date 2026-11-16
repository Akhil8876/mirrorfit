import React from 'react';
import { useStore, mutate, exportProjectFile, toast } from '../store';
import type { RulePack, Settings } from '../core/types';
import { DEFAULT_RULES } from '../core/rules';
import { Field, FilePick, NumInput, TextInput, download, shrinkImage } from './common';

export function SettingsView() {
  const project = useStore((s) => s.project)!;
  const s = project.settings;
  const set = (patch: Partial<Settings>) => mutate('Settings', (p) => { p.settings = { ...p.settings, ...patch }; });
  const setRule = (patch: Partial<RulePack>) => mutate('Rule pack', (p) => { p.settings.rulePack = { ...p.settings.rulePack, ...patch }; }, { audit: true });
  const R = s.rulePack;
  const num = (k: keyof RulePack, label: string, hint?: string) => <Field label={label} hint={hint}><NumInput value={R[k] as number} onChange={(v) => setRule({ [k]: v } as Partial<RulePack>)} /></Field>;
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="sub">Firm details, units, tax, layer standard and the versioned rule pack this project is designed under.</p>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card col">
          <h2>Firm & you</h2>
          <div className="fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Firm name"><TextInput value={s.firmName} onChange={(v) => set({ firmName: v })} /></Field>
            <Field label="Your name (for sign-offs)"><TextInput value={s.user} onChange={(v) => set({ user: v })} /></Field>
          </div>
          <div className="row">{s.firmLogo && <img src={s.firmLogo} style={{ height: 40 }} alt="Firm logo" />}<FilePick accept="image/*" onFile={async ([f]) => set({ firmLogo: (await shrinkImage(f, 400, 0.9)).url })}>{s.firmLogo ? 'Change logo' : 'Upload logo'}</FilePick></div>
          <h2 style={{ marginTop: 8 }}>Units, tax & tolerances</h2>
          <div className="fields">
            <Field label="Display units"><select className="i" value={s.displayUnits} onChange={(e) => set({ displayUnits: e.target.value as Settings['displayUnits'] })}><option value="mm">mm</option><option value="m">m</option><option value="ftin">ft-in</option></select></Field>
            <Field label="GST %"><NumInput value={s.gstPct} onChange={(v) => set({ gstPct: v })} /></Field>
            <Field label="Margin %"><NumInput value={s.marginPct} onChange={(v) => set({ marginPct: v })} /></Field>
            <Field label="Site tolerance (mm)"><NumInput value={s.siteTolerance} onChange={(v) => set({ siteTolerance: v })} /></Field>
            <Field label="Default slab height"><NumInput value={s.defaultCeiling} onChange={(v) => set({ defaultCeiling: v })} /></Field>
            <Field label="Drawing symbols"><select className="i" value={s.drawingStandard} onChange={(e) => set({ drawingStandard: e.target.value as Settings['drawingStandard'] })}><option>IS</option><option>BS</option><option>ANSI</option></select></Field>
            <Field label="Trade sheet labels"><select className="i" value={s.sheetLanguage} onChange={(e) => set({ sheetLanguage: e.target.value as Settings['sheetLanguage'] })}><option value="en">English</option><option value="hi">English + Hindi</option></select></Field>
          </div>
        </div>
        <div className="card col">
          <h2>Rule pack</h2>
          <div className="banner info small">{R.id} · {R.edition}. Values are stored with the project so it keeps the rules it was designed under. Confirm the building-code edition before citing it on drawings.</div>
          <div className="fields">
            <Field label="City / authority"><TextInput value={R.city} onChange={(v) => setRule({ city: v })} /></Field>
            {num('minHabitableArea', 'Min habitable room (m²)')}
            {num('minKitchenArea', 'Min kitchen (m²)')}
            {num('minHabitableCeiling', 'Min habitable ceiling')}
            {num('minToiletCeiling', 'Min toilet ceiling')}
            {num('minWindowRatio', 'Window / floor ratio')}
            {num('walkway', 'Walkway clearance')}
            {num('wardrobeFront', 'Wardrobe front clearance')}
            {num('bedSide', 'Bed-side clearance')}
            {num('switchMin', 'Switch height min')}
            {num('switchMax', 'Switch height max')}
            {num('counterMin', 'Counter height min')}
            {num('counterMax', 'Counter height max')}
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRule({ ...DEFAULT_RULES })}>Reset to {DEFAULT_RULES.id}</button>
        </div>
        <div className="card col">
          <h2>DWG layer standard</h2>
          <div className="fields">{Object.entries(s.layerStandard).map(([k, v]) => <Field key={k} label={k}><TextInput value={v} onChange={(nv) => set({ layerStandard: { ...s.layerStandard, [k]: nv } })} /></Field>)}</div>
        </div>
        <div className="card col">
          <h2>Data & privacy</h2>
          <div className="small">Projects, reference images and site photos are stored only in this browser. Nothing is uploaded or used to train shared models. Export the project file to back it up or move it to another machine.</div>
          <div className="row"><button className="btn primary" onClick={() => { download(`${project.name}.ibt.json`, exportProjectFile(), 'application/json'); toast('Project file saved'); }}>Export project file</button></div>
        </div>
      </div>
    </div>
  );
}
