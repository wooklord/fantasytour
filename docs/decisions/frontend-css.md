# Frontend/CSS rules: the paper sheet, --coral, the podium tiers

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 2098–2197. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **`.sheet` (the pick sheet paper card) is theme-invariant — always cream
  paper with dark ink, regardless of which app theme is active.**
  `--paper`/`--paper-ink`/`--paper-ink-soft` are the tokens built for it;
  the app's own `--cream`/`--cream-dim`/`--panel`/`--panel2`/`--line`/`--pit`/
  `--indigo` all flip between light and dark theme and are wrong the
  instant they're used on anything sitting on the paper. This has broken
  three different ways so far, always the same root cause — an app-wide
  class used where a paper-scoped one was needed:
  - The ineligible-reason text originally used `--ink` (a theme-flipping
    variable that, despite the name, is repurposed as light theme's
    *foreground* color) — cream-on-cream in light theme. Fixed with
    `--paper-ink`.
  - A "numbers are points per slot" legend line used the app-wide `.muted`
    class (`color:var(--cream-dim)`) — ~1.56:1 contrast in dark theme,
    since dark theme's `--cream-dim` is a pale grey that nearly matches
    the paper's own lightness. Fixed with an inline `--paper-ink-soft` style.
  - `renderIneligible`'s "Switch to Casual" button used the shared
    `.btn.ghost` class (`--panel2`/`--cream`/`--line2`) — in light theme,
    `--panel2` is nearly the same pale cream as the paper, so the button
    read as barely-there against its own card even though its own text
    stayed technically legible. **This is a different failure shape than
    the first two**: a *component* blending into its background, not
    *text* vanishing into it — because the button supplies its own opaque
    fill, the text-on-fill contrast was never the problem, the
    component's boundary against the paper was. Fixed with a
    `.sheet .btn` override using `--paper-ink`.
  - **`--coral` on the paper fails AA in BOTH themes — found 2026-08-15,
    NOT YET FIXED.** Same class as the first two: an app-wide token used
    on the cream sheet. Computed from sRGB relative luminance (the WCAG
    formula), not eyeballed, and recomputed here rather than accepting a
    relayed number:
    - **Dark theme** — `--coral:#FF6B5E` on `--paper:#FFF3DC` = **2.54:1**.
      Fails AA's 4.5:1 *and* the 3:1 large-text floor.
    - **Light theme** — `--coral:#D9503F` on the same paper = **3.70:1**.
      Fails AA's 4.5:1. **It does clear the 3:1 large-text floor** — but
      that floor doesn't apply here: both affected elements render at
      `.85rem`, which is normal text, so 4.5:1 is the applicable
      threshold and both themes fail it. (An earlier relay of this finding
      said both themes were under 3:1; light is not. The AA conclusion is
      unchanged.)
    - `--paper` is defined once in `:root` and never redefined under
      `html[data-theme="light"]`, so the paper is the same cream in both
      themes and only `--coral` moves. For calibration against tokens that
      pass: `--paper-ink` is 13.70:1 and `--paper-ink-soft` is 6.83:1.
    - **Two places this actually renders today, both inside `.sheet`** —
      this is a live defect, not a prospective hazard:
      1. **`.err` / `#p-err`** (`styles.css:413`, `picks.js:261`) — every
         save and validation error on the pick sheet.
      2. **`.countbig b`** (`styles.css:322`, `picks.js:260`) — the
         cutoff countdown. This is the element whose two-row split
         surfaced the finding in the first place.
      `.linkbtn` and `.pill.live` also use `--coral` but don't currently
      land on paper; they're the same hazard if ever moved there.
    - **Fix, when it's taken**: a `.sheet`-scoped override in the same
      idiom as the `.btn` fix above — a paper-safe danger colour rather
      than reusing `--coral`, since `--coral` has to keep working on the
      app's own dark panels where it's fine. Do **not** darken `--coral`
      globally to solve a paper-only problem.
  The pattern to watch for: it's not just text-color classes that break
  this way — **any app-wide component class** (buttons, pills, badges,
  whatever gets added next) breaks the instant it's dropped inside
  `.sheet`, just via a different visual symptom depending on whether the
  component supplies its own background or inherits the paper's. Before
  adding anything to `.sheet`, check whether its classes reference
  `--cream*`/`--panel*`/`--line*`/`--pit`/`--indigo` anywhere in their
  CSS — if so, it needs paper tokens or a `.sheet`-scoped override, not a
  pass, and check the result in an actual browser in light theme, not by
  reading the values.
