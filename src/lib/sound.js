let ctx;

/** Dos tonos cortos tipo "ding-dong" (sin archivos de audio). */
export function beep() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [660, 0.22]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + d;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.start(t);
      o.stop(t + 0.34);
    });
  } catch {
    /* audio no disponible */
  }
}

/** Anuncia el turno por voz: "Turno T R 0 4 5, pase a Consultorio 1". */
export function announce(code, dest) {
  try {
    if (!('speechSynthesis' in window)) return;
    const spoken = code.replace('TR-', 'T R ').split('').join(' ').replace(/\s+/g, ' ');
    const u = new SpeechSynthesisUtterance(`Turno ${spoken}. Pase a ${dest}.`);
    u.lang = 'es-PE';
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* voz no disponible */
  }
}
