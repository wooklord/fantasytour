# Admin playbook — "I forgot my PIN"

For league admins. Written 2026-10-11 from the live code and database, not
from memory. No nicknames or league-specific identifiers in this file, on
purpose: it is public, and it applies to every league.

## What the reset does (so the steps make sense)

- The app generates a six-digit **temporary** PIN. You never choose it and
  you see it exactly once.
- The player's old PIN stops working **immediately, on every device**. The
  app does not log them out; their open sessions just start failing with
  "Wrong name or PIN" until they log out and log back in.
- On their next login the app forces them to choose a new PIN before
  anything else. After that, nobody, including you, knows their PIN.
- Nothing records that a reset happened. Be deliberate.

## The steps

1. **Only reset someone who genuinely cannot log in.** A reset breaks their
   existing logged-in session on every device at once. If they are merely
   logged out on one phone but still signed in on another, have them try
   the other device first, or tell them to use Settings → Change PIN there.
2. **Confirm it is really them.** Ask on the channel you already know them
   by, not a new message from an unfamiliar account. The reset works on
   their nickname, which is public, so your judgement is the only identity
   check there is.
3. Open the app → **Admin** tab → **Members** → find their nickname →
   **Reset PIN** → OK on the dialog.
4. A box shows a six-digit PIN once. **Send it to the player privately,
   right then.** It is not shown again. If you lose it, run the reset
   again; nothing breaks.
5. Tell the player, in these words or close to them:
   > Log in with your nickname and this temporary PIN. You'll be asked to
   > choose a new PIN straight away, 4 to 8 digits. Don't use 1234, your
   > birth year, or the same digit repeated. If the app was still open on
   > another device, log out there and log in again with the new PIN.
6. If they see **"PIN change required before this action"** anywhere, they
   skipped the new-PIN screen. Have them log out and log in again with the
   temporary PIN.
7. If they see **"Wrong name or PIN"** on a device after the reset, that
   device is still holding the old PIN. Press **Log out** on it and log in
   again. Nothing is broken.

## What you must NOT do

8. **Do not ask the player what PIN they want, and do not try to set one
   for them.** You cannot, and you should not know their chosen PIN.
9. **Do not post the temporary PIN in a group channel** or anywhere others
   can see it.
10. **Do not press Boot.** It sits next to Reset PIN, is red, and removes
    the player from the league. If an Official season is running, booting
    also costs them standings position that cannot be repaired.
11. **A global admin's PIN cannot be reset by a league admin.** If the
    button fails with "Only Global can reset a Global admin's PIN", tell
    the developer.
