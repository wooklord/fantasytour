// Venue-local time helpers for the admin Shows & cutoffs panel — the one
// place absolute cutoff times get SET, where displaying them in the
// admin's own device timezone is actively dangerous (a 6 PM Pacific show
// reads as 9 PM Eastern, and "fixing" it while thinking in local terms
// silently shifts it three hours). The venue's IANA zone itself is NOT
// duplicated here — it comes from `shows.timezone`, resolved once
// server-side at sync time (see supabase/functions/carton-sync/index.ts's
// resolveVenueTz), so there's a single source of truth for the state→zone
// mapping instead of two copies that can drift apart.
//
// The datetime-local <input> itself has no concept of timezone — its value
// is plain "YYYY-MM-DDTHH:mm" text with no zone attached. It only LOOKS
// device-local today because that's what we fill it with; filling it with
// venue-local wall-clock numbers instead (and interpreting what's typed
// back as venue-local, not device-local) fixes both reading AND editing
// without needing a custom control.

// UTC offset (minutes) a zone uses at a given instant. Positive = ahead of
// UTC. Same technique as venueCutoffISO in the edge function.
function offsetMinutesAt(ms, tz){
  const val = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(new Date(ms)).find(p => p.type === "timeZoneName")?.value || "GMT+0";
  const m = val.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const h = parseInt(m[1], 10), min = parseInt(m[2] || "0", 10);
  return h * 60 + (h < 0 ? -min : min);
}

// UTC instant -> venue-local "YYYY-MM-DDTHH:mm", for filling the input.
export function venueLocalInputValue(cutoffISO, tz){
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(cutoffISO));
  const get = t => parts.find(p => p.type === t)?.value;
  let hh = get("hour"); if (hh === "24") hh = "00"; // ICU midnight quirk
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
}

// Venue-local "YYYY-MM-DDTHH:mm" (as typed into the input) -> UTC ISO.
// Probes the zone's offset at noon UTC of the typed date (a stable
// reference point, same idea as venueCutoffISO) rather than at the exact
// typed instant — correct except right at that date's own DST transition,
// which hasDstTransition() below flags explicitly rather than silently
// trusting.
export function venueLocalToUTC(naiveLocalStr, tz){
  const [datePart] = naiveLocalStr.split("T");
  const noonUTC = Date.parse(`${datePart}T12:00:00Z`);
  const offMin = offsetMinutesAt(noonUTC, tz);
  const asIfUTC = Date.parse(`${naiveLocalStr}:00Z`);
  return new Date(asIfUTC - offMin * 60000).toISOString();
}

// "6:00 PM" — the human-readable time, no zone abbreviation.
export function venueLocalTimeDisplay(cutoffISO, tz){
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(cutoffISO));
}

// "PDT" / "EST" / etc. — resolved from the real IANA rules for this exact
// date, so it's DST-correct without hardcoding transition dates anywhere.
export function venueAbbrev(cutoffISO, tz){
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", timeZoneName: "short" })
    .formatToParts(new Date(cutoffISO)).find(p => p.type === "timeZoneName")?.value || "";
}

// Does this zone change offset at some point during this calendar date?
// Brackets the date (00:00Z..23:59Z comfortably covers any real local day
// for every zone this app uses) and compares offsets, rather than
// hardcoding "2nd Sunday of March / 1st Sunday of November" — works for
// any zone and stays correct even if DST rules ever change.
export function hasDstTransition(naiveLocalStr, tz){
  const [datePart] = naiveLocalStr.split("T");
  const start = Date.parse(`${datePart}T00:00:00Z`);
  const end = Date.parse(`${datePart}T23:59:00Z`);
  return offsetMinutesAt(start, tz) !== offsetMinutesAt(end, tz);
}
