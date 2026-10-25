import { esc } from "./dom.js";
import { db } from "./supabaseClient.js";

// Stage S — community links from leagues.config (fb_url / discord_url),
// shared by the two pre-membership surfaces: the login/new-player screen
// (features/auth.js) and the no-league screen (core/session.js). One copy
// of the guard, so the two can never disagree about what becomes an href.
// Record: docs/decisions/onboarding.md.
//
// Only an https URL becomes an href. admin_update_league_config enforces
// the same rule server-side, but the client is the thing that actually
// writes an attribute, so it checks too — a stale row from before the
// check, or a hand-edited one, must not become a javascript: link. Labels
// are fixed; the URL is the only admin-supplied part. Returns [] for a
// league with no links (or no config at all), which callers must treat as
// "render nothing", not as an error.
export function communityLinks(cfg){
  const ok = u => typeof u === "string" && /^https:\/\//i.test(u);
  const out = [];
  if (ok(cfg?.fb_url)) out.push({ label: "Facebook group", url: cfg.fb_url });
  if (ok(cfg?.discord_url)) out.push({ label: "Discord", url: cfg.discord_url });
  return out;
}

// One row per league that has at least one valid link; a league with none
// contributes nothing. "" when no league has any.
export function communityRowsHtml(leagues){
  return (leagues || []).map(l => {
    const links = communityLinks(l.config);
    if (!links.length) return "";
    return `<div class="muted" style="margin-top:6px"><b>${esc(l.name)}</b>: ${links.map(k =>
      `<a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${k.label}</a>`).join(" · ")}</div>`;
  }).join("");
}

// The whole block, or "" — absent entirely rather than an empty heading
// when there is nothing to show. `lead` is caller copy; it is not escaped,
// so it must be a literal, never data.
export function communityBlockHtml(leagues, { id, lead }){
  const rows = communityRowsHtml(leagues);
  return rows ? `<div id="${id}" class="noticebox"><b>${lead}</b>${rows}</div>` : "";
}

// The anon read both surfaces use. leagues has a public select policy
// ("pub leagues", stage_a_schema.sql) — names and config are accepted-public
// (onboarding.md decision 3); join_code is NOT in this column, by decision.
// Throws on a query error so each caller decides what "nothing" looks like.
export async function fetchLeagueLinks(){
  const { data, error } = await db.from("leagues").select("name, config").order("name");
  if (error) throw new Error(error.message);
  return data || [];
}
