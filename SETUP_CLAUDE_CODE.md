# Getting this repo into Claude Code

You already have a GitHub repo serving the app via GitHub Pages. This is not a new
repo — you're just going to (a) add these organized files + docs to it, and (b) start
editing it with Claude Code instead of pasting files. Steps:

## 1. Install Node.js (one time)
Claude Code runs on Node. Download the **LTS** version from https://nodejs.org and
install it. Verify in a terminal:
    node --version
(Any recent LTS is fine.)

## 2. Install Claude Code (one time)
Check the current install command at https://docs.claude.com (it may change). As of
writing it's typically installed via npm, e.g.:
    npm install -g @anthropic-ai/claude-code
Then run `claude` in a terminal to start it and follow the login prompt. If the command
name or package differs in the docs, trust the docs over this file.

## 3. Get these files into your repo
You have two options:

**Option A — merge into your existing repo (recommended):**
1. Clone your existing repo locally if it isn't already:
       git clone <your-repo-url>
       cd <your-repo>
2. Copy the contents of this package into it. The important additions are:
   - `CLAUDE.md`  (the full project playbook — this is the key file)
   - `README.md`  (refreshed)
   - `SETUP_CLAUDE_CODE.md`  (this file)
   - `.gitignore`
   - `docs/MULTITENANT_SPEC.md`
   - `sql/stage_a_schema.sql` (+ the archived SQL under `sql/archive/`)
   - the reorganized `assets/` and `supabase/` folders
   Your existing `index.html` is the same app — keep whichever is newest (they should
   match; this package's copy has the credentials filled in).
3. Commit:
       git add -A
       git commit -m "Add Claude Code docs + reorganize repo for 2.0"
       git push

**Option B — start fresh from this package:**
Only if you'd rather not merge. `git init` inside this folder, point it at a new GitHub
repo, and re-establish GitHub Pages. More disruptive; Option A keeps your deploy intact.

## 4. Open the repo in Claude Code
From inside the repo folder:
    claude
Claude Code automatically reads `CLAUDE.md` for context. Everything we've learned across
the whole project lives in that file, so the agent starts fully briefed.

## 5. First things to tell Claude Code (in this order)
1. "Read CLAUDE.md and docs/MULTITENANT_SPEC.md, then summarize the plan back to me."
   — confirms it ingested the context correctly.
2. "Reorganize the repo to match the target layout in CLAUDE.md, commit it."
3. "Split index.html into modules with a build step, keep it deployable on GitHub Pages,
   and set up test harnesses. Verify the build works before committing."
4. Then begin **Stage A** of 2.0 per the spec (run sql/stage_a_schema.sql in Supabase
   first, in a quiet window, snapshot first, and check the verification counts).

## Notes
- The anon/publishable Supabase key in `index.html` is public by design — safe to commit.
- NEVER commit the service_role key. `.gitignore` already excludes `.env` and secret files.
- Deploy stays the same: push -> GitHub Pages (frontend);
  `supabase functions deploy carton-sync` (edge function); SQL in the Supabase editor.
