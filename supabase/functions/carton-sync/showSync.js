// Pure show-sync logic for Fantasy Eggy — no Deno, no Supabase, no network
// I/O. Same isolation as scoring.js: the Deno edge function (index.ts)
// fetches rows, calls the three functions below, and applies the writes they
// return; test/showSync.test.mjs imports this same file under plain Node.
//
// Decision record: docs/decisions/cron-secret-edge-auth.md → "LOCKED
// 2026-10-25 — daily in-tick show sync". Build plan: docs/show_sync_plan.md.
//
// Three guardrails, locked before anything else was designed, and the reason
// each function is shaped the way it is:
//   * never modify a finalized show  → diffShows routes a changed row whose
//     id ANY league has `final` to `flags`, never to `updates`;
//   * never delete a show that disappears from The Carton → diffShows has
//     no delete list at all, only `vanished` + a flag;
//   * a date change posts the EXISTING cutoff-changed notification → the
//     caller builds the message; cutoffPlan only says recompute or keep.

const ET = "America/New_York";

// Eastern calendar date ("YYYY-MM-DD") of an instant. The "sv" locale
// formats as ISO; same idiom as easternDate() in index.ts, parameterised on
// the instant instead of reading the clock.
export function easternDateOf(d) {
  return new Intl.DateTimeFormat("sv", { timeZone: ET }).format(toDate(d));
}

// Eastern hour (0–23) of an instant. hourCycle "h23" rather than
// `hour12: false`: some ICU builds render midnight as "24" under hour12:false,
// and 24 >= 9 would open the gate at midnight. h23 is unambiguous.
export function easternHourOf(d) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", hourCycle: "h23" }).format(toDate(d)));
}

function toDate(d) {
  return d instanceof Date ? d : new Date(d);
}

const GATE_HOUR_ET = 9;
const RETRY_AFTER_MS = 30 * 60_000;

// Due when ALL of: the Eastern hour of `now` is >= 9; there is no ranAt on
// now's Eastern calendar date; attemptedAt is null or more than 30 minutes
// before now. attemptedAt is stamped before the Carton call and ranAt only
// after success, so a run that threw leaves attemptedAt set and ranAt unset
// — the 30-minute backoff — rather than retrying every minute or never.
// Calendar-date comparison is in Eastern time on BOTH sides, so a run at
// 22:00 ET still counts as today's run even though the UTC date has rolled.
export function dailyGateDue({ ranAt, attemptedAt, now }) {
  const n = toDate(now);
  if (easternHourOf(n) < GATE_HOUR_ET) return false;
  if (ranAt != null && easternDateOf(ranAt) === easternDateOf(n)) return false;
  if (attemptedAt != null && n.getTime() - toDate(attemptedAt).getTime() <= RETRY_AFTER_MS) return false;
  return true;
}

// The fields a finalized show must never have rewritten — a change to any
// of these on a final row is flagged, not applied. These are also the
// fields whose change is worth telling an admin about.
const LOCKED_FIELDS = ["showdate", "venue", "city", "state"];
// Carried along on a non-final row's rewrite without being "a change": the
// permalink is a slug The Carton regenerates from the venue name, and
// timezone is derived from `state` by index.ts (self-heals when STATE_TZ
// gains a mapping). Neither flags, neither notifies, neither touches a
// finalized row.
const CARRIED_FIELDS = ["permalink", "timezone"];

function nv(v) {
  return v == null ? null : String(v).trim();
}
function same(a, b) {
  return nv(a) === nv(b);
}

