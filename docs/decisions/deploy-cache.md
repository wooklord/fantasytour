# Build id, deploy verification and the missing cache-busting

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 3429–3537. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

**HOW TO ANSWER "IS THE NEW BUNDLE LIVE?" — build id, added 2026-08-17.**
`build.mjs` injects a `__BUILD_ID__` of the form `<contenthash>-<gitsha>`,
rendered in the Settings card under the colophon. The content hash covers
**every file that ships** — `src/**/*.js` *plus* `styles.css` *plus*
`index.html` — because `styles.css` is a separate `<link>` (`index.html:16`)
that esbuild never sees, so a src-only hash would be blind to CSS changes,
which was one of the two cases that prompted this.

```
# what is deployed
curl -s https://fantasyeggy.wooklord.net/app.js | grep -oE '[0-9a-f]{7}-[0-9a-f]{7}' | head -1
# what is local (dev server, or swap for a file read of app.js)
curl -s http://localhost:8080/app.js          | grep -oE '[0-9a-f]{7}-[0-9a-f]{7}' | head -1
```

Equal = the deploy is live. Different = it is not, and the git SHA half says
which commit *is*. **This replaces the ad-hoc "grep the bundle for a string
unique to my change" checks used throughout this file** — those work only if
you already know such a string, which is exactly what you lack when the
question is "did anything change at all".
- **It also separates "not deployed" from "my browser cached it"**: the
  Settings card shows the id the *tab* is running, `curl` shows the id the
  *edge* is serving. Two different ids means a stale client, not a failed
  deploy — the distinction the `max-age=600` entry below makes so painful.
- **The separator is a plain `-`, deliberately.** esbuild does NOT fold
  `` `build ${__BUILD_ID__}` `` into one literal — it emits
  `build ${"<id>"}` — and it escapes non-ASCII, so an earlier `·` came out
  as `\xB7` and a grep for the rendered prose matched nothing. Verified
  against the emitted bundle, not assumed.
- **Content hash, not a timestamp, and not a dirty flag.** `npm run dev`
  runs `build.mjs` before serving, so a timestamp would rewrite `app.js` on
  every dev-server start and leave the tree permanently dirty — destroying
  "tree is clean" as a signal. A dirty flag would be permanently set in the
  committed bundle, since you always build before committing.
- **Consequence to know: a CSS-only edit now changes `app.js`**, because the
  embedded id moves. Rebuild and commit both together. That is what keeps
  the id honest about CSS rather than silently under-reporting it.
- **Scope limit, worth stating: the id lives in `app.js` but covers
  `styles.css` too.** GitHub Pages deploys the whole repo per commit, so the
  *origin* always serves both from the same commit and the pairing is real
  there. A *client* can still hold them from different deploys for up to the
  cache window, since each file is cached independently — so a mismatched
  pair is possible in a browser and never at the edge. That is the same
  `max-age=600` problem below, not a flaw in the id.

**Deferred, and it silently taxes EVERY breaking change: `app.js` HAS NO
CACHE-BUSTING, and both it and `index.html` are served with
`max-age=600`.** Measured directly against the live site 2026-08-16 (not
inferred from GitHub Pages docs), so nobody has to re-measure it:

```
app.js      Cache-Control: max-age=600
index.html  Cache-Control: max-age=600
```

and `index.html:52` loads the bundle as a bare `<script src="app.js">` —
**no content hash in the filename, no query string, nothing tied to the
build.** Consequences, in the order they bite:

- **An active browser can keep running the old bundle for ~10 minutes
  after a deploy.** A normal reload inside that window serves the cached
  copy; only a hard reload bypasses it. So "I pushed it" and "clients are
  running it" are up to ten minutes apart, and the gap is invisible from
  the dev's side.
- **An installed PWA left open never refetches at all** until it is fully
  closed and reopened — so the tail is *unbounded*, not ten minutes. This
  compounds with the separate `state.leagues` reload requirement (see
  "Multi-league switcher behavior"): both are fixed by the same user
  action, and neither is discoverable by the user.
- **Therefore no deploy ordering is ever "clean" for a breaking change.**
  The window is governed by client cache and reload behaviour, which the
  deploy does not control — not by how fast the push lands.

**Two changes in one week have already paid this cost**, which is what
moved it from theoretical to recorded:
- **The domain move (2026-08-15)** — the storage/origin change forced every
  player to re-load and re-install anyway, so the stale-bundle tail was
  absorbed into a migration that was already disruptive. Easy to miss as
  an instance of this problem precisely because it hid inside a bigger one.
- **Stage P (2026-08-16)** — a genuine breaking RPC signature change, where
  it directly forced a two-file P1/P2 split (`stage_p1_...` additive,
  `stage_p2_...` the drop) purely to keep old and new bundles both working
  across the window. That split is the concrete, recurring cost: **every
  future signature change needs the same dance until this is fixed.**

**Fix options, either of which removes the window entirely:**
1. **Content hash in the filename** — emit `app.<hash>.js` from
   `build.mjs` and rewrite the `<script src>` in `index.html` at build
   time. Strongest option: the URL changes whenever the bytes change, so a
   cached old bundle is simply never requested again. Costs a build step
   that edits `index.html`, which is currently a static hand-maintained
   file, and means the committed bundle filename changes every build
   (noisier diffs, and the old file needs cleaning up).
2. **Query string keyed to the build** — `<script src="app.js?v=<hash>">`.
   Much smaller change; `app.js` keeps its stable name and git history
   stays clean. Caches key on the full URL including the query, so this is
   effective in practice. Slightly weaker than (1) — some intermediaries
   have historically ignored query strings for caching, though that is
   rare now and does not apply to the GitHub Pages CDN.
**Recommendation: (2)**, given `index.html` is a ~50-line hand-maintained
shell and the bundle is committed to git — (1)'s churn is real and buys
little at this scale. Either way `index.html` must stay `max-age=600` or
lower, since it is the file that carries the pointer.

**Not urgent in itself** — it changes nothing on a normal, non-breaking
deploy, which is most of them. Worth doing before the next breaking RPC
change, or before the player count makes "tell everyone to reload" stop
being a viable fallback.
