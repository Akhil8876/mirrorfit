// Section 11: task-graph orchestrator. Independent tasks run in parallel, results are validated
// before they are merged (REL-01/02), with retries + backoff (REL-03), checkpoints (REL-04),
// priority lanes (AGT-05) and progress streaming (AGT-07).

export type Lane = 'interactive' | 'generation' | 'export';
const LANE_ORDER: Lane[] = ['interactive', 'generation', 'export'];

export interface JobTask<T = unknown> {
  id: string;
  label: string;
  lane: Lane;
  deps: string[];
  run: (inputs: Record<string, unknown>) => Promise<T> | T;
  validate?: (out: T) => string | null; // null = valid
  retries?: number;
  timeoutMs?: number;
}

export type JobEvent =
  | { type: 'queued'; id: string; label: string }
  | { type: 'start'; id: string; attempt: number }
  | { type: 'done'; id: string; ms: number; cached?: boolean }
  | { type: 'retry'; id: string; attempt: number; error: string }
  | { type: 'fail'; id: string; error: string };

export interface RunOptions {
  concurrency?: number;
  onEvent?: (e: JobEvent) => void;
  checkpoint?: Map<string, unknown>; // completed results survive a failed run
  backoffMs?: number;
  onResult?: (id: string, out: unknown) => void; // called after validation, so only valid patches are merged (AGT-03)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return p;
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);
}

export async function runGraph(tasks: JobTask[], opts: RunOptions = {}): Promise<{ results: Map<string, unknown>; failed: string[] }> {
  const conc = opts.concurrency ?? 4;
  const results = opts.checkpoint ?? new Map<string, unknown>();
  const failed: string[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) for (const d of t.deps) if (!byId.has(d) && !results.has(d)) throw new Error(`Task ${t.id} depends on unknown task ${d}`);
  const pending = new Set(tasks.filter((t) => !results.has(t.id)).map((t) => t.id));
  for (const t of tasks) {
    if (results.has(t.id)) opts.onEvent?.({ type: 'done', id: t.id, ms: 0, cached: true });
    else opts.onEvent?.({ type: 'queued', id: t.id, label: t.label });
  }
  const running = new Set<string>();
  return new Promise((resolve) => {
    const pump = () => {
      if (!pending.size && !running.size) return resolve({ results, failed });
      const ready = [...pending].map((id) => byId.get(id)!).filter((t) => t.deps.every((d) => results.has(d)));
      const blocked = [...pending].filter((id) => byId.get(id)!.deps.some((d) => failed.includes(d)));
      for (const id of blocked) { pending.delete(id); failed.push(id); opts.onEvent?.({ type: 'fail', id, error: 'dependency failed' }); }
      ready.sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane));
      for (const t of ready) {
        if (running.size >= conc) break;
        if (!pending.has(t.id)) continue;
        pending.delete(t.id);
        running.add(t.id);
        execute(t).then((ok) => { running.delete(t.id); if (!ok) failed.push(t.id); pump(); });
      }
      if (!running.size && pending.size && !ready.length) {
        for (const id of pending) { failed.push(id); opts.onEvent?.({ type: 'fail', id, error: 'unresolvable dependencies' }); }
        pending.clear();
        resolve({ results, failed });
      }
    };
    const execute = async (t: JobTask): Promise<boolean> => {
      const inputs: Record<string, unknown> = {};
      for (const d of t.deps) inputs[d] = results.get(d);
      const max = (t.retries ?? 2) + 1;
      for (let attempt = 1; attempt <= max; attempt++) {
        const t0 = Date.now();
        opts.onEvent?.({ type: 'start', id: t.id, attempt });
        try {
          const out = await withTimeout(Promise.resolve().then(() => t.run(inputs)), t.timeoutMs);
          const err = t.validate?.(out as never) ?? null;
          if (err) throw new Error(`validation: ${err}`);
          results.set(t.id, out);
          opts.onResult?.(t.id, out);
          opts.onEvent?.({ type: 'done', id: t.id, ms: Date.now() - t0 });
          return true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (attempt < max) { opts.onEvent?.({ type: 'retry', id: t.id, attempt, error: msg }); await sleep((opts.backoffMs ?? 40) * 2 ** (attempt - 1)); }
          else { opts.onEvent?.({ type: 'fail', id: t.id, error: msg }); return false; }
        }
      }
      return false;
    };
    pump();
  });
}

/** A small pool of module workers with an inline fallback (AGT-04: separate CPU pool). */
export class WorkerPool<I, O> {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { input: I; resolve: (o: O) => void; reject: (e: unknown) => void }[] = [];
  constructor(make: (() => Worker) | null, size: number, private inline: (i: I) => O) {
    if (make && typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < size; i++) { const w = make(); this.workers.push(w); this.idle.push(w); }
      } catch { this.workers = []; this.idle = []; }
    }
  }
  get parallel() { return this.workers.length; }
  run(input: I): Promise<O> {
    if (!this.workers.length) return Promise.resolve().then(() => this.inline(input));
    return new Promise((resolve, reject) => { this.queue.push({ input, resolve, reject }); this.drain(); });
  }
  private drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      w.onmessage = (e: MessageEvent) => { this.idle.push(w); e.data?.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data.result as O); this.drain(); };
      w.onerror = (e) => { this.idle.push(w); job.reject(e); this.drain(); };
      w.postMessage(job.input);
    }
  }
}
