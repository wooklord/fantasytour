/* =================== CONFIG — EDIT THESE =================== */
export const SUPABASE_URL  = "https://zdfhglvjxquvkjyvophz.supabase.co";
export const SUPABASE_ANON = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo";
/* =========================================================== */

// Whether the admin panel offers "Ranked choice" in the Scoring mode
// selector. This started as a deploy gate — ranked scoring existed in the
// edge function before it was deployed, and the flag stopped a bracket
// being switched to a mode the live scorer wouldn't run. That reason is
// spent: Casual is already in ranked_choice mode, switched deliberately.
//
// What's left is a plain feature flag. Setting it false removes the option
// from the dropdown without disturbing a bracket already using the mode —
// renderAdmin still renders the option when the CURRENT bracket is ranked,
// so the select can always represent the state it loaded rather than
// silently rewriting it on the next save.
export const RANKED_CHOICE_ENABLED = true;

// Instance constants: name, branding, data source.
export const APP_NAME = "Fantasy Eggy";
// The band, for player-facing copy (the welcome card's how-to lines,
// onboarding.md Batch 3). Feature code reads this, never a literal.
export const BAND_NAME = "Eggy";
export const THEME_COLOR_LIGHT = "#F4ECD9";
export const THEME_COLOR_DARK  = "#171233";
export const CARTON_SITE_BASE = "https://thecarton.net/setlists";

// Nickname length cap for NEW registrations only (sql/stage_t_name_length_cap.sql
// is the real gate; this is the client-side courtesy in features/auth.js).
// Existing names are untouched — the live max is 27 — which is also why
// this is NOT a maxlength on the shared login/register input: login must
// still accept those names. Record: docs/decisions/standings-ux.md (4).
export const NAME_MAX_LEN = 20;

// Vet-first fast path (docs/decisions/onboarding.md, decision 7): the
// Admin-tab badge counts players in no league who registered within this
// many days. Long enough to span an admin who checks in weekly; short
// enough that an account nobody vouches for stops lighting it on its own.
export const NEW_SIGNUP_DAYS = 14;

// Decision 8 (onboarding.md): "Clear all" on the sign-up list snoozes the
// badge and every "new" mark it covers for this many days. Anyone who
// registers after the clear relights it at once; a cleared account still in
// no league and still inside NEW_SIGNUP_DAYS relights when the snooze ends.
export const SIGNUP_SNOOZE_DAYS = 7;
