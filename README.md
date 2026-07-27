# Fantasy Eggy

A fantasy-setlist game for fans of the jam band **Eggy**. Predict which songs the band
plays in specific slots (opener, encore, set-2 opener, a repeatable cover pick, an
"Any Debut" wildcard, and flat picks); scores compute automatically from the real
setlist after each show. Standings, seasons, an admin panel, and notifications included.

## Stack

- **Frontend**: single static `index.html` (HTML/CSS/JS inline), served from GitHub Pages.
  *(A module split + build step is planned — see `CLAUDE.md`.)*
- **Backend**: Supabase — Postgres + RLS + Realtime + a Deno Edge Function.
- **Auth**: name + PIN (no email; validated server-side via `SECURITY DEFINER` RPCs).
- **Setlist data**: The Carton's public Songfish API (`https://thecarton.net/api/v2`).
- **Notifications**: in-app realtime toasts + Discord webhook.

## Repo layout

- `index.html` — the app.
- `sql/` — database schema. **`stage_a_schema.sql`** is the current multi-tenant schema
  (supersedes the archived incremental files).
- `supabase/functions/carton-sync/` — the Deno edge function (sync + scoring + announce).
- `docs/MULTITENANT_SPEC.md` — the full spec for the "2.0" multi-tenant rebuild.
- `assets/` — icons (app, favicon, PWA, Discord).
- `CLAUDE.md` — the engineering playbook and full project context. **Read this first
  if you're picking the project up.**

## Deploy

- **Frontend**: commit + push; GitHub Pages serves it. The two Supabase constants
  (`SUPABASE_URL`, `SUPABASE_ANON`) are near the top of the inline `<script>`. The anon
  key is public by design; the service_role key must never be committed.
- **Edge function**: `supabase functions deploy carton-sync`.
- **SQL**: run in the Supabase SQL editor.

## Status

Live in beta as a single-league app. About to undergo a multi-tenant rebuild
(Global -> League -> Bracket) — see `CLAUDE.md` and `docs/MULTITENANT_SPEC.md`.
Beta scores will be wiped at launch (players keep their accounts).
