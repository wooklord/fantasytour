// Unit tests for the pure Discord-webhook module (supabase/functions/
// carton-sync/discord.js). Plain Node — no Deno, no Supabase, no network, no
// DOM — the same isolation as test/showSync.test.mjs, and wired into
// `npm test` the same way so it cannot go stale.
//
//   node test/discord.test.mjs
//
// Decision record: docs/decisions/discord-routing.md → "Per-league split:
// LOCKED 2026-10-28", Part 1. Three mutations are run against this file:
// M1 the global DISCORD_WEBHOOK fallback restored, M2 the mention block
// dropped, M3 the author name dropped. Each must turn at least one check red.

import {
  APP_NAME, WEBHOOK_KEY_PREFIX, CONTENT_MAX, USERNAME_MAX,
  webhookEnvKey, resolveHook, authorName, discordBody, postOutcome,
} from "../supabase/functions/carton-sync/discord.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}

const URL_GE = "https://discord.com/api/webhooks/1/green-eggs-token";
const URL_AM = "https://discord.com/api/webhooks/2/ambassadors-token";
const URL_GLOBAL = "https://discord.com/api/webhooks/3/global-token";
const envOf = (obj) => (k) => obj[k];

// ---------------------------------------------------------------
// webhookEnvKey — the two live league names derive to the two live keys,
// and the derivation is the one index.ts used before (upper-case, runs of
// non-alphanumerics to "_", edge underscores stripped).
// ---------------------------------------------------------------
check("key: Ambassadors → DISCORD_WEBHOOK_AMBASSADORS", webhookEnvKey("Ambassadors"), "DISCORD_WEBHOOK_AMBASSADORS");
check("key: Green Eggs → DISCORD_WEBHOOK_GREEN_EGGS", webhookEnvKey("Green Eggs"), "DISCORD_WEBHOOK_GREEN_EGGS");
check("key: a run of separators collapses to one underscore", webhookEnvKey("Green - Eggs"), "DISCORD_WEBHOOK_GREEN_EGGS");
check("key: edge separators are stripped", webhookEnvKey("  (Green Eggs)  "), "DISCORD_WEBHOOK_GREEN_EGGS");
check("key: a non-ASCII letter is a separator (as before)", webhookEnvKey("Café Eggy"), "DISCORD_WEBHOOK_CAF_EGGY");
check("key: the prefix constant is the live one", WEBHOOK_KEY_PREFIX, "DISCORD_WEBHOOK_");

// ---------------------------------------------------------------
// resolveHook — the league's own key, nothing else, nothing for no name.
// ---------------------------------------------------------------
const liveToday = { DISCORD_WEBHOOK_GREEN_EGGS: URL_GE };            // the dashboard as of 2026-10-28
const bothSet = { DISCORD_WEBHOOK_GREEN_EGGS: URL_GE, DISCORD_WEBHOOK_AMBASSADORS: URL_AM }; // after D7
const onlyGlobal = { DISCORD_WEBHOOK: URL_GLOBAL };
const globalAndGreen = { DISCORD_WEBHOOK: URL_GLOBAL, DISCORD_WEBHOOK_GREEN_EGGS: URL_GE };

check("resolve: today's dashboard — Green Eggs gets its own hook", resolveHook("Green Eggs", envOf(liveToday)), URL_GE);
check("resolve: today's dashboard — Ambassadors (no secret) gets null, i.e. posts nothing", resolveHook("Ambassadors", envOf(liveToday)), null);
check("resolve: after D7 — each league gets its OWN hook", [resolveHook("Ambassadors", envOf(bothSet)), resolveHook("Green Eggs", envOf(bothSet))], [URL_AM, URL_GE]);

// M1: with ONLY the old global secret set, both leagues must still be null.
check("resolve: only DISCORD_WEBHOOK set → null for Ambassadors (no global fallback)", resolveHook("Ambassadors", envOf(onlyGlobal)), null);
check("resolve: only DISCORD_WEBHOOK set → null for Green Eggs (no global fallback)", resolveHook("Green Eggs", envOf(onlyGlobal)), null);
check("resolve: global + Green Eggs set → Ambassadors still null, never the global one", resolveHook("Ambassadors", envOf(globalAndGreen)), null);

