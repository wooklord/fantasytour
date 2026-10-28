// Vet-first fast path, Part A (docs/decisions/onboarding.md, decision 7):
// the count behind the Admin-tab badge. Pure: no DOM and no state.js, so
// test/signups.test.mjs imports it in plain Node.
//
// `rows` is admin_list_unaffiliated_players' result. Stage W lists it
// newest first and caps it at 50, so the cap drops the OLDEST rows: every
// player inside the window is in `rows` unless all `cap` rows are inside
// it, which is the one case where more may exist, and `saturated` says so.
// `cap` mirrors the SQL's "limit 50"; change both together.
// A row without a parseable created_at (the pre-Stage-W RPC) never counts,
// so the new client against the old function shows no badge rather than a
// wrong one. A created_at ahead of this device's clock (skew) counts: it is
// recent by any reading.
const DAY_MS = 864e5;

export function isRecent(createdAt, { nowMs, days }){
  const t = Date.parse(createdAt ?? "");
  return Number.isFinite(t) && t >= nowMs - days * DAY_MS;
}

export function countRecent(rows, { nowMs, days, cap = 50 }){
  const n = (rows || []).filter(r => isRecent(r?.created_at, { nowMs, days })).length;
  return { n, saturated: n >= cap };
}

export const badgeText = ({ n, saturated }) => saturated ? `${n}+` : String(n);
