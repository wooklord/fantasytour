import { $ } from "./dom.js";

const seenToasts = new Set();
export function toast(msg, cls="", key=null){
  if (key){ if (seenToasts.has(key)) return; seenToasts.add(key); }
  const box = $("#toasts");
  while (box.children.length >= 4) box.firstChild.remove();
  const t = document.createElement("div");
  t.className = "toast " + cls; t.innerHTML = msg;
  t.onclick = () => t.remove();
  box.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}