// Which keys are consulted is the real condition, not just the result: a
// fallback that happens to be unset would pass the three checks above.
{
  const asked = [];
  const r = resolveHook("Ambassadors", (k) => { asked.push(k); return undefined; });
  check("resolve: exactly ONE key is consulted, the league's own", asked, ["DISCORD_WEBHOOK_AMBASSADORS"]);
  check("resolve: ... and the result is null", r, null);
}

// Empty / missing names: nothing is read at all.
{
  const asked = [];
  const spy = (k) => { asked.push(k); return URL_GLOBAL; }; // would return a URL for ANY key
  check("resolve: empty name → null even if every key would resolve", resolveHook("", spy), null);
  check("resolve: undefined name → null", resolveHook(undefined, spy), null);
  check("resolve: null name → null", resolveHook(null, spy), null);
  check("resolve: whitespace-only name → null", resolveHook("   ", spy), null);
  check("resolve: a name with nothing alphanumeric in it → null", resolveHook("!!!", spy), null);
  check("resolve: ... and in none of those cases was any key consulted (empty set)", asked, []);
}
check("resolve: an empty secret value is not a hook", resolveHook("Green Eggs", envOf({ DISCORD_WEBHOOK_GREEN_EGGS: "" })), null);

// ---------------------------------------------------------------
// authorName — "Fantasy Eggy · <League>", capped at 80 counting the label.
// ---------------------------------------------------------------
check("author: APP_NAME is the instance constant", APP_NAME, "Fantasy Eggy");
check("author: Green Eggs", authorName("Green Eggs"), "Fantasy Eggy · Green Eggs");
check("author: Ambassadors", authorName("Ambassadors"), "Fantasy Eggy · Ambassadors");
check("author: the league name is trimmed", authorName("  Green Eggs "), "Fantasy Eggy · Green Eggs");
check("author: no league → the app name alone, no dangling separator", authorName(""), "Fantasy Eggy");
{
  const longLeague = "L".repeat(120);
  const name = authorName(longLeague);
  check("author: a long league name is cut so the WHOLE label is 80 characters", name.length, USERNAME_MAX);
  check("author: ... keeping the prefix intact", name.startsWith("Fantasy Eggy · "), true);
  check("author: ... so the league part is 80 minus the prefix, not 80", name.slice("Fantasy Eggy · ".length).length, USERNAME_MAX - "Fantasy Eggy · ".length);
  check("author: a label of exactly 80 is left alone", authorName("L".repeat(USERNAME_MAX - "Fantasy Eggy · ".length)).length, USERNAME_MAX);
}
check("author: Discord's username cap is 80", USERNAME_MAX, 80);

