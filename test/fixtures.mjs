// Fixture dataset shared by both the old-monolith and new-modular harness runs.
// Kept intentionally small but touching every table/shape the app queries.
export function makeFixtures(){
  const now = new Date("2026-07-26T12:00:00Z").getTime();
  const iso = (offsetMin) => new Date(now + offsetMin*60000).toISOString();

  const tables = {
    game_config: [{ id: 1, data: {
      slots: [
        { key:"opener", type:"opener", label:"Opener", points:2 },
        { key:"closer", type:"closer", label:"Closer", points:2 },
        { key:"encore", type:"encore", label:"Encore", points:2 },
      ],
      flat_picks: 2, flat_points: 1,
      partial_credit: true, partial_points: 1,
      allow_duplicates: false,
      voting_override: "auto",
      bonuses: { cover:1, debut:2, perfect:3, jamchart:0 },
      wildcards: { debut: true },
      oneset: { slots:[{key:"opener",type:"opener",label:"Opener",points:2}], flat_picks:1, flat_points:1 },
    }}],
    songs_cache: [
      { songname: "Distraction", times_played: 40, is_original: true },
      { songname: "Rambling Boy", times_played: 12, is_original: true },
      { songname: "Space Oddity", times_played: 3, is_original: false },
    ],
    shows: [
      { id: 1, showdate: "2026-07-27", venue: "The Barn", city: "Woodstock", state: "NY", cutoff_at: iso(60), status: "upcoming", format: "standard" },
      { id: 2, showdate: "2026-07-20", venue: "Old Mill", city: "Hudson", state: "NY", cutoff_at: iso(-7*24*60), status: "final", format: "standard" },
    ],
    seasons: [
      { id: 1, name: "Summer Tour 2026", start_date: "2026-06-01", end_date: "2026-09-01" },
    ],
    players_public: [
      { id: "p1", name: "Wooklord", is_admin: true, created_at: "2026-01-01" },
      { id: "p2", name: "EggHead", is_admin: false, created_at: "2026-01-02" },
    ],
    scores: [
      { player_id: "p1", show_id: 2, points: 5, breakdown: [{ slot:"opener", songname:"Distraction", points:2, hit:true, reason:"hit" }] },
      { player_id: "p2", show_id: 2, points: 2, breakdown: [{ slot:"opener", songname:"Rambling Boy", points:0, hit:false, reason:"miss" }] },
    ],
    setlist_songs: [
      { show_id: 2, position: 1, songname: "Distraction", setnumber: 1, is_encore: false },
      { show_id: 2, position: 2, songname: "Rambling Boy", setnumber: 1, is_encore: false },
    ],
  };

  const session = { id: "p1", name: "Wooklord", pin: "1234", is_admin: true };

  return { tables, session };
}
