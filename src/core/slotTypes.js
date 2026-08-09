// Fixed, code-owned slot labels/tooltips — the label column used to be free
// text an admin typed per slot; closing it to a known set lets the label
// column be sized and explained consistently instead of defending against
// arbitrary admin input. A type missing from these maps (a genuinely
// retired/legacy type no longer offered in the admin dropdown) isn't
// handled here — callers fall back to prettifying the raw key, same as
// the score-breakdown display already did for a slot removed from config
// entirely.
export const SLOT_LABELS = {
  opener: "Opener",
  set1_closer: "Set 1 Closer",
  set2_opener: "Set 2 Opener",
  closer: "Set 2 Closer",
  show_closer: "Final Song",
  encore: "Encore",
  second_song: "2nd Song",
  cover_pick: "Cover",
};

export const SLOT_TOOLTIPS = {
  opener: "First song of the show",
  set1_closer: "Last song of set 1",
  set2_opener: "First song of set 2",
  closer: "Last song before the encore",
  show_closer: "Last song of the show, encore included",
  encore: "Any encore song",
  second_song: "Second song of the show",
  cover_pick: "A cover the band has played before",
};

export const FLAT_PICK_TOOLTIP = "Any song, any position";

// A one-set show has no "set 2" — these two types are permanently
// slotImpossible there (scoring.js: set1.length===0 / set2.length===0 for
// a one-set show has no set2 array at all), so they're excluded from that
// section's type dropdown entirely rather than merely relabeled.
export const ONE_SET_EXCLUDED_TYPES = ["set1_closer", "set2_opener"];

// The one label that actually depends on format: "Set 2 Closer" implies a
// set 2 a one-set show never had. Tooltip is unchanged either way — "last
// song before the encore" is true regardless of how many sets preceded it.
export function slotLabelFor(type, format){
  if (type === "closer" && format === "one_set") return "Closer";
  return SLOT_LABELS[type] || null;
}
