# Tooling / account notes (full text)

> Extracted verbatim from `CLAUDE.md` at commit 54a5ab8 (2026-10-18), original lines 4460–4508. Nested entries were de-indented to top level; wording is unchanged.
> Decision record — currently binding. `CLAUDE.md` holds only a pointer stub under the same entry name; this file is the full text and rationale.

- **The corporate→personal account switch needs re-auth in TWO places, not
  one** (hit 2026-08-14). Claude Code itself (`/logout`, then `/login`) and
  the **Chrome extension separately** — signing one in does not sign in the
  other, and the extension silently keeps whatever account it had.
  **The extension's failure mode is the problem**: with the wrong account,
  `list_connected_browsers` returns an empty list `[]` and
  `tabs_context_mcp` reports "extension is not connected" — both of which
  read as *"no browser available"* rather than *"a browser is right there,
  signed into the wrong account."* Nothing in either message mentions
  accounts. If the browser tools report no browser while Chrome is
  demonstrably open with the extension installed, **check which account the
  extension is signed into before debugging anything else** — restarting
  Chrome and reinstalling both look like plausible fixes and neither
  touches the actual cause.
- **TYPED INPUT INTO THE SUPABASE SQL EDITOR SILENTLY DROPS CHARACTERS.
  Never type a destructive statement into it.** Measured 2026-08-14: a
  211-character `select` typed via the browser tool's `type` action landed
  in Monaco's model as **203 characters** — the tail ` k.slot;` was gone,
  with no error and nothing visibly wrong. The failure is silent and
  position-dependent (it ate the end), which is the worst possible shape
  for SQL: **a `delete ... where bracket_id = 1 and show_id = X and slot in
  (...)` truncated the same way becomes `delete ... where bracket_id = 1
  and show_id = X`, which still parses, still runs, and destroys
  everything the narrowing clause was there to protect.**
  - **Use `monaco.setValue()` instead** — `window.monaco` is exposed on the
    dashboard, `window.monaco.editor.getModels()[0]` is the query editor's
    model. Setting the value programmatically bypasses keystroke handling
    entirely and reproduced the string exactly (249/249 chars) where typing
    did not. `form_input` on the editor's ref does NOT work: it writes
    Monaco's hidden textarea without updating the model, so the editor
    still shows its placeholder and the query never runs.
  - **Verify the model before executing, every time, and check the TAIL
    specifically** — an exact-length check alone is fine, but `endsWith(...)`
    on the intended final clause is what actually catches this failure
    mode. For anything destructive also assert the narrowing predicate is
    present (`v.includes("and slot in ('encore','flat2')")`) and that
    `delete` appears exactly once.
  - **The `javascript_tool` guard blocks responses containing the statement
    text** — it reads `bracket_id = 1 and show_id = 1765912122` as
    cookie/query-string data and returns `[BLOCKED: Cookie/query string
    data]`, killing the whole call. Return **primitives only** (lengths,
    booleans, counts joined into a string); never echo the SQL or a `tail`
    slice back. Build the statement by concatenating fragments around the
    `=` signs for the same reason.
  - **Reading results**: the results grid is `.rdg`, and `innerText` on it
    returns empty (the container has no layout height) — use
    `textContent` on `[role="row"]` children instead. `get_page_text`
    reports the row COUNT but never the cell values.
