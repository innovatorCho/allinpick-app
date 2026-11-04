import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

/**
 * Progress logging for long background runs (price collection, search
 * crawls), so Vercel's log viewer shows exactly when a run started, what it
 * did step by step, and how it ended.
 *
 * Every line carries:
 *  - the run id, e.g. "run=k3f9": lines from two overlapping runs never mix
 *    silently;
 *  - the server instance id, e.g. "inst=a1b2": two runs on the same instance
 *    vs. on different instances is visible at a glance;
 *  - seconds since the run started, e.g. "+12.4s".
 *
 * Code deep inside a run (the browser session, collectors) calls runLog()
 * without being handed anything: the run context travels through
 * AsyncLocalStorage. Outside a run, lines are printed with just the tag.
 */

/** Random per process. Fluid compute reuses an instance for many requests, so this tells instances apart. */
const INSTANCE_ID = randomBytes(2).toString("hex");

interface RunContext {
  tag: string;
  runId: string;
  startedAt: number;
}

const store = new AsyncLocalStorage<RunContext>();

export function newRunId(): string {
  return randomBytes(2).toString("hex");
}

export function withRunLog<T>(tag: string, runId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ tag, runId, startedAt: Date.now() }, fn);
}

export function currentRunElapsedMs(): number | null {
  const ctx = store.getStore();
  return ctx ? Date.now() - ctx.startedAt : null;
}

function prefix(fallbackTag: string): string {
  const ctx = store.getStore();
  if (!ctx) return `[${fallbackTag} inst=${INSTANCE_ID}]`;
  const elapsed = ((Date.now() - ctx.startedAt) / 1000).toFixed(1);
  return `[${ctx.tag} run=${ctx.runId} inst=${INSTANCE_ID} +${elapsed}s]`;
}

export function runLog(message: string, fallbackTag = "log"): void {
  console.log(`${prefix(fallbackTag)} ${message}`);
}

export function runWarn(message: string, fallbackTag = "log"): void {
  console.warn(`${prefix(fallbackTag)} ${message}`);
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}
