import { $ } from "./dom.js";

const seenToasts = new Set();
// `ms` defaults to the usual 6s; the first-save toast (onboarding.md
// Batch 3) passes 10s because it carries two sentences of instructions.
export function toast(msg, cls="", key=null, ms=6000){
  if (key){ if (seenToasts.has(key)) return; seenToasts.add(key); }
  const box = $("#toasts");
  while (box.children.length >= 4) box.firstChild.remove();
  const t = document.createElement("div");
  t.className = "toast " + cls; t.innerHTML = msg;
  t.onclick = () => t.remove();
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
