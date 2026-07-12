# CLAUDE.md

Guidance for Claude Code when working in `~/Desktop/sonnerie/`.

## What this is

A personal GNOME Shell extension (GJS/ESM, GNOME 45+ style) — a
grandfather-clock metronome: minor clicks every N minutes, a major click
every Nth beat, only inside a daily time window. Integrated into Quick
Settings (SystemIndicator + QuickMenuToggle, Caffeine-style), not a
standalone panel button. Installed locally only; **not published** to
extensions.gnome.org and there is no plan to.

## Layout

- `src/` — the extension exactly as installed: `metadata.json`,
  `extension.js` (Quick Settings UI + `Scheduler` class), `prefs.js`
  (libadwaita preferences), `schemas/` (GSettings), `sounds/` (generated
  WAVs — build artifacts, but committed so installs need no build step).
- `tools/make_sounds.py` — stdlib-only modal synthesizer for the bundled
  palette; regenerates `src/sounds/*.wav`. Its `PALETTE` dict, the
  `BUNDLED` list in `prefs.js`, and the Makefile `PALETTE` variable must
  stay in sync (sound names are the settings values).
- `Makefile` — `install` / `uninstall` / `enable` / `check` / `sounds` /
  `listen`. `make install` rsyncs `src/` to
  `~/.local/share/gnome-shell/extensions/sonnerie@bphopkins.net` and
  compiles the schema there.

## Key invariants

- Beats are wall-clock-aligned on a grid anchored at `anchor-minutes`
  (default midnight): beat k at `anchor + k * interval`, k any integer —
  the grid extends *backwards* past the anchor too (negative k), so a
  mid-morning anchor still yields early-morning beats. Major beats use
  proper (sign-safe) modulo on k. Don't collapse the anchor into the
  window start time — they are deliberately independent settings.
- Sound settings are strings: a bare name selects
  `src/sounds/<name>.wav`; anything containing `/` is a custom file
  path; `''` falls back to the per-key default (tick/woodblock — keep
  `DEFAULT_SOUND` in extension.js, prefs.js and the schema defaults in
  agreement).
- Profiles (the `PRESETS` list in prefs.js) are derived state, not a
  stored setting: the combo just reflects whether (interval,
  major-every) matches a preset. Don't add a "profile" GSettings key.
- The scheduler sleeps at most 30 min per wakeup and skips beats that
  fire > 60 s late (suspend/resume safety). Preserve both behaviors.
- `make check` must pass before `make install` (it's a dependency).

## Dev cycle gotcha

On Wayland, GNOME Shell only picks up new/changed extension code at
login. After `make install`, the user must log out/in for changes to take
effect — there is no in-session reload. Schema-only or sound-only changes
still need a re-login to be safe. Don't claim a change is live until then.
