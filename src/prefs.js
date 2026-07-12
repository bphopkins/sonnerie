import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Bundled palette: [settings value, display label]. Keep in sync with
// tools/make_sounds.py PALETTE.
const BUNDLED = [
    ['woodblock', 'Woodblock'],
    ['claves', 'Claves'],
    ['tick', 'Clock Tick'],
    ['marimba', 'Marimba'],
    ['bell', 'Bell'],
    ['chime', 'Tubular Chime'],
    ['dingdong', 'Ding-Dong'],
    ['bourdon', 'Low Bell'],
];
const DEFAULT_SOUND = {'minor-sound': 'tick', 'major-sound': 'woodblock'};

// Profile presets: named (interval, major cadence) pairs. A profile is
// derived state, not a stored setting — the combo shows whichever preset
// matches the current values, or "Custom" if none does. Window, anchor
// and sounds are untouched by profile selection.
const PRESETS = [
    {label: 'Quarter-Hour', interval: 15, majorEvery: 4,
        desc: '15-minute beats; the hour mark is major'},
    {label: 'Twenty-Minute', interval: 20, majorEvery: 3,
        desc: '20-minute beats; the hour mark is major'},
    {label: 'Half-Hour', interval: 30, majorEvery: 2,
        desc: '30-minute beats; the hour mark is major'},
    {label: 'Hourly', interval: 60, majorEvery: 1,
        desc: 'One beat per hour, always major'},
];

