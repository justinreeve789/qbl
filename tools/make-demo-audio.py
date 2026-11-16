"""Synthesise the demo scenario's audio so the repo ships with no third-party sound files.

    python3 tools/make-demo-audio.py scenarios/assets/starship/audio

Loops are built only from components that complete a whole number of cycles
over the loop length, so they repeat without a click.
"""
import sys, wave
import numpy as np

RATE = 22050
out_dir = sys.argv[1]

def save(name, samples):
    samples = samples / max(1e-9, np.max(np.abs(samples))) * 0.8
    with wave.open(f"{out_dir}/{name}", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((samples * 32767).astype("<i2").tobytes())

def loop_time(seconds):
    return np.arange(int(RATE * seconds)) / RATE

def snap(freq, seconds):
    """Nearest frequency with a whole number of cycles in the loop."""
    return round(freq * seconds) / seconds

def plucks(t, seconds, notes, decay):
    """Soft bell notes. Each fades out before the loop ends, so the loop stays seamless."""
    y = np.zeros_like(t)
    for start, freq, gain in notes:
        local = t - start
        env = np.where(local >= 0, np.exp(-np.maximum(local, 0) * decay), 0.0)
        y += gain * env * (np.sin(2 * np.pi * freq * local) + 0.3 * np.sin(2 * np.pi * freq * 2 * local))
    return y

# --- planet: a slow, airy pad over four chords with a few bell notes -----------------
L = 16.0
t = loop_time(L)
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 207.65, 246.94)]
pad = np.zeros_like(t)
for i, chord in enumerate(chords):
    centre = (i + 0.5) * L / 4
    # Raised-cosine window, wrapped around the loop so the last chord blends into the first.
    d = np.minimum(np.abs(t - centre), L - np.abs(t - centre))
    win = np.where(d < L / 4, 0.5 * (1 + np.cos(np.pi * d / (L / 4))), 0.0)
    for f in chord:
        f = snap(f, L)
        pad += win * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * snap(f * 1.005, L) * t) + 0.2 * np.sin(2 * np.pi * f * 2 * t))
shimmer = 1 + 0.15 * np.sin(2 * np.pi * (3 / L) * t)
bells = plucks(t, L, [(0.5, 659.25, .5), (2.5, 880.0, .35), (4.5, 523.25, .5), (6.5, 698.46, .35),
                      (8.5, 587.33, .5), (10.5, 783.99, .35), (12.2, 493.88, .5), (13.4, 659.25, .3)], 2.2)
save("planet-ambience.wav", pad * shimmer * 0.5 + bells)

# --- starship: engine drone with a pulsing overtone and a quiet console blip ----------
L = 12.0
t = loop_time(L)
drone = sum(g * np.sin(2 * np.pi * snap(f, L) * t) for f, g in [(55, 1.0), (82.5, .5), (110, .45), (165, .2), (220, .12)])
throb = 1 + 0.25 * np.sin(2 * np.pi * (6 / L) * t)
air = np.sin(2 * np.pi * snap(330, L) * t) * (0.5 + 0.5 * np.sin(2 * np.pi * (1 / L) * t)) * 0.08
blips = plucks(t, L, [(1.0, 1318.5, .12), (1.25, 1568.0, .12), (7.0, 1174.7, .12), (7.25, 1318.5, .12)], 9.0)
save("starship-hum.wav", drone * throb * 0.6 + air + blips)

# --- rocket launch: a rumble that swells and tails off (one-shot) ----------------------
L = 3.6
t = loop_time(L)
rng = np.random.default_rng(7)
noise = rng.standard_normal(t.size)
rumble = np.cumsum(noise); rumble -= np.linspace(rumble[0], rumble[-1], rumble.size)      # brown noise
rumble = rumble / np.max(np.abs(rumble))
hiss = np.convolve(noise, np.ones(6) / 6, mode="same") * 0.25
env = np.minimum(t / 1.1, 1.0) ** 2 * np.minimum((L - t) / 1.4, 1.0)
tone = np.sin(2 * np.pi * (60 + 50 * t) * t) * 0.3
save("rocket-launch.wav", (rumble + hiss + tone) * env)
