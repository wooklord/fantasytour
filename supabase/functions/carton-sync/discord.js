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
// Part 2 (Stage Y, APPROVED 2026-11-01, "Part 2 build record" in the same
// file): the outcome vocabulary below is what leagues.discord_status stores
// (its check constraint; STATUS_RE is the same regex), statusPatch is the
// row update index.ts writes after every post and every daily GET check,
// and DEAD_STATUSES are the words that drop the client's hint on their own
// (the SQL's discord_live names exactly them). Mutation M8 (a stale check
// counted as live) is run against the SQL rule's mirror in test/harness.mjs
// and against the stage file; nothing here decides liveness.

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
// is resolveHook's null and never reaches here); index.ts writes them through
// statusPatch below, and the daily check reads a GET's status through this.
export function postOutcome(status) {
  if (status == null) return { ok: false, status: "error" };
  const n = Number(status);
  if (!Number.isFinite(n)) return { ok: false, status: "error" };
  // Only a real three-digit HTTP status becomes http_<n>; anything else is
  // `error`, so the stored word always satisfies the Stage Y constraint.
  if (!Number.isInteger(n) || n < 100 || n > 999) return { ok: false, status: "error" };
  if (n >= 200 && n < 300) return { ok: true, status: "ok" };
  return { ok: false, status: `http_${n}` };
}

// ---- Part 2 (Stage Y) ----
// The status a league gets when its name resolves to no secret: resolveHook's
// null, written on EVERY post attempt and by the daily check (the dev's call
// 5), so a removed or renamed secret flips the league dead at its next
// event, not only at the next daily check.
export const NO_KEY = "no_key";
// The three words that mean "not live" on their own, whatever the last
// success was: a deleted webhook, a bad token, no secret. The SQL's
// discord_live (sql/stage_y_discord_status.sql) names exactly these; a
// transient failure (429, 5xx, error) is deliberately NOT here (call 2).
export const DEAD_STATUSES = ["http_404", "http_401", NO_KEY];
// The vocabulary leagues.discord_status accepts — its check constraint, as a
// JS regex. test/stageY.test.mjs checks the two are the same text.
export const STATUS_RE = /^(ok|no_key|error|http_[0-9]{3})$/;

// The update index.ts writes to leagues after a post or a daily check: the
// status and the check time ALWAYS, the success time ONLY on a success — so
// discord_ok_at is the last success and a failure never touches it. A word
// outside the vocabulary (there should be none) is written as `error` rather
// than failing the constraint. `nowIso` is injected so tests are exact.
export function statusPatch(outcome, nowIso) {
  const status = STATUS_RE.test(outcome?.status ?? "") ? outcome.status : "error";
  const patch = { discord_status: status, discord_checked_at: nowIso };
  if (status === "ok") patch.discord_ok_at = nowIso;
  return patch;
}
