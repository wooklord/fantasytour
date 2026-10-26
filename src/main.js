import { toggleTheme } from "./core/theme.js";
import { boot, logout } from "./core/session.js";
import { switchToBracket, switchToLeague } from "./core/switcher.js";
import "./core/layout.js";
import "./core/realtime.js";
import { doLogin, doRegister, submitForcedPinChange } from "./features/auth.js";
import { openShow, setScoresView } from "./features/picks.js";
import { renderShows, dismissWelcome } from "./features/shows.js";
import { setBoardSeason, toggleTieGroup, setStatsSort } from "./features/standings.js";
import { changeOwnPin } from "./features/settings.js";
import { captureInstallPrompt, promptInstall, dismissInstall, toggleInstallHow, setInstallTips } from "./core/install.js";
import {
  loadRoster, addSeasonRow, saveSeason, deleteSeason, addSlot, saveConfig,
  toggleFormat, saveCutoff, finalizeShow, reopenShow, toggleBans, unban, runEdge, bootPlayer,
  searchMembers, addMember, toggleRoster, setRosterMember, toggleSection,
  addCustomRule, checkRuleCap, resetMemberPin,
  onModeChange, addRankRow, renumberRanks, saveMasterSwitch,
  globalCreateLeague, globalSearchPlayers, globalAppointAdmin, globalResetPin,
  saveLeagueConfig, setRosterFilter, clearSyncFlag,
} from "./features/admin.js";

// Functions referenced from inline HTML onclick/onchange attributes must live
// on window — module-scoped bindings aren't visible to inline handlers.
Object.assign(window, {
  toggleTheme, logout, doLogin, doRegister, submitForcedPinChange, changeOwnPin, openShow, setScoresView, renderShows, setBoardSeason, toggleTieGroup, setStatsSort,
  loadRoster, addSeasonRow, saveSeason, deleteSeason, addSlot, saveConfig,
  toggleFormat, saveCutoff, finalizeShow, reopenShow, toggleBans, unban, runEdge, bootPlayer,
  searchMembers, addMember, toggleRoster, setRosterMember, toggleSection,
  addCustomRule, checkRuleCap, resetMemberPin,
  onModeChange, addRankRow, renumberRanks, saveMasterSwitch,
  globalCreateLeague, globalSearchPlayers, globalAppointAdmin, globalResetPin,
  saveLeagueConfig, setRosterFilter, clearSyncFlag,
  switchToBracket, switchToLeague,
  promptInstall, dismissInstall, toggleInstallHow, setInstallTips, dismissWelcome,
});

// Before boot(): beforeinstallprompt can fire at any point after load, and
// a missed one is gone (onboarding.md Batch 3).
captureInstallPrompt();
boot();
