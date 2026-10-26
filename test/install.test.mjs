// Unit tests for the pure install-help helpers (src/core/install.js):
// platform detection against a table of user-agent strings, the standalone
// check, and the platform instructions (branches a-d). Plain Node, no DOM.
// Wired into npm test. Record: docs/decisions/onboarding.md, Batch 3.
//
//   node test/install.test.mjs
//
// The user agents follow each browser's published format, with version
// numbers that need not match any one release; real ones captured on
// devices should be added here when available (a device check).

import { detectPlatform, isStandalone, installStepsHtml, INSTALL_FLAG } from "../src/core/install.js";

const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n  expected: ${e}\n  actual:   ${a}`);
}
// Visible text of an html snippet, one "|" between elements.
const strip = html => html.replace(/<[^>]+>/g, "|").replace(/\s*\|[\s|]*/g, "|").replace(/^\||\|$/g, "");

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  edgeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  fbIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.98;FBBV/628475391;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/631152116]",
  fbAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/478.0.0.42.110;]",
  msgrIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.38.109;FBBV/628090557;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  msgrAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/468.0.0.54.108;]",
  igIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.24.89 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 631484245)",
  igAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 345.0.0.48.95 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 631813187)",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

// ---------- detectPlatform ----------
const P = (ua, t) => detectPlatform(ua, { maxTouchPoints: t ?? 0 });
const DESKTOP = { kind: "desktop", os: null, phone: false };
check("Android Chrome", P(UA.androidChrome), { kind: "android", os: "android", phone: true, samsung: false });
check("Edge on Android is plain Android (no Samsung menu)", P(UA.edgeAndroid), { kind: "android", os: "android", phone: true, samsung: false });
check("Samsung Internet: Android, samsung flag set (≡ menu, decision 5)", P(UA.samsung), { kind: "android", os: "android", phone: true, samsung: true });
check("iOS Safari", P(UA.iosSafari), { kind: "ios", os: "ios", phone: true });
check("iOS Chrome is iOS (Add to Home Screen via Share)", P(UA.iosChrome), { kind: "ios", os: "ios", phone: true });
check("iPadOS Safari: a desktop Mac agent WITH touch is iOS", P(UA.macSafari, 5), { kind: "ios", os: "ios", phone: true });
check("Mac Safari without touch is desktop", P(UA.macSafari, 0), DESKTOP);
check("Facebook in-app on iOS is in-app, NOT plain iOS", P(UA.fbIos), { kind: "inapp", os: "ios", app: "Facebook", phone: true });
check("Facebook in-app on Android", P(UA.fbAndroid), { kind: "inapp", os: "android", app: "Facebook", phone: true });
check("Messenger on iOS is Messenger, not Facebook (its agent carries FBAN/FBAV too)", P(UA.msgrIos), { kind: "inapp", os: "ios", app: "Messenger", phone: true });
check("Messenger on Android (Orca)", P(UA.msgrAndroid), { kind: "inapp", os: "android", app: "Messenger", phone: true });
check("Instagram on iOS", P(UA.igIos), { kind: "inapp", os: "ios", app: "Instagram", phone: true });
check("Instagram on Android", P(UA.igAndroid), { kind: "inapp", os: "android", app: "Instagram", phone: true });
check("desktop Chrome", P(UA.desktopChrome), DESKTOP);
check("empty or missing agent is desktop, never a throw", [P(""), detectPlatform(undefined)], [DESKTOP, DESKTOP]);

// ---------- isStandalone ----------
const win = ({ mm = false, nav, throws = false } = {}) => ({
  matchMedia: q => { if (throws) throw new Error("no matchMedia"); return { matches: q === "(display-mode: standalone)" ? mm : false }; },
  navigator: nav === undefined ? {} : { standalone: nav },
});
check("standalone: display-mode standalone", isStandalone(win({ mm: true })), true);
check("standalone: iOS navigator.standalone", isStandalone(win({ nav: true })), true);
check("standalone: neither", isStandalone(win({ mm: false, nav: false })), false);
check("standalone: matchMedia throwing falls back to navigator.standalone", [isStandalone(win({ throws: true, nav: true })), isStandalone(win({ throws: true }))], [true, false]);
check("standalone: no window at all is false", isStandalone(undefined), false);

// ---------- installStepsHtml (branches a-d) ----------
const steps = (k, canPrompt = false) => strip(installStepsHtml(P(UA[k], k === "macSafari" ? 5 : 0), { canPrompt }));
const IOS_TEXT = "Tap Share, then Add to Home Screen.|You'll sign in once more inside the app, so keep your PIN handy.";
const inApp = (app, menu) => `You're in ${app}'s browser, which can't install apps. Tap ${menu} → Open in browser, then install from there.`;
check("(a) captured prompt on Android: one Install button, no menu text", steps("androidChrome", true), "Install");
check("(a) the button calls promptInstall()", /onclick="promptInstall\(\)"/.test(installStepsHtml(P(UA.androidChrome), { canPrompt: true })), true);
check("(a) also wins on Samsung when a prompt was captured", steps("samsung", true), "Install");
check("(b) Android, no prompt: ⋮ menu", steps("androidChrome"), "Browser menu (⋮) → Install app / Add to Home screen");
check("(b) Samsung, no prompt: ≡ menu (decision 5)", steps("samsung"), "Browser menu (≡) → Add page to → Home screen");
check("(c) iPhone: Share plus the sign-in-again line", steps("iosSafari"), IOS_TEXT);
check("(c) iOS Chrome and iPadOS get the iOS text", [steps("iosChrome"), steps("macSafari")], [IOS_TEXT, IOS_TEXT]);
check("(d) Facebook on iOS: ⋯", steps("fbIos"), inApp("Facebook", "⋯"));
check("(d) Facebook on Android: ⋮ (decision 5)", steps("fbAndroid"), inApp("Facebook", "⋮"));
check("(d) Messenger and Instagram name their own app", [steps("msgrIos"), steps("msgrAndroid"), steps("igIos"), steps("igAndroid")],
  [inApp("Messenger", "⋯"), inApp("Messenger", "⋮"), inApp("Instagram", "⋯"), inApp("Instagram", "⋮")]);
check("(d) beats a captured prompt: an in-app browser cannot install", steps("fbAndroid", true), inApp("Facebook", "⋮"));
check("desktop: no instructions at all, even with a prompt", steps("desktopChrome", true), "");
check("the device flag is the locked key", INSTALL_FLAG, "ft_install_dismissed");

if (failures.length) {
  console.log(`FAIL — ${failures.length} check(s):`);
  for (const f of failures) console.log("  " + f.replace(/\n/g, "\n  "));
  process.exit(1);
} else {
  console.log("PASS — all install.js checks passed.");
  process.exit(0);
}
