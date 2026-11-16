// Pasar Senja — all sound is synthesised with WebAudio. No audio files,
// no network: gunshots are filtered noise, beeps and jingles are small
// oscillator phrases, footsteps are short low thumps. The context is created
// lazily on the first user gesture (pointer lock), as browsers require.

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return context;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    const length = Math.floor(context.sampleRate * 0.5);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function unlock() {
    const ctx = ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  // distance in metres from the listener; distant sounds are quieter.
  function gainFor(distance, base) {
    if (distance === undefined) return base;
    return base * Math.max(0.08, 1 - distance / 55);
  }

  function noiseBurst({ duration, frequency, type, gain, distance }) {
    const ctx = ensure();
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type ?? 'lowpass';
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    const level = gainFor(distance, gain);
    amp.gain.setValueAtTime(level, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone({ frequency, duration, type, gain, distance, slideTo, delay = 0 }) {
    const ctx = ensure();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type ?? 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(gainFor(distance, gain), start + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  return {
    unlock,
    shot(kind, distance) {
      if (kind === 'sniper') {
        noiseBurst({ duration: 0.28, frequency: 900, gain: 0.7, distance });
        tone({ frequency: 140, duration: 0.16, type: 'sawtooth', gain: 0.25, slideTo: 55, distance });
      } else if (kind === 'smg') {
        noiseBurst({ duration: 0.09, frequency: 2400, gain: 0.4, distance });
      } else if (kind === 'pistol') {
        noiseBurst({ duration: 0.12, frequency: 1800, gain: 0.5, distance });
      } else {
        noiseBurst({ duration: 0.16, frequency: 1400, gain: 0.55, distance });
        tone({ frequency: 110, duration: 0.1, type: 'square', gain: 0.12, slideTo: 60, distance });
      }
    },
    dryFire() {
      tone({ frequency: 1400, duration: 0.04, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 900, duration: 0.05, type: 'square', gain: 0.1 });
      tone({ frequency: 600, duration: 0.05, type: 'square', gain: 0.1, delay: 0.28 });
      tone({ frequency: 1100, duration: 0.05, type: 'square', gain: 0.12, delay: 0.55 });
    },
    hit() {
      tone({ frequency: 2200, duration: 0.05, type: 'sine', gain: 0.18 });
    },
    kill() {
      tone({ frequency: 660, duration: 0.09, type: 'sine', gain: 0.2 });
      tone({ frequency: 990, duration: 0.12, type: 'sine', gain: 0.2, delay: 0.08 });
    },
    hurt() {
      tone({ frequency: 180, duration: 0.14, type: 'sawtooth', gain: 0.2, slideTo: 90 });
    },
    step(distance) {
      noiseBurst({ duration: 0.06, frequency: 320, gain: 0.14, distance });
    },
    plantBeep() {
      tone({ frequency: 880, duration: 0.09, type: 'square', gain: 0.16 });
    },
    bombTick() {
      tone({ frequency: 1200, duration: 0.06, type: 'square', gain: 0.14 });
    },
    explosion(distance) {
      noiseBurst({ duration: 1.1, frequency: 420, gain: 0.9, distance });
      tone({ frequency: 70, duration: 0.9, type: 'sine', gain: 0.5, slideTo: 32, distance });
    },
    buy() {
      tone({ frequency: 1040, duration: 0.07, type: 'sine', gain: 0.16 });
      tone({ frequency: 1560, duration: 0.1, type: 'sine', gain: 0.16, delay: 0.07 });
    },
    denied() {
      tone({ frequency: 220, duration: 0.12, type: 'square', gain: 0.14 });
    },
    roundWin() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ frequency: f, duration: 0.22, type: 'triangle', gain: 0.18, delay: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262, 196].forEach((f, i) => tone({ frequency: f, duration: 0.24, type: 'triangle', gain: 0.16, delay: i * 0.12 }));
    },
  };
}
