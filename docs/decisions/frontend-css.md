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
