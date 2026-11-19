// audio.js — the whole sound of Solano Bay from one WebAudio graph: engine,
// sirens, gunfire and crashes as synthesised effects, and a three-station
// radio whose tracks are small step-sequenced compositions, switched live.
// Nothing is loaded: every sound is made from oscillators and noise here.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const STATIONS = [
  {
    name: 'Onda 98.1 FM',
    tag: 'Latin pop',
    tracks: [
      {
        title: 'Brisa de Neón', artist: 'Luna Cabrera', bpm: 98,
        bass: [45, null, 45, null, 52, null, 45, null, 41, null, 41, null, 48, null, 41, null],
        chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
        lead: [69, null, 72, null, 76, null, 72, null, 69, null, 67, null, 69, null, null, null,
               65, null, 69, null, 72, null, 69, null, 64, null, 62, null, 64, null, null, null],
      },
      {
        title: 'Medianoche en Solano', artist: 'Los Faros', bpm: 92,
        bass: [43, null, 43, null, 50, null, 43, null, 48, null, 48, null, 55, null, 48, null],
        chords: [[55, 59, 62], [53, 57, 60], [48, 52, 55], [50, 54, 57]],
        lead: [67, null, null, 71, null, 74, null, null, 72, null, 69, null, 67, null, null, null,
               69, null, null, 72, null, 76, null, null, 74, null, 71, null, 67, null, null, null],
      },
    ],
  },
  {
    name: 'Pulso 104.7',
    tag: 'Synthwave',
    tracks: [
      {
        title: 'Neon Tide', artist: 'Vektor Azul', bpm: 114,
        bass: [45, 45, null, 45, 45, null, 45, 57, 41, 41, null, 41, 41, null, 53, 53],
        chords: [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
        lead: [76, null, 79, null, 76, null, 72, null, 74, null, 76, null, null, null, null, null,
               81, null, 79, null, 76, null, 74, null, 72, null, 74, null, null, null, null, null],
      },
      {
        title: 'Chrome Palms', artist: 'DJ Meridiano', bpm: 118,
        bass: [38, 38, null, 38, 38, null, 50, 38, 41, 41, null, 41, 41, null, 53, 55],
        chords: [[50, 53, 57], [50, 53, 57], [53, 57, 60], [55, 59, 62]],
        lead: [74, 74, null, 77, null, 74, null, 70, null, 74, null, 72, null, null, null, null,
               69, null, 72, null, 74, null, 77, null, 79, null, 77, null, 74, null, null, null],
      },
    ],
  },
  {
    name: 'Radio Faro 91.3',
    tag: 'Jazz lounge',
    tracks: [
      {
        title: 'Café con Sal', artist: 'Trío Miramar', bpm: 76,
        bass: [50, null, null, 57, null, null, 47, null, null, 54, null, null, 52, null, 57, null],
        chords: [[62, 66, 69, 73], [59, 62, 66, 69], [64, 67, 71, 74], [57, 61, 64, 67]],
        lead: [74, null, null, null, 73, null, 69, null, null, null, null, 66, null, null, null, null,
               71, null, null, 69, null, 67, null, null, 64, null, null, null, null, null, null],
      },
      {
        title: 'Blue Bahía', artist: 'Elena Vidal', bpm: 72,
        bass: [45, null, null, 52, null, null, 41, null, null, 48, null, null, 43, null, 50, null],
        chords: [[57, 61, 64, 68], [53, 57, 60, 64], [55, 59, 62, 66], [52, 55, 59, 62]],
        lead: [69, null, null, 76, null, null, 72, null, null, 69, null, null, null, null, null, null,
               67, null, null, 71, null, null, 74, null, null, 71, null, 67, null, null, null, null],
      },
    ],
  },
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.liveNodes = 0;
    this.radioOn = false;
    this.station = 0;
    this.trackIndex = 0;
    this.step = 0;
    this.nextStepTime = 0;
    this.timer = null;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.4;
    this.music.connect(this.master);
    // Shared noise buffer for shots, hats and crashes.
    const len = ctx.sampleRate * 1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.buildEngine();
    this.buildSiren();
  }

  track(node) {
    this.liveNodes++;
    node.onended = () => { this.liveNodes--; };
    return node;
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfx);
    this.engineOsc.start();
    this.engineSub.start();
  }

  setEngine(on, rpm01, load) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = on ? 0.05 + load * 0.05 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.09);
    const f = 55 + rpm01 * 165;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineSub.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + rpm01 * 900, t, 0.1);
  }

  buildSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 800;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.55;
    this.sirenLfoGain = ctx.createGain();
    this.sirenLfoGain.gain.value = 160;
    this.sirenLfo.connect(this.sirenLfoGain);
    this.sirenLfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfx);
    this.sirenOsc.start();
    this.sirenLfo.start();
  }

  setSiren(level) {
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(Math.min(0.16, level), this.ctx.currentTime, 0.15);
  }

  blip(freq = 880, dur = 0.09, gain = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = this.track(ctx.createOscillator());
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  sting() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.22, 0.14), i * 110);
    });
  }

  gunshot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfx);
    src.start(ctx.currentTime, Math.random() * 0.4, 0.16);
  }

  crash(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * strength, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfx);
    src.start(ctx.currentTime, Math.random() * 0.4, 0.32);
  }

  // ------------------------------------------------------------- radio
  currentTrack() {
    return STATIONS[this.station].tracks[this.trackIndex];
  }

  setRadio(on) {
    this.radioOn = on;
    if (!this.ctx) return;
    if (on && !this.timer) {
      this.step = 0;
      this.nextStepTime = this.ctx.currentTime + 0.06;
      this.timer = setInterval(() => this.schedule(), 46);
    } else if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.trackIndex = 0;
    this.step = 0;
    if (this.ctx && this.radioOn) this.nextStepTime = this.ctx.currentTime + 0.05;
    return STATIONS[this.station];
  }

  prevStation() {
    this.station = (this.station + STATIONS.length - 1) % STATIONS.length;
    this.trackIndex = 0;
    this.step = 0;
    if (this.ctx && this.radioOn) this.nextStepTime = this.ctx.currentTime + 0.05;
    return STATIONS[this.station];
  }

  schedule() {
    if (!this.ctx || !this.radioOn) return;
    const track = this.currentTrack();
    const stepDur = 60 / track.bpm / 4;
    while (this.nextStepTime < this.ctx.currentTime + 0.16) {
      this.playStep(track, this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step++;
      if (this.step >= 64) {
        this.step = 0;
        this.trackIndex = (this.trackIndex + 1) % STATIONS[this.station].tracks.length;
      }
    }
  }

  note(freq, time, dur, type, gain, dest) {
    const ctx = this.ctx;
    const o = this.track(ctx.createOscillator());
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g);
    g.connect(dest || this.music);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  hat(time, gain) {
    const ctx = this.ctx;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.music);
    src.start(time, Math.random() * 0.5, 0.05);
  }

  playStep(track, step, time, stepDur) {
    const bar = Math.floor(step / 16) % 4;
    const inBar = step % 16;
    const bassNote = track.bass[inBar];
    if (bassNote != null) this.note(mtof(bassNote), time, stepDur * 1.8, 'triangle', 0.30);
    if (inBar === 0) {
      for (const n of track.chords[bar]) this.note(mtof(n), time, stepDur * 14, 'sawtooth', 0.045);
    }
    const leadNote = track.lead[step % 32];
    if (leadNote != null && step % 2 === 0) this.note(mtof(leadNote), time, stepDur * 2.4, 'square', 0.06);
    if (step % 4 === 2) this.hat(time, 0.05);
    if (step % 16 === 0) this.hat(time, 0.09);
  }

  state() {
    const st = STATIONS[this.station];
    const tr = this.currentTrack();
    return {
      running: !!this.ctx && this.ctx.state === 'running',
      ctxState: this.ctx ? this.ctx.state : 'none',
      radioOn: this.radioOn,
      station: this.station,
      stationName: st.name,
      track: tr.title,
      artist: tr.artist,
      liveNodes: this.liveNodes,
      hasEngine: !!this.engineOsc,
      hasSiren: !!this.sirenOsc,
    };
  }
}