- **The boxed podium row (`standings.js`) is width-sensitive in a way that
  breaks only inside a specific window-width band, not "on mobile" or "on
  desktop"** — the kind of bug that gets reported as random/flaky rather
  than traced to a cause, so the arithmetic that makes it obvious is worth
  keeping written down rather than re-derived next time trophy sizing
  changes. The row must never wrap (a wrap can put gold below a lower
  tier, breaking `arrangePodium`'s arrangement), and whether it wraps is a
  function of BOTH the icon px size (`bigPx`/`smallPx`) AND `.podium`'s
  gap (styles.css) against whatever container it's actually sitting in —
  three sizing tiers exist today because that available width is not the
  same thing at every breakpoint:
  - Phone, `<=420px` width: 96/68px icons, 8px gap (available width ~258px
    at a real 324px phone).
  - Desktop, `901-1279px` viewport width: 83/58px icons, 8px gap.
  - Desktop, `>=1280px` viewport width: 118/82px icons, 28px gap
    (unchanged from before this note existed).
  The middle tier exists because desktop's OWN narrowest real width
  (901px, the mobile/desktop breakpoint) is a genuinely separate
  constraint from phone's, not a smaller version of the same one: the
  podium sits inside `#cols`' grid column there, not `.wrap`, and at
  901px that column's available width is 224px. The pre-fix icon sizing
  (118/82) needed 318px of icon ALONE at that width — 94px over, before
  any gap is even added — which is the concrete reason a bigger gap
  can't be the fix on desktop the way it is on phone: no gap value
  subtracts a negative number. Verified directly (not just by this
  arithmetic) that the wrap actually spans the whole 901-1279px range,
  not just the instant at the breakpoint, and that 1280px+ has real
  margin (344px available vs 338px needed) and needs no change. Below
  901px desktop's grid never renders at all (`isDesktop()` in
  `core/dom.js` is `min-width:901px`) — that's phone/tablet's `.wrap`
  instead, covered by the first tier.

