# ============================================================
# Stage C1 — edge function auth verification (carton-sync)
# ============================================================
# Run this after sql/stage_c1_rpcs.sql has been applied (confirmed via
# stage_c1_smoke_test.sql). Fill in your real Ambassadors admin name/PIN
# once below, then run the whole script or paste individual blocks.
#
# Note on reading results: auth rejections come back as HTTP 500 with
# {"ok":false,"error":"..."} — same status code as a genuine server error
# (a known gap, tracked in CLAUDE.md). Invoke-RestMethod treats any non-2xx
# response as a terminating error, so Invoke-CartonAction below catches it
# and prints the response body instead of a bare PowerShell exception. A
# rejection is expected to print an error body, NOT to mean the request
# itself failed to run.
#
# Variants included: 1 (no credentials) and 2 (wrong PIN) for reopen,
# cutoff_changed, and finalize — these are safe, the guard rejects before
# any DB mutation or Discord post. Variant 3 (correct credentials, expect
# success) is included ONLY for cutoff_changed, which just posts a Discord
# notice with no DB mutation — same shared guard as the other two, so
# proving it once is sufficient. reopen and finalize are NOT exercised with
# correct credentials here: reopen flips a future show to 'live' and nulls
# winner_sent; finalize marks a show that hasn't happened yet as 'final' and
# may fire a nonsense winner announcement to the real Discord channel.
#
# Setup: copy auth-verify.creds.ps1.example to auth-verify.creds.ps1 (same
# folder) and fill in your real name/PIN there. That file is gitignored —
# this script only ever holds the placeholder-free logic, so a real PIN
# can't end up committed by accident.

$credsFile = Join-Path $PSScriptRoot "auth-verify.creds.ps1"
if (-not (Test-Path $credsFile)) {
  Write-Error "Missing $credsFile — copy auth-verify.creds.ps1.example to auth-verify.creds.ps1 and fill in your real Ambassadors admin name/PIN before running this script."
  exit 1
}
. $credsFile

$url  = "https://zdfhglvjxquvkjyvophz.supabase.co/functions/v1/carton-sync"
$anon = "sb_publishable_qN1goR6-Ss3cErnJJIJdKw_xr5nrFuo"

$leagueId = 1            # Ambassadors
$showId   = 1775573029   # Ocean Mist, South Kingstown RI, 2026-07-30 — hasn't happened yet

function Invoke-CartonAction($body) {
  try {
    Invoke-RestMethod -Uri $url -Method Post -Headers @{ Authorization = "Bearer $anon" } `
      -ContentType "application/json" -Body ($body | ConvertTo-Json)
  } catch {
    if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  }
}

# ---------- REOPEN ----------

# 1. reopen, no credentials — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "reopen"; league_id = $leagueId; show_id = $showId }

# 2. reopen, wrong PIN — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "reopen"; league_id = $leagueId; show_id = $showId; p_name = $name; p_pin = "0000" }

# ---------- CUTOFF_CHANGED ----------

# 3. cutoff_changed, no credentials — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "cutoff_changed"; league_id = $leagueId; show_id = $showId }

# 4. cutoff_changed, wrong PIN — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "cutoff_changed"; league_id = $leagueId; show_id = $showId; p_name = $name; p_pin = "0000" }

# 5. cutoff_changed, correct name/PIN — expect success: {"ok":true,...}.
#    Real side effect: posts a real "cutoff changed" notice to the actual
#    Discord channel. No DB mutation.
Invoke-CartonAction @{ action = "cutoff_changed"; league_id = $leagueId; show_id = $showId; p_name = $name; p_pin = $pin }

# ---------- FINALIZE ----------

# 6. finalize, no credentials — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "finalize"; league_id = $leagueId; show_id = $showId }

# 7. finalize, wrong PIN — expect rejection: {"ok":false,"error":"Wrong name or PIN"}
Invoke-CartonAction @{ action = "finalize"; league_id = $leagueId; show_id = $showId; p_name = $name; p_pin = "0000" }
