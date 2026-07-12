// Sonnerie -- a metronome for hours, not minutes.
//
// Beats fall on a grid anchored to a configurable wall-clock time
// (default midnight): beat k at anchor + k * interval, with the grid
// extending in both directions. Every Nth beat (counted from the anchor)
// is major. With interval 20, anchor 00:00 and N=3, that is a grandfather
// clock: ticks at :20 and :40, the hour voice at :00.
//
// UI lives in Quick Settings, Caffeine-style: an icon in the system
// indicator block while ticking, and a toggle tile with a menu (next
// beat, test sounds, preferences) in the grid.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const SECONDS_PER_DAY = 86400;
// Never sleep longer than this between wakeups, so we resynchronize with
// the wall clock after suspend, DST shifts, or manual clock changes.
const MAX_SLEEP_SECONDS = 1800;
// A beat that fires this late (e.g. resume from suspend) is skipped
// rather than sounded off-schedule.
const LATE_GRACE_SECONDS = 60;

const DEFAULT_SOUND = {'minor-sound': 'tick', 'major-sound': 'woodblock'};

// --- beat scheduler (no UI) ---------------------------------------------

class Scheduler {
    constructor(extension, onUpdate) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._onUpdate = onUpdate;   // (text) => void
        this._timeoutId = 0;
        this._targetEpoch = 0;
        this._targetIsBeat = false;
        this._pendingBeat = null;

        this._settingsChangedId =
            this._settings.connect('changed', () => this.reschedule());
        this.reschedule();
    }

    _inWindow(minuteOfDay) {
        const start = this._settings.get_int('start-minutes');
        const end = this._settings.get_int('end-minutes');
        if (start <= end)
            return minuteOfDay >= start && minuteOfDay <= end;
        return minuteOfDay >= start || minuteOfDay <= end; // wraps midnight
    }

    _isMajor(beatIndex) {
        const n = this._settings.get_int('major-every');
        // Proper modulo: beat indices before the anchor are negative.
        return n > 0 && ((beatIndex % n) + n) % n === 0;
    }

    // Next beat strictly after `sod` (seconds into today). The grid is
    // anchor + k * interval for any integer k; we scan up to two days
    // ahead so windows that wrap midnight are handled. Returns
    // {delay, beatIndex, minuteOfDay} or null if the window admits no
    // beat (e.g. a one-minute window the grid never lands on).
    _nextBeat(sod) {
        const interval = this._settings.get_int('interval-minutes') * 60;
        const anchor = this._settings.get_int('anchor-minutes') * 60;
        let k = Math.floor((sod + 0.5 - anchor) / interval) + 1;
        const maxSteps = Math.ceil(2 * SECONDS_PER_DAY / interval) + 2;
        for (let i = 0; i < maxSteps; i++, k++) {
            const t = anchor + k * interval;
            if (t <= sod + 0.5)
                continue;
            const minuteOfDay =
                (((t % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY) / 60;
            if (this._inWindow(minuteOfDay))
                return {delay: t - sod, beatIndex: k, minuteOfDay};
        }
        return null;
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    reschedule() {
        this._clearTimeout();

        if (!this._settings.get_boolean('enabled')) {
            this._onUpdate('Paused');
            return;
        }

        const now = GLib.DateTime.new_now_local();
        const sod = now.get_hour() * 3600 + now.get_minute() * 60 +
            now.get_second() + now.get_microsecond() / 1e6;

        const beat = this._nextBeat(sod);
        if (!beat) {
            this._onUpdate('No beat fits the window');
            return;
        }

        const h = Math.floor(beat.minuteOfDay / 60);
        const m = Math.floor(beat.minuteOfDay % 60);
        const tag = this._isMajor(beat.beatIndex) ? ' (major)' : '';
        this._onUpdate(
            `Next ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}${tag}`);

        this._pendingBeat = beat;
        this._targetEpoch = GLib.get_real_time() / 1e6 + beat.delay;
        this._targetIsBeat = beat.delay <= MAX_SLEEP_SECONDS;
        const sleep = Math.min(beat.delay, MAX_SLEEP_SECONDS);

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, Math.ceil(sleep * 1000), () => {
                this._timeoutId = 0;
                this._onWake();
                return GLib.SOURCE_REMOVE;
            });
    }

    _onWake() {
        const nowEpoch = GLib.get_real_time() / 1e6;
        // Only sound if this wakeup was the beat itself and we are not
        // hopelessly late (laptop was suspended, clock jumped, ...).
        if (this._targetIsBeat &&
            nowEpoch >= this._targetEpoch - 2 &&
            nowEpoch <= this._targetEpoch + LATE_GRACE_SECONDS)
            this.play(this._isMajor(this._pendingBeat.beatIndex));
        this.reschedule();
    }

    _soundFile(major) {
        const key = major ? 'major-sound' : 'minor-sound';
        const value = this._settings.get_string(key);
        if (value.includes('/') && GLib.file_test(value, GLib.FileTest.EXISTS))
            return Gio.File.new_for_path(value);
        const name = value !== '' && !value.includes('/')
            ? value : DEFAULT_SOUND[key];
        let file = Gio.File.new_for_path(
            `${this._extension.path}/sounds/${name}.wav`);
        if (!file.query_exists(null))
            file = Gio.File.new_for_path(
                `${this._extension.path}/sounds/${DEFAULT_SOUND[key]}.wav`);
        return file;
    }

    play(major) {
        const player = global.display.get_sound_player();
        player.play_from_file(
            this._soundFile(major),
            major ? 'Sonnerie major beat' : 'Sonnerie minor beat',
            null);
    }

    destroy() {
        this._clearTimeout();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
    }
}

// --- quick settings UI ----------------------------------------------------

const SonnerieToggle = GObject.registerClass(
class SonnerieToggle extends QuickMenuToggle {
    _init(extension, scheduler) {
        super._init({
            title: 'Sonnerie',
            iconName: 'alarm-symbolic',
            toggleMode: true,
        });

        extension.getSettings().bind('enabled', this, 'checked',
            Gio.SettingsBindFlags.DEFAULT);

        this.menu.setHeader('alarm-symbolic', 'Sonnerie', '');

        let testMinor = new PopupMenu.PopupMenuItem('Test Minor Click');
        testMinor.connect('activate', () => scheduler.play(false));
        this.menu.addMenuItem(testMinor);

        let testMajor = new PopupMenu.PopupMenuItem('Test Major Click');
        testMajor.connect('activate', () => scheduler.play(true));
        this.menu.addMenuItem(testMajor);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let prefs = new PopupMenu.PopupMenuItem('Preferences');
        prefs.connect('activate', () => extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    setStatus(text) {
        this.subtitle = text;
        this.menu.setHeader('alarm-symbolic', 'Sonnerie', text);
    }
});

const SonnerieIndicator = GObject.registerClass(
class SonnerieIndicator extends SystemIndicator {
    _init(extension) {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'alarm-symbolic';
        // Icon shows in the system block only while ticking, like
        // Caffeine's cup.
        extension.getSettings().bind('enabled', this._indicator, 'visible',
            Gio.SettingsBindFlags.GET);

        this._scheduler = new Scheduler(extension,
            text => this._toggle?.setStatus(text));
        this._toggle = new SonnerieToggle(extension, this._scheduler);
        this._scheduler.reschedule();   // now that the toggle exists

        this.quickSettingsItems.push(this._toggle);
    }

    destroy() {
        this._scheduler.destroy();
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class SonnerieExtension extends Extension {
    enable() {
        this._indicator = new SonnerieIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
