import * as esbuild from "esbuild";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------
// BUILD ID — rendered in the Settings card, and the answer to "which
// bundle am I actually looking at". Two things cost real time before this
// existed: a change that hadn't been rebuilt, and a browser tab holding a
// stale bundle, which look identical from the app.
//
// It is a CONTENT HASH, not a timestamp, and that is deliberate:
// `npm run dev` runs this file before serving, so a timestamp would rewrite
// app.js on every dev-server start and leave `git status` permanently
// dirty — destroying "tree is clean" as a signal and masking real changes.
// A content hash is identical for an identical build, so a no-op rebuild
// produces no diff.
//
// The tradeoff, stated: the id does NOT change on a rebuild that changes
// nothing. That is correct rather than a gap — the bundle is byte-identical,
// so "is this the new one" has no meaningful answer. The case that matters
// (source edited, id unmoved) still shows up, and means the edit did not
// save or the build did not run.
//
// INPUTS COVER EVERYTHING SERVED, not just what esbuild bundles.
// styles.css is a separate <link> in index.html (index.html:16) and nothing
// in src/ imports it, so esbuild never sees it — a src-only hash would be
// blind to every CSS change, which is precisely one of the cases that
// prompted this. index.html is included for the same reason: it is the
// shell, and it ships.
//
// Consequence to know: a CSS-only edit now changes app.js, because the id
// embedded in it moves. Rebuild and commit both together. That is what keeps
// the id honest about CSS instead of silently under-reporting it.
// ---------------------------------------------------------------------
function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) jsFiles(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

// Sorted so the hash is stable regardless of directory-read order.
const inputs = [...jsFiles("src").sort(), "styles.css", "index.html"];
const h = createHash("sha256");
for (const f of inputs) h.update(readFileSync(f));
const contentHash = h.digest("hex").slice(0, 7);

// Provenance: which commit this was built from. Wrapped so a missing git, or
// a checkout with no commits, degrades to a marker rather than failing the
// build. No dirty flag on purpose — you always build before committing, so
// the committed bundle would carry it permanently and it would mean nothing.
let sha = "nogit";
try { sha = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* keep nogit */ }

// Separator is a plain ASCII hyphen, NOT "·", and that is load-bearing.
// esbuild does not fold `build ${__BUILD_ID__}` into one literal — it emits
// `build ${"<id>"}` — and it escapes non-ASCII, so "·" comes out as "\xB7".
// A grep for the rendered prose therefore matches nothing in app.js.
// "<hash>-<sha>" survives verbatim and is greppable straight out of curl,
// which is the entire point of having the id. Verified against the emitted
// bundle, not assumed.
const BUILD_ID = `${contentHash}-${sha}`;

await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "app.js",
  format: "iife",
  target: "es2019",
  sourcemap: true,
  logLevel: "info",
  // Textual substitution at build time — src/ just references the
  // identifier, nothing is hand-maintained.
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
});

console.log(`  build id    ${BUILD_ID}`);
