#!/usr/bin/env python3
"""Synthesize the bundled Sonnerie sound palette (pure stdlib, no deps).

Each sound is modal synthesis: a sum of exponentially decaying sine
partials whose frequency ratios come from the physics of the instrument
(tubular-bell transverse modes, marimba bar tuning, church-bell partials),
plus a short noise transient for the strike. The woodblock and claves add
a fast downward pitch chirp on the fundamental, which is what makes a
struck block sound "hollow" rather than "beepy".

Writes src/sounds/<name>.wav for every entry in PALETTE. Re-run via
`make sounds`; audition with `make listen`.
"""

import math
import os
import struct
import wave

RATE = 48000


def add_partial(buf, freq, amp, decay, onset=0.0, chirp=0.0, chirp_rate=350.0):
    """Add one decaying sine partial to the sample buffer.

    chirp: initial fractional frequency excess (0.6 = starts 60% sharp),
    decaying at chirp_rate per second -- phase-accumulated so the sweep
    is continuous.
    """
    start = int(onset * RATE)
    phase = 0.0
    for i in range(start, len(buf)):
        t = (i - start) / RATE
        f = freq * (1.0 + chirp * math.exp(-chirp_rate * t))
        phase += 2 * math.pi * f / RATE
        buf[i] += amp * math.exp(-decay * t) * math.sin(phase)


def add_noise(buf, amp, decay, onset=0.0):
    """Add a decaying pseudo-noise strike transient (deterministic)."""
    start = int(onset * RATE)
    state = 0x2545F4914F6CDD1D
    for i in range(start, len(buf)):
        t = (i - start) / RATE
        state = (state * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        r = (state >> 40) / (1 << 23) - 1.0
        buf[i] += amp * math.exp(-decay * t) * r


def render(duration, partials, noise=None, attack=0.002):
    buf = [0.0] * int(duration * RATE)
    for p in partials:
        add_partial(buf, **p)
    for nz in noise or []:
        add_noise(buf, **nz)
    a = max(1, int(attack * RATE))
    for i in range(min(a, len(buf))):
        buf[i] *= i / a
    r = max(1, int(0.01 * RATE))
    n = len(buf)
    for i in range(min(r, n)):
        buf[n - 1 - i] *= i / r
    peak = max(abs(s) for s in buf) or 1.0
    return [s * 0.85 / peak for s in buf]


def P(freq, amp, decay, **kw):
    return dict(freq=freq, amp=amp, decay=decay, **kw)


# ---------------------------------------------------------------------------
# The palette. Short/dry sounds suit the minor beat; long/tonal ones the
# major beat, but nothing enforces that split.
# ---------------------------------------------------------------------------

PALETTE = {
    # Hollow struck block: inharmonic modes, strong pitch drop, ~90 ms.
    'woodblock': dict(
        duration=0.09,
        partials=[
            P(820, 1.0, 55, chirp=0.6, chirp_rate=350),
            P(1560, 0.45, 90),
            P(2660, 0.28, 130),
            P(3400, 0.12, 160),
        ],
        noise=[dict(amp=0.40, decay=600)],
    ),
    # Bright hardwood "tock", nearly pure and very short.
    'claves': dict(
        duration=0.05,
        partials=[
            P(2450, 1.0, 140, chirp=0.3, chirp_rate=500),
            P(3675, 0.20, 200),
        ],
        noise=[dict(amp=0.15, decay=900)],
    ),
    # Mechanical clock escapement tick: mostly transient.
    'tick': dict(
        duration=0.035,
        partials=[
            P(4200, 0.5, 250),
            P(950, 0.6, 180),
        ],
        noise=[dict(amp=1.0, decay=700)],
        attack=0.0005,
    ),
    # Soft-mallet marimba bar, C5; bar tuning ratios ~1 : 3.9 : 9.2.
    'marimba': dict(
        duration=0.45,
        partials=[
            P(523.25, 1.0, 9),
            P(523.25 * 3.93, 0.35, 30),
            P(523.25 * 9.2, 0.12, 60),
        ],
        noise=[dict(amp=0.05, decay=300)],
        attack=0.004,
    ),
    # Small bell, slightly detuned upper partials (the original major).
    'bell': dict(
        duration=0.9,
        partials=[
            P(660.0, 1.0, 5.0),
            P(1327.0, 0.55, 8.0),
            P(1986.0, 0.28, 12.0),
            P(2644.0, 0.15, 40.0),
        ],
        noise=[dict(amp=0.10, decay=250)],
    ),
    # Tubular chime, A3 fundamental; transverse-bar mode ratios
    # 1 : 2.76 : 5.40 : 8.93 (the 2.76 mode carries the strike tone).
    'chime': dict(
        duration=2.2,
        partials=[
            P(220.0, 0.6, 2.2),
            P(220.0 * 2.76, 1.0, 3.0),
            P(220.0 * 5.40, 0.5, 5.0),
            P(220.0 * 8.93, 0.25, 8.0),
        ],
        noise=[dict(amp=0.06, decay=200)],
        attack=0.003,
    ),
    # Two-note doorbell: E5 then C5, second strike 0.35 s later.
    'dingdong': dict(
        duration=1.4,
        partials=[
            P(659.25, 1.0, 6),
            P(659.25 * 2, 0.25, 14),
            P(523.25, 1.0, 5, onset=0.35),
            P(523.25 * 2, 0.25, 12, onset=0.35),
        ],
        noise=[dict(amp=0.05, decay=400),
               dict(amp=0.05, decay=400, onset=0.35)],
        attack=0.003,
    ),
    # Deep slow bell, G3 with hum tone and minor-third partial.
    'bourdon': dict(
        duration=3.0,
        partials=[
            P(98.0, 0.40, 2.5),
            P(196.0, 1.0, 3.5),
            P(233.1, 0.50, 4.0),
            P(293.7, 0.35, 5.0),
            P(392.0, 0.25, 6.0),
            P(523.3, 0.12, 9.0),
        ],
        noise=[dict(amp=0.05, decay=180)],
        attack=0.004,
    ),
}


def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(
            b"".join(struct.pack("<h", int(s * 32767)) for s in samples)
        )
    print(f"wrote {path} ({len(samples) / RATE:.2f}s)")


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "src", "sounds")
    os.makedirs(out, exist_ok=True)
    for name, spec in PALETTE.items():
        write_wav(os.path.join(out, f"{name}.wav"), render(**spec))


if __name__ == "__main__":
    main()
