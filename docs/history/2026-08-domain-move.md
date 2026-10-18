# 2026-08-15: domain move to fantasyeggy.wooklord.net

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 1209–1264. Nested entries were de-indented to top level; wording is unchanged.
> Historical record — resolved, closed or superseded. Kept for its method and evidence. Not a current instruction.

- **✅ DONE 2026-08-15 — the app now lives at `fantasyeggy.wooklord.net`.**
  Was a roadmap item gated on "before Facebook-league recruitment begins";
  shipped ahead of that, which was the point (the cost scales with player
  count, so paying it at thirteen players beat paying it at fifty).
  `CNAME` is committed at the repo root and the old `github.io` URL
  redirects. **This is item #3 on the Pre-Session-5 gate — now closed.**
  - **The codebase needed NO changes, verified before the move rather than
    discovered during it.** `manifest.webmanifest` has `start_url: "."` and
    **no `scope` key at all** (an absent scope defaults to the manifest's
    own directory), so both are origin-relative and followed the app across.
    Icons are relative. `index.html` has no `<base>` tag and no absolute
    self-references. `src/` contains zero `location.origin`/`.host`/
    `.href`/`.hostname`/`document.domain` uses and no absolute URL to the
    app's own host. **There is no service worker anywhere in the repo**, so
    there was no cached scope pinned to the old origin — one of the usual
    ways this move breaks simply didn't apply.
  - **Supabase needed nothing either, and that's worth stating because it
    normally would.** Auth here is a name+PIN RPC, not Supabase Auth, so
    there are no redirect URLs or site-URL allowlists tied to an origin.
    The publishable key, project URL and the cron's Authorization header
    are all origin-independent.
  - **What it bought, precisely:** (a) **host portability** — the URL is no
    longer a `github.io` path, so leaving GitHub Pages later is a DNS
    change nobody notices; (b) **storage-origin isolation** — the app no
    longer shares `localStorage` with the Ambassadors app or anything else
    on `wooklord.github.io`, which is the half that actually mattered given
    `ft_session` holds a plaintext PIN. See the `ft_session` bullet above
    for why that narrows the blast radius without fixing the credential.
  - **What it cost players, as predicted:** logged out (`ft_session` is
    origin-scoped), in-progress drafts dropped (`ft_draft_*`), and a
    re-add to the home screen for anyone who had installed it. **Expect to
    run `admin_reset_player_pin` a few times** — some players hadn't typed
    their PIN since setting it, because the stored session kept them signed
    in. That is a normal outcome of this move, not a sign anything
    went wrong.
  - **Implementation, retained because it generalises to the next move:** a
    `CNAME` file in the repo containing the subdomain, a DNS `CNAME` record
    pointing at `wooklord.github.io`, then enable HTTPS in the repo's Pages
    settings. Use a **subdomain, not the apex** — GitHub Pages allows one
    apex/www site per account but unlimited project sites, so don't spend
    the apex here.
  - **Path prefix changed too, and it's why the storage loss was
    unavoidable**: the app was served from a project page at
    `wooklord.github.io/fantasytour/` and now sits at the root of its own
    host. Every reference being relative is what made that a non-event for
    the *code*; it's still a different origin AND path for the *browser*,
    which is exactly what drops the storage.
  - **Caveat that survives the move — still live, read it before adding any
    cookie**: subdomains are separate *storage* origins, but `wooklord.net`
    is a registrable domain, so a cookie set with `domain=.wooklord.net` is
    readable by every subdomain. Storage separates automatically; cookies
    don't. Scope any cookie to the exact host with no `domain` attribute.
    (Moot today — the app sets no cookies at all and uses no
    `sessionStorage`/`indexedDB`; `localStorage` is the entire client-side
    surface: `ft_session`, `ft_bracket_id`, `ft_theme2`,
    `ft_admin_sections`, and the per-show `ft_draft_*` keys.)
