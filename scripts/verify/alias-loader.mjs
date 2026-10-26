// Minimal ESM loader so verification scripts (run via `node --experimental-strip-types`)
// can import project modules the same way the app's TS source does — the
// tsconfig "@/" alias, and extensionless relative imports (e.g. "./schema").
// Not used by the app itself; Next.js/webpack handle both natively there.
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSIONS = [".ts", ".tsx"];

function firstExisting(basePathNoExt) {
  for (const ext of EXTENSIONS) {
    const withExt = `${basePathNoExt}${ext}`;
    if (existsSync(withExt)) return withExt;
  }
  for (const ext of EXTENSIONS) {
    const indexFile = path.join(basePathNoExt, `index${ext}`);
    if (existsSync(indexFile)) return indexFile;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `next`'s package.json has no "exports" map, so plain ESM `import` (unlike
  // CJS `require`, which does extensionless resolution) can't find subpaths
  // like "next/server" without the real file extension — confirmed: fails
  // with "Did you mean to import next/server.js?". Next.js's own bundler
  // (webpack/Turbopack) papers over this for real app code; these verify
  // scripts run as plain Node ESM, so they need the same nudge. Only a
  // handful of these subpaths are ever imported by lib/ code (currently just
  // "next/server", for lib/runAfterResponse.ts's `after()`) — add more here
  // if another one starts getting imported by something a verify script reaches.
  if (specifier === "next/server") {
    return nextResolve(`${specifier}.js`, context);
  }

  if (specifier.startsWith("@/")) {
    const base = path.join(rootDir, specifier.slice(2));
    const resolved = existsSync(base) ? base : (firstExisting(base) ?? `${base}.ts`);
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
    const parentPath = fileURLToPath(context.parentURL);
    const base = path.resolve(path.dirname(parentPath), specifier);
    const resolved = firstExisting(base);
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  return nextResolve(specifier, context);
}
