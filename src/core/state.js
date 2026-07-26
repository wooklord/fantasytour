// Shared mutable app state. Kept as properties on one object (rather than
// separate `let` exports) so every module that mutates a field is actually
// mutating the same object — ES module bindings are read-only outside the
// module that declares them, so plain `export let x` can't be reassigned
// from elsewhere.
export const state = {
  session: JSON.parse(localStorage.getItem("ft_session") || "null"),
  tab: "shows",
  currentShow: null,
  songList: [],
  cfg: null,
  timers: [],
  boardSeason: null, // null = auto-pick current season
};