export default class SonneriePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep playing media alive while the window is open (GC guard).
        window._sonnerieMedia = [];

        const page = new Adw.PreferencesPage({title: 'Sonnerie'});
        window.add(page);

        // --- profile ----------------------------------------------------
        const profileGroup = new Adw.PreferencesGroup({
            title: 'Profile',
            description: 'Common beat patterns; picking one sets the ' +
                'interval and major cadence below. Everything else is ' +
                'left alone.',
        });
        page.add(profileGroup);
        profileGroup.add(this._profileRow(settings));

        // --- daily window ---------------------------------------------
        const windowGroup = new Adw.PreferencesGroup({
            title: 'Daily Window',
            description: 'Beats only sound between these times. ' +
                'A start later than the end wraps past midnight.',
        });
        page.add(windowGroup);
        windowGroup.add(this._timeRow(settings, 'start-minutes', 'Start'));
        windowGroup.add(this._timeRow(settings, 'end-minutes', 'End'));

        // --- beats ------------------------------------------------------
        const beatGroup = new Adw.PreferencesGroup({
            title: 'Beats',
            description: 'Beats fall on a grid anchored to the "count from" ' +
                'time, extending in both directions. With interval 20, ' +
                'anchor 00:00 and major every 3rd, the hour mark is major.',
        });
        page.add(beatGroup);

        const intervalRow = new Adw.SpinRow({
            title: 'Interval',
            subtitle: 'Minutes between beats',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 720, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('interval-minutes', intervalRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        beatGroup.add(intervalRow);

        const majorRow = new Adw.SpinRow({
            title: 'Major Beat',
            subtitle: 'Every Nth beat is major (0 = never, 1 = always)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 60, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('major-every', majorRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        beatGroup.add(majorRow);

        beatGroup.add(this._timeRow(settings, 'anchor-minutes', 'Count From',
            'Anchor of the beat grid; majors count from here'));

        // --- sounds -----------------------------------------------------
        const soundGroup = new Adw.PreferencesGroup({
            title: 'Sounds',
            description: 'Bundled sounds are synthesized locally ' +
                '(tools/make_sounds.py); Custom accepts any audio file, ' +
                'e.g. from /usr/share/sounds.',
        });
        page.add(soundGroup);
        soundGroup.add(this._soundRow(window, settings, 'minor-sound',
            'Minor Click'));
        soundGroup.add(this._soundRow(window, settings, 'major-sound',
            'Major Click'));
    }

    _profileRow(settings) {
        const row = new Adw.ComboRow({
            title: 'Profile',
            model: Gtk.StringList.new(
                PRESETS.map(p => p.label).concat(['Custom'])),
        });
        const customIndex = PRESETS.length;

        let syncing = false;
        const sync = () => {
            syncing = true;
            const interval = settings.get_int('interval-minutes');
            const majorEvery = settings.get_int('major-every');
            const idx = PRESETS.findIndex(p =>
                p.interval === interval && p.majorEvery === majorEvery);
            row.selected = idx >= 0 ? idx : customIndex;
            row.subtitle = idx >= 0
                ? PRESETS[idx].desc
                : 'Interval and major cadence set manually below';
            syncing = false;
        };
        sync();
        settings.connect('changed::interval-minutes', sync);
        settings.connect('changed::major-every', sync);

        row.connect('notify::selected', () => {
            if (syncing || row.selected >= customIndex)
                return;   // "Custom" is a state label, not an action
            const p = PRESETS[row.selected];
            syncing = true;   // suppress mid-write flicker to "Custom"
            settings.set_int('interval-minutes', p.interval);
            settings.set_int('major-every', p.majorEvery);
            syncing = false;
            sync();
        });
        return row;
    }

    // A row with hour and minute spin buttons backed by a
    // minutes-since-midnight integer setting.
    _timeRow(settings, key, title, subtitle = null) {
        const row = new Adw.ActionRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        const value = settings.get_int(key);

        const hour = Gtk.SpinButton.new_with_range(0, 23, 1);
        const minute = Gtk.SpinButton.new_with_range(0, 59, 1);
        hour.valign = minute.valign = Gtk.Align.CENTER;
        hour.orientation = minute.orientation = Gtk.Orientation.VERTICAL;
        hour.value = Math.floor(value / 60);
        minute.value = value % 60;
        minute.connect('output', sb => {
            sb.text = sb.value.toString().padStart(2, '0');
            return true;
        });

        const store = () =>
            settings.set_int(key, hour.value * 60 + minute.value);
        hour.connect('value-changed', store);
        minute.connect('value-changed', store);

        const box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
        box.append(hour);
        box.append(new Gtk.Label({label: ':'}));
        box.append(minute);
        row.add_suffix(box);
        return row;
    }

    _resolveFile(settings, key) {
        const value = settings.get_string(key);
        if (value.includes('/') && GLib.file_test(value, GLib.FileTest.EXISTS))
            return Gio.File.new_for_path(value);
        const name = value !== '' && !value.includes('/')
            ? value : DEFAULT_SOUND[key];
        return Gio.File.new_for_path(`${this.path}/sounds/${name}.wav`);
    }

    _soundRow(window, settings, key, title) {
        const labels = BUNDLED.map(([, label]) => label).concat(['Custom…']);
        const customIndex = BUNDLED.length;

        const row = new Adw.ComboRow({
            title,
            model: Gtk.StringList.new(labels),
        });

        let syncing = false;
        const syncFromSettings = () => {
            syncing = true;
            const value = settings.get_string(key);
            if (value.includes('/')) {
                row.selected = customIndex;
                row.subtitle = GLib.path_get_basename(value);
            } else {
                const name = value !== '' ? value : DEFAULT_SOUND[key];
                const idx = BUNDLED.findIndex(([n]) => n === name);
                row.selected = idx >= 0 ? idx : 0;
                row.subtitle = '';
            }
            syncing = false;
        };
        syncFromSettings();
        settings.connect(`changed::${key}`, syncFromSettings);

        row.connect('notify::selected', () => {
            if (syncing)
                return;
            if (row.selected < customIndex) {
                settings.set_string(key, BUNDLED[row.selected][0]);
                return;
            }
            // Custom…: pick a file; revert the combo if dismissed.
            const filter = new Gtk.FileFilter();
            filter.set_name('Audio files');
            filter.add_mime_type('audio/*');
            const filters = new Gio.ListStore();
            filters.append(filter);
            const dialog = new Gtk.FileDialog({filters});
            dialog.open(window, null, (dlg, result) => {
                try {
                    const file = dlg.open_finish(result);
                    if (file)
                        settings.set_string(key, file.get_path());
                    else
                        syncFromSettings();
                } catch {
                    syncFromSettings();   // dialog dismissed
                }
            });
        });

        const play = new Gtk.Button({
            icon_name: 'media-playback-start-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Test this sound',
        });
        play.connect('clicked', () => {
            const media = Gtk.MediaFile.new_for_file(
                this._resolveFile(settings, key));
            window._sonnerieMedia.push(media);
            media.play();
        });
        row.add_suffix(play);

        return row;
    }
}
