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
export const THEME_COLOR_LIGHT = "#F4ECD9";
export const THEME_COLOR_DARK  = "#171233";
export const CARTON_SITE_BASE = "https://thecarton.net/setlists";
