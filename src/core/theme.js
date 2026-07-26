import { $ } from "./dom.js";

// theme: 'auto' follows the phone live; 'light'/'dark' are manual overrides
const sysLight = matchMedia("(prefers-color-scheme: light)");
let themeMode = localStorage.getItem("ft_theme2") || "auto"; // key bump: old ft_theme values were auto-written and block auto mode
export function applyTheme(){
  const eff = themeMode === "auto" ? (sysLight.matches ? "light" : "dark") : themeMode;
  document.documentElement.dataset.theme = eff;
  const b = $("#themeBtn");
  if (b) b.textContent = themeMode === "auto" ? "\u{1F317}" : (themeMode === "light" ? "☀️" : "\u{1F319}");
  if (b) b.title = "theme: " + themeMode + (themeMode === "auto" ? " (follows your phone)" : "");
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = eff === "light" ? "#F4ECD9" : "#171233";
}
export function toggleTheme(){
  themeMode = { auto: "light", light: "dark", dark: "auto" }[themeMode] || "auto";
  localStorage.setItem("ft_theme2", themeMode);
  applyTheme();
}
const onSysTheme = () => { if (themeMode === "auto") applyTheme(); };
if (sysLight.addEventListener) sysLight.addEventListener("change", onSysTheme); else sysLight.addListener(onSysTheme);
applyTheme();
