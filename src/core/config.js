/* =================== CONFIG — EDIT THESE =================== */
export const SUPABASE_URL  = "https://zdfhglvjxquvkjyvophz.supabase.co";
export const SUPABASE_ANON = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo";
/* =========================================================== */

// Ranked-choice scoring exists in the edge function but has NOT been
// deployed yet, so the admin UI must not offer it: a bracket switched to a
// mode the deployed scorer doesn't run would accumulate real picks against
// a scoring path that never executes. Flip this to true in the same change
// that deploys carton-sync — not before, and not separately.
export const RANKED_CHOICE_ENABLED = false;

// Instance constants: name, branding, data source.
export const APP_NAME = "Fantasy Eggy";
export const THEME_COLOR_LIGHT = "#F4ECD9";
export const THEME_COLOR_DARK  = "#171233";
export const CARTON_SITE_BASE = "https://thecarton.net/setlists";
