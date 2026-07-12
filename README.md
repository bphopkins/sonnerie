# Sonnerie

A metronome for hours, not minutes.

Sonnerie is a GNOME Shell extension that clicks at a configurable
interval during a daily window, with a distinct **major** click every
Nth beat — a grandfather clock for the top bar. With the defaults
(20-minute interval, major every 3rd beat, window 08:00–22:00) you get a
clock tick at :20 and :40 past each hour, a woodblock on the hour, and
silence outside waking hours.

It lives in **Quick Settings** (the system menu at the right of the top
bar): an alarm icon shows in the indicator block while it's ticking, and
the grid gets a Sonnerie tile — click to toggle, expand for the
next-beat time, test buttons for both sounds, and Preferences.

## Project status

Sonnerie is a complete, fully functional GNOME Shell extension. It is
distributed from this repository **deliberately** rather than from
extensions.gnome.org: I maintain it for my own machines (currently
GNOME 50 on Fedora) and don't want to take on maintenance obligations
beyond that. It should work anywhere its `shell-version` allows, but
there are no compatibility promises, release schedule, or support —
fork freely.

## Requirements

- GNOME Shell 45 or later (developed and tested on GNOME 50 / Fedora;
  uses the modern ESM extension style)
- `make`, `rsync`, and `glib-compile-schemas` (part of glib2) to install
- Python 3 only if you want to regenerate the bundled sounds; Node.js
  only for the `make check` development target

## Install

```sh
git clone https://github.com/bphopkins/sonnerie.git
cd sonnerie
make install
```

GNOME Shell only scans for new or changed extensions at login (on
Wayland there is no in-session reload), so **log out and back in**.
Then, back in a fresh terminal, `cd` into the clone again and enable:

```sh
cd sonnerie
make enable
```

(Or from anywhere: `gnome-extensions enable sonnerie@bphopkins.net`,
which is all that target does.)

## Configuration

Everything is in Preferences (from the Quick Settings tile, or
`gnome-extensions prefs sonnerie@bphopkins.net`):

- **Profile** — one-click beat patterns: Quarter-Hour, Twenty-Minute,
  Half-Hour, Hourly. Picking one sets the interval and major cadence;
  the selector reads "Custom" whenever the values below don't match a
  preset. Window, anchor and sounds are never touched by a profile, and
  a profile is never *stored* — it's a shortcut that writes the settings
  below, so edits you make afterwards (sounds, a tweaked interval) are
  the settings, and nothing reasserts a profile over them at login.
- **Daily window** — beats only sound between the start and end times.
  A start later than the end wraps past midnight (e.g. 22:00–06:00),
  and a beat landing exactly on the end time still sounds.
- **Interval** — minutes between beats, 1–720.
- **Major beat** — every Nth beat is major (0 = never, 1 = always).
- **Count from** — the anchor of the beat grid. Beat k falls at
  `anchor + k × interval`, extending in *both* directions, so beats also
  fall before the anchor; major-beat counting is anchored here too.
  With the default midnight anchor and a 20-minute interval, that is
  what keeps the major beat on the hour.
- **Sounds** — pick a bundled sound per beat, or **Custom…** for any
  audio file libcanberra can play (WAV/OGG are safe bets; the
  freedesktop theme under `/usr/share/sounds/` is a good hunting
  ground). Volume follows the system sound level.

## Behavior notes

- No sound while the screen is locked (the shell suspends extensions on
  the lock screen); beats resume on unlock.
- After suspend, a beat that would have fired while the lid was closed
  is skipped, not played late.
- The beat grid is derived from each day's midnight, so the daily
  pattern is identical every day even for intervals that don't divide
  24 hours.
- All settings (and the ticking/paused state) live in GSettings/dconf,
  so everything survives reboots; since beats are wall-clock-aligned,
  the schedule after a restart is identical, not shifted.

## Sounds

The eight bundled sounds are synthesized locally by
`tools/make_sounds.py` (pure Python stdlib — modal synthesis: decaying
partials at physically-motivated frequency ratios). No samples, no
third-party assets:

woodblock · claves · clock tick · marimba · bell · tubular chime ·
ding-dong · low bell (bourdon)

To reshape them, edit the partial/decay tables in the `PALETTE` dict,
then `make sounds && make listen`.

## Development

```sh
make check       # syntax-check the JS, validate the schema
make sounds      # regenerate the palette from tools/make_sounds.py
make listen      # audition all bundled sounds
make pack        # build a distributable zip (gnome-extensions pack)
make uninstall
```

To watch extension logs while testing:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

When a new GNOME major version ships, add it to `shell-version` in
`src/metadata.json` and reinstall; that is normally the entire
migration.

## License

GPL-2.0-or-later — see [LICENSE](LICENSE). Like GNOME Shell itself,
which extensions run inside of.
