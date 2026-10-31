// Pure Discord-webhook helpers for Fantasy Eggy — no Deno, no Supabase, no
// network I/O. Same isolation as scoring.js and showSync.js: the Deno edge
// function (index.ts) reads the env and performs the fetch; this file decides
// WHICH secret to read, WHAT to send and HOW to read the answer, and
// test/discord.test.mjs imports it under plain Node.
//
// Decision record: docs/decisions/discord-routing.md → "Per-league split:
// LOCKED 2026-10-28", Part 1 (D2, D7, D8). The three rules this file holds,
// each with the mutation that is run against it:
//   * routing is the league's OWN secret, DISCORD_WEBHOOK_<LEAGUE NAME>, with
//     NO global fallback — a league with no secret posts nothing, by design,
//     rather than into another league's channel (M1: fallback restored);
//   * every post blocks every mention, so a member named "@everyone" or a
//     name holding a raw <@…> can never ping a channel (M2: block dropped);
//   * every post carries the per-league author name, so the two leagues'
//     posts stay legible even through a reused webhook (M3: label dropped).

// Instance constants (Conventions: instance values live in named constants).
export const APP_NAME = "Fantasy Eggy";
const AUTHOR_SEP = " · ";
export const WEBHOOK_KEY_PREFIX = "DISCORD_WEBHOOK_";
// Discord's own limits: 2000 characters of content (1900 keeps the headroom
// the old inline code had) and 80 characters for the `username` override.
export const CONTENT_MAX = 1900;
export const USERNAME_MAX = 80;

// DISCORD_WEBHOOK_<NAME>: the league's live `leagues.name`, upper-cased, each
// non-alphanumeric run collapsed to "_", edge underscores stripped — the same
// derivation index.ts has used since the per-league secret was introduced,
// so the live secret name (DISCORD_WEBHOOK_GREEN_EGGS) keeps resolving. A
// league rename silently changes the key: rename the secret with it.
export function webhookEnvKey(leagueName) {
  return WEBHOOK_KEY_PREFIX + String(leagueName ?? "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// The webhook URL for a league, or null. `getEnv` is injected (Deno.env.get
// in production, a plain lookup in tests). Exactly one key is ever consulted
// — the league's own — and none at all for a name that derives to no key
// (empty, missing, or nothing alphanumeric in it). There is no global
// DISCORD_WEBHOOK fallback: a league without its own secret is silent.
export function resolveHook(leagueName, getEnv) {
  const key = webhookEnvKey(leagueName);
  if (key === WEBHOOK_KEY_PREFIX) return null;
  return getEnv(key) || null;
}

// "Fantasy Eggy · <League>", capped at Discord's 80 characters counting the
// WHOLE label (prefix and separator included), not the league name alone.
export function authorName(leagueName) {
  const league = String(leagueName ?? "").trim();
  return (league ? APP_NAME + AUTHOR_SEP + league : APP_NAME).slice(0, USERNAME_MAX);
}

// The JSON body of every post. `allowed_mentions: { parse: [] }` is what
// stops @everyone/@here/role/user pings whatever the text holds — the
// content is NOT rewritten (a nickname stays as typed); the mention is just
// never resolved. `username` is the per-league author name (D2).
export function discordBody(leagueName, msg) {
  return {
    content: String(msg ?? "").slice(0, CONTENT_MAX),
    username: authorName(leagueName),
    allowed_mentions: { parse: [] },
  };
}

// Sorts Discord's answer into ok or failed. `status` is the HTTP status, or
// null when the fetch itself threw (DNS, TLS, timeout). Discord answers a
// webhook POST with 204 (200 with ?wait=true); anything else is a failed
// post — 404 a deleted webhook, 401 a bad token, 429 rate-limited, 400 a
// rejected body. The `status` strings are the vocabulary Part 2's
// leagues.discord_status will store (`ok`, `http_<code>`, `error`; `no_key`
// is resolveHook's null and never reaches here). Part 1 only logs them.
export function postOutcome(status) {
  if (status == null) return { ok: false, status: "error" };
  const n = Number(status);
  if (!Number.isFinite(n)) return { ok: false, status: "error" };
  if (n >= 200 && n < 300) return { ok: true, status: "ok" };
  return { ok: false, status: `http_${n}` };
}
