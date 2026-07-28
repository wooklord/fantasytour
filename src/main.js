import { toggleTheme } from "./core/theme.js";
import { boot, logout } from "./core/session.js";
import { switchToBracket, switchToLeague } from "./core/switcher.js";
import "./core/layout.js";
import "./core/realtime.js";
import { doLogin, doRegister } from "./features/auth.js";
import { openShow } from "./features/picks.js";
import { renderShows } from "./features/shows.js";
import { setBoardSeason } from "./features/standings.js";
import {
  loadRoster, addSeasonRow, saveSeason, deleteSeason, addSlot, saveConfig,
  toggleFormat, saveCutoff, finalizeShow, toggleBans, unban, runEdge, bootPlayer,
} from "./features/admin.js";

// Functions referenced from inline HTML onclick/onchange attributes must live
// on window — module-scoped bindings aren't visible to inline handlers.
Object.assign(window, {
  toggleTheme, logout, doLogin, doRegister, openShow, renderShows, setBoardSeason,
  loadRoster, addSeasonRow, saveSeason, deleteSeason, addSlot, saveConfig,
  toggleFormat, saveCutoff, finalizeShow, toggleBans, unban, runEdge, bootPlayer,
  switchToBracket, switchToLeague,
});

boot();
