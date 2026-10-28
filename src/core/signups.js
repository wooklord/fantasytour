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
//
// Decision 8 (D2): Stage X adds cleared_at to every row, the CALLER's last
// "Clear all" (null if never), and "new" is recent AND not snoozed. A row
// registered at or before the clear is snoozed until snoozeDays after it;
// one registered after it never is. A row without cleared_at (null, or the
// pre-Stage-X RPC) is never snoozed. While a snooze runs, "new" means
// "registered after the clear and inside the window", one cut-off on
// created_at, so the rows counted are still a prefix of the newest-first
// list and `saturated` stays exact.
const DAY_MS = 864e5;

export function isRecent(createdAt, { nowMs, days }){
  const t = Date.parse(createdAt ?? "");
  return Number.isFinite(t) && t >= nowMs - days * DAY_MS;
}

export function isSnoozed(createdAt, clearedAt, { nowMs, snoozeDays }){
  const t = Date.parse(createdAt ?? ""), c = Date.parse(clearedAt ?? "");
  return Number.isFinite(t) && Number.isFinite(c) && t <= c && nowMs < c + snoozeDays * DAY_MS;
}

// What the badge counts and the list marks "new".
export function isNew(row, { nowMs, days, snoozeDays }){
  return isRecent(row?.created_at, { nowMs, days })
    && !isSnoozed(row?.created_at, row?.cleared_at, { nowMs, snoozeDays });
}

export function countRecent(rows, { nowMs, days, snoozeDays, cap = 50 }){
  const n = (rows || []).filter(r => isNew(r, { nowMs, days, snoozeDays })).length;
  return { n, saturated: n >= cap };
}

export const badgeText = ({ n, saturated }) => saturated ? `${n}+` : String(n);