// ---------------------------------------------------------------
// discordBody — every post, both leagues: parse: [] and the author name.
// The eight message shapes index.ts posts, including names that WOULD ping
// without the block (the mention hazard from the decision record).
// ---------------------------------------------------------------
const messages = [
  "⏰ **1 hour to lock** — Ardmore Music Hall. Still waiting on: @everyone, @here, <@123456789012345678>, <@&987654321098765432>",
  "⏰ **1 hour to lock** — Ardmore Music Hall. Everyone's in 🥚",
  "🔒 **Picks are locked** for Ardmore Music Hall — 9 sheets in. Boards are live in the app.",
  "🏆 **Ardmore Music Hall** is final\n**Casual**: @everyone · 14 pts\n**Official**: <@123456789012345678> · 12 pts",
  "👑 **Fall 2026 is in the books!**\n🥇 @here · 88   🥈 x · 80   🥉 y · 71",
  "🥚 **Show's on** — Ardmore Music Hall\n🎵 **Song A** — *Opener*",
  "🕓 **Cutoff changed** for Ardmore Music Hall — now Nov 6, 2026, 6:00 PM ET.",
  "⚠️ **Show sync** — Ardmore Music Hall (2026-11-06): Carton no longer returns this show; not deleted",
  "🔄 **Scores reopened** for Ardmore Music Hall — corrected setlist, re-scoring now.",
];
const leagues = ["Ambassadors", "Green Eggs"];
{
  const noBlock = [];       // bodies whose allowed_mentions is not exactly { parse: [] }
  const wrongAuthor = [];   // bodies whose username is not the league's own author name
  const rewritten = [];     // bodies whose content was altered (the block, not a rewrite, is the mechanism)
  const extraKeys = [];     // bodies sending anything beyond the three fields
  for (const lg of leagues) {
    for (const [i, msg] of messages.entries()) {
      const body = discordBody(lg, msg);
      if (JSON.stringify(body.allowed_mentions) !== JSON.stringify({ parse: [] })) noBlock.push(`${lg}#${i}`);
      if (body.username !== `Fantasy Eggy · ${lg}`) wrongAuthor.push(`${lg}#${i}`);
      if (body.content !== msg) rewritten.push(`${lg}#${i}`);
      if (Object.keys(body).sort().join() !== "allowed_mentions,content,username") extraKeys.push(`${lg}#${i}`);
    }
  }
  check("body: EVERY post of both leagues carries allowed_mentions { parse: [] } (offenders)", noBlock, []);
  check("body: EVERY post carries its own league's author name (offenders)", wrongAuthor, []);
  check("body: a message under the cap is sent as typed, mentions included — the block is the mechanism (offenders)", rewritten, []);
  check("body: nothing else is sent (offenders)", extraKeys, []);
  check("body: the two leagues' author names differ", discordBody("Ambassadors", "x").username === discordBody("Green Eggs", "x").username, false);
}
check("body: parse is an empty ARRAY, not a missing field or a string",
  Array.isArray(discordBody("Green Eggs", "x").allowed_mentions?.parse) && discordBody("Green Eggs", "x").allowed_mentions.parse.length === 0, true);

// The content cap.
{
  const long = "x".repeat(2500);
  const body = discordBody("Green Eggs", long);
  check("cap: content is cut to 1900", body.content.length, CONTENT_MAX);
  check("cap: ... the first 1900 characters", body.content, long.slice(0, 1900));
  check("cap: the constant is 1900", CONTENT_MAX, 1900);
  check("cap: exactly 1900 is left alone", discordBody("Green Eggs", "y".repeat(1900)).content.length, 1900);
  check("cap: the author name is unaffected by a long message", body.username, "Fantasy Eggy · Green Eggs");
  check("cap: the mention block is unaffected by a long message", body.allowed_mentions, { parse: [] });
}
check("body: an empty message is an empty content string", discordBody("Green Eggs", "").content, "");
check("body: an undefined message is an empty content string, not \"undefined\"", discordBody("Green Eggs", undefined).content, "");

// ---------------------------------------------------------------
// postOutcome — Discord's answer, sorted.
// ---------------------------------------------------------------
check("outcome: 204 (the normal webhook answer) → ok", postOutcome(204), { ok: true, status: "ok" });
check("outcome: 200 (?wait=true) → ok", postOutcome(200), { ok: true, status: "ok" });
check("outcome: 404 (webhook deleted) → failed, http_404", postOutcome(404), { ok: false, status: "http_404" });
check("outcome: 401 (bad token) → failed", postOutcome(401), { ok: false, status: "http_401" });
check("outcome: 429 (rate limited) → failed", postOutcome(429), { ok: false, status: "http_429" });
check("outcome: 400 (rejected body) → failed", postOutcome(400), { ok: false, status: "http_400" });
check("outcome: 500 → failed", postOutcome(500), { ok: false, status: "http_500" });
check("outcome: 3xx is not ok", postOutcome(301).ok, false);
check("outcome: fetch threw (null) → failed, error", postOutcome(null), { ok: false, status: "error" });
check("outcome: undefined → failed, error", postOutcome(undefined), { ok: false, status: "error" });
check("outcome: a non-numeric status → failed, error, never http_NaN", postOutcome("abc"), { ok: false, status: "error" });
check("outcome: a numeric string is read as a number", postOutcome("204"), { ok: true, status: "ok" });
{
  const all = [200, 204, 301, 400, 401, 404, 429, 500, null, undefined, "abc"].map(postOutcome);
  check("outcome: ok is true exactly when status is \"ok\" (no third state)", all.every((o) => o.ok === (o.status === "ok")), true);
}

// ---------------------------------------------------------------
if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all discord.js checks passed.");
  process.exit(0);
}