// incoming: the mapped Carton rows (id, showdate, venue, city, state,
//           permalink, timezone), already past the caller's 14-day floor.
// existing: the `shows` rows the app holds for those ids, plus every row
//           dated `today` or later (the vanished-detection set).
// finalIds: one entry per league_shows row with status 'final' — duplicates
//           are meaningful (that is how "finalized in N league(s)" counts).
// today:    Eastern calendar date; the floor below which a missing row is
//           simply old, not vanished.
//
// Returns { inserts, updates, flags, vanished }:
//   inserts  — incoming rows with no existing row (the full row to upsert).
//   updates  — existing, NON-final rows that differ: { id, row, changed,
//              old } where `row` is the full new row to upsert, `changed`
//              the differing field names and `old` the prior values.
//   flags    — { id, note } for changed rows that ARE final, and for
//              vanished rows. Notes are deterministic (no timestamps) so
//              the caller's "don't re-add an identical note" rule holds
//              across days.
//   vanished — { id, showdate, venue, recreatedAs } for existing rows dated
//              today or later that Carton no longer returns. There is no
//              delete list, by design.
// Identical inputs → every list empty: no writes, no posts.
export function diffShows({ incoming, existing, finalIds, today }) {
  const inc = (incoming ?? []).map((r) => ({ ...r, id: Number(r.id) }));
  const ex = (existing ?? []).map((r) => ({ ...r, id: Number(r.id) }));
  const finalCount = new Map();
  for (const id of finalIds ?? []) finalCount.set(Number(id), (finalCount.get(Number(id)) ?? 0) + 1);
  const existingById = new Map(ex.map((r) => [r.id, r]));
  const incomingIds = new Set(inc.map((r) => r.id));

  const inserts = [], updates = [], flags = [], vanished = [];
  for (const row of inc) {
    const cur = existingById.get(row.id);
    if (!cur) { inserts.push(row); continue; }
    const lockedChanged = LOCKED_FIELDS.filter((k) => !same(cur[k], row[k]));
    const n = finalCount.get(row.id) ?? 0;
    if (n > 0) {
      if (lockedChanged.length) {
        const what = lockedChanged.map((k) => `${k} (${nv(cur[k]) ?? "—"} → ${nv(row[k]) ?? "—"})`).join(", ");
        flags.push({ id: row.id, note: `Carton changed ${what}; not applied — finalized in ${n} league(s)` });
      }
      continue; // a finalized show's global row is never rewritten, not even for carried fields
    }
    const carriedChanged = CARRIED_FIELDS.filter((k) => !same(cur[k], row[k]));
    const changed = [...lockedChanged, ...carriedChanged];
    if (!changed.length) continue;
    const old = Object.fromEntries(changed.map((k) => [k, cur[k] ?? null]));
    updates.push({ id: row.id, row, changed, old });
  }

  // New-on-Carton rows, keyed by date+venue, so a vanished show that came
  // back under a new id is named beside the new one — the admin sees the
  // pair instead of an unexplained disappearance and an unexplained arrival.
  const newByDateVenue = new Map();
  for (const row of inserts) newByDateVenue.set(`${nv(row.showdate)}|${(nv(row.venue) ?? "").toLowerCase()}`, row.id);

  for (const cur of ex) {
    if (incomingIds.has(cur.id)) continue;
    if (cur.showdate == null || String(cur.showdate) < String(today)) continue; // old, not vanished
    const recreatedAs = newByDateVenue.get(`${nv(cur.showdate)}|${(nv(cur.venue) ?? "").toLowerCase()}`) ?? null;
    vanished.push({ id: cur.id, showdate: cur.showdate, venue: cur.venue ?? null, recreatedAs });
    let note = `Carton no longer returns this show (${cur.showdate} · ${cur.venue ?? "venue unknown"}); not deleted`;
    if (recreatedAs != null) note += ` — re-created on The Carton as show ${recreatedAs}?`;
    flags.push({ id: cur.id, note });
  }

  return { inserts, updates, flags, vanished };
}

// Append `note` to an existing sync_flag unless that exact note is already
// one of its entries. " · " is the separator the admin notice renders. The
// caller writes the result; this just computes it. Returns { text, added }
// so the caller knows whether anything new was recorded (and so whether to
// post it).
export const FLAG_SEP = " · ";
export function appendFlag(current, note) {
  const parts = current ? String(current).split(FLAG_SEP).map((s) => s.trim()).filter(Boolean) : [];
  if (parts.includes(note)) return { text: current, added: false };
  parts.push(note);
  return { text: parts.join(FLAG_SEP), added: true };
}

function sameInstant(a, b) {
  if (a == null || b == null) return false;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function fmtET(iso) {
  if (!iso) return "none";
  return new Date(iso).toLocaleString("en-US", { timeZone: ET, dateStyle: "medium", timeStyle: "short" }) + " ET";
}

// One league_shows row, one decision. `defaultOf(showdate, state)` is
// injected — index.ts passes venueCutoffISO, the same function that wrote
// the stored defaults, so the equality below is against the value that was
// actually written. Instants are compared as instants, not as strings:
// Postgres hands back "+00:00" where venueCutoffISO wrote ".000Z", and a
// string compare would classify every pre-flag row as admin-set.
//
// Derived iff cutoff_set_by_admin === false, OR it is null AND the stored
// cutoff equals the OLD date's default — compared against the old date,
// never the new one (a row that already equals the new default is one that
// was moved by hand, and must be left alone). A null cutoff with a null
// flag is derived too: nobody set it, and the caller's NULL-refill would
// default it anyway.
//
// Returns { kind: "recompute", cutoff_at, resetStamps } or { kind: "keep",
// note }. resetStamps is true when the recomputed cutoff is after `now`
// (the reminder and lock would otherwise never fire for the moved show).
export function cutoffPlan({ overlay, oldShow, newShow, defaultOf, now, leagueName }) {
  const flag = overlay.cutoff_set_by_admin;
  const stored = overlay.cutoff_at ?? null;
  const oldDefault = defaultOf(oldShow.showdate, oldShow.state ?? null);
  const derived = flag === false
    || (flag == null && (stored == null || sameInstant(stored, oldDefault)));
  if (derived) {
    const cutoff_at = defaultOf(newShow.showdate, newShow.state ?? null);
    return { kind: "recompute", cutoff_at, resetStamps: Date.parse(cutoff_at) > toDate(now).getTime() };
  }
  const league = leagueName ?? overlay.league_name ?? `league ${overlay.league_id}`;
  return {
    kind: "keep",
    note: `date moved ${oldShow.showdate} → ${newShow.showdate}; ${league}'s admin-set cutoff left at ${fmtET(stored)} — review`,
  };
}
