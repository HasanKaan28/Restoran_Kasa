/**
 * The "order ready" sound and buzz, made on the device: two short rising tones from Web Audio, so
 * there is no sound file to download or cache. Browsers start audio only after the person has
 * touched the page; `unlockChime` (on the first touch) prepares it so a later chime can play.
 */

type AudioContextClass = typeof AudioContext;

let context: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (context) {
    return context;
  }
  const Context: AudioContextClass | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext);
  if (!Context) {
    return undefined;
  }
  try {
    context = new Context();
  } catch {
    return undefined;
  }
  return context;
}

/** Prepares the sound on a touch of the page, which browsers ask for before any audio plays. */
export function unlockChime(): void {
  const ctx = audio();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

/** Two short tones, the second higher: heard over a busy floor, gone in under a second. */
export function playChime(): void {
  const ctx = audio();
  if (!ctx) {
    return;
  }
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    const start = ctx.currentTime + 0.02;
    [880, 1318.5].forEach((frequency, index) => {
      const at = start + index * 0.16;
      const tone = ctx.createOscillator();
      const level = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(frequency, at);
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
      level.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      tone.connect(level);
      level.connect(ctx.destination);
      tone.start(at);
      tone.stop(at + 0.5);
    });
  } catch {
    // No sound this time; the banner and the buzz still say it.
  }
}

/** A short double buzz where the device can (phones; never iOS Safari, never a desktop). */
export function buzz(): void {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    // Not allowed here: the sound and the banner still say it.
  }
}