- **Brand assets: the laurel wreath has stems (LOCKED 2026-10-26; dev's
  design, drafted 2026-10-14, revised twice on review of before/after
  sheets).** No other record covers brand assets, so this is their home.
  - **Every copy of the wreath** (all now stemmed): `assets/icon.svg` and
    root `icon.svg` (byte-identical duplicates; the root copies exist for
    browsers' automatic requests); the `index.html` header `.logo-icon` (no
    halos); `src/core/trophy.js` `WIN_SVG` (`winBadge`; its halos always
    show, the app CSS has no `.h` rule) and `TROPHY_SVG` (`trophy`; no
    halos); rasters `assets/icon-512.png`, `assets/icon-192.png`,
    `assets/apple-touch-icon.png` + root `apple-touch-icon.png`,
    `assets/favicon.ico` (PNG frames 16/32/48) + root `favicon.ico`, new
    `assets/icon-maskable-512.png` and `-192.png`, `assets/discord-icon.png`;
    and `manifest.webmanifest`. `laurelSpray()` already draws its own stem
    and is unchanged.
  - **Stem path:** a Catmull-Rom spline through each branch's leaf-pair
    anchors (the `translate()` of every leaf; 8 per branch, mirrored
    x -> 100 - x), bottom to top, as cubic Beziers with the end points
    duplicated, one path per branch. Icon and header anchors run
    (53.9,82.8) ... (67.4,24.2); the trophy/badge wreath is the same shape
    at 0.655 scale, (52.6,58.8) ... (61.4,20.4).
  - **Base lead-in (SHORT, chosen by the dev over LONG):** each stem starts
    with a straight `M E L P0` from its lowest anchor P0 back along the
    tangent there (direction P0 - P1; the spline's tangent at a duplicated
    end point), so there is no kink; round caps kept. Length is solved per
    geometry so the gap between the two cap edges is HALF the un-extended
    gap, never closer: icon and header 5.6 -> 2.8 units (lead-in 1.466),
    trophy and badge 3.0 -> 1.5 (lead-in 0.784). LONG (a third) was the
    alternative shown.
  - **Stroke:** `#9C6B3C`, width 2.2 in every copy, round caps, no halo.
    2.2 holds in the trophy/badge too: same 0-100 viewBox, and their wreath
    leaves already use the icon's unscaled 1.4 outline. The near-black
    first draft (`#1A2415` with a cream stem halo) was rejected because it
    disappeared on the dark header and the home-screen icon.
  - **Paint order: the stem is above every cream halo and below every
    leaf.** In the halo'd copies (`icon.svg` and its rasters, `WIN_SVG`)
    each layer of halos and leaves is reordered to all its halos, then all
    its leaves, and the stems go between the halos and the leaves of the
    wreath's layer. `WIN_SVG`'s contact-shadow ellipse sits between its 26
    back and 2 front nest leaves; it splits the layers, so the shadow keeps
    its place. Shown to the dev and accepted: there is no longer a cream rim
    where leaves overlap, in the wreath or the nest. The header and
    `TROPHY_SVG` have no halos; their stem simply sits before the wreath's
    first leaf (in `TROPHY_SVG`, after the nest and before the medal).
  - **Halos trimmed (variant B, chosen over A at 3.8):** every halo is 1.0
    thinner, 3.8 -> 2.8 on the icon and wreath leaves and 3.6 -> 2.6 on the
    nest, which keeps the cream margin around each leaf even.
  - **Stem colour contrast** (WCAG relative luminance, non-text 3:1):

    | Background | Ratio |
    |---|---|
    | `#171233` (theme_color, apple-touch) | 3.91 |
    | `#100C26` (`--pit`, header, maskable) | 4.16 |
    | `#1F1941` (dark `--panel`) | 3.60 |
    | `#FDF8EC` (light `--panel`) | 4.32 |
    | `#F3EBD8` (light header) | 3.86 |
    | `#EDE3CC` (light `--pit`) | 3.59 |
    | `#F2EEDC` (cream halo) | 3.94 |
    | `#FFFFFF` (light browser tab) | 4.58 |
    | `#35363A` (Chrome dark tab strip) | **2.63** |

    The tab strip is the one miss, accepted: in a dark tab the SVG shows its
    halos, so the stem sits mostly on cream, and at 16px it is under a pixel.
    Lighter browns that clear it (`#AA7842`, 3.15) become nearly identical
    to the leaf green under deuteranopia (CIEDE2000 2.0, against 6.7 for
    `#9C6B3C`). Against the leaf green `#5B9E45` the stem is only 1.40:1 in
    luminance but CIEDE2000 35 in hue, and the leaf's dark outline always
    separates them.
  - **Rasters are regenerated from `icon.svg` with the halos forced ON.**
    Re-rendering the old SVG that way reproduced every old raster to within
    antialiasing (mean difference 0.7-5.5 out of 255; halos off was 19-26).
    Full frame, transparent background; `apple-touch-icon.png` is on
    `#171233` and stays RGB.
  - **Maskable icons** sit on `#100C26` (the manifest's `background_color`).
    The wreath is centred on its smallest enclosing circle (radius 39.6
    units about (50, 52.45)) and sized 1px inside the 80% safe circle
    (painted radius 204.09 of 204.8 at 512, 76.25 of 76.8 at 192). The
    manifest's two existing icons now carry an explicit `"purpose": "any"`.
    This resolves the maskable follow-up in `onboarding.md` Batch 3.
  - **`discord-icon.png` has no source file.** It is the wreath at 1.03x
    over a gold egg on a `#171233` rounded square; the fitted placement is
    527.11px per 100 units at offset (-7.555, -2.171), within about 1px. It
    was regenerated by wiping the old wreath to the flat navy (verified
    uniform outside the wreath) and drawing the new one at the fitted
    placement; the egg and corners are byte-identical. **Nothing in the repo
    references it, and the edge function sends no `avatar_url`, so it
    changes in Discord only when re-uploaded as each webhook's avatar in
    Discord's settings.**
  - **Installed apps:** installed iPhones keep their old home-screen icon
    until the app is removed and re-added to the Home Screen; Android
    updates the installed icon on its own (Chrome's periodic manifest
    check, so not instantly). Browser favicons refresh as their cache
    expires.
