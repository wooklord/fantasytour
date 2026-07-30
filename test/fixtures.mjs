// Fixture dataset for the harness — bracket-scoped shape (Stage A/C1/C2a),
// touching every table/RPC the app actually reads. One league ("Ambassadors"),
// two brackets (Casual, Official) — the real production shape today.
export function makeFixtures(){
  // Real wall-clock time, not a hardcoded date — showState()/openShow()
  // compare cutoff_at against the actual system clock, so a fixed past
  // "now" silently drifts into the past itself and every show reads as
  // already-locked regardless of what the test intends to exercise.
  const now = Date.now();
  const iso = (offsetMin) => new Date(now + offsetMin*60000).toISOString();

  const defCfg = {
    slots: [
      { key:"opener", type:"opener", label:"Opener", points:2 },
      { key:"closer", type:"closer", label:"Set 2 Closer", points:2 },
      { key:"encore", type:"encore", label:"Encore", points:2 },
    ],
    flat_picks: 2, flat_points: 1,
    partial_credit: true, partial_points: 1,
    allow_duplicates: false,
    voting_override: "auto",
    bonuses: { cover:1, debut:2, perfect:3, jamchart:0 },
    wildcards: { debut: true },
    oneset: { slots:[{key:"opener",type:"opener",label:"Opener",points:2}], flat_picks:1, flat_points:1 },
  };

  const LEAGUE_ID = 1, CASUAL_ID = 10, OFFICIAL_ID = 11;

  const tables = {
    leagues: [{ id: LEAGUE_ID, name: "Ambassadors" }],
    brackets: [
      { id: CASUAL_ID, league_id: LEAGUE_ID, kind: "casual", name: "Casual", config: defCfg },
      { id: OFFICIAL_ID, league_id: LEAGUE_ID, kind: "official", name: "Official", config: defCfg },
    ],
    league_members: [
      { league_id: LEAGUE_ID, player_id: "p1", is_league_admin: true, official_opt_in: true },
      { league_id: LEAGUE_ID, player_id: "p2", is_league_admin: false, official_opt_in: false },
    ],
    songs_cache: [
      { songname: "Distraction", times_played: 40, is_original: true },
      { songname: "Rambling Boy", times_played: 12, is_original: true },
      { songname: "Space Oddity", times_played: 3, is_original: false },
    ],
    // Global, stripped down — cutoff_at/format/status moved to league_shows.
    shows: [
      { id: 1, showdate: "2026-07-27", venue: "The Barn", city: "Woodstock", state: "NY" },
      { id: 2, showdate: "2026-07-20", venue: "Old Mill", city: "Hudson", state: "NY" },
    ],
    league_shows: [
      { league_id: LEAGUE_ID, show_id: 1, cutoff_at: iso(60), format: "standard", status: "upcoming",
        remind_sent: null, lock_sent: null, winner_sent: null },
      { league_id: LEAGUE_ID, show_id: 2, cutoff_at: iso(-7*24*60), format: "standard", status: "final",
        remind_sent: iso(-7*24*60-70), lock_sent: iso(-7*24*60-60), winner_sent: iso(-7*24*60-10) },
    ],
    // One past season (well outside show 1's date, 2026-07-27) so it doesn't
    // disturb the existing "no season covers this show" Official-ineligible
    // assertion — its only job here is giving the season-roster admin UI
    // something real to list/toggle. season_rosters has one member on it, so
    // the roster panel exercises both the "already on roster" (Remove) and
    // "not on roster" (Add) render branches.
    seasons: [
      { id: 501, bracket_id: OFFICIAL_ID, name: "Past Season", start_date: "2026-01-01", end_date: "2026-01-31", roster_locked_at: null },
    ],
    season_rosters: [
      { season_id: 501, player_id: "p1" },
    ],
    players_public: [
      { id: "p1", name: "Wooklord", created_at: "2026-01-01" },
      { id: "p2", name: "EggHead", created_at: "2026-01-02" },
      // Registered but not yet in league_members — the non-member match
      // admin_find_players should be able to surface for the "add a member"
      // search.
      { id: "p3", name: "Wanderer", created_at: "2026-01-03" },
    ],
    scores: [
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, points: 5, breakdown: [{ slot:"opener", songname:"Distraction", points:2, hit:true, reason:"hit" }] },
      { player_id: "p2", bracket_id: CASUAL_ID, show_id: 2, points: 2, breakdown: [{ slot:"opener", songname:"Rambling Boy", points:0, hit:false, reason:"miss" }] },
    ],
    setlist_songs: [
      { show_id: 2, position: 1, songname: "Distraction", setnumber: 1, is_encore: false },
      { show_id: 2, position: 2, songname: "Rambling Boy", setnumber: 1, is_encore: false },
    ],
  };

  // Not a global admin — a plain league admin, so admin-tab visibility
  // exercises isCurrentLeagueAdmin()'s league_members branch, not the
  // is_global_admin shortcut.
  const session = { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false };

  return { tables, session, ids: { LEAGUE_ID, CASUAL_ID, OFFICIAL_ID } };
}
