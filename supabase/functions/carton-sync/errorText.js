// errorText(e): the ONE place the function turns a thrown value into the
// `error` string of its response — which is also the admin toast's text.
// `String(e)` on a supabase-js PostgrestError (a plain object, not an Error)
// is "[object Object]", which is exactly what hid the songs_cache upsert
// failure from 2026-07-18 to 2026-11-07 (docs/decisions/edge-function.md,
// 2026-11-07). Error → its message; object → message + code + details +
// hint when present, else its JSON; anything else → String(e).
export function errorText(e) {
  if (e instanceof Error) return e.message || e.name || "Error";
  if (e && typeof e === "object") {
    if (typeof e.message === "string" && e.message) {
      const parts = [e.message];
      if (e.code) parts.push(`(${e.code})`);
      if (e.details) parts.push(`— ${e.details}`);
      if (e.hint) parts.push(`hint: ${e.hint}`);
      return parts.join(" ");
    }
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}
