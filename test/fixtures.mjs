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
  const day = (offsetDays) => new Date(now + offsetDays*864e5).toISOString().slice(0,10);

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
    // Relative to the real wall clock (day()), same reasoning as iso() above —
    // a hardcoded showdate ages past admin's 7-day sync lookback and shows.js's
    // recent/upcoming split as real time passes, even though cutoff_at was
    // already correctly relative. This bit the fixture once for real: show 2
    // silently fell out of admin's Shows & cutoffs list once "today" moved far
    // enough past its old hardcoded date, breaking a Reopen-button assertion
    // that had nothing to do with dates at all.
    shows: [
      { id: 1, showdate: day(0), venue: "The Barn", city: "Woodstock", state: "NY" },
      { id: 2, showdate: day(-5), venue: "Old Mill", city: "Hudson", state: "NY" },
    ],
    league_shows: [
      { league_id: LEAGUE_ID, show_id: 1, cutoff_at: iso(60), format: "standard", status: "upcoming",
        remind_sent: null, lock_sent: null, winner_sent: null },
      { league_id: LEAGUE_ID, show_id: 2, cutoff_at: iso(-7*24*60), format: "standard", status: "final",
        remind_sent: iso(-7*24*60-70), lock_sent: iso(-7*24*60-60), winner_sent: iso(-7*24*60-10) },
    ],
    // One past season (well outside show 1's date — see day(0) above) so it doesn't
    // disturb the existing "no season covers this show" Official-ineligible
    // assertion — its only job here is giving the season-roster admin UI
    // something real to list/toggle. season_rosters has one member on it, so
    // the roster panel exercises both the "already on roster" (Remove) and
    // "not on roster" (Add) render branches.
    seasons: [
      { id: 501, bracket_id: OFFICIAL_ID, name: "Past Season", start_date: "2026-01-01", end_date: "2026-01-31", roster_locked_at: null },
    ],
    season_rosters: [
      { season_id: 501, player_id: "p1", added_at: "2026-01-01T00:00:00Z" },
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
    // Shows-list marker fixture: standard format's target is 5 (3 slots +
    // flat_picks:2, per defCfg above). p1 has 2 of 5 on show 1 (upcoming,
    // still open — the amber "incomplete, no draft" case) and all 5 of 5
    // on show 2 (final — the green "complete" case).
    picks: [
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 1, slot: "opener", songname: "Rambling Boy" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 1, slot: "closer", songname: "Distraction" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, slot: "opener", songname: "Distraction" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, slot: "closer", songname: "Rambling Boy" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, slot: "encore", songname: "Space Oddity" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, slot: "flat1", songname: "Distraction" },
      { player_id: "p1", bracket_id: CASUAL_ID, show_id: 2, slot: "flat2", songname: "Rambling Boy" },
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

// Minimal fixture for the autocomplete/save-time catalog-match regression:
// a real catalog entry with trailing whitespace (e.g. "Time Escaping ")
// passes autocomplete's substring filter but used to fail the save-time
// exact-match check, because the input value got trimmed before comparing
// while the catalog string didn't — see normSong in picks.js. Deliberately
// NOT layered onto makeFixtures() above: that fixture's slot count/target
// numbers are load-bearing for several other assertions, and this scenario
// only needs one opener-type slot and one cover_pick slot to exist at all.
export function makeCatalogWhitespaceFixtures(){
  const now = Date.now();
  const iso = (offsetMin) => new Date(now + offsetMin*60000).toISOString();
  const day = (offsetDays) => new Date(now + offsetDays*864e5).toISOString().slice(0,10);
  const LEAGUE_ID = 1, CASUAL_ID = 10;
  const cfg = {
    slots: [
      { key:"opener", type:"opener", label:"Opener", points:2 },
      { key:"cover1", type:"cover_pick", label:"Cover", points:2 },
    ],
    flat_picks: 0, flat_points: 1,
    partial_credit: true, partial_points: 1,
    allow_duplicates: false,
    voting_override: "auto",
    bonuses: { cover:1, debut:2, perfect:3, jamchart:0 },
    wildcards: { debut: true },
    oneset: { slots:[{key:"opener",type:"opener",label:"Opener",points:2}], flat_picks:0, flat_points:1 },
  };
  const tables = {
    leagues: [{ id: LEAGUE_ID, name: "Ambassadors" }],
    brackets: [{ id: CASUAL_ID, league_id: LEAGUE_ID, kind: "casual", name: "Casual", config: cfg }],
    league_members: [{ league_id: LEAGUE_ID, player_id: "p1", is_league_admin: true, official_opt_in: true }],
    // Both entries carry real trailing whitespace, mirroring actual
    // songs_cache rows found in production (confirmed via a live query —
    // 7 of 363 catalog rows have leading/trailing whitespace as of this
    // writing, "Time Escaping " among them).
    songs_cache: [
      { songname: "Layla ", times_played: 9, is_original: true },
      { songname: "Time Escaping ", times_played: 5, is_original: false },
    ],
    shows: [{ id: 1, showdate: day(0), venue: "The Barn", city: "Woodstock", state: "NY" }],
    league_shows: [{ league_id: LEAGUE_ID, show_id: 1, cutoff_at: iso(60), format: "standard", status: "upcoming",
      remind_sent: null, lock_sent: null, winner_sent: null }],
    seasons: [], season_rosters: [],
    players_public: [{ id: "p1", name: "Wooklord", created_at: "2026-01-01" }],
    scores: [], picks: [], setlist_songs: [],
  };
  const session = { id: "p1", name: "Wooklord", pin: "1234", is_global_admin: false };
  return { tables, session, ids: { LEAGUE_ID, CASUAL_ID } };
}
