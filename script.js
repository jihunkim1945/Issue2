/* =============================================================
   WATCHMAN — ISSUE 02 — SURVEILLANCE
   script.js  (vanilla JS, no libraries)

   01 UTILITIES
   02 SOUND (optional, off by default)
   03 PLACEHOLDER FOOTAGE — procedural CCTV scenes
   04 FEED SYSTEM — createFeed / feedBox / switchCamera
   05 TRACKING OVERLAYS — createTracker
   06 METADATA — typing, tooltip, viewer
   07 CORRUPTED STATES
   08 STORY DATA — cameras, fragments, subjects, eras
   09 CITY MAP (network + age stages)
   10 STAGES — one object per stage, in story order
   11 NAVIGATION + BOOT

   HOW TO REPLACE PLACEHOLDER FOOTAGE
   Every camera in CAMS (section 08) can take   src: 'assets/video/cam03.mp4'
   or                                            src: 'assets/images/cam03.jpg'
   When src is set, a real <video>/<img> is used instead of the generated
   canvas scene. Tracking boxes then use cam.figs (normalised boxes, 0–1).

   DEV SHORTCUT: open index.html#stage=5 to jump to a stage (0–11).
   ============================================================= */
'use strict';


/* ---------- 01 UTILITIES ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pad = (n, l = 2) => String(n).padStart(l, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, min, max) => min + ((((v - min) % (max - min)) + (max - min)) % (max - min));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}

// small seeded random generator → the same camera always shows the same "place"
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtClock(sec) {
  sec = ((Math.floor(sec) % 86400) + 86400) % 86400;
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}

// what the visitor has done — used later by the REVERSAL stage (nothing leaves the page)
const STATE = { start: Date.now(), clicks: 0, feedsOpened: 0, filesOpened: 0, nodesInspected: 0, max: 0 };
const elapsed = () => (Date.now() - STATE.start) / 1000;
const ARCHIVE_START = 23 * 3600 + 41 * 60 + 8;          // archive clock starts at 23:41:08

// every stage change bumps RUN; running sequences check it and stop (see sleep)
const CANCEL = Symbol('cancel');
let RUN = 0;
let stageTimers = [];
function every(ms, fn) { const id = setInterval(fn, ms); stageTimers.push(() => clearInterval(id)); return id; }
function later(ms, fn) { const id = setTimeout(fn, ms); stageTimers.push(() => clearTimeout(id)); return id; }
function clearStageTimers() { stageTimers.forEach(f => f()); stageTimers = []; }
async function sleep(ms, tk) { await wait(ms); if (tk !== undefined && tk !== RUN) throw CANCEL; }
const quiet = e => { if (e !== CANCEL) console.error(e); };

// live clocks: any element with data-clock="<seconds>" keeps running
function tickClocks() {
  const e = elapsed();
  $$('[data-clock]').forEach(n => { n.textContent = fmtClock(+n.dataset.clock + e); });
}


/* ---------- 02 SOUND ----------
   Everything is synthesised with Web Audio — no files needed.
   To use recorded sound instead, put files in /assets/audio and
   play them inside Sound.blip / Sound.burst. */
/* background music — a tape loop under everything.
   Browsers only allow sound after the visitor has clicked something, so it fades in on the first click.
   The SOUND button turns it on / off. REPLACE: src, volume. */
const Music = {
  src: 'assets/audio/tape-emission.wav',
  volume: .45,          // 0–1
  el: null, on: true, playing: false, fadeT: 0,
  start() {
    if (!this.on || this.playing) return;
    const a = (this.el ||= Object.assign(new Audio(this.src), { loop: true, volume: 0, preload: 'auto' }));
    this.playing = true;
    a.play().then(() => this.fade(this.volume)).catch(() => { this.playing = false; });
  },
  fade(to, ms = 1800) {
    const a = this.el; if (!a) return;
    cancelAnimationFrame(this.fadeT);
    const from = a.volume, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      a.volume = from + (to - from) * p;
      if (p < 1) this.fadeT = requestAnimationFrame(step);
      else if (to === 0) { a.pause(); this.playing = false; }
    };
    this.fadeT = requestAnimationFrame(step);
  },
  toggle() {
    this.on = !this.on;
    if (this.on) this.start(); else this.fade(0, 600);
    return this.on;
  },
};

const Sound = {
  on: false, ctx: null, master: null, noiseBuf: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // electrical hum
    const hum = ctx.createGain(); hum.gain.value = 0.05; hum.connect(this.master);
    [[50, .5], [100, .25], [150, .08]].forEach(([f, v]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = v; o.connect(g).connect(hum); o.start();
    });

    // low static bed
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = .7;
    const ng = ctx.createGain(); ng.gain.value = .012;
    n.connect(bp).connect(ng).connect(this.master); n.start();
  },

  toggle() {
    this.init();
    if (!this.ctx) return false;
    this.on = !this.on;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.on ? .8 : 0, this.ctx.currentTime, .2);
    return this.on;
  },

  blip(freq = 880, dur = .06, type = 'square', vol = .035) {
    if (!this.on) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + .02);
  },
  click() { this.blip(2600, .012, 'square', .02); },
  burst(dur = .25, vol = .07) {                       // camera switch static
    if (!this.on) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    s.buffer = this.noiseBuf;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(hp).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur);
  },
};


/* ---------- 03 PLACEHOLDER FOOTAGE ----------
   Each scene draws one low-resolution frame onto a canvas and returns
   the people it drew as normalised boxes {x, y, w, h} (0–1). The tracking
   overlay uses those boxes. Replace any of these with real footage via cam.src. */

const NOISE = [];
function makeNoise() {
  for (let k = 0; k < 6; k++) {
    const c = el('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < .5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 80;
    }
    x.putImageData(img, 0, 0);
    NOISE.push(c);
  }
  // an opaque noise tile for CSS (static flashes, paper grime)
  const c = el('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--noise-img', `url(${c.toDataURL()})`);
}

// drawing helpers
function bg(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function glow(ctx, x, y, r, a = .8) {                  // blown highlight
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(.25, `rgba(255,255,255,${a * .45})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }
function lighter(ctx, fn) { ctx.globalCompositeOperation = 'lighter'; fn(); ctx.globalCompositeOperation = 'source-over'; }

// a walking silhouette; (x, y) = feet, s = height in px
function figure(ctx, x, y, s, t, o = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const sw = o.walking === false ? 0 : Math.sin(t * 7 + (o.phase || 0) * 1.7);
  ctx.fillStyle = o.color || '#050505';
  ctx.beginPath(); ctx.arc(x, y - s * .89, s * .085, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - s * .12, y - s * .8, s * .24, s * .44);
  ctx.fillRect(x - s * .1 + sw * s * .05, y - s * .38, s * .085, s * .38);
  ctx.fillRect(x + s * .015 - sw * s * .05, y - s * .38, s * .085, s * .38);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(x - s * .15, y - 1, s * .4, Math.max(1, s * .03));
  return { x: (x - s * .17) / W, y: (y - s) / H, w: (s * .34) / W, h: s / H, label: o.label };
}

function alleyBase(ctx, w, h) {
  bg(ctx, w, h, '#101010', '#2a2a2a');
  ctx.fillStyle = '#5a5a5a'; ctx.fillRect(w * .42, h * .12, w * .16, h * .54);          // far opening
  ctx.fillStyle = '#0a0a0a'; poly(ctx, [[0, 0], [w * .42, h * .12], [w * .42, h * .66], [0, h]]);
  ctx.fillStyle = '#131313'; poly(ctx, [[w, 0], [w * .58, h * .12], [w * .58, h * .66], [w, h]]);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for (let i = 1; i < 9; i++) {
    const k = i / 9;
    line(ctx, 0, h * k, w * .42, h * .12 + h * .54 * k);
    line(ctx, w, h * k, w * .58, h * .12 + h * .54 * k);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.22)';                                          // fire escape
  for (let i = 0; i < 4; i++) {
    const y = h * (.15 + i * .13);
    line(ctx, w * .62, y + h * .02, w * .9, y - h * .05);
    line(ctx, w * .62, y + h * .02, w * .62, y + h * .1);
  }
  ctx.fillStyle = '#1d1d1d'; ctx.fillRect(w * .7, h * .45, w * .09, h * .3);            // service door
  ctx.fillStyle = '#303030'; poly(ctx, [[w * .42, h * .66], [w * .58, h * .66], [w, h], [0, h]]);
  ctx.fillStyle = '#070707'; ctx.fillRect(w * .08, h * .7, w * .18, h * .16);           // dumpster
  lighter(ctx, () => { glow(ctx, w * .74, h * .4, h * .35, .85); glow(ctx, w * .6, h * .9, h * .4, .15); });
}

const SCENES = {
  // street at night: buildings, road, a passing car, pedestrians. figs[0] = "the subject"
  street(ctx, w, h, t, p) {
    bg(ctx, w, h, '#141414', '#2e2e2e');
    const hy = h * (.34 + p[0] * .1), vx = w * (.3 + p[1] * .4);
    ctx.fillStyle = '#080808';
    for (let i = 0; i < 7; i++) {
      const bx = (p[i + 2] * 1.2 - .1) * w, bw = w * (.08 + p[i + 9] * .16), top = hy - h * (.08 + p[i + 16] * .3);
      ctx.fillRect(bx, top, bw, hy - top + 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i < 12; i++) if (p[(i * 5) % 32] > .5) ctx.fillRect(p[(i * 3 + 1) % 32] * w, hy - p[(i * 7 + 2) % 32] * h * .25, Math.max(1, w / 160), Math.max(1, h / 120));
    ctx.fillStyle = '#3b3b3b';
    poly(ctx, [[vx - 1, hy], [vx + 1, hy], [w * 1.4, h], [-w * .4, h]]);
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = Math.max(1, w / 300);
    line(ctx, vx, hy, -w * .1, h); line(ctx, vx, hy, w * 1.1, h);
    ctx.setLineDash([w * .03, w * .04]); line(ctx, vx, hy, w * .5, h); ctx.setLineDash([]);
    lighter(ctx, () => { glow(ctx, w * p[20], hy - h * .06, h * .22, .8); glow(ctx, w * (.2 + p[21] * .6), h * .85, h * .55, .22); });

    const dir = p[22] > .5 ? 1 : -1;
    const cx = wrap(p[23] * w * 3 + t * w * .22 * dir, -w * .6, w * 1.6), cy = h * (.6 + p[24] * .12);
    ctx.fillStyle = '#060606';
    ctx.fillRect(cx, cy, w * .24, h * .08); ctx.fillRect(cx + w * .05, cy - h * .05, w * .13, h * .06);
    lighter(ctx, () => glow(ctx, dir > 0 ? cx + w * .24 : cx, cy + h * .03, h * .12, .9));

    const n = 2 + Math.floor(p[25] * 3), people = [];
    for (let i = 0; i < n; i++) {
      const sp = i === 0 ? .035 : (.02 + p[(26 + i) % 32] * .05) * (i % 2 ? -1 : 1);
      const d = i === 0 ? .82 : .35 + p[(i * 3 + 4) % 32] * .5;
      people.push({ x: wrap(p[(i * 5 + 3) % 32] * w + t * sp * w, -w * .15, w * 1.15), d, i });
    }
    people.sort((a, b) => a.d - b.d);
    const figs = [];
    people.forEach(o => { figs[o.i] = figure(ctx, o.x, hy + (h - hy) * o.d, h * (.1 + o.d * .32), t, { phase: o.i }); });
    return figs;
  },

  alley(ctx, w, h, t, p) {
    alleyBase(ctx, w, h);
    const figs = [];
    if (p[5] > .35) {
      const d = wrap(t * .04 + p[6], 0, 1);
      figs.push(figure(ctx, w * (.45 + p[7] * .1), h * (.66 + d * .3), h * (.15 + d * .45), t));
    }
    return figs;
  },

  platform(ctx, w, h, t, p) {
    bg(ctx, w, h, '#0c0c0c', '#1e1e1e');
    lighter(ctx, () => {
      for (let i = 0; i < 5; i++) {
        const x = w * (.1 + i * .2);
        ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x, h * .08, w * .08, h * .015);
        glow(ctx, x + w * .04, h * .1, h * .18, .35);
      }
    });
    ctx.fillStyle = '#040404'; ctx.fillRect(0, h * .38, w, h * .16);
    const cyc = wrap(t + p[3] * 20, 0, 22);                                   // train passes every ~22 s
    if (cyc < 4) {
      const x = (cyc / 4) * w * 2.2 - w * 1.2;
      ctx.fillStyle = '#8a8a8a'; ctx.fillRect(x, h * .18, w * 1.2, h * .34);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 8; i++) ctx.fillRect(x + i * w * .15 + w * .02, h * .24, w * .09, h * .08);
    }
    ctx.fillStyle = '#4a4a4a'; ctx.fillRect(0, h * .54, w, h * .46);
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, h * .54, w, Math.max(1, h * .012));
    ctx.fillStyle = '#151515';
    for (let i = 0; i < 4; i++) ctx.fillRect(w * (.12 + i * .26 + p[i] * .03), 0, w * .05, h * .62);
    const figs = [], n = 1 + Math.floor(p[10] * 3);
    for (let i = 0; i < n; i++) {
      const sway = Math.sin(t * .5 + i) * w * .004;
      figs.push(figure(ctx, w * (.2 + p[11 + i] * .6) + sway, h * (.8 + p[14 + i] * .15), h * (.38 + p[17 + i] * .12), t, { walking: false }));
    }
    return figs;
  },

  // top-down: intersection / plaza / rooftop view
  overhead(ctx, w, h, t, p) {
    bg(ctx, w, h, '#2c2c2c', '#262626');
    const ry = h * (.35 + p[0] * .2), rx = w * (.3 + p[1] * .3);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, ry, w, h * .22); ctx.fillRect(rx, 0, w * .18, h);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (let i = 0; i < 6; i++) ctx.fillRect(rx - w * .05, ry + i * h * .037, w * .04, h * .018);
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([w * .03, w * .03]); line(ctx, 0, ry + h * .11, w, ry + h * .11); ctx.setLineDash([]);
    for (let i = 0; i < 2; i++) {
      const x = wrap(p[2 + i] * w * 2 + t * w * .18 * (i ? -1 : 1), -w * .3, w * 1.3);
      ctx.fillStyle = i ? '#bdbdbd' : '#050505'; ctx.fillRect(x, ry + h * (i ? .13 : .03), w * .1, h * .06);
    }
    const figs = [], n = 3 + Math.floor(p[4] * 4);
    for (let i = 0; i < n; i++) {
      const ang = p[(i * 3 + 5) % 32] * Math.PI * 2, sp = .015 + p[(i * 3 + 6) % 32] * .03;
      const x = wrap(p[(i * 3 + 7) % 32] * w + Math.cos(ang) * t * sp * w, 0, w);
      const y = wrap(p[(i * 5 + 8) % 32] * h + Math.sin(ang) * t * sp * h, 0, h);
      const r = Math.max(1.5, h * .025);
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(x + r * .8, y + r * .6, r * 1.3, r * .8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = i % 3 ? '#060606' : '#cfcfcf'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      figs.push({ x: (x - r * 2.5) / w, y: (y - r * 2.5) / h, w: (r * 5) / w, h: (r * 5) / h });
    }
    return figs;
  },

  corridor(ctx, w, h, t, p) {
    bg(ctx, w, h, '#161616', '#0c0c0c');
    const vx = w * (.45 + p[0] * .1), vy = h * .42;
    ctx.fillStyle = '#262626'; poly(ctx, [[0, h], [vx - w * .06, vy + h * .08], [vx + w * .06, vy + h * .08], [w, h]]);
    ctx.fillStyle = '#0b0b0b'; poly(ctx, [[0, 0], [vx - w * .06, vy - h * .08], [vx - w * .06, vy + h * .08], [0, h]]);
    ctx.fillStyle = '#131313'; poly(ctx, [[w, 0], [vx + w * .06, vy - h * .08], [vx + w * .06, vy + h * .08], [w, h]]);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(vx - w * .06, vy - h * .08, w * .12, h * .16);
    lighter(ctx, () => {
      for (let i = 0; i < 4; i++) {
        const k = Math.pow(.62, i), y = vy - (vy - h * .02) * k, lw = w * .18 * k;
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(vx - lw / 2, y, lw, Math.max(1, h * .02 * k));
        glow(ctx, vx, y + h * .05 * k, h * .3 * k, .3);
      }
      glow(ctx, vx, h * .95, h * .4, .12);
    });
    const figs = [];
    if (p[3] > .2) {
      const d = wrap(t * .05 + p[4], 0, 1);
      figs.push(figure(ctx, vx + (p[5] - .5) * w * .2 * d, vy + h * .08 + h * .55 * d, h * (.12 + d * .62), t));
    }
    return figs;
  },

  // REVERSAL: a camera behind the visitor, looking at them looking at the wall
  room(ctx, w, h, t) {
    bg(ctx, w, h, '#020202', '#0a0a0a');
    const cols = 12, rows = 6, mw = w * .065, mh = mw * .56, gx = w * .012;
    const ox = (w - cols * (mw + gx)) / 2, oy = h * .06;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const b = .35 + .3 * Math.sin(t * 1.3 + r * 2.1 + c * 1.7) + (Math.random() < .02 ? .4 : 0);
      ctx.fillStyle = `rgba(225,225,225,${clamp(b, .08, .95)})`;
      ctx.fillRect(ox + c * (mw + gx) + (r % 2 ? mw * .5 : 0), oy + r * (mh + gx * 1.4), mw, mh);
    }
    lighter(ctx, () => glow(ctx, w * .5, h * .35, h * .6, .18));
    ctx.fillStyle = '#070707'; ctx.fillRect(0, h * .78, w, h * .22);
    const sx = w * .5 + Math.sin(t * .4) * w * .004, hy = h * .6;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sx, h, w * .2, h * .26, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx, hy, h * .1, h * .125, 0, 0, 7); ctx.fill();
    ctx.fillRect(sx - h * .05, hy + h * .08, h * .1, h * .12);
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(sx, hy, h * .1, h * .125, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    return [{ x: (sx - w * .2) / w, y: (hy - h * .14) / h, w: .4, h: 1 - (hy - h * .14) / h }];
  },

  nosignal(ctx, w, h, t) {
    ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 1); grain(ctx, w, h, 1);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, wrap(t * h * .6, 0, h), w, h * .1);
    return [];
  },

  // old analog film: 8 fps, flicker, scratches, dust
  film(ctx, w, h, t, p) {
    const ft = Math.floor(t * 8) / 8;
    const figs = (p[31] > .5 ? SCENES.street : SCENES.alley)(ctx, w, h, ft, p);
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * .1})`; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    for (let i = 0; i < 2; i++) if (Math.random() < .5) { const x = Math.random() * w; line(ctx, x, 0, x + rand(-2, 2), h); }
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.random() * w, Math.random() * h, rand(1, 3), rand(1, 3));
    return figs;
  },

  // ISSUE 01 CAMERA 04 — Morrow Street, 2023.10.02.
  // t = seconds after 00:05:00 (0–900). Driven by the timeline, not by real time.
  morrow(ctx, w, h, t) {
    if (t >= 360 && t < 660) {                     // 00:11:00 — 00:16:00  SIGNAL LOST
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      return [];
    }
    alleyBase(ctx, w, h);
    const figs = [];
    if (t < 360) {
      // person 01 waiting by the rear entrance (later identified: Elias Vane)
      figs.push(figure(ctx, w * .64 + Math.sin(t * .3) * w * .02, h * .84, h * .42, t, { walking: false, label: 'PERSON 01' }));
      if (t >= 240) {                               // 00:09 — a second figure from the west edge
        const k = Math.min(1, (t - 240) / 110);
        figs.push(figure(ctx, w * (.04 + k * .42), h * .9, h * .46, t, { label: 'PERSON 02' }));
      }
    } else {
      ctx.fillStyle = '#040404';                   // object on the ground after the gap
      ctx.beginPath(); ctx.ellipse(w * .6, h * .87, w * .12, h * .035, -.08, 0, 7); ctx.fill();
      figs.push({ x: .47, y: .82, w: .26, h: .1, label: 'OBJECT' });
      if (t >= 780 && t < 784) {                    // 00:18:00 — under four seconds, far east edge
        figs.push(figure(ctx, w * .95, h * .72, h * .3, t, { label: 'UNKNOWN FIGURE' }));
      }
    }
    return figs;
  },
};

function grain(ctx, w, h, a) {
  ctx.save(); ctx.globalAlpha = a;
  const tile = NOISE[(Math.random() * NOISE.length) | 0];
  const ox = -((Math.random() * 128) | 0), oy = -((Math.random() * 128) | 0);
  for (let x = ox; x < w; x += 128) for (let y = oy; y < h; y += 128) ctx.drawImage(tile, x, y);
  ctx.restore();
}

// CCTV post-processing: grain, tearing, vignette
function postFX(ctx, w, h, noise = .55) {
  grain(ctx, w, h, noise);
  if (Math.random() < .025) {
    const y = Math.random() * h, bh = h * rand(.03, .12);
    ctx.drawImage(ctx.canvas, 0, y, w, bh, rand(-w * .06, w * .06), y, w, bh);
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, h * .3, w / 2, h / 2, w * .75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.65)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

const params = seed => Array.from({ length: 32 }, seeded(seed));

// placeholder portrait (subject files, face-match windows)
// look: 'face' | 'public' | 'blur' | 'none' | 'small' | 'mask'
function drawPortrait(canvas, look = 'face', seed = 1) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, r = seeded(seed);
  bg(ctx, w, h, look === 'public' ? '#8a8a8a' : '#3a3a3a', look === 'public' ? '#c8c8c8' : '#1a1a1a');
  if (look === 'none') { grain(ctx, w, h, 1); grain(ctx, w, h, 1); return; }
  const s = look === 'small' ? .75 : 1, cx = w * (.46 + r() * .08), cy = h * (.42 + (1 - s) * .15);
  ctx.fillStyle = look === 'public' ? '#e6e6e6' : '#9a9a9a';                       // shoulders
  ctx.beginPath(); ctx.ellipse(cx, h * 1.02, w * .42 * s, h * .3 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = look === 'mask' ? '#0a0a0a' : look === 'public' ? '#f0f0f0' : '#b5b5b5';
  ctx.beginPath(); ctx.ellipse(cx, cy, w * .2 * s, h * .2 * s, 0, 0, 7); ctx.fill();   // head
  ctx.fillStyle = 'rgba(0,0,0,.35)';                                                   // shadow side
  ctx.beginPath(); ctx.ellipse(cx + w * .07 * s, cy, w * .13 * s, h * .2 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = look === 'mask' ? '#ddd' : 'rgba(0,0,0,.6)';                         // eyes / mask slits
  ctx.fillRect(cx - w * .11 * s, cy - h * .03, w * .07 * s, h * .025);
  ctx.fillRect(cx + w * .04 * s, cy - h * .03, w * .07 * s, h * .025);
  if (look === 'blur') {
    const t = el('canvas'); t.width = 8; t.height = 10;
    t.getContext('2d').drawImage(canvas, 0, 0, 8, 10);
    ctx.drawImage(t, 0, 0, w, h);
  }
  grain(ctx, w, h, .8);
}

// one-off still image (used for fragments, records, portraits backgrounds)
function drawStill(canvas, scene, seed, t = rand(0, 60)) {
  const ctx = canvas.getContext('2d');
  (SCENES[scene] || SCENES.street)(ctx, canvas.width, canvas.height, t, params(seed));
  postFX(ctx, canvas.width, canvas.height, .7);
}


/* ---------- 03b REAL FOOTAGE ----------
   assets/video/cctv/cctv-01.mp4 … cctv-18.mp4 (made with tools/cctv-convert.swift).
   18 short loops are re-used for hundreds of cameras: every camera shows a different
   crop of a clip (cam.crop), some mirrored, from one of two play positions (cam.inst).
   Add more clips → raise CLIP_COUNT. Cameras without cam.clip use the generated scenes. */
const CLIP_COUNT = 18;            // (clip 19 = the eye, used only by the target camera — never on the filler screens)
const TARGET = 'CAM 04';          // REPLACE: the camera the visitor has to find (Issue 01: "Who disabled Camera 04?")
const clipPath = n => `assets/video/cctv/cctv-${pad(n)}.mp4`;

const VideoPool = {
  els: {}, box: null,
  // the <video> for clip n (1-based); inst 1 = the same clip, started half-way through
  // manual = true → a paused copy that someone else drives with currentTime (the Morrow timeline)
  get(n, inst = 0, manual = false) {
    const key = `${n}-${inst}`;
    let v = this.els[key];
    if (!v) {
      if (!this.box) {   // videos must stay "on screen" or browsers pause them — so: a 2px corner, invisible
        this.box = el('div');
        Object.assign(this.box.style, { position: 'fixed', left: 0, bottom: 0, width: '2px', height: '2px', overflow: 'hidden', opacity: .01, pointerEvents: 'none', zIndex: -1 });
        document.body.append(this.box);
      }
      v = this.els[key] = el('video');
      Object.assign(v, { muted: true, loop: !manual, playsInline: true, autoplay: !manual, preload: 'auto' });
      v.setAttribute('muted', '');
      v.src = clipPath(n);
      if (!manual) v.addEventListener('loadedmetadata', () => { if (inst) v.currentTime = v.duration * .5; v.play().catch(() => {}); });
      v.addEventListener('error', () => { v.failed = true; });
      this.box.append(v);
    }
    if (v.failed) return null;
    if (v.paused && !manual) v.play().catch(() => {});
    return v.readyState >= 2 ? v : null;
  },
};

// which part of the clip a camera shows (0–1): zoom by crop.s, then trimmed to the screen's shape (never stretched)
function cropRect(crop = {}, vw, vh, w, h) {
  const s = crop.s || 1;
  let uw = 1 / s, uh = 1 / s;
  const want = w / h, have = (uw * vw) / (uh * vh);
  if (have > want) uw *= want / have; else uh *= have / want;
  return { u0: (1 - uw) * (crop.x ?? .5), v0: (1 - uh) * (crop.y ?? .5), uw, uh };
}

// draw a crop of a clip; crop = { s: zoom ≥ 1, x, y: 0–1 position, flip }
function drawClip(ctx, w, h, v, crop = {}) {
  const vw = v.videoWidth || v.naturalWidth, vh = v.videoHeight || v.naturalHeight, r = cropRect(crop, vw, vh, w, h);
  const sx = r.u0 * vw, sy = r.v0 * vh, sw = r.uw * vw, sh = r.uh * vh;
  ctx.save();
  if (crop.flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
}

// Detected boxes for every clip: assets/video/cctv/tracks.json (made once with tools/detect.html).
// { fps, clips: { "3": [ frame, frame … ] } }, frame = [[class, score, x, y, w, h], …] (0–1)
let TRACKS = null;
fetch('assets/video/cctv/tracks.json').then(r => (r.ok ? r.json() : null)).then(j => { TRACKS = j; }).catch(() => {});

// the detections at the clip's current time, moved into this camera's crop / mirror
function trackedFigs(cam, v, cw, ch) {
  const frames = TRACKS?.clips?.[cam.clip];
  if (!frames?.length) return null;
  // each clip has its own frame rate; between two analysed frames the boxes slide (same track id → interpolated)
  const fps = TRACKS.fpsByClip?.[cam.clip] || TRACKS.fps;
  const at = Math.min(frames.length - 1, v.currentTime * fps), i0 = Math.floor(at), mix = at - i0;
  const f0 = frames[i0] || [], f1 = frames[Math.min(frames.length - 1, i0 + 1)] || [];
  const f = f0.map(d => {
    const n = d[6] != null && f1.find(e => e[6] === d[6]);
    return n ? [d[0], d[1], ...[2, 3, 4, 5].map(j => d[j] + (n[j] - d[j]) * mix), d[6]] : d;
  });
  const c = cam.crop || {}, r = cropRect(c, v.videoWidth, v.videoHeight, cw, ch);
  const out = [];
  for (const [cls, score, x, y, w, h, id] of f) {
    let nx = (x - r.u0) / r.uw;
    const ny = (y - r.v0) / r.uh, nw = w / r.uw, nh = h / r.uh;
    if (c.flip) nx = 1 - nx - nw;
    if (nx + nw < .02 || ny + nh < .02 || nx > .98 || ny > .98) continue;     // outside this camera's crop
    const name = cls.toUpperCase() + (id != null ? ` ${pad(id)}` : '');       // YOLO track id → the same person keeps the same number
    out.push({ x: nx, y: ny, w: nw, h: nh, cls, id, label: `${name} ${score.toFixed(2)}`, short: name });
  }
  // stable order: people first, then by track id (so boxes don't swap between people)
  return out.sort((a, b) => ((b.cls === 'person') - (a.cls === 'person')) || ((a.id ?? 0) - (b.id ?? 0)));
}

// no detection data → the system guesses: wandering boxes
function guessFigs(t, p) {
  return [0, 1].map(i => ({
    x: .15 + .55 * (.5 + .5 * Math.sin(t * .13 * (i + 1) + p[i] * 6)),
    y: .3 + .3 * (.5 + .5 * Math.sin(t * .09 + p[i + 2] * 6)),
    w: .07 + p[i + 4] * .06, h: .14 + p[i + 5] * .1,
  }));
}

// one frame of a camera: its clip if it has one (and it has loaded), otherwise its generated scene
// still photographs used as camera feeds (cam.still) — the feed's noise and tearing keep them alive
const StillPool = {
  els: {},
  get(src) {
    let im = this.els[src];
    if (!im) { im = this.els[src] = new Image(); im.src = src; }
    return im.complete && im.naturalWidth ? im : null;
  },
};

function paintCam(ctx, w, h, t, cam, p, scene = cam?.scene) {
  if (cam?.scrub) return paintArchive(ctx, w, h, t, cam);
  if (cam?.still) {
    const im = StillPool.get(cam.still);
    paintCam.video = !!im; paintCam.tracked = false;
    if (im) {
      if (cam.mono) ctx.filter = 'grayscale(1) contrast(1.1)';     // colour pictures → black & white
      drawClip(ctx, w, h, im, cam.crop);
      ctx.filter = 'none';
      return cam.figs || [];
    }
    return SCENES.nosignal(ctx, w, h, t);
  }
  const v = cam?.clip ? VideoPool.get(cam.clip, cam.inst || 0) : null;
  paintCam.video = !!v;
  paintCam.tracked = false;
  if (v) {
    drawClip(ctx, w, h, v, cam.crop);
    if (cam.figs) return cam.figs;                          // the person's position is given by hand
    const figs = trackedFigs(cam, v, w, h);
    paintCam.tracked = !!figs;
    return figs || [];                                      // no detection data → no boxes (never guessed)
  }
  if (cam?.clip) return SCENES.nosignal(ctx, w, h, t);     // clip still loading → static, never a drawn scene
  return (SCENES[scene] || SCENES.nosignal)(ctx, w, h, t, p) || [];
}


// CAMERA 04 ARCHIVE — real footage driven by the Morrow Street timeline.
// t = seconds after 00:05:00 (0–900), mapped across the whole clip. 00:11–00:16 is missing.
function paintArchive(ctx, w, h, t, cam) {
  paintCam.video = false; paintCam.tracked = false;
  if (t >= 360 && t < 660) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return []; }   // SIGNAL LOST
  const v = VideoPool.get(cam.clip, 'scrub', true);
  if (!v) return SCENES.nosignal(ctx, w, h, t);
  const want = (t / 900) * Math.max(0, v.duration - .1);
  if (!v.seeking && Math.abs(v.currentTime - want) > .12) v.currentTime = want;
  drawClip(ctx, w, h, v, cam.crop);
  paintCam.video = true;
  const figs = trackedFigs(cam, v, w, h) || [];
  const person = figs.find(f => f.cls === 'person');
  if (person) {
    if (t < 360) person.label = 'PERSON 01';                         // later identified: Elias Vane
    else if (t >= 780 && t < 790) person.label = 'UNKNOWN FIGURE';   // 12:18 — under four seconds
  }
  return figs;
}


/* ---------- 04 FEED SYSTEM ---------- */
const FEEDS = new Set();

function createFeed(canvas, o) {
  const f = {
    canvas, ctx: canvas.getContext('2d'),
    cam: o.cam, scene: o.scene, p: params(o.seed || 1),
    fps: o.fps || 10, last: 0, figs: [],
    time: o.time || null,                 // optional function → scene time (used by Morrow timeline)
    host: o.host || canvas,
    offset: rand(0, 100),
    noise: o.noise ?? .55,
  };
  FEEDS.add(f);
  return f;
}
function destroyFeed(f) { if (f) FEEDS.delete(f); }

function renderFeeds(now) {
  for (const f of FEEDS) {
    if (f.host.offsetParent === null) continue;              // hidden stage → skip
    if (now - f.last < 1000 / f.fps) continue;
    f.last = now;
    if (Math.random() < .03) continue;                       // dropped frame
    const { ctx, canvas } = f;
    const t = f.time ? f.time() : now / 1000 + f.offset;
    f.figs = paintCam(ctx, canvas.width, canvas.height, t, f.cam, f.p, f.scene);
    postFX(ctx, canvas.width, canvas.height, f.noise);
  }
  requestAnimationFrame(renderFeeds);
}

function feedLabels(cam, mode = 'full') {
  const st = cam.status || 'REC';
  const live = /REC|LIVE/.test(st);
  const center = cam.scene === 'nosignal' ? `<span class="fl-center">NO SIGNAL</span>` : '';
  if (mode === 'min') {
    return el('div', 'feed-labels is-min', `<span class="fl-id">${cam.id}</span><span class="fl-rec ${live ? 'is-live' : ''}"></span>${center}`);
  }
  const time = typeof cam.clock === 'number'
    ? `<span class="fl-time" data-clock="${cam.clock}">${fmtClock(cam.clock + elapsed())}</span>`
    : `<span class="fl-time">${cam.timeText || ''}</span>`;
  return el('div', 'feed-labels', `<span class="fl-id">${cam.id}</span>${time}<span class="fl-loc">${cam.loc}</span><span class="fl-rec ${live ? 'is-live' : ''}">${st}</span>${center}`);
}

/* feedBox(cam) → { box, media, feed }
   <!-- REPLACE WITH CCTV FOOTAGE --> : set cam.src to a video or image path */
function feedBox(cam, o = {}) {
  const box = el('div', 'feed');
  let media, feed;
  if (cam.src) {
    const isVideo = /\.(mp4|webm|mov)$/i.test(cam.src);
    media = el(isVideo ? 'video' : 'img', 'feed-media');
    media.src = cam.src;
    if (isVideo) Object.assign(media, { autoplay: true, muted: true, loop: true, playsInline: true });
    else media.alt = `${cam.id} — ${cam.loc}`;
    feed = { media: true, figs: cam.figs || [{ x: .42, y: .3, w: .14, h: .5 }] };
  } else {
    media = el('canvas', 'feed-media');
    media.width = o.w || 160; media.height = o.h || 90;
    feed = createFeed(media, { cam, scene: cam.scene, seed: cam.seed, fps: o.fps, host: box, time: o.time, noise: o.noise });
  }
  box.append(media);
  if (o.labels !== false) box.append(feedLabels(cam, o.labels || 'full'));
  return { box, media, feed };
}

// replace whatever is in `slot` with a new camera, with a static cut
function switchCamera(slot, cam, o = {}) {
  if (slot._view) { destroyFeed(slot._view.feed); slot._view.tracker?.destroy(); slot._view.box.remove(); }
  const v = feedBox(cam, o);
  slot.prepend(v.box);
  if (o.tracker) v.tracker = createTracker(v.box, v.feed, o.tracker);
  v.cam = cam;
  slot._view = v;
  staticCut(slot);
  if (!o.silent) Sound.burst(.12, .05);
  return v;
}

function staticCut(node, ms = 280) {
  node.classList.remove('is-switching'); void node.offsetWidth;
  node.classList.add('is-switching');
  setTimeout(() => node.classList.remove('is-switching'), ms);
}


/* ---------- 05 TRACKING OVERLAYS ----------
   createTracker(host, feed, options)
     target   index of the person to treat as the subject (-1 = none)
     primary  label (string or function) for the subject box
     words    labels for other boxes (cycled) — like "I / AM / WHERE" in the reference
     ghosts   extra boxes that track nothing (lights, reflections)
     edges    long lines that leave the frame
     lag      0–1, how slowly the subject box catches up
   tracker.manual = {x,y,w,h} forces the subject box somewhere (wrong person, mouse...) */
function createTracker(host, feed, o = {}) {
  const layer = el('div', 'trk');
  const lines = svgEl('svg', { class: 'trk-lines' });
  const path = svgEl('path', {}, lines);
  layer.append(lines);
  host.append(layer);

  // (ghosts = made-up wandering boxes, edges = lines to nowhere — off by default now that the boxes are real)
  const ghosts = Array.from({ length: o.ghosts ?? 0 }, () => ({ x: rand(.05, .8), y: rand(.05, .6), w: rand(.04, .14), h: rand(.05, .2), ghost: true }));
  const edges = Array.from({ length: o.edges ?? 0 }, () => (Math.random() < .5 ? { x: Math.round(Math.random()), y: Math.random() } : { x: Math.random(), y: 0 }));

  const T = {
    layer, feed, boxes: [], manual: null,
    target: o.target ?? 0,
    words: o.words || ['PERSON'],
    primary: o.primary || 'SUBJECT',
    lag: o.lag ?? .45,
    frame: [1280, 720],
  };

  T.update = () => {
    if (!layer.isConnected || layer.offsetParent === null) return;
    const W = layer.clientWidth, H = layer.clientHeight;
    let targets = (T.feed.figs || []).filter(Boolean).map((f, i) => ({ ...f, i, primary: i === T.target }));
    if (T.manual) {
      targets = targets.filter(f => f.i !== T.target);
      targets.unshift({ ...T.manual, primary: true });
    }
    ghosts.forEach(g => { g.x = clamp(g.x + rand(-.004, .004), 0, .9); g.y = clamp(g.y + rand(-.004, .004), 0, .85); });
    targets = targets.concat(ghosts);

    // one box per tracked object: a box stays with the same id (YOLO track) instead of jumping to whoever is next in the list
    const keyOf = (tg, k) => (tg.id != null ? `id${tg.id}` : `k${k}`);
    T.byKey ||= new Map();
    const used = new Set();
    const ordered = targets.map((tg, k) => {
      const key = keyOf(tg, k);
      used.add(key);
      let b = T.byKey.get(key);
      if (!b) {
        const e = el('div', 'trk-box', '<span class="lb"></span><span class="xy"></span>');
        layer.append(e);
        b = { el: e, init: false };
        T.byKey.set(key, b);
      }
      return [b, tg];
    });
    for (const [key, b] of T.byKey) if (!used.has(key)) { b.el.remove(); T.byKey.delete(key); }   // that person left the picture
    T.boxes = ordered.map(([b]) => b);

    ordered.forEach(([b, tg], k) => {
      b.el.style.display = ''; b.hidden = false;
      const lost = Math.random() < (o.dropout ?? 0);
      const lag = tg.primary ? T.lag : .6;
      if (!b.init) Object.assign(b, { x: tg.x, y: tg.y, w: tg.w, h: tg.h, init: true });
      else if (!lost) { b.x += (tg.x - b.x) * lag; b.y += (tg.y - b.y) * lag; b.w += (tg.w - b.w) * lag; b.h += (tg.h - b.h) * lag; }
      // snap to a 2px grid → mechanical, slightly jumpy
      b.px = Math.round((b.x * W) / 2) * 2; b.py = Math.round((b.y * H) / 2) * 2;
      b.pw = Math.max(6, Math.round(b.w * W)); b.ph = Math.max(6, Math.round(b.h * H));
      b.el.style.transform = `translate(${b.px}px,${b.py}px)`;
      b.el.style.width = b.pw + 'px'; b.el.style.height = b.ph + 'px';
      b.el.classList.toggle('is-primary', !!tg.primary);
      b.el.classList.toggle('is-lost', lost);
      b.el.classList.toggle('is-ghost', !!tg.ghost);
      b.primary = !!tg.primary;
      const label = lost ? 'LOST'
        : tg.primary ? (typeof T.primary === 'function' ? T.primary() : T.primary)
        : tg.label || T.words[k % T.words.length];
      b.el.firstChild.textContent = label;
      b.el.lastChild.textContent = `X:${Math.round(b.x * T.frame[0])} Y:${Math.round(b.y * T.frame[1])}`;
    });

    if (o.lines === false) return;
    lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const vis = T.boxes.filter(b => !b.hidden);
    const P = vis.find(b => b.primary) || vis[0];
    let d = '';
    if (P) {
      const cx = P.px + P.pw, cy = P.py + P.ph / 2;
      vis.forEach(b => { if (b !== P) d += `M${cx},${cy}L${b.px},${b.py + b.ph}`; });
      edges.forEach(e => { d += `M${cx},${cy}L${e.x * W},${e.y * H}`; });
    }
    path.setAttribute('d', d);
  };

  T.timer = setInterval(T.update, o.interval || 120);
  T.destroy = () => { clearInterval(T.timer); layer.remove(); };
  return T;
}


/* ---------- 06 METADATA — typing, tooltip, viewer ---------- */

// types the text of `html` into node, then swaps in the real html (so redactions etc. survive)
async function typeInto(node, html, { speed = 14, tk } = {}) {
  const tmp = el('div'); tmp.innerHTML = html;
  const text = tmp.textContent;
  for (let i = 1; i <= text.length; i += 2) {
    node.textContent = text.slice(0, i);
    if (i % 8 === 1) Sound.click();
    await sleep(speed, tk);
  }
  node.innerHTML = html;
}
// lines: strings, or {html, cls}
async function typeLines(container, lines, o = {}) {
  for (const ln of lines) {
    const isObj = typeof ln === 'object';
    const row = el(o.tag || 'div', (isObj && ln.cls) || o.cls || '');
    container.append(row);
    await typeInto(row, isObj ? ln.html : ln, o);
    if (o.gap) await sleep(o.gap, o.tk);
  }
}
const kv = (k, v, cls = '') => `<span class="k">**${k}:**</span> <span class="${cls}">${v}</span>`;

const Tip = {
  node: null,
  show(html, e) { this.node.innerHTML = html; this.node.hidden = false; this.move(e); },
  move(e) {
    const n = this.node;
    const x = Math.min(e.clientX + 16, innerWidth - n.offsetWidth - 8);
    const y = Math.min(e.clientY + 16, innerHeight - n.offsetHeight - 8);
    n.style.transform = `translate(${x}px,${y}px)`;
  },
  hide() { if (this.node) this.node.hidden = true; },
};

function camMeta(cam) {
  const t = typeof cam.clock === 'number' ? fmtClock(cam.clock + elapsed()) : '—';
  return `<b>${cam.id}</b><dl>
    <dt>LOC</dt><dd>${cam.loc}</dd>
    <dt>TIME</dt><dd>${t}</dd>
    <dt>STATUS</dt><dd>${cam.status}</dd>
    <dt>REGISTRY</dt><dd class="${cam.anomaly ? 'inv' : ''}">${cam.reg}</dd>
    ${cam.mirror ? `<dt>COPY</dt><dd class="inv">${cam.mirror}</dd>` : ''}
    ${cam.note ? `<dt>NOTE</dt><dd>${cam.note}</dd>` : ''}
  </dl>`;
}

// expanded feed (click a tile on the wall)
const Viewer = {
  list: [], i: 0, view: null, typing: 0,

  // cx, cy = where you clicked: the feed grows out of that point to the centre
  open(list, i, cx = innerWidth / 2, cy = innerHeight / 2) {
    this.list = list;
    const v = $('#viewer');
    v.hidden = false;
    Tip.hide();
    this.show(i);
    const f = $('.viewer-frame', v), r = f.getBoundingClientRect();
    f.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
    v.classList.remove('is-opening'); void v.offsetWidth; v.classList.add('is-opening');
  },

  show(i) {
    if (Found.on) return;
    this.i = (i + this.list.length) % this.list.length;
    const cam = this.list[this.i];
    STATE.feedsOpened++;
    if (cam.id === TARGET) { Found.run(cam).catch(quiet); return; }   // found it
    Encroach.bump(1);                                                     // not it — and the screen gets worse
    const person = lifeOf(cam);
    Found.log.push({ t: fmtClock(ARCHIVE_START + elapsed()), id: cam.id, person });   // everything you open is written down
    this.view = switchCamera($('#viewer-media'), cam, {
      w: 960, h: 540, fps: 12, noise: .3,          // canvas size of the enlarged feed
      tracker: {
        target: -1,                                   // nobody is singled out — every box is a real YOLO track (PERSON 07 0.84 …)
        words: ['PERSON'],
        ghosts: 0,
      },
    });

    const meta = $('#viewer-meta');
    meta.innerHTML = '';
    const token = ++this.typing;
    const lines = [
      `# FEED DETAIL`,
      kv('CAMERA', cam.id),
      kv('LOCATION', cam.loc),
      kv('REGISTRY', cam.reg, cam.anomaly ? 'inv' : ''),
      kv('STATUS', cam.status),
      kv('RETENTION', cam.anomaly ? 'PERMANENT' : '30 DAYS'),
      kv('COPY', cam.mirror || 'NONE', cam.mirror ? 'inv' : ''),
    ];
    if (cam.note) lines.push(`// ${cam.note}`);
    lines.push(`// ${person}`);                                                        // just someone's evening
    lines.push(`<span class="inv">NOT ${TARGET.replace('CAM', 'CAMERA')}</span>`);   // keep looking
    (async () => {
      for (const ln of lines) {
        if (token !== this.typing || $('#viewer').hidden) return;
        const row = el('div'); meta.append(row);
        await typeInto(row, ln, { speed: 8 });
      }
    })().catch(quiet);
  },

  close() {
    if (Found.on) return;                            // once CAMERA 04 is open there is no way out — it ends by itself
    const v = $('#viewer-media');
    if (v._view) { destroyFeed(v._view.feed); v._view.tracker?.destroy(); v._view.box.remove(); v._view = null; }
    $('#viewer').hidden = true;
    this.typing++;
  },
};


/* ---------- 06b THE SEARCH — the screen fills up while you look for CAMERA 04 ----------
   Every wrong feed you open raises the level (time alone does nothing):
   black boxes take parts of the screen, and pop-up windows (records, faces, movements)
   start to appear on top of the room. Close one and it may come back as two.
   REPLACE the numbers in SEARCH to make it gentler or harsher. */
const SEARCH = {
  blackPerFeed: 2,    // black boxes added for every wrong camera you open
  maxBlack: 46,       // most black boxes at once
  maxPopups: 6,       // most pop-ups at once
  popupChance: .07,   // per second, per level
};
const Encroach = {
  level: 0, live: false,
  reset() { this.level = 0; this.live = false; $('#blackout').innerHTML = ''; $('#tempt').innerHTML = ''; $('#hud-checked').textContent = 'FEEDS CHECKED 00'; },
  start() {
    this.live = true;
    every(1000, () => { if (this.live && Math.random() < Math.min(.85, this.level * SEARCH.popupChance)) this.popup(); });
    every(140, () => $$('#tempt .cmdwin:not(.cmd-ghost)').forEach(w => { if (Math.random() < .6) this.dataLine(w); }));
  },
  stop() { this.live = false; },
  bump(n = 1) {
    if (!this.live) return;
    this.level += n;
    this.black(Math.round(n * SEARCH.blackPerFeed));
    $('#hud-checked').textContent = `FEEDS CHECKED ${pad(Math.round(this.level), 2)}`;
  },
  black(n) {
    const B = $('#blackout');
    for (let i = 0; i < n && B.children.length < SEARCH.maxBlack; i++) {
      const b = el('i', Math.random() < .25 ? 'lbl' : '');
      const w = rand(6, 26), h = rand(4, 16);
      Object.assign(b.style, { left: `${rand(-4, 100 - w)}%`, top: `${rand(4, 100 - h)}%`, width: `${w}%`, height: `${h}%` });
      B.append(b);
    }
  },
  // a pop-up: an old command-prompt window dumping someone's data — and glitching
  popup() {
    const L = $('#tempt');
    if ($$('.cmdwin:not(.cmd-ghost)', L).length >= SEARCH.maxPopups) return;   // (torn copies don't count)
    const id = pad(randInt(1000, 9999), 4);
    const title = pick([`C:\\BPD\\PERSON_${id}.LOG`, `C:\\MIRROR\\FACE_VEC_${id}.DAT`, `C:\\W13\\TRACE_${id}.TXT`, `C:\\CAM\\FEED_${randInt(10, 99)}.RAW`, `C:\\RECORDS\\ADDR_${id}.DB`]);
    const w = el('div', 'cmdwin', `<header><span>${title}</span><i>_</i><i>□</i><button type="button" aria-label="Close">×</button></header>
      <div class="cmd-body"><pre></pre><b class="cmd-scroll"><i></i></b></div>`);
    w.style.left = `${rand(2, 70)}%`; w.style.top = `${rand(10, 70)}%`;
    w.style.width = `${randInt(220, 340)}px`;
    w.pre = $('pre', w); w.id_ = id;
    for (let k = 0; k < 10; k++) this.dataLine(w);
    $('header button', w).onclick = e => { e.stopPropagation(); w.remove(); };   // closed = gone
    L.append(w);
    Sound.click();
  },
  // one more line of someone's life, as data — sometimes broken
  dataLine(w) {
    const hex = () => randInt(0, 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const JUNK = ['█', '▓', '▒', '░', '#', '@', '$', '%', '&', '*', '<', '>', '/', '|', '=', '+', '_'];
    const junk = n => Array.from({ length: n }, () => pick(JUNK)).join('');
    const lines = [
      () => `0x${hex()}${hex()}  ${hex()} ${hex()} ${hex()} ${hex()}  FACE_VEC[${randInt(0, 127)}] = ${rand(-1, 1).toFixed(5)}`,
      () => `MATCH   PERSON_${w.id_}   ${randInt(12, 97)}%   ${'█'.repeat(randInt(2, 9))}${'░'.repeat(randInt(1, 6))}`,
      () => `GPS     40.75${randInt(100, 999)}  -73.98${randInt(100, 999)}   CAM ${randInt(10, 99)}`,
      () => `ADDR    ${randInt(10, 240)} ${pick(STREETS)} ST  APT ${randInt(1, 30)}`,
      () => `SEEN    ${fmtClock(ARCHIVE_START + elapsed() - randInt(0, 4000))}  CAM ${randInt(10, 99)}  ${pick(['WALKING', 'STOPPED', 'ENTERED', 'LEFT', 'WAITING'])}`,
      () => `ERR: FRAME ${randInt(1000, 9999)} CORRUPT — RETRY`,
      () => `PRIOR   ${pick(PRIORS)}`,
      () => junk(randInt(8, 40)),
      () => `${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}`,
    ];
    let ln = pick(lines)();
    if (Math.random() < .18) ln = ln.slice(0, randInt(3, ln.length)) + junk(randInt(3, 12));     // the line breaks up
    const pre = w.pre;
    pre.textContent = (pre.textContent + '\n' + ln).split('\n').slice(-40).join('\n');
    pre.scrollTop = pre.scrollHeight;
    // holes: bits of older lines drop out, like a signal losing characters
    if (Math.random() < .25) {
      const rows = pre.textContent.split('\n'), r = randInt(0, rows.length - 1), row = rows[r];
      if (row.length > 6) { const a = randInt(0, row.length - 4), b = Math.min(row.length, a + randInt(3, 18)); rows[r] = row.slice(0, a) + ' '.repeat(b - a) + row.slice(b); pre.textContent = rows.join('\n'); }
    }
    if (Math.random() < .09) this.tear(w);
  },
  // the window tears: horizontal slices slide sideways — the text inside the window,
  // and the whole window (frame, title bar and all) at the same moment
  tear(w) {
    const body = $('.cmd-body', w), pre = w.pre, L = w.parentNode;
    if (!L) return;
    const life = randInt(90, 280);
    // 1. slices of the text, kept inside the window
    for (let k = 0, n = randInt(2, 4); k < n; k++) {
      const c = pre.cloneNode(true);
      c.className = 'cmd-slice';
      const top = rand(0, 85), h = rand(5, 22);
      c.style.clipPath = `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`;
      c.style.transform = `translateX(${(Math.random() < .5 ? -1 : 1) * randInt(4, 40)}px)`;
      body.append(c);
      c.scrollTop = pre.scrollTop;
      setTimeout(() => c.remove(), life);
    }
    // 2. slices of the whole window — the frame breaks with the text
    for (let k = 0, n = randInt(1, 3); k < n; k++) {
      const g = w.cloneNode(true);
      g.classList.add('cmd-ghost');
      $$('.cmd-slice', g).forEach(x => x.remove());
      const top = rand(0, 80), h = rand(6, 26);
      g.style.clipPath = `inset(${top}% -40px ${Math.max(0, 100 - top - h)}% -40px)`;
      g.style.transform = `translateX(${(Math.random() < .5 ? -1 : 1) * randInt(3, 16)}px)`;
      g.style.zIndex = (+w.style.zIndex || 0) + 1;
      L.append(g);
      $('pre', g).scrollTop = pre.scrollTop;
      setTimeout(() => g.remove(), life);
    }
    // 3. the window itself jolts and its text dims under the slices
    w.classList.add('is-torn');
    setTimeout(() => w.classList.remove('is-torn'), life);
  },
};

/* ---------- 06c ORDINARY LIVES — what you actually see when you open a feed ----------
   Not suspects. Just people. One line per camera (always the same line for the same camera).
   REPLACE / add lines freely. */
const LIVES = [
  'WALKING HOME FROM A NIGHT SHIFT', 'WAITING FOR A BUS THAT IS LATE', 'BUYING MEDICINE FOR A CHILD',
  'ON THE PHONE WITH HER MOTHER', 'SAME ROUTE EVERY NIGHT AT THIS TIME', 'SMOKING ALONE BEHIND THE SHOP',
  'CARRYING GROCERIES FOR A NEIGHBOUR', 'LOOKING FOR A LOST DOG', 'WALKING TO THE HOSPITAL',
  'SITTING IN A PARKED CAR, NOT MOVING', 'CLOSING UP THE LAUNDROMAT', 'MEETING SOMEONE HE SHOULD NOT',
  'LATE FOR WORK AGAIN', 'CRYING ON A BENCH', 'TAKING THE LONG WAY HOME', 'DELIVERING FOOD — 11TH ORDER TONIGHT',
  'TWO PEOPLE ARGUING QUIETLY', 'A KID WHO SHOULD BE IN BED', 'WAITING OUTSIDE A CLINIC', 'NOTHING. JUST WALKING.',
];
// each camera you open gets its own person (no two the same until the list runs out); same camera → same person
const _lives = new Map();
let _lifeDeck = [];
function lifeOf(cam) {
  if (_lives.has(cam.id)) return _lives.get(cam.id);
  if (!_lifeDeck.length) _lifeDeck = [...LIVES].sort(() => Math.random() - .5);
  let h = 0; for (const ch of cam.id + cam.loc) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const line = `PERSON ${pad(h % 9000 + 1000, 4)} — ${_lifeDeck.pop()}`;
  _lives.set(cam.id, line);
  return line;
}

/* ---------- 06d FOUND — CAMERA 04 looks back ----------
   1. CAMERA 04: an eye, right up against the lens, staring at you
   2. the feed cuts — it is now a camera on THIS room: someone at the monitors. You.
   3. a warning: this terminal is being watched — static — the screen kills itself
   4. a terminal types back everything you looked at tonight, then asks: WAS THIS JUST? . . .   */
const Found = {
  on: false, log: [], t0: 0,
  eyeFor: 7500,  // ms the eye stays on screen (the clip is 12 s)
  // the camera on YOU (clip 20: someone at the monitors, seen from behind)
  // figs = where the person is in the picture (0–1 of the screen) → the VIEWER box
  you: { id: 'CAM ??', loc: 'CIVIC CENTER / SUBLEVEL 2 — BEHIND TERMINAL 2', clip: 20, status: 'LIVE', reg: '—', figs: [{ x: .39, y: .58, w: .22, h: .42 }] },
  async run(cam) {
    this.on = true; Encroach.stop(); window.Room3D?.hint(false);
    const tk = RUN, media = $('#viewer-media'), meta = $('#viewer-meta'), V = $('#viewer');
    this.log.push({ t: fmtClock(ARCHIVE_START + elapsed()), id: cam.id, person: 'SOMEONE LOOKING BACK' });
    V.classList.add('is-found');
    switchCamera(media, cam, { w: 960, h: 540, fps: 12, noise: .3 });          // the eye — no boxes, nothing to track
    meta.innerHTML = '';
    for (const ln of ['# FEED DETAIL', kv('CAMERA', cam.id), kv('LOCATION', cam.loc), kv('STATUS', 'LIVE')]) { const r = el('div'); meta.append(r); await typeInto(r, ln, { speed: 8, tk }); }
    await sleep(this.eyeFor, tk);

    // it was never a street camera
    Sound.burst(.6, .12);
    switchCamera(media, this.you, { w: 960, h: 540, fps: 12, noise: .35, silent: true,
      tracker: { target: 0, primary: () => 'VIEWER', words: ['VIEWER'], ghosts: 0 } });
    corrupt($('.viewer-frame'));
    meta.innerHTML = '';
    for (const ln of ['# FEED DETAIL', kv('CAMERA', '—'), kv('LOCATION', 'THIS ROOM'), kv('STATUS', 'LIVE — RECORDING'), kv('SUBJECT', 'VIEWER AT TERMINAL 2', 'inv')]) { const r = el('div'); meta.append(r); await typeInto(r, ln, { speed: 8, tk }); }
    await sleep(900, tk);

    // someone is watching this terminal
    const w = el('div', 'watch-warn', `<header>⚠ WARNING</header><div class="body">
      <p>THIS TERMINAL IS BEING MONITORED</p>${kv('REMOTE VIEWER', 'CONNECTED')}<br>${kv('SESSION', 'RECORDED')}<br>${kv('FEEDS ACCESSED', this.log.length)}</div>`);
    V.append(w);
    Sound.blip(880, .15); Sound.blip(660, .3);
    await sleep(2800, tk);

    // static — and it shuts itself off
    V.classList.add('is-static');
    Sound.burst(1.2, .14);
    await sleep(1300, tk);
    this.powerOff();
  },
  // the tube dies: the picture collapses to a line, then a dot, then nothing
  powerOff() {
    if (this.off) return;
    this.off = true;
    document.body.classList.add('is-poweroff');
    Sound.blip(60, .4, 'sawtooth', .06);
    if (Music.playing) Music.fade(0, 1200);           // the music dies with the screen — the terminal is silent
    later(700, () => { $('#power-off').hidden = false; this.terminal().catch(quiet); });
  },
  // what you did, typed back to you
  async terminal() {
    const T = $('#term'), tk = RUN;
    const line = async (txt, speed = 10) => { const r = el('div'); T.append(r); await typeInto(r, txt, { speed, tk }); };
    await sleep(1200, tk);
    await line('> SESSION LOG — TERMINAL 2');
    await line('&gt;');
    const shown = this.log.slice(-16);
    if (this.log.length > shown.length) await line(`> … ${this.log.length - shown.length} EARLIER`, 4);
    for (const e of shown) await line(`> ${e.t}  ${e.id.padEnd(7)}  VIEWED — ${e.person.replace(/^PERSON \d+ — /, '')}`, 4);
    await line('&gt;');
    const people = this.log.filter(e => /^PERSON/.test(e.person)).length;
    const secs = Math.round((performance.now() - this.t0) / 1000);
    await line(`> FEEDS VIEWED ......... ${pad(this.log.length)}`);
    await line(`> PEOPLE WATCHED ....... ${pad(people)}`);
    await line(`> SUSPECTS FOUND ....... 00`);
    await line(`> TIME SPENT WATCHING .. ${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`);
    await line('&gt;');
    await sleep(1400, tk);
    await line('> WAS THIS JUSTICE?', 60);   // REPLACE: the last question
    const dots = el('div', 'term-dots', '&gt; <span></span>');
    T.append(dots);
    const sp = $('span', dots);
    let n = 0;
    setInterval(() => { n = (n + 1) % 4; sp.textContent = '. '.repeat(n); }, 600);   // . . .  forever
    await sleep(4000, tk);
    const b = el('button', 'btn term-reconnect', 'RECONNECT');
    b.type = 'button'; b.onclick = () => location.reload();
    $('#power-off').append(b);
  },
};

/* ---------- 07 CORRUPTED STATES ---------- */
function corrupt(node, ms = 520) {
  node.classList.remove('is-corrupt'); void node.offsetWidth;
  node.classList.add('is-corrupt');
  setTimeout(() => node.classList.remove('is-corrupt'), ms);
}
// temporarily replaces characters with block glyphs
function scramble(node, ms = 800) {
  const orig = node.textContent, chars = '█▓▒░#X/\\_';
  const end = Date.now() + ms;
  const iv = setInterval(() => {
    if (Date.now() > end) { clearInterval(iv); node.textContent = orig; return; }
    node.textContent = orig.split('').map(c => (c !== ' ' && Math.random() < .35 ? pick(chars) : c)).join('');
  }, 50);
}
// deletes text character by character
async function erase(node, speed = 25, tk) {
  let t = node.textContent;
  while (t.length) { t = t.slice(0, -1); node.textContent = t; await sleep(speed, tk); }
}
function flash() {
  const f = $('#fx-flash');
  f.classList.remove('is-on'); void f.offsetWidth; f.classList.add('is-on');
}


/* ---------- 08 STORY DATA ---------- */

/* Named cameras. Add  src: 'assets/video/xxx.mp4'  to use real footage.
   clock = seconds after midnight on the camera's own clock (they drift — on purpose). */
const CAMS = [
  { id: 'CAM 03', loc: 'EAST BELLMONT / 9TH & HOLLIS', scene: 'street', seed: 303, clock: ARCHIVE_START, status: 'REC', reg: 'BPD — PUBLIC SAFETY', match: true, note: 'AUTO-MATCH: SUBJECT 023 (61%)' },
  { id: 'CAM 11', loc: 'MORROW STREET', scene: 'street', seed: 1111, clock: 8 * 60 + 44, status: 'REC', reg: 'BPD — PUBLIC SAFETY', note: 'CLOCK OFFSET +25 MIN — NOT CORRECTED' },
  { id: 'CAM 18', loc: 'CIVIC CENTER', scene: 'overhead', seed: 1818, clock: 2 * 3600 + 13 * 60 + 51, status: 'LIVE', reg: 'CITY OF BELLMONT' },
  { id: 'CAM 22', loc: 'SUBWAY PLATFORM — LINE 3', scene: 'platform', seed: 2222, clock: ARCHIVE_START - 2, status: 'SIGNAL WEAK', reg: 'TRANSIT AUTHORITY' },
  { id: 'CAM 04', loc: '114 MORROW ST / REAR SERVICE', scene: 'street', seed: 404, status: 'OFFLINE', reg: 'PRIVATE — PROPERTY MGMT', note: 'OFFLINE SINCE 2023.10.02 — SEE CASE FILE 001, EVIDENCE 03' },
  { id: 'CAM 47', loc: 'EAST BELLMONT / PAROLE OFFICE', scene: 'street', seed: 4747, clock: ARCHIVE_START + 1, status: 'REC', reg: 'NO REGISTERED OWNER', anomaly: true, mirror: 'W-13 / EXTERNAL', note: 'FOOTAGE COPIED TO UNKNOWN SERVER' },
  { id: 'CAM 08', loc: 'HOLLIS AVE / LAUNDROMAT', scene: 'street', seed: 808, clock: ARCHIVE_START + 3, status: 'REC', reg: 'BPD — PUBLIC SAFETY' },
  { id: 'CAM 14', loc: 'CANAL STREET / UNDERPASS', scene: 'street', seed: 1414, clock: ARCHIVE_START - 4, status: 'REC', reg: 'CITY TRAFFIC' },
  { id: 'CAM 21', loc: 'GRANT ST / ROOFTOP', scene: 'overhead', seed: 2121, clock: ARCHIVE_START + 2, status: 'LIVE', reg: 'PRIVATE — GRANT HOLDINGS' },
  { id: 'CAM 3?', loc: 'CIVIC CENTER / SUBLEVEL 2', scene: 'corridor', seed: 3939, clock: ARCHIVE_START, status: 'LIVE', reg: 'ID DOES NOT EXIST IN BPD RECORDS', anomaly: true, mirror: 'W-13 / EXTERNAL' },
  { id: 'CAM 07', loc: 'MORROW ST & SEVENTH AVE', scene: 'overhead', seed: 707, clock: ARCHIVE_START - 1, status: 'REC', reg: 'CITY TRAFFIC UNIT 07', note: 'CASE FILE 001 / EVIDENCE 04' },
  { id: 'CAM 26', loc: 'MERCY GENERAL / AMBULANCE BAY', scene: 'alley', seed: 2626, clock: ARCHIVE_START + 5, status: 'REC', reg: 'PRIVATE — HOSPITAL' },
  { id: 'CAM 33', loc: '— NOT IN CITY RECORDS —', scene: 'overhead', seed: 3333, clock: ARCHIVE_START, status: 'LIVE', reg: 'NO REGISTERED OWNER', anomaly: true, note: 'AUTO-TRACKING 3 INDIVIDUALS — NO OPERATOR' },
  { id: 'CAM 31', loc: 'BELLMONT TRANSIT DEPOT', scene: 'corridor', seed: 3131, clock: ARCHIVE_START - 3, status: 'REC', reg: 'TRANSIT AUTHORITY' },
  // REPLACE: picture feeds (still images, drawn in black & white)
  { id: 'CAM 23', loc: 'PARK AVE / POST 203', scene: 'street', seed: 2323, clock: ARCHIVE_START - 6, status: 'LIVE', reg: 'BPD — PUBLIC SAFETY', still: 'assets/images/cams/park-ave.webp', mono: true },
  { id: 'CAM 52', loc: 'CENTRAL SQUARE / VENDOR TEST', scene: 'street', seed: 5252, clock: ARCHIVE_START + 4, status: 'REC', reg: 'PRIVATE — VISION VENDOR', still: 'assets/images/cams/detection.webp', mono: true, anomaly: true, note: 'AUTOMATIC DETECTION — 14 OBJECTS — NO OPERATOR' },
];
const CAM = id => CAMS.find(c => c.id === id);

// REAL FOOTAGE for the named cameras — clip number = assets/video/cctv/cctv-XX.mp4
// (only CAM 04 keeps its generated scene — the Morrow Street timeline needs it)
const CAM_CLIPS = {
  'CAM 22': 6,    // signal weak — dark road
  'CAM 3?': 1,    // the camera that doesn't exist — looking down from a roof
  'CAM 03': 2,    // crowded plaza from above — dozens of people
  'CAM 04': 19,   // THE EYE — someone staring straight into the lens (the camera you are looking for)
  'CAM 11': 16,   // Morrow Street, night, building corner
  'CAM 18': 13,   // Civic Center street
  'CAM 47': 9,    // parole office street
  'CAM 08': 4,    // Hollis Ave, night junction
  'CAM 14': 10,   // canal street junction
  'CAM 21': 18,   // rooftop, looking down on the road
  'CAM 07': 15,   // Morrow St & Seventh Ave, night
  'CAM 26': 5,
  'CAM 33': 17,   // not in city records — night city from above
  'CAM 31': 7,
};
CAMS.forEach(c => { if (CAM_CLIPS[c.id]) c.clip = CAM_CLIPS[c.id]; });
CAM(TARGET).hide = true;
CAM(TARGET).crop = { s: 1, y: .85 };   // frame the lower part of the clip, where the eye is
// (hide → the 3D room puts it far out at the edge of the wall — you have to look for it)

const LOCS = ['NORTHGATE / 2ND AVE', 'OLD HARBOR / PIER 6', 'CANAL DISTRICT', 'EAST BELLMONT / LOT C', 'KESSLER BRIDGE', 'ST. ANSEL CHURCH', 'MORROW ST / NO. 88', 'CIVIC CENTER / EAST STAIRS', 'TRANSIT LINE 3 / TUNNEL', 'GRANT ST / NO. 140', 'HOLLIS AVE / BUS STOP', 'WARD 9 HOUSING', 'BELLMONT CENTRAL STN', 'LOWER MARKET', 'FERRY TERMINAL', 'PARKING / LEVEL B2'];
const FILLER_SCENES = ['street', 'alley', 'overhead', 'corridor', 'platform', 'street', 'overhead', 'street'];

function fillerCam(i) {
  const r = seeded(9000 + i);
  const n = r();
  return {
    id: `CAM ${pad(40 + i * 3 + Math.floor(r() * 3))}`,
    loc: LOCS[Math.floor(r() * LOCS.length)],
    scene: n < .06 ? 'nosignal' : FILLER_SCENES[Math.floor(r() * FILLER_SCENES.length)],
    seed: 5000 + i,
    clock: ARCHIVE_START + Math.floor(r() * 9) - 4,
    status: n < .06 ? 'NO SIGNAL' : r() < .15 ? 'SIGNAL WEAK' : r() < .5 ? 'LIVE' : 'REC',
    reg: n > .93 ? 'UNREGISTERED' : 'CITY OF BELLMONT',
    anomaly: n > .93,
    // every working city camera shows a crop of a real clip (only NO SIGNAL screens stay static)
    clip: n >= .06 ? 1 + Math.floor(r() * CLIP_COUNT) : 0,
    inst: r() < .5 ? 0 : 1,
    crop: { s: 1 + r() * .9, x: r(), y: r(), flip: r() < .35 },
  };
}

// fragments behind unregistered nodes — deliberately ambiguous: help and harm side by side
const FRAGMENTS = [
  { scene: 'street', date: '2019.06.11 / 16:42', cls: 'MISSING PERSON', text: 'CHILD, AGE 7. LOCATED 3.2 KM FROM HOME. RELAYED TO BPD AS “ANONYMOUS TIP”. RECOVERED ALIVE.' },
  { scene: 'overhead', date: '2020.08.29 / 21:03', cls: 'PUBLIC ASSEMBLY', text: 'CIVIC CENTER PROTEST. 1,412 FACES INDEXED. OFFENSES RECORDED: 0. RETENTION: PERMANENT.' },
  { scene: 'alley', date: '2023.01.14 / 02:51', cls: 'SUBJECT 023', text: 'FIRST SIGHTING — EAST BELLMONT. NINE MONTHS BEFORE MORROW STREET. ACTION: OBSERVE. <span class="redact">DO NOT ALERT BPD</span>.' },
  { scene: 'street', date: '2021.11.30 / 23:17', cls: 'VIOLENT CRIME — PREVENTED', text: 'ARMED ROBBERY PREDICTED 4 MIN IN ADVANCE. PATROL REROUTED AS “ROUTINE DISPATCH”. NO INJURIES.' },
  { scene: 'corridor', date: '2022.03.08 / 07:55', cls: 'PUBLIC OFFICIAL', text: 'COUNCIL MEMBER <span class="redact">ADRIAN HOLLE</span>. PRIVATE RESIDENCE. MONITORING: CONTINUOUS. REASON: <span class="redact">LEVERAGE</span>.' },
  { scene: 'platform', date: '2018.10.02 / 18:20', cls: 'CIVILIAN', text: 'NO OFFENSE. NO ASSOCIATION. FACE ARCHIVED 214 TIMES SINCE 2011. PURPOSE: NOT SPECIFIED.' },
  { scene: 'street', date: '2022.07.19 / 01:12', cls: 'BPD PATROL UNIT 31', text: 'POLICE VEHICLE ALSO MONITORED. OFFICER <span class="redact">R. MARSH</span> — FLAGGED: “LEAK RISK”.' },
  { scene: 'film', date: '1981.04.03 / 00:40', cls: 'NODE U-04', text: 'LOCATION: BENEATH CIVIC CENTER. INSTALLED: PRE-1980. ORIGINAL MEDIUM: 16MM / 8 FPS.' },
  { scene: 'alley', date: '2023.09.24 / 02:14', cls: 'MORROW STREET', text: 'CONNECTION TEST — CAMERA 04. EIGHT DAYS BEFORE THE DEATH OF ELIAS VANE.' },
  { scene: 'alley', date: '2017.02.12 / 22:09', cls: 'DOMESTIC VIOLENCE CALL', text: 'ASSAULT OBSERVED IN REAL TIME. INTERVENTION: NONE. OBSERVATION ONLY.' },
];

// subject files. To use a real image: add  img: 'assets/images/subject-001.jpg'
const SUBJECTS = [
  { id: '001', alias: 'PUBLIC NAME: “HALCYON”', look: 'public', stamp: 'REGISTERED',
    fields: [['STATUS', 'REGISTERED'], ['PUBLIC ROLE', 'HERO'], ['THREAT LEVEL', 'LOW']],
    more: [['PUBLIC APPEARANCES', '212'], ['PRIVATE MOVEMENTS', 'ALSO LOGGED'], ['HOME ADDRESS', '<span class="redact">KNOWN</span>']] },
  { id: '007', alias: '—', look: 'blur', stamp: 'CLASSIFIED',
    fields: [['STATUS', 'GOVERNMENT CONTRACT'], ['THREAT LEVEL', 'CLASSIFIED']],
    more: [['CONTRACT ISSUER', '<span class="redact">DEPT. ███</span>'], ['MONITORING AUTHORISED BY', '<span class="redact">W-13</span>']],
    doc: 'assets/images/docs/fbi-file.jpg' },
  { id: '014', alias: 'NO IMAGE ON FILE', look: 'none',
    fields: [['STATUS', 'UNREGISTERED'], ['LOCATION', 'UNKNOWN']],
    more: [['LAST NODE', 'U-31 / 2022.11.03'], ['ASSESSMENT', 'PRESUMED ALIVE']] },
  { id: '019', alias: 'CIVILIAN — ENHANCED', look: 'small',
    fields: [['STATUS', 'CIVILIAN ENHANCED'], ['MONITORING LEVEL', 'PASSIVE']],
    more: [['AGE AT FIRST ENTRY', '9'], ['OFFENSES', 'NONE'], ['FAMILY INFORMED', 'NO']],
    doc: 'assets/images/docs/xray-collage.jpg' },
  { id: '023', alias: 'EAST BELLMONT VIGILANTE', look: 'mask', stamp: 'ACTIVE', symbol: true,
    fields: [['STATUS', 'ACTIVE'], ['THREAT LEVEL', 'HIGH']],
    more: [['FIRST TRACKED', '2023.01.14'], ['MORROW ST / 10.02', 'OBSERVED'], ['INTERVENTION', 'NOT AUTHORISED']],
    doc: 'assets/images/docs/fingerprints.jpg' },
  { id: '0??', alias: 'PROFILE BEING COMPILED', look: 'none', loading: true,
    fields: [['STATUS', 'OBSERVING'], ['SOURCE', 'ARCHIVE TERMINAL']],
    more: [['NOTE', 'INSUFFICIENT DATA. CONTINUE OBSERVATION.']] },
];

// the vigilante's mark from Issue 01: rough circle, imperfect X, one line past the edge
const SYMBOL_SVG = `<svg class="subj-symbol" viewBox="0 0 100 120" aria-hidden="true">
  <path d="M52 9 C76 8 93 28 92 51 C91 76 71 93 48 92 C24 91 8 71 9 49 C10 26 28 10 55 11"/>
  <path d="M23 21 L78 82"/><path d="M80 19 L27 112"/></svg>`;

const CONF = { v: 61 };   // shared "match confidence"


/* ---------- 08b FILM OPENING — the shot list ----------
   One object per shot, in order. Edit freely.
     kind   'title' | 'page' (Issue 01 page on paper) | 'note' (handwritten note) | 'photo' (full-bleed still)
     img    image path  — REPLACE assets/images/film/shot0X-*.jpg with your own / licensed stills
     dur    how long the shot holds (ms) before cutting; a click cuts early
     from / to   camera move: x, y = point of the image to centre (0–1), s = zoom
     marks  pen strokes drawn on the image: { d: SVG path in image pixels, at: ms }
     torch  true → the image is dark and the cursor is a flashlight
     flicker / focus / steps   fluorescent flicker / focus pull / footstep sound
     bright brightness of the photo (1 = as is, 2 = twice as bright) — raise it for dark images
     out    how this shot ends: 'black' (default) or 'white' (flash cut)
     sub    the detective's line (typewriter subtitle) */

// a hand-drawn loop around a word (image pixels)
function handEllipse(cx, cy, rx, ry) {
  let d = '';
  for (let i = 0; i <= 34; i++) {
    const a = -Math.PI * .95 + (i / 30) * Math.PI * 2.1;
    const j = 1 + Math.sin(i * 1.7) * .035 + i * .004;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rx * j).toFixed(1)},${(cy + Math.sin(a) * ry * j - i * .5).toFixed(1)}`;
  }
  return d;
}

const SHOTS = [
  { kind: 'title', dur: 6000 },
  { kind: 'page', img: 'assets/images/issue01/spread-10.jpg', dur: 8000,      // ISSUE 01 — EVIDENCE 03
    from: { x: .5, y: .5, s: 1 }, to: { x: .32, y: .53, s: 2.6 },
    marks: [{ d: 'M540 1052 C 700 1060, 900 1046, 1150 1055', at: 4200 }],
    sub: 'Five minutes of footage, missing. Everyone said the camera failed.' },
  { kind: 'page', img: 'assets/images/issue01/spread-21.jpg', dur: 8000,      // ISSUE 01 — OPEN QUESTIONS
    from: { x: .56, y: .32, s: 1.05 }, to: { x: .615, y: .145, s: 3.4 },
    marks: [{ d: handEllipse(1608, 274, 182, 36), at: 4000 }],
    sub: 'I stopped asking who killed Elias Vane. I started asking who turned off the camera.' },
  { kind: 'note', dur: 6500,
    label: 'CAMERA 04 — SERVICE LOG — REMOTE MAINTENANCE — RETURN ADDRESS:',
    note: 'Civic Center — Sublevel 2',
    sub: 'The maintenance request did not come from the city.' },
  { kind: 'photo', img: 'assets/images/film/shot04-exterior.jpg', dur: 7000, bright: 1.7,
    from: { x: .5, y: .8, s: 1 }, to: { x: .5, y: .45, s: 1.12 }, stamp: true,
    sub: 'Bellmont Civic Center. Closed since 1998. On paper.' },
  { kind: 'photo', img: 'assets/images/film/shot05-stairs-a.jpg', dur: 7000, bright: 2.1, torch: true, steps: true,
    from: { x: .5, y: .5, s: 1.02 }, to: { x: .45, y: .55, s: 1.1 },
    sub: 'Sublevel 2 is not on any floor plan.' },
  { kind: 'photo', img: 'assets/images/film/shot05-stairs-b.jpg', dur: 7000, bright: 1.9, torch: true, steps: true,
    from: { x: .5, y: .5, s: 1 }, to: { x: .5, y: .55, s: 1.35 },
    sub: 'The deeper I went, the warmer the air got. Machines.' },
  { kind: 'photo', img: 'assets/images/film/shot06-corridor-a.jpg', dur: 6000, bright: 1.35, flicker: true, steps: true,
    from: { x: .52, y: .5, s: 1 }, to: { x: .52, y: .48, s: 1.18 },
    sub: 'Someone had been here. Recently.' },
  { kind: 'photo', img: 'assets/images/film/shot06-corridor-b.jpg', dur: 5500, bright: 1.55, flicker: true,
    from: { x: .5, y: .5, s: 1.04 }, to: { x: .5, y: .48, s: 1.2 },
    sub: 'Every door was locked. Except one.' },
  { kind: 'photo', img: 'assets/images/film/shot07-door.jpg', dur: 5500, bright: 1.15, focus: true, out: 'white',
    from: { x: .62, y: .5, s: 1.15 }, to: { x: .62, y: .5, s: 1.02 },
    sub: 'I should have turned around.' },
  { kind: 'photo', img: 'assets/images/film/shot08-eye.jpg', dur: 6500, bright: 2.3,       // the wall, reflected in the eye
    from: { x: .5, y: .55, s: 1 }, to: { x: .5, y: .58, s: 2.3 },
    sub: 'Then I saw them.' },
];

const Film = {
  i: -1, tk: 0, tok: 0, timer: null, shotTimers: [], busy: false, ending: false,
  pointer: { x: 0, y: 0, t: 0 },

  init() {
    SHOTS.forEach(s => { if (s.img) new Image().src = s.img; });      // preload
    const stage = $('#film');
    stage.addEventListener('click', e => { if (!e.target.closest('#film-skip')) this.next(); });
    $('#film-skip').addEventListener('click', () => this.finish());
    stage.addEventListener('pointermove', e => { Object.assign(this.pointer, { x: e.clientX, y: e.clientY, t: Date.now() }); });
  },
  start(tk) { this.tk = tk; this.i = -1; this.ending = false; $('#film').classList.remove('is-opening'); $('#film-cut').className = 'film-cut'; this.show(0); },
  stop() { clearTimeout(this.timer); this.clearShot(); this.tok++; },
  clearShot() { this.shotTimers.forEach(clearInterval); this.shotTimers.forEach(clearTimeout); this.shotTimers = []; },
  next() { if (!this.busy && !this.ending && STAGES[current]?.id === 'film') this.show(this.i + 1); },

  // cut to shot i: a black (or white) frame in between, like a splice
  async show(i) {
    const tk = this.tk;
    if (i >= SHOTS.length) return this.finish();
    clearTimeout(this.timer);
    this.busy = true;
    const cut = $('#film-cut');
    if (this.i >= 0) {
      const white = SHOTS[this.i].out === 'white';
      cut.className = `film-cut is-${white ? 'white' : 'black'}`;
      Sound.burst(white ? .3 : .06, white ? .08 : .025);
      await wait(white ? 450 : rand(160, 280));
      if (tk !== RUN) return;
    }
    this.i = i;
    this.render(SHOTS[i]);
    cut.className = 'film-cut';
    this.busy = false;
    this.timer = setTimeout(() => { if (tk === RUN) this.next(); }, SHOTS[i].dur);
  },

  render(s) {
    this.clearShot();
    const frame = $('#film-frame');
    frame.innerHTML = '';
    $('#film-count').textContent = `SHOT ${pad(this.i + 1)} / ${pad(SHOTS.length)}`;
    $('#film').classList.toggle('has-torch', !!s.torch);

    const shot = el('div', `shot shot--${s.kind}${s.flicker ? ' is-flicker' : ''}${s.focus ? ' is-focus' : ''}`);
    if (s.bright) shot.style.setProperty('--b', s.bright);
    frame.append(shot);

    if (s.kind === 'title') {
      shot.innerHTML = `<div class="film-title">
        <p># WATCHMAN<br>## ISSUE 02</p>
        <p class="film-title-big">SURVEILLANCE</p>
        <p class="dim">WHAT IS JUSTICE? — CAN SURVEILLANCE BE JUST?</p></div>`;
    } else if (s.kind === 'note') {
      // HANDWRITTEN NOTE — replace with a scan of your own handwriting (an <img>) if you make one
      shot.innerHTML = `<div class="film-note"><p class="film-note-label">${s.label}</p><p class="film-note-hand">${s.note}</p></div>`;
    } else {
      this.image(shot, s);
    }

    if (s.stamp) {   // a hint: this "film" already has a timestamp
      const st = el('div', 'film-stamp', `CAM ?? &nbsp;2024.03.11 &nbsp;<span data-clock="${ARCHIVE_START - 1800}"></span>`);
      shot.append(st); tickClocks();
    }
    if (s.torch) this.torch(shot);
    if (s.steps) this.shotTimers.push(setInterval(() => Sound.blip(rand(60, 80), .1, 'sine', .09), 640));

    // subtitle, typed — a new shot interrupts the old line
    const sub = $('#film-sub'), tok = ++this.tok, text = s.sub || '';
    sub.textContent = '';
    let k = 0;
    const iv = setInterval(() => {
      if (tok !== this.tok) return clearInterval(iv);
      sub.textContent = text.slice(0, ++k);
      if (k % 4 === 0) Sound.click();
      if (k >= text.length) clearInterval(iv);
    }, 36);
    this.shotTimers.push(iv);
  },

  // still image + slow camera move (Ken Burns) + optional pen marks
  image(shot, s) {
    const wrap = el('div', 'shot-img');
    const img = new Image();
    img.alt = '';
    img.src = s.img;
    wrap.append(img);
    shot.append(wrap);
    const place = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const W = shot.clientWidth, H = shot.clientHeight;
      const k = s.kind === 'page' ? Math.min((W * .86) / iw, (H * .72) / ih) : Math.max(W / iw, H / ih);
      const dw = iw * k, dh = ih * k, left = (W - dw) / 2, top = (H - dh) / 2;
      Object.assign(wrap.style, { left: `${left}px`, top: `${top}px`, width: `${dw}px`, height: `${dh}px` });
      const tf = st => {
        let tx = W / 2 - left - st.s * st.x * dw, ty = H / 2 - top - st.s * st.y * dh;
        if (s.kind !== 'page') {            // photos never show their edges
          tx = clamp(tx, W - left - st.s * dw, -left);
          ty = clamp(ty, H - top - st.s * dh, -top);
        }
        return `translate(${tx}px, ${ty}px) scale(${st.s})`;
      };
      const from = s.from || { x: .5, y: .5, s: 1 };
      wrap.style.transition = 'none';
      wrap.style.transform = tf(from);
      if (s.marks) {
        const svg = svgEl('svg', { class: 'shot-mark', viewBox: `0 0 ${iw} ${ih}`, preserveAspectRatio: 'none' });
        wrap.append(svg);
        s.marks.forEach(m => {
          const p = svgEl('path', { d: m.d }, svg);
          p.style.setProperty('--len', p.getTotalLength());
          this.shotTimers.push(setTimeout(() => { p.classList.add('is-drawn'); Sound.blip(300, .25, 'triangle', .02); }, m.at));
        });
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        wrap.style.transition = `transform ${s.dur + 900}ms cubic-bezier(.3, .1, .3, 1)`;
        wrap.style.transform = tf(s.to || from);
      }));
    };
    if (img.complete && img.naturalWidth) place(); else img.onload = place;
  },

  // the cursor is a flashlight; without a mouse (touch / idle) the light searches on its own
  torch(shot) {
    const t = el('div', 'film-torch');
    shot.append(t);
    const move = () => {
      let { x, y } = this.pointer;
      if (Date.now() - this.pointer.t > 2200) {
        const s = Date.now() / 1000;
        x = innerWidth * (.5 + Math.sin(s * .6) * .3);
        y = innerHeight * (.5 + Math.sin(s * .9) * .22);
      }
      t.style.setProperty('--tx', `${x}px`);
      t.style.setProperty('--ty', `${y}px`);
    };
    move();
    this.shotTimers.push(setInterval(move, 40));
  },

  // the door opens: letterbox bars slide away, white-out, the wall
  async finish() {
    if (this.ending) return;
    this.ending = true;
    clearTimeout(this.timer); this.clearShot(); this.tok++;
    const tk = this.tk;
    $('#film-sub').textContent = '';
    $('#film').classList.add('is-opening');
    Sound.burst(.6, .1);
    await wait(500);
    $('#film-cut').className = 'film-cut is-white';
    await wait(450);
    if (tk === RUN) goTo(1, { quiet: true, arrive: true });
  },
};


/* ---------- 09 CITY MAP ----------
   The camera network of Bellmont (stage 07). Nodes are generated (seeded);
   the city underneath is an image — HIDDEN NETWORK MAP: replace MAP.img
   (and its w/h in pixels) to use another map. With img: null a street grid is drawn instead. */
const MAP = { img: 'assets/images/map/network-map.jpg', focusY: .45 };   // focusY: which band of a tall map to show (0 top – 1 bottom)
const MAP_H = 620;                                                       // the map is shown as a wide 1000×620 window
let CITY = null;
function buildCity() {
  const r = seeded(1974);
  const streets = [];
  for (let i = 0; i < 10; i++) { const y = 30 + i * 64 + (r() - .5) * 20; streets.push([0, y, 1000, y + (r() - .5) * 50]); }
  for (let i = 0; i < 16; i++) { const x = 20 + i * 64 + (r() - .5) * 24; streets.push([x, 0, x + (r() - .5) * 60, 620]); }
  streets.push([0, 600, 1000, 60], [80, 0, 760, 620]);
  const subs = [];                               // old tunnels beneath the city
  for (let i = 0; i < 9; i++) subs.push([420 + (r() - .5) * 40, 260 + (r() - .5) * 40, r() * 1000, r() * 620]);

  const nodes = [];
  for (let i = 0; i < 92; i++) nodes.push({ id: `C-${pad(i + 1, 3)}`, kind: 'reg', x: 20 + r() * 960, y: 20 + r() * 580, since: 1998 + Math.floor(r() * r() * 26) });
  for (let i = 0; i < 37; i++) nodes.push({ id: `U-${pad(i + 1)}`, kind: 'unreg', x: 30 + r() * 940, y: 30 + r() * 560, since: 1974 + Math.floor(r() * r() * 42), frag: i });
  for (let i = 0; i < 12; i++) nodes.push({ id: `R-${pad(i + 1)}`, kind: 'relay', x: 120 + r() * 760, y: 80 + r() * 460, since: 1974 + Math.floor(r() * 16), frag: i + 3 });
  nodes.push({ id: 'CAM 04', kind: 'reg', x: 640, y: 312, since: 2016, cam04: true });

  const near = (n, kind) => nodes.filter(m => m !== n && m.kind === kind).sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y))[0];
  const links = [];
  nodes.forEach(n => {
    if (n.kind === 'reg') { const m = near(n, 'reg'); links.push({ a: n, b: m, kind: 'reg' }); }
    if (n.kind === 'unreg' || n.cam04) links.push({ a: n, b: near(n, 'relay'), kind: 'unreg' });
  });
  const relays = nodes.filter(n => n.kind === 'relay').sort((a, b) => a.x - b.x);
  relays.forEach((n, i) => { if (relays[i + 1]) links.push({ a: n, b: relays[i + 1], kind: 'relay' }); });
  links.forEach(l => { l.since = Math.max(l.a.since, l.b.since); });

  const districts = [['NORTHGATE', 90, 70], ['EAST BELLMONT', 760, 110], ['CIVIC CENTER', 400, 240], ['MORROW ST', 610, 290], ['CANAL DISTRICT', 500, 430], ['OLD HARBOR', 120, 540]];
  // everything above was laid out on a 1000×620 sheet → stretch it down to the map's height
  const k = MAP_H / 620;
  nodes.forEach(n => { n.y *= k; });
  subs.forEach(s => { s[1] *= k; s[3] *= k; });
  districts.forEach(d => { d[2] *= k; });
  CITY = { streets, subs, nodes, links, districts, exit: relays[relays.length - 1] };
}

function drawCity(svg, onNode) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 1000 ${MAP_H}`);
  const g = cls => svgEl('g', { class: cls }, svg);
  const base = g('layer-base');
  if (MAP.img) {
    // cover the 1000×620 window with the map; a tall map is cropped to the band around focusY
    const img = svgEl('image', { href: MAP.img, x: 0, y: 0, width: 1000, height: MAP_H, preserveAspectRatio: 'xMidYMid slice', class: 'map-image' }, base);
    const probe = new Image();
    probe.onload = () => {
      const h = 1000 * probe.naturalHeight / probe.naturalWidth;
      if (h <= MAP_H) return;
      img.setAttribute('height', h);
      img.setAttribute('y', -(h - MAP_H) * (MAP.focusY ?? .5));
      img.setAttribute('preserveAspectRatio', 'none');
    };
    probe.src = MAP.img;
  } else {
    svgEl('path', { class: 'map-river', d: 'M0,470 C220,430 330,560 520,520 S820,430 1000,480' }, base);
    CITY.streets.forEach(([x1, y1, x2, y2]) => svgEl('line', { class: 'map-street', x1, y1, x2, y2 }, base));
  }
  CITY.districts.forEach(([t, x, y]) => { svgEl('text', { class: 'map-district', x, y }, base).textContent = t; });

  const sub = g('layer-sub layer-off');
  CITY.subs.forEach(([x1, y1, x2, y2]) => svgEl('path', { class: 'map-sub', d: `M${x1},${y1} Q${(x1 + x2) / 2 + 60},${y1} ${x2},${y2}` }, sub));

  const layers = { reg: g('layer-reg'), unreg: g('layer-unreg'), relay: g('layer-relay') };
  CITY.links.forEach(l => {
    svgEl('line', { class: `link-${l.kind}`, x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y, 'data-since': l.since }, layers[l.kind]);
  });
  // the relay chain leaves the map → external network W-13
  const ex = CITY.exit;
  const ey = MAP_H * .48;
  svgEl('line', { class: 'link-relay', x1: ex.x, y1: ex.y, x2: 1000, y2: ey, 'data-since': ex.since }, layers.relay);
  svgEl('text', { class: 'map-label', x: 905, y: ey - 8, 'data-since': ex.since }, layers.relay).textContent = 'W-13 → EXTERNAL';

  CITY.nodes.forEach(n => {
    const layer = layers[n.kind];
    let shape;
    if (n.kind === 'reg') shape = svgEl('rect', { class: n.cam04 ? 'node-reg node-cam04' : 'node-reg', x: n.x - 2.5, y: n.y - 2.5, width: 5, height: 5 }, layer);
    if (n.kind === 'unreg') shape = svgEl('path', { class: 'node-unreg', d: `M${n.x},${n.y - 6} L${n.x + 6},${n.y} L${n.x},${n.y + 6} L${n.x - 6},${n.y} Z` }, layer);
    if (n.kind === 'relay') shape = svgEl('path', { class: 'node-relay', d: `M${n.x},${n.y - 8} L${n.x + 7},${n.y + 5} L${n.x - 7},${n.y + 5} Z` }, layer);
    shape.dataset.since = n.since;
    n.el = shape;
    if (n.cam04) { const t = svgEl('text', { class: 'map-label', x: n.x + 8, y: n.y - 6, 'data-since': n.since }, layer); t.textContent = 'CAM 04 / MORROW'; }
    if (onNode && n.kind !== 'reg') {
      const hit = svgEl('circle', { class: 'node-hit', cx: n.x, cy: n.y, r: 13, 'data-since': n.since }, layer);
      hit.addEventListener('click', () => onNode(n));
      hit.addEventListener('mouseenter', e => Tip.show(`<b>${n.id}</b><dl><dt>TYPE</dt><dd>${n.kind === 'relay' ? 'RELAY POINT' : 'UNREGISTERED NODE'}</dd><dt>OWNER</dt><dd class="inv">NONE ON RECORD</dd><dt>ACTIVE SINCE</dt><dd>${n.since}</dd></dl>`, e));
      hit.addEventListener('mousemove', e => Tip.move(e));
      hit.addEventListener('mouseleave', () => Tip.hide());
    }
  });
}

// number animation for stats
function countUp(node, to, ms = 1400) {
  const t0 = performance.now();
  const step = now => {
    const k = clamp((now - t0) / ms, 0, 1);
    node.textContent = Math.round(to * (k < 1 ? k * k : 1)).toLocaleString('en-US');
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


/* ---------- 10 STAGES ----------
   Each stage: id (section id), title, and optional
     init()      once, the first time the stage opens (build DOM)
     enter(tk)   every time it opens (start sequences; use sleep(ms, tk))
     exit()      when leaving
   showProceed(label) reveals the PROCEED button for the next stage. */

/* The wall: a flat, frontal grid of 4:3 screens that fills the whole viewport.
   Column count by width; rows = as many as it takes to reach the bottom. */
const WALL = { cols: 0, rows: 0, feeds: [], cams: [] };
function wallSize() {
  const w = innerWidth || 1280, h = innerHeight || 800;   // (can be 0 for a moment while the window opens)
  const cols = w >= 1400 ? 12 : w >= 1100 ? 10 : w >= 900 ? 8 : w >= 600 ? 6 : 4;
  return { cols, rows: clamp(Math.ceil(h / ((w / cols) * .75)), 1, 16) };
}
function buildWall() {
  WALL.feeds.forEach(destroyFeed); WALL.feeds = [];
  const { cols, rows } = wallSize();
  Object.assign(WALL, { cols, rows });
  const grid = $('#wall-grid');
  grid.innerHTML = '';
  grid.style.setProperty('--cols', cols);
  const total = cols * rows;

  // put the named cameras near the centre of the wall, the rest are generic city feeds
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const order = [...Array(total).keys()].sort((a, b) =>
    Math.hypot((a % cols) - cx, (Math.floor(a / cols) - cy) * 1.6) - Math.hypot((b % cols) - cx, (Math.floor(b / cols) - cy) * 1.6));
  const slots = order.filter((_, k) => k % 2 === 0).concat(order.filter((_, k) => k % 2 === 1));
  const cams = new Array(total);
  CAMS.forEach((c, k) => { if (k < total) cams[slots[k]] = c; });
  let fi = 0;
  for (let i = 0; i < total; i++) if (!cams[i]) cams[i] = fillerCam(fi++);
  WALL.cams = cams;

  const dark = seeded(77);
  cams.forEach((cam, i) => {
    // a few dead screens, like gaps in a real monitor wall
    if (!CAMS.includes(cam) && dark() < .07) { grid.append(el('div', 'tile is-dark')); return; }
    const tile = el('button', 'tile');
    tile.type = 'button';
    tile.setAttribute('aria-label', `${cam.id} — ${cam.loc}`);
    tile.style.setProperty('--b', ((cam.clip ? .85 : 1.3) + dark() * (cam.clip ? .7 : 1.2)).toFixed(2));   // footage is already lifted
    const v = feedBox(cam, { w: 160, h: 120, fps: rand(4, 7), labels: 'min', noise: .25 });
    tile.append(v.box);
    WALL.feeds.push(v.feed);
    if (cam.match) tile.dataset.match = '1';
    tile.addEventListener('mouseenter', e => Tip.show(camMeta(cam), e));
    tile.addEventListener('mousemove', e => Tip.move(e));
    tile.addEventListener('mouseleave', () => Tip.hide());
    tile.addEventListener('click', e => pickFeed(cam, e));
    grid.append(tile);
  });
}

/* ---------- 10a TEMPTATION — the detective's dilemma in the CCTV room ----------
   The detective has found the room. Every feed he opens answers with more:
   windows burst out (faces, records, addresses), duplicate themselves, refuse
   to close — and black boxes slowly take over the screen. After a few looks the
   system asks the question the issue is about: will he use it?
   Edit the detective's thoughts in TEMPT_NOTES (one per look, in order). */
const TEMPT_NOTES = [
  'Just one more camera.',
  'He could be on any of these.',
  'I could find him tonight.',
  "Isn't this exactly what he did? Watch. Decide.",
  'If I use this, what am I?',
  'Nobody would ever know.',
  "I'm not watching him. I'm watching everyone.",
];
const PRIORS = ['NONE — CIVILIAN', 'ASSAULT — CHARGES DROPPED', 'THEFT — 2019', 'DOMESTIC CALL — NO ARREST', 'PAROLE — ACTIVE', 'NONE', 'TRESPASS — 2021'];
const STREETS = ['MORROW', 'HOLLIS', 'GRANT', 'KESSLER', 'CANAL', 'SEVENTH'];

const Tempt = {
  n: 0, live: [], asked: false, lines: '',

  reset() {
    this.n = 0; this.asked = false; this.lines = '';
    this.live.forEach(v => { destroyFeed(v.feed); v.tracker?.destroy(); });
    this.live = [];
    $$('#tempt .twin, #tempt-front .twin').forEach(w => w.remove());
    this.z = 0;
    $('#tempt-lines').innerHTML = '';
    $('#blackout').innerHTML = '';
    $('#dilemma').hidden = true;
  },

  // a feed was clicked at (cx, cy) — screen coordinates
  async burst(cam, cx, cy) {
    const tk = RUN, r = $('#tempt').getBoundingClientRect();
    const x0 = cx - r.left, y0 = cy - r.top;
    this.n++; STATE.feedsOpened++;
    const types = ['feed', 'match', 'face', 'record', 'loc', 'face', 'dup', 'record', 'dup', 'face', 'loc', 'dup', 'record', 'dup', 'dup'];
    const count = Math.min(5 + this.n * 2, types.length);
    Sound.burst(.12, .05);
    for (let k = 0; k < count; k++) {
      if (tk !== RUN) return;
      this.spawn(types[k], cam, x0, y0, k);
      await wait(70);
    }
    if (tk !== RUN) return;
    this.spawn('note', cam, x0, y0, count);
    this.black(this.n + 2);
    if (this.n >= 4 && !this.asked) later(1600, () => this.ask());
  },

  spawn(type, cam, x0, y0, k) {
    const L = $('#tempt');
    if (type === 'dup') {                                   // the same window again, slightly off
      const src = pick($$('.twin:not(.twin--note)', L));
      if (!src) return;
      const w = src.cloneNode(true);
      $$('canvas', src).forEach((c, i) => $$('canvas', w)[i].getContext('2d').drawImage(c, 0, 0));
      w.style.left = `${parseFloat(src.style.left) + randInt(8, 18)}px`;
      w.style.top = `${parseFloat(src.style.top) + randInt(8, 18)}px`;
      this.wire(w);
      L.append(w);
      Sound.click();
      return;
    }
    const w = el('div', `twin twin--${type}`);
    const id = `${pad(randInt(1000, 9999), 4)}`;
    const head = t => `<header><span>${t}</span><button type="button" aria-label="Close">×</button></header>`;
    if (type === 'feed') {
      w.innerHTML = head(`${cam.id} — LIVE`) + '<div class="body"></div>';
      const v = feedBox(cam, { w: 160, h: 120, fps: 8 });
      v.tracker = createTracker(v.box, v.feed, { target: cam.match ? 0 : -1, primary: () => `SUBJECT 023? ${CONF.v}%`, words: ['PERSON', 'PERSON', '?'], ghosts: 1 });
      w.lastChild.append(v.box);
      this.live.push(v);
      if (this.live.length > 3) { const old = this.live.shift(); destroyFeed(old.feed); old.tracker?.destroy(); }   // older ones freeze
    } else if (type === 'face') {
      w.innerHTML = head(`FACE MATCH — ${id}`) + `<div class="body"><canvas width="64" height="80"></canvas><p>PERSON ${id}<br>MATCH 0.${randInt(12, 88)}</p></div>`;
      drawPortrait($('canvas', w), 'face', randInt(1, 999));
    } else if (type === 'record') {
      w.innerHTML = head(`RECORD — ${id}`) + `<div class="body">
        ${kv('NAME', '<span class="redact">██████ ███</span>')}<br>${kv('PRIOR', pick(PRIORS))}<br>
        ${kv('ADDRESS', `${randInt(10, 240)} ${pick(STREETS)} ST — APT ${randInt(1, 30)}`)}<br>${kv('STATUS', pick(['NOT A SUSPECT', 'CIVILIAN', 'UNKNOWN', 'OF INTEREST']))}</div>`;
    } else if (type === 'loc') {
      w.innerHTML = head('MOVEMENT') + `<div class="body">
        ${kv('LAST SEEN', `${cam.id} / ${fmtClock(ARCHIVE_START + elapsed())}`)}<br>
        ${kv('NEXT LIKELY', `CAM ${randInt(10, 99)} (${randInt(30, 90)}%)`)}<br>${kv('HOME', `${randInt(200, 900)} M`)}</div>`;
    } else if (type === 'match') {
      w.innerHTML = head('MATCH — SUBJECT 023?') + `<div class="body"><p class="big">${cam.match ? 61 : randInt(8, 64)}%</p></div>`;
    } else if (type === 'note') {                          // the detective, thinking
      w.innerHTML = `<div class="body">${TEMPT_NOTES[Math.min(this.n - 1, TEMPT_NOTES.length - 1)]}</div>`;
    }
    // place it around the click, spreading towards the middle of the screen, further out each time
    const Wd = L.clientWidth, Ht = L.clientHeight;
    const ang = Math.atan2(Ht / 2 - y0, Wd / 2 - x0) + rand(-1.3, 1.3), dist = 70 + k * 22 + this.n * 14;
    const ww = Math.min(type === 'feed' ? 300 : 220, Wd * .6);
    w.style.left = `${clamp(x0 + Math.cos(ang) * dist - ww / 2, 8, Wd - ww - 8)}px`;
    w.style.top = `${clamp(y0 + Math.sin(ang) * dist * .7 - 60, 8, Ht - 140)}px`;
    if (type !== 'note') this.wire(w);
    if (type === 'feed') {
      // the camera you clicked goes in front of everything — newest on top
      w.style.zIndex = ++this.z;
      $('#tempt-front').append(w);
      w.addEventListener('pointerdown', () => { w.style.zIndex = ++this.z; });   // click an older one → it comes forward
    } else {
      L.append(w);
    }
    this.line(x0, y0, w);
    Sound.click();
  },

  // closing a window doesn't help — sometimes it comes back as two
  wire(w) {
    const b = $('header button', w);
    if (!b) return;
    b.onclick = e => {
      e.stopPropagation();
      const r = w.getBoundingClientRect(), L = $('#tempt').getBoundingClientRect();
      w.remove();
      if (Math.random() < .45) { this.spawn('record', {}, r.left - L.left + 40, r.top - L.top + 40, 1); this.spawn('dup', {}, 0, 0, 0); }
    };
  },

  line(x0, y0, w) {
    const x = parseFloat(w.style.left) + 10, y = parseFloat(w.style.top) + 10;
    this.lines += `M${x0},${y0}L${x},${y}`;
    const svg = $('#tempt-lines');
    svg.innerHTML = `<path d="${this.lines}"/>`;
  },

  // black boxes: the page is slowly swallowed
  black(count) {
    const B = $('#blackout');
    for (let i = 0; i < count; i++) {
      if (B.children.length > 80) return;
      const b = el('i', Math.random() < .3 ? 'lbl' : '');
      const w = rand(8, 34), h = rand(4, 20);
      Object.assign(b.style, { left: `${rand(-5, 100 - w)}%`, top: `${rand(-5, 100 - h)}%`, width: `${w}%`, height: `${h}%` });
      B.append(b);
    }
  },

  // the question
  ask() {
    if (this.asked) return;
    this.asked = true;
    const d = $('#dilemma'), tk = RUN;
    d.hidden = false;
    d.innerHTML = `<p class="dim">// WATCHMAN NOTE</p>
      <p class="q">USE IT TO FIND HIM?</p>
      <p>Every camera in Bellmont. Somewhere in there is the man who killed Elias Vane.</p>
      <div class="row"><button class="btn" type="button" data-a="yes">[ FIND HIM ]</button><button class="btn" type="button" data-a="no">[ LOOK AWAY ]</button></div>`;
    corrupt(d);
    Sound.blip(220, .4, 'sine', .05);
    d.onclick = async e => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      d.onclick = null;
      try {
        if (a === 'yes') {
          d.innerHTML = '<p class="hand-big">Just this once.</p>';
          for (let i = 0; i < 6; i++) { this.black(5); await sleep(160, tk); }
        } else {
          // he looks away. The room doesn't.
          d.hidden = true;
          for (let i = 0; i < 3; i++) {
            const cam = pick(WALL.cams.filter(Boolean));
            this.burst(cam, rand(innerWidth * .2, innerWidth * .8), rand(innerHeight * .25, innerHeight * .75));
            await sleep(900, tk);
          }
          this.black(14);
        }
        await sleep(2400, tk);
        goTo(2);
      } catch (err) { quiet(err); }
    };
  },
};

// the CCTV room calls this when a feed is clicked (flat wall or 3D room)
// → the clicked feed comes to the centre, large. ← / → browse the other feeds, ESC closes.
// (The old pop-up windows + black boxes live on in Tempt above — saved for the ending.)
function pickFeed(cam, e) {
  if (!cam) return;
  const all = window.Room3D?.cams?.includes(cam) ? Room3D.cams : WALL.cams;   // 3D room or flat wall
  const list = [...new Set(all)].filter(c => c && (c.scene !== 'nosignal' || c === cam));
  if (!list.includes(cam)) list.unshift(cam);
  Viewer.open(list, list.indexOf(cam), e?.clientX, e?.clientY);
}

function showProceed(label, n = current + 1) {
  const b = $('#proceed');
  b.textContent = label;
  b.hidden = false;
  b.onclick = () => goTo(n);
  Sound.blip(440, .08);
}
function hideProceed() { $('#proceed').hidden = true; }


/* the desk (opening) — Issue 01 becomes an evidence board.
   1. every page drops onto the desk, fast (the screen is the desk seen from above)
   2. the pile bursts out across the desk like an evidence board
   3. string connects the pages (tacks already in them) — most of it leads to one spread
   4. the pen circles "Who disabled Camera 04?" on the clue spread
   5. it waits: the cursor is a flashlight — click any page to open it;
      open the circled spread and click the circle → we zoom into the words → CCTV room
   Pages were rendered from EDIT FINAL44.pdf with tools/pdf-pages.swift. */
const DESK = {
  folder: 'assets/images/issue01/pages/',   // page-01.jpg … page-23.jpg
  count: 23,                                // REPLACE: number of pages
  last: 21,                                 // REPLACE: the clue spread (lands last, sits in the middle of the board, gets circled)
  size: [1799, 1312],                       // pixel size of a spread image
  circle: { x: 950, y: 104, w: 430, h: 96, rot: 10 }, // REPLACE: pen circle box on the clue spread (pixels of that image) + tilt in degrees
  pen: 'assets/images/desk/pen-circle.png', // REPLACE: your pen circle (black ink on transparent PNG)
  board: { cols: 7, rows: 4, spread: 21, cover: 12, hub: 34 },   // board layout: grid, page widths in % of the desk
  slack: .16,                               // REPLACE: how much the string hangs (0 = tight, straight)
  strings: 9,                               // REPLACE: how many extra strings between other pages (the clue spread always gets its own)
  // ms
  timing: { first: 300, gap: 150, fall: 150, burst: 650, burstGap: 14, string: 55, draw: 420, lamp: 900, circle: 700, hint: 7000, zoom: 1600, follow: .12 },   // hint = small text if nobody clicks, follow = how quickly the light trails the cursor
};

const STAGES = [

  /* ===== 01 — FILM OPENING ===== */
  {
    id: 'film', title: 'OPENING',
    init() { Film.init(); },
    enter(tk) { Film.start(tk); },
    exit() { Film.stop(); },
  },

  /* ===== 00 — THE DESK (opening) ===== */
  {
    id: 'desk', title: 'CASE FILE 001',
    init() {
      const T = this.table = el('div', 'desk-table');   // a 16:10 desk that scales with the window
      $('#desk-surface').append(T);
      const B = DESK.board, rnd = seeded(2024);
      // drop order: 1, 2, 3 … with the clue spread last (on top of the pile)
      const order = [...Array(DESK.count).keys()].map(k => k + 1).filter(n => n !== DESK.last).concat(DESK.last);

      // board slots: a jittered grid, with the middle kept free for the clue spread
      const slots = [];
      for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) {
        const x = (c + .5) / B.cols * 100, y = (r + .5) / B.rows * 100;
        if (Math.abs(x - 50) < 20 && Math.abs(y - 50) < 26) continue;
        slots.push({ x: x + (rnd() - .5) * 7, y: y + (rnd() - .5) * 9 });
      }
      for (let k = slots.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [slots[k], slots[m]] = [slots[m], slots[k]]; }

      this.cards = order.map((n, k) => {
        const hub = n === DESK.last, portrait = n === 1 || n === DESK.count;
        const card = el('div', 'paper');
        card.innerHTML = `<img src="${DESK.folder}page-${pad(n)}.jpg" alt="Issue 01 — page ${n}" draggable="false"><i class="pin"></i>`;
        // 1) where it lands in the pile
        // (all in the same spot, like turning to the next spread — the ones before peek out underneath)
        const pw = portrait ? 30 : 60;
        const ph = pw * (portrait ? 1800 / 1234 : DESK.size[1] / DESK.size[0]) * 1.6;
        card.pile = { w: pw, x: (100 - pw) / 2 + (rnd() - .5) * 2.4, y: (100 - ph) / 2 + (rnd() - .5) * 2.4, r: hub ? -.6 : (rnd() - .5) * 3.2 };
        // 2) where it ends up on the board
        const bw = hub ? B.hub : portrait ? B.cover : B.spread + (rnd() - .5) * 3;
        const ratio = portrait ? 1800 / 1234 : DESK.size[1] / DESK.size[0];
        const bh = bw * ratio * 1.6;                       // height in % of the desk (desk is 16:10)
        const at = hub ? { x: 50, y: 50 } : slots[k % slots.length];
        card.board = { w: bw, x: at.x - bw / 2, y: at.y - bh / 2, r: hub ? -1.5 : (rnd() - .5) * 16 };
        card.pinAt = { x: at.x + (rnd() - .5) * bw * .3, y: at.y - bh / 2 + bh * .07 };   // pin near the top edge
        if (hub) {   // the clue spread: its pin goes right next to the circled question, so every string leads to it
          const c = DESK.circle, [W, H] = DESK.size;
          card.pinAt = { x: card.board.x + (c.x / W) * bw, y: card.board.y + ((c.y + c.h * .5) / H) * bh };
        }
        if (hub) {
          const c = DESK.circle, [W, H] = DESK.size, img = el('img', 'paper-circle');
          img.src = DESK.pen; img.alt = ''; img.draggable = false;
          Object.assign(img.style, { left: `${c.x / W * 100}%`, top: `${c.y / H * 100}%`, width: `${c.w / W * 100}%`, height: `${c.h / H * 100}%`, transform: `rotate(${c.rot || 0}deg)` });
          card.append(img);
          this.circle = img; this.hub = card;
        }
        card.addEventListener('click', e => { if (this.ready) { e.stopPropagation(); this.open(n); } });   // open the page
        card.n = n;
        card.style.zIndex = k + 1;
        T.append(card);
        return card;
      });

      // the string: SVG over the whole desk (in % of the desk)
      const svg = this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'desk-strings'); svg.setAttribute('viewBox', '0 0 160 100');   // same 16:10 shape as the desk → x is % × 1.6
      T.append(svg);
      const others = this.cards.filter(c => c !== this.hub);
      const pairs = [];
      // every spread is tied to the clue spread …
      others.forEach((c, k) => { if (k % 2 === 0 || others.length < 10) pairs.push([c, this.hub]); });
      // … plus a few strings between the others (nearest neighbours)
      // (diagonal only — a string that runs flat along a row looks like one long red line)
      const used = new Set();
      for (let k = 0, tries = 0; k < DESK.strings && tries < 200; tries++) {
        const a = others[Math.floor(rnd() * others.length)];
        if (used.has(a)) continue;
        const b = others.filter(o => o !== a && !used.has(o))
          .filter(o => Math.abs(o.pinAt.y - a.pinAt.y) > Math.abs(o.pinAt.x - a.pinAt.x) * 1.6 * .45)   // steep enough
          .sort((p, q) => Math.hypot(p.pinAt.x - a.pinAt.x, p.pinAt.y - a.pinAt.y) - Math.hypot(q.pinAt.x - a.pinAt.x, q.pinAt.y - a.pinAt.y))[Math.floor(rnd() * 2)];
        if (!b) continue;
        pairs.push([a, b]); used.add(a); used.add(b); k++;
      }
      this.lines = pairs.map(([a, b]) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x1 = a.pinAt.x * 1.6, y1 = a.pinAt.y, x2 = b.pinAt.x * 1.6, y2 = b.pinAt.y;
        // the string is slack: it hangs (gravity) and drifts a little sideways, never a straight line
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, bend = len * DESK.slack * (.75 + rnd() * .5);
        let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;                          // across the string
        if (Math.abs(ny) < .25) { if (rnd() < .5) { nx = -nx; ny = -ny; } }        // near-vertical: bows to either side
        else if (ny < 0) { nx = -nx; ny = -ny; }                                    // otherwise it hangs downward
        const c1x = x1 + (x2 - x1) * .3 + nx * bend, c1y = y1 + (y2 - y1) * .3 + ny * bend;
        const c2x = x1 + (x2 - x1) * .7 + nx * bend * .85, c2y = y1 + (y2 - y1) * .7 + ny * bend * .85;
        p.setAttribute('d', `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`);
        p.setAttribute('pathLength', '1');
        svg.append(p);
        return p;
      });
      // pins sit on top of the string
      this.pins = this.cards.map(c => {
        const pin = el('i', 'desk-pin');
        Object.assign(pin.style, { left: `${c.pinAt.x}%`, top: `${c.pinAt.y}%` });
        T.append(pin);
        return pin;
      });
      $('#desk').addEventListener('click', () => { this.skip = true; });   // click = don't wait

      // the flashlight: the pool of light trails the cursor
      const L = $('#desk-lamp'), D = DESK.timing;
      this.light = { x: null, y: null, tx: null, ty: null };
      $('#desk').addEventListener('pointermove', e => {
        const r = L.getBoundingClientRect();
        this.light.tx = e.clientX - r.left; this.light.ty = e.clientY - r.top;
      });
      const step = () => {
        requestAnimationFrame(step);
        if (STAGES[current]?.id !== 'desk') return;
        const l = this.light, r = L.getBoundingClientRect();
        if (l.tx === null) { l.tx = r.width / 2; l.ty = r.height * .52; }        // no mouse yet → the middle of the desk
        if (l.x === null) { l.x = l.tx; l.y = l.ty; }
        l.x += (l.tx - l.x) * D.follow; l.y += (l.ty - l.y) * D.follow;
        L.style.setProperty('--lx', `${l.x.toFixed(1)}px`); L.style.setProperty('--ly', `${l.y.toFixed(1)}px`);
      };
      requestAnimationFrame(step);

      // the page viewer
      $('#desk-view-close').addEventListener('click', () => this.close());
      // the circle on the clue spread → into the CCTV room
      const c = DESK.circle, [W, H] = DESK.size, btn = $('#desk-view-circle');
      Object.assign(btn.style, { left: `${c.x / W * 100}%`, top: `${c.y / H * 100}%`, width: `${c.w / W * 100}%`, height: `${c.h / H * 100}%`, transform: `rotate(${c.rot || 0}deg)` });
      btn.addEventListener('click', e => { e.stopPropagation(); if (!this.leaving) this.follow(RUN).catch(quiet); });
      $('#desk-view-prev').addEventListener('click', () => this.open(this.viewing - 1));
      $('#desk-view-next').addEventListener('click', () => this.open(this.viewing + 1));
      $('#desk-view').addEventListener('click', e => { if (e.target.id === 'desk-view') this.close(); });
      document.addEventListener('keydown', e => {
        if ($('#desk-view').hidden) return;
        if (e.key === 'Escape') this.close();
        if (e.key === 'ArrowRight') this.open(this.viewing + 1);
        if (e.key === 'ArrowLeft') this.open(this.viewing - 1);
      });
    },

    // open page n of Issue 01, large
    open(n) {
      n = ((n - 1 + DESK.count) % DESK.count) + 1;
      this.viewing = n;
      const v = $('#desk-view');
      $('#desk-view-img').src = `${DESK.folder}page-${pad(n)}.jpg`;
      $('#desk-view-img').alt = `Issue 01 — page ${n}`;
      $('#desk-view-num').textContent = `PAGE ${pad(n)} / ${DESK.count}`;
      const btn = $('#desk-view-circle');
      btn.hidden = n !== DESK.last;                    // the circle only exists on the clue spread
      btn.classList.remove('is-drawn');
      if (n === DESK.last) later(350, () => btn.classList.add('is-drawn'));
      if (v.hidden) { v.hidden = false; v.classList.remove('is-opening'); void v.offsetWidth; v.classList.add('is-opening'); }
      Sound.click();
    },
    close() { if (!this.leaving) $('#desk-view').hidden = true; },

    place(card, s) {
      Object.assign(card.style, { left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%` });
      card.style.setProperty('--r', `${s.r}deg`);
    },

    async enter(tk) {
      const S = $('#desk-surface'), D = DESK.timing;
      S.classList.remove('is-leaving');
      S.style.removeProperty('--zoom');
      this.skip = false;
      this.circle?.classList.remove('is-drawn');
      this.lines.forEach(l => l.classList.remove('is-drawn'));
      this.pins.forEach(p => p.classList.remove('is-in'));
      this.cards.forEach(c => { c.hidden = true; this.place(c, c.pile); });
      // wait (max 4 s) for the pages to load so none of them drop in blank
      await Promise.race([Promise.all(this.cards.map(c => $('img', c).decode().catch(() => {}))), sleep(4000, tk)]);
      const wait = ms => this.skip ? Promise.resolve() : sleep(ms, tk);

      // the lamp is already on: everything happens in its pool of light
      $('#desk').classList.add('is-lamp');

      // 1 — the pile: pages drop onto the desk, fast
      await wait(D.first);
      for (const card of this.cards) {
        if (tk !== RUN) return;
        this.drop(card, this.skip ? 0 : D.fall);
        await wait(D.gap);
      }
      await wait(D.fall + 250);

      // 2 — the pile bursts out into an evidence board
      this.cards.forEach((card, k) => later(this.skip ? 0 : k * D.burstGap, () => this.move(card, card.board, this.skip ? 0 : D.burst)));
      Sound.burst(.08, .03);
      await wait(D.burst + this.cards.length * D.burstGap);

      // 3 — the tacks are already in the pages; the string connects them
      this.pins.forEach(p => p.classList.add('is-in'));
      for (const line of this.lines) { line.classList.add('is-drawn'); await wait(D.string); }
      await wait(D.draw + D.circle);

      // 4 — the clue spread sits under the lamp; the pen circles the question
      this.hub.classList.add('is-lit');
      await wait(D.lamp);
      this.circle?.classList.add('is-drawn');
      Sound.blip(260, .25, 'sine', .02);
      // 5 — wait for the visitor: click the lit spread
      this.ready = true;
      $('#desk').classList.add('is-board');
      later(D.circle + D.hint, () => { if (this.ready) $('#desk-hint').textContent = 'CLICK A PAGE TO OPEN IT'; });
    },

    // the lit spread was clicked → into the circled words → the CCTV room
    // the circle on the opened clue spread was clicked → into the circled words → the CCTV room
    async follow(tk) {
      const P = $('#desk-view-page'), D = DESK.timing;
      this.leaving = true; this.ready = false;
      const r = $('#desk-view-circle').getBoundingClientRect(), d = P.getBoundingClientRect();
      P.style.transformOrigin = `${r.left + r.width / 2 - d.left}px ${r.top + r.height / 2 - d.top}px`;
      P.style.setProperty('--zoom', Math.min(14, innerWidth * .7 / r.width).toFixed(2));   // the circled words fill the screen
      $('#desk-view').classList.add('is-leaving');
      Sound.click();
      await sleep(D.zoom, tk);
      goTo(STAGES.findIndex(s => s.id === 'wall'), { quiet: true });
    },

    exit() { this.ready = false; this.leaving = false; $('#desk-view').classList.remove('is-leaving'); this.close(); $('#desk').classList.remove('is-lamp', 'is-board'); this.hub?.classList.remove('is-lit'); $('#desk-hint').textContent = 'CASE FILE 001'; },

    // the next spread is slapped down on top — same spot, like a page turning; the ones before stay underneath
    drop(card, ms) {
      card.hidden = false;
      if (!ms) return;
      const r = card.pile.r;
      card.animate([
        { transform: `rotate(${r}deg) scale(1.045)`, boxShadow: '0 40px 60px rgba(0,0,0,.5)' },
        { transform: `rotate(${r}deg) scale(1)`, boxShadow: '0 18px 40px rgba(0,0,0,.65)' },
      ], { duration: ms, easing: 'cubic-bezier(.5, 0, .9, .5)' });
      later(ms, () => Sound.burst(.02, .025));        // slap
    },

    // slide a page from where it is to a new spot (pile → board)
    move(card, to, ms) {
      const a = card.getBoundingClientRect(), wa = card.offsetWidth, ra = parseFloat(card.style.getPropertyValue('--r')) || 0;
      this.place(card, to);
      if (!ms) return;
      const b = card.getBoundingClientRect(), wb = card.offsetWidth;
      const dx = (a.left + a.width / 2) - (b.left + b.width / 2), dy = (a.top + a.height / 2) - (b.top + b.height / 2);
      card.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(${ra}deg) scale(${wa / wb})` },
        { transform: `rotate(${to.r}deg) scale(1)` },
      ], { duration: ms, easing: 'cubic-bezier(.16, .9, .3, 1)' });   // flung out, settles
    },
  },

  /* ===== 02 — CCTV GRID ===== */
  {
    id: 'wall', title: 'CCTV GRID',
    init() {
      buildWall();
      let t;
      addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => { const s = wallSize(); if (s.cols !== WALL.cols || s.rows !== WALL.rows) buildWall(); }, 300);
      });
      // 360° room (room3d.js). The flat grid above stays as the fallback.
      const mount3d = () => { Room3D.mount($('#wall')); if (STAGES[current]?.id === 'wall' && !this.arriving) Room3D.reset(); };
      if (window.Room3D) mount3d(); else addEventListener('room3d-ready', mount3d, { once: true });
    },
    enter(tk, opts) {
      const total = WALL.cams.length;
      $('#wall-count').textContent = `FEEDS ONLINE ${total - 3} / ${total} — SHOWING ${total} OF 428`;
      $('#wall-alert').hidden = true;
      const stage = $('#wall');
      let delay = 0;
      if (opts.arrive) {
        // straight out of the white door-flash: the wall starts far away and comes towards you
        delay = 7000;
        stage.classList.add('is-far');
        document.body.classList.add('is-arriving');
        void stage.offsetWidth;                        // commit the far position before animating
        requestAnimationFrame(() => stage.classList.remove('is-far'));
        later(delay, () => document.body.classList.remove('is-arriving'));
        this.arriving = true;
        later(delay, () => { this.arriving = false; });
        window.Room3D?.arrive(delay);                 // 3D: walk in from the doorway
      } else {
        window.Room3D?.reset();
      }
      // find CAMERA 03 — nothing points to it; the longer it takes, the more the screen fills up
      Encroach.reset();
      Found.t0 = performance.now(); Found.log = [];
      later(delay + 4000, () => { Encroach.start(); window.Room3D?.hint(); });   // hint: CAMERA 04 blinks
    },
    exit() { $('#wall').classList.remove('is-far'); document.body.classList.remove('is-arriving'); Encroach.reset(); },
  },

  /* ===== 03 — SUBJECT TRACKING ===== */
  {
    id: 'track', title: 'SUBJECT TRACKING',
    init() {
      this.view = switchCamera($('#track-feed'), CAM('CAM 03'), {
        w: 384, h: 216, fps: 12, silent: true,
        tracker: { target: 0, primary: () => `SUBJECT ${CONF.v}%`, words: ['PERSON', 'PERSON', 'SUBJECT?', 'VEHICLE', 'PERSON'], ghosts: 3, edges: 3 },
      });
      this.frame = 1280;
    },
    async enter(tk) {
      const data = $('#track-data');
      data.innerHTML = '';
      $('#track-frames').innerHTML = '';
      CONF.v = 61;
      every(700, () => {
        CONF.v = clamp(61 + randInt(-3, 3), 0, 99);
        const n = $('#conf-val'); if (n) n.textContent = CONF.v + '%';
      });
      every(1300, () => this.capture());
      await typeLines(data, [
        kv('SUBJECT', 'UNKNOWN'),
        kv('MATCH CONFIDENCE', '<span id="conf-val">61%</span>'),
        kv('STATUS', 'UNREGISTERED'),
        kv('LAST KNOWN LOCATION', 'EAST BELLMONT'),
        kv('HEIGHT EST.', '6\'1" ± 2"'),
        kv('GAIT', 'LEFT-SIDE STIFFNESS'),
        kv('CLOTHING', 'DARK / LAYERED / REINFORCED'),
        kv('REF', 'CASE FILE 001 / EVIDENCE 04'),
      ], { tk, gap: 200 });
      await sleep(1200, tk);
      showProceed('FOLLOW SUBJECT ACROSS CAMERAS →');
    },
    // freeze a frame of the subject every second or so — obsessive record keeping
    capture() {
      const src = $('#track-feed canvas');
      if (!src) return;
      const fig = el('figure', 'frame');
      const c = el('canvas'); c.width = 96; c.height = 54;
      const x = c.getContext('2d');
      x.drawImage(src, 0, 0, 96, 54);
      const s = this.view.feed.figs[0];
      if (s) { x.strokeStyle = '#fff'; x.strokeRect(s.x * 96, s.y * 54, s.w * 96, s.h * 54); }
      this.frame += randInt(18, 31);
      fig.append(c, el('figcaption', '', `FR ${pad(this.frame, 6)} / ${fmtClock(ARCHIVE_START + elapsed())}`));
      const strip = $('#track-frames');
      strip.prepend(fig);
      while (strip.children.length > 8) strip.lastChild.remove();
    },
  },

  /* ===== 04 — CAMERA HANDOFF ===== */
  {
    id: 'handoff', title: 'CAMERA HANDOFF',
    init() {
      const strip = $('#ho-strip');
      ['CAM 03', 'CAM 08', 'CAM 14', 'CAM 21'].forEach(id => {
        const slot = el('div', 'feed-slot');
        slot.dataset.cam = id;
        strip.append(slot);
        switchCamera(slot, CAM(id), { w: 160, h: 90, fps: 7, silent: true });
      });
    },
    async enter(tk) {
      const log = $('#ho-log'), main = $('#ho-feed');
      log.innerHTML = '';
      $$('#ho-path li').forEach(li => li.className = '');
      const t0 = Date.now();
      const say = (text, cls = '') => {
        const li = el('li', cls, text);
        li.dataset.t = `+${pad(Math.floor((Date.now() - t0) / 1000))}s`;
        log.append(li); log.scrollTop = log.scrollHeight;
        Sound.click();
        return li;
      };
      const show = (id, target = 0) => {
        $$('#ho-strip .feed-slot').forEach(s => s.classList.toggle('is-active', s.dataset.cam === id));
        const li = $(`#ho-path li[data-cam="${id}"]`); if (li) li.classList.add('is-reached');
        return switchCamera(main, CAM(id), {
          w: 320, h: 180, fps: 12,
          tracker: { target, primary: () => `SUBJECT ${CONF.v}%`, words: ['PERSON', 'PERSON', 'MOVING', 'PERSON'], ghosts: 2, edges: 2 },
        });
      };
      const lost = async () => {
        say('TARGET LOST');
        say('SEARCHING...');
        $$('#ho-strip .feed-slot').forEach(s => s.classList.remove('is-active'));
        for (let i = 0; i < 6; i++) {             // the system flicks through the city
          switchCamera(main, fillerCam(randInt(0, 60)), { w: 160, h: 90, fps: 10 });
          await sleep(170, tk);
        }
      };

      say('> AUTO-TRACK INITIATED / REF: CASE 001');
      show('CAM 03'); CONF.v = 61;
      say('SUBJECT ACQUIRED — CAM 03 — CONFIDENCE 61%');
      await sleep(2400, tk);
      say('SUBJECT EXITING FRAME → EAST');
      await sleep(1000, tk);
      await lost();
      say('MATCH FOUND — CAM 08 — CONFIDENCE 47%'); CONF.v = 47;
      say('CAMERA HANDOFF 03 → 08');
      show('CAM 08');
      await sleep(1100, tk);
      CONF.v = 63; say('SUBJECT ACQUIRED — CONFIDENCE 63%');
      await sleep(2200, tk);
      await lost();
      say('MATCH FOUND — CAM 14 — CONFIDENCE 81%'); CONF.v = 81;
      say('CAMERA HANDOFF 08 → 14');
      const v14 = show('CAM 14', 1);              // the box locks onto the wrong person
      say('SUBJECT ACQUIRED — CONFIDENCE 81%');
      await sleep(2800, tk);
      say('!! GAIT MISMATCH — LEFT-SIDE STIFFNESS NOT PRESENT', 'warn');
      corrupt(main);
      await sleep(1100, tk);
      say('MATCH RECLASSIFIED: CIVILIAN / NO RELATION', 'warn');
      $('#ho-path li[data-cam="CAM 14"]').classList.add('is-wrong');
      say('41 SEC OF TRACKING ASSIGNED TO WRONG INDIVIDUAL');
      say('CIVILIAN DATA: RETAINED');
      CONF.v = 12;
      v14.tracker.target = -1;
      await sleep(1800, tk);
      await lost();
      say('MATCH FOUND — CAM 21 — CONFIDENCE 52%'); CONF.v = 52;
      say('CAMERA HANDOFF → 21');
      show('CAM 21');
      await sleep(2600, tk);
      say('SUBJECT ENTERING CAM 22 ZONE — SIGNAL WEAK');
      switchCamera(main, CAM('CAM 22'), { w: 320, h: 180, fps: 6, noise: 1 });
      await sleep(1600, tk);
      say('TRACK TERMINATED');
      await sleep(2000, tk);

      // the turn: the footage was already tagged before WATCHMAN arrived
      say('— — —');
      say('NOTE: SOURCE FOOTAGE ALREADY CONTAINS TRACKING METADATA', 'warn');
      await sleep(900, tk);
      say('TRACK ID: W13-0023 / CREATED 2023.01.14');
      say('CREATED BY: [NOT WATCHMAN]', 'warn');
      await sleep(1400, tk);
      showProceed('OPEN ARCHIVE — CAMERA 04 / MORROW STREET →');
    },
  },

  /* ===== 05 — MORROW STREET / CAMERA 04 ===== */
  {
    id: 'morrow', title: 'MORROW STREET ARCHIVE',
    t: 0, playing: null, inspected: false, sawGap: false,
    events: [
      [0, 'PERSON 01 AT REAR ENTRANCE (LATER ID: ELIAS VANE)'],
      [120, '12:07 — WITNESS: RAISED VOICES. UNIT HAS NO AUDIO'],
      [240, '12:09 — PERSON 02 ENTERS FROM WEST EDGE'],
      [360, '12:11 — SIGNAL LOST'],
      [660, '12:16 — SIGNAL RESTORED. NO TECHNICIAN ON SITE'],
      [780, '12:18 — UNKNOWN FIGURE DETECTED (EAST EDGE, < 4 SEC)'],
      [785, 'NO FURTHER MOTION. BODY FOUND 01:12'],
    ],
    init() {
      // ISSUE 01 CAMERA 04 — real footage (clip 15: night street from above), scrubbed by the timeline.
      // Change `clip` to use another file from assets/video/cctv.
      const cam = { id: 'CAM 04', loc: '114 MORROW ST / REAR SERVICE ENTRANCE', scene: 'morrow', seed: 404, status: 'ARCHIVE', timeText: '', clip: 15, scrub: true };
      // ISSUE 01 CAMERA 04 IMAGE — replace by giving `cam` a src (tracking then uses cam.figs)
      this.view = switchCamera($('#m-feed'), cam, {
        w: 320, h: 180, fps: 10, silent: true, time: () => this.t,
        tracker: { target: -1, words: ['PERSON'], ghosts: 1, dropout: .02, edges: 1 },
      });

      const bar = $('#tl-bar');
      for (let m = 0; m <= 15; m++) { const t = el('i', 'tl-tick'); t.style.left = `${(m / 15) * 100}%`; bar.append(t); }
      [[120, '12:07'], [240, '12:09'], [360, '12:11'], [660, '12:16'], [780, '12:18']].forEach(([s, lbl]) => {
        const b = el('button', 'tl-mark', lbl);
        b.type = 'button';
        b.style.left = `${(s / 900) * 100}%`;
        b.addEventListener('click', () => { this.stop(); this.set(s); });
        bar.append(b);
      });
      $('#tl').addEventListener('input', e => { this.stop(); this.set(+e.target.value); });
      $('#tl-play').addEventListener('click', () => (this.playing ? this.stop() : this.play()));
      $('#m-inspect').addEventListener('click', () => this.inspect(RUN).catch(quiet));
    },
    enter() { this.set(this.t); },
    exit() { this.stop(); },
    set(t) {
      this.t = clamp(t, 0, 900);
      $('#tl').value = this.t;
      const ts = fmtClock(5 * 60 + this.t);
      $('#m-time').textContent = ts;
      const label = $('#m-feed .fl-time'); if (label) label.textContent = `2023.10.02  ${ts}`;
      const lost = this.t >= 360 && this.t < 660;
      $('#m-lost').hidden = !lost;
      if (lost) {
        this.sawGap = true;
        $('#m-lost-count').textContent = `${fmtClock(this.t - 360).slice(3)} / 05:00 MISSING`;
      }
      $('#m-event').textContent = this.events.filter(e => e[0] <= this.t).pop()[1];
      if (this.sawGap && !this.inspected) $('#m-inspect').classList.add('is-hint');
    },
    play() {
      if (this.t >= 900) this.set(0);
      $('#tl-play').textContent = '❚❚ PAUSE';
      this.playing = setInterval(() => { this.set(this.t + 1.5); if (this.t >= 900) this.stop(); }, 100);   // 15× speed
    },
    stop() {
      clearInterval(this.playing); this.playing = null;
      $('#tl-play').textContent = '▶ PLAY';
    },
    async inspect(tk) {
      if (this.inspecting) return;
      this.inspecting = true;
      const btn = $('#m-inspect');
      btn.classList.remove('is-hint'); btn.disabled = true;
      const out = $('#m-out');
      out.innerHTML = '';
      try {
        await typeLines(out, [
          '> QUERY UNIT 04 / 2023.10.02 / 00:11:00—00:16:00',
          'POWER SUPPLY ....... NOMINAL',
          'NETWORK LINK ....... CONNECTED',
          'STORAGE ............ AVAILABLE',
          'RECORDING .......... SUSPENDED BY COMMAND',
          { html: 'LIVE OUTPUT ........ ACTIVE', cls: 'hl' },
          'OUTBOUND STREAMS ... 1',
          'DESTINATION ........ [NOT RESOLVED]',
        ], { tk, gap: 140, speed: 10 });
        $('#m-cause').classList.add('x-out');
        $('#m-cause-new').hidden = false;
        scramble($('#m-cause-new'), 900);
        await sleep(500, tk);
        await typeLines(out, [{ html: 'REMOTE SESSION FOUND', cls: 'big' }, { html: 'ACCESS LOG AVAILABLE', cls: 'big' }], { tk, gap: 300 });
        this.inspected = true;
        $('#m-lost-live').hidden = false;
        const b = el('button', 'btn btn-wide', '[ OPEN ACCESS LOG → ]');
        b.type = 'button'; b.onclick = () => goTo(5);
        out.append(b);
        showProceed('OPEN ACCESS LOG →');
      } catch (e) {
        quiet(e);
        out.innerHTML = '';                   // left mid-query → allow running again
      } finally {
        this.inspecting = false; btn.disabled = false;
      }
    },
  },

  /* ===== 06 — ACCESS LOG ===== */
  {
    id: 'log', title: 'ACCESS LOG',
    // the black bars in the scan, in % of the image: [left, top, width, height, what is underneath, main]
    // main: true → the bar that gives the remote-access record away
    spots: [
      [55.7, 25.7, 24.5, 2.6, 'REPORT MADE BY: W13-RELAY-07'],
      [29.9, 31.1, 11.5, 4.7, 'USER: ...ER_04'],
      [8.2, 38.5, 78.4, 14, 'CAMERA 04 — 00:10:48 REMOTE OVERRIDE REQUEST / 00:10:51 AUTHORIZATION ACCEPTED', true],
      [53, 59.7, 17.7, 2.8, 'SOURCE: EXTERNAL NETWORK'],
      [6.3, 64.9, 77.4, 7.5, '00:11:00 RECORDING SUSPENDED — 00:11:02 LIVE VIEW OPENED — VIEWERS: 1'],
      [55, 74.1, 16, 3.2, 'CLEARANCE: LEVEL 04'],
      [74.7, 82.5, 10.9, 2.3, '00:16:00 RESUMED'],
      [59.8, 90.9, 8.8, 6, 'LOG PURGE: FAILED'],
    ],
    init() {
      const doc = $('#log-doc');
      this.spots.forEach(([l, t, w, h, frag, main]) => {
        const b = el('button', 'scan-redact' + (main ? ' is-main' : ''), `<span>${frag}</span>`);
        b.type = 'button';
        b.setAttribute('aria-label', 'Redacted — click to recover');
        Object.assign(b.style, { left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%` });
        b.addEventListener('click', () => {
          if (!b.classList.contains('is-revealed')) {
            b.classList.add('is-revealed');
            scramble(b.firstChild, 600);
            STATE.filesOpened++;
            Sound.blip(1200, .04);
          }
          if (main) this.reveal(RUN).catch(quiet);
        });
        doc.append(b);
      });
    },
    async enter(tk) {
      $('#log-reveal').hidden = true;
      this.revealed = false;
      $$('#log-doc .scan-redact').forEach(b => b.classList.remove('is-revealed', 'is-hint'));
      corrupt($('#log-doc'));
      await sleep(3500, tk);
      $('#log-doc .scan-redact.is-main').classList.add('is-hint');
    },
    async reveal(tk) {
      if (this.revealed) return;
      this.revealed = true;
      $('#log-doc .scan-redact.is-main').classList.remove('is-hint');
      const card = $('#log-reveal');
      card.hidden = false; card.innerHTML = '';
      Sound.blip(220, .3, 'sawtooth', .05);
      corrupt(card);
      await typeLines(card, [
        { html: 'CAMERA 04', cls: 'big' },
        { html: 'REMOTE ACCESS DETECTED', cls: 'big' },
        kv('USER', '[UNKNOWN]'),
        kv('CLEARANCE', 'LEVEL 04'),
        kv('SOURCE', 'EXTERNAL NETWORK'),
        kv('NETWORK', 'W-13'),
        kv('LIVE VIEW', '00:11:02 — 00:16:00 / 1 VIEWER'),
      ], { tk, gap: 150, speed: 12 });
      await sleep(1200, tk);
      showProceed('TRACE NETWORK W-13 →');
    },
  },

  /* ===== 07 — HIDDEN NETWORK ===== */
  {
    id: 'network', title: 'HIDDEN NETWORK',
    init() {
      if (!CITY) buildCity();
      drawCity($('#net-map'), n => this.inspect(n));
      $$('.net-layers .btn').forEach(b => b.addEventListener('click', () => {
        b.classList.toggle('is-on');
        $(`#net-map .layer-${b.dataset.layer}`).classList.toggle('layer-off', !b.classList.contains('is-on'));
      }));
    },
    enter() {
      $$('#net-stats b').forEach((b, i) => later(i * 350, () => countUp(b, +b.dataset.count)));
      this.seen = 0;
      later(14000, () => showProceed('WHO ELSE IS BEING WATCHED? →'));
    },
    // click an unknown node → a recovered fragment
    inspect(n) {
      STATE.nodesInspected++;
      n.el.classList.add('is-seen');
      const panel = $('#net-panel');
      panel.innerHTML = '';
      corrupt(panel);
      Sound.burst(.1, .04);
      const corrupted = (n.frag * 7) % 5 === 4;
      const f = FRAGMENTS[n.frag % FRAGMENTS.length];
      const c = el('canvas'); c.width = 192; c.height = 108;
      // ARCHIVED SURVEILLANCE STILL — placeholder
      if (corrupted) drawStill(c, 'nosignal', n.frag); else drawStill(c, f.scene, 700 + n.frag);
      panel.append(c);
      const lines = corrupted
        ? [`# ${n.id}`, kv('FRAGMENT', '██ CORRUPTED ██'), kv('RECOVERED', '3%'), '// try another node.']
        : [`# ${n.id} — ${n.kind === 'relay' ? 'RELAY' : 'UNREGISTERED'}`,
           kv('GRID', `${String.fromCharCode(65 + Math.floor(n.x / 80))}-${pad(Math.floor(n.y / 40))} / ${n.x.toFixed(1)} : ${n.y.toFixed(1)}`),
           kv('DATE', f.date), kv('CLASS', f.cls), f.text];
      typeLines(panel, lines, { speed: 8, tk: RUN }).catch(quiet);
      if (++this.seen === 2) showProceed('WHO ELSE IS BEING WATCHED? →');
    },
  },

  /* ===== 08 — OTHER SUBJECTS ===== */
  {
    id: 'subjects', title: 'OTHER SUBJECTS',
    init() {
      const grid = $('#subj-grid');
      SUBJECTS.forEach((s, i) => {
        const card = el('button', 'subj' + (s.loading ? ' is-loading' : ''));
        card.type = 'button';
        const c = el('canvas'); c.width = 64; c.height = 80;
        if (s.img) {                                        // real portrait if supplied
          const img = new Image(); img.onload = () => c.getContext('2d').drawImage(img, 0, 0, 64, 80); img.src = s.img;
        } else drawPortrait(c, s.look, 30 + i);
        card.append(c);
        card.insertAdjacentHTML('beforeend', `
          ${s.symbol ? SYMBOL_SVG : ''}
          ${s.stamp ? `<span class="subj-stamp">${s.stamp}</span>` : ''}
          <p class="subj-id">SUBJECT ${s.id}</p>
          <p class="subj-alias">${s.alias}</p>
          <dl>
            ${s.fields.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
            ${s.more.map(([k, v]) => `<div class="more"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
          </dl>
          ${s.loading ? '<div class="subj-progress"><i></i></div>' : ''}
          ${s.doc ? `<img class="subj-doc" src="${s.doc}" alt="Attached document, subject ${s.id}">` : ''}`);
        card.addEventListener('click', e => {
          if (e.target.closest('.redact')) return;
          card.classList.toggle('is-open');
          if (card.classList.contains('is-open')) { STATE.filesOpened++; corrupt(card, 300); Sound.click(); }
        });
        grid.append(card);
      });
      $('#subj-grid').addEventListener('click', e => {
        const r = e.target.closest('.redact');
        if (r && !r.classList.contains('is-revealed')) { r.classList.add('is-revealed'); scramble(r, 500); }
      });
    },
    enter() {
      $$('#subj-grid .subj').forEach((c, i) => { c.style.visibility = 'hidden'; later(160 * i, () => { c.style.visibility = ''; corrupt(c, 300); Sound.click(); }); });
      later(2500, () => showProceed('FIND THE OWNER →'));
    },
  },

  /* ===== 10 — WHO OWNS THE NETWORK? ===== */
  {
    id: 'owner', title: 'NETWORK OWNER',
    init() { $('#own-request').addEventListener('click', () => this.breakdown(RUN).catch(quiet)); },
    async enter(tk) {
      $('#own-out').innerHTML = ''; $('#own-fields').innerHTML = ''; $('#own-users').innerHTML = ''; $('#own-pops').innerHTML = '';
      $('#own-alert').hidden = true; $('#own-alert').className = 'own-alert';
      $('#own-print').classList.remove('is-gone');
      $('#own-request').hidden = true; $('#own-request').disabled = false;
      await typeLines($('#own-out'), [
        '> QUERY: OWNERSHIP RECORD / NETWORK W-13',
        '> CROSS-REFERENCE: CITY / STATE / FEDERAL / PRIVATE REGISTRIES',
        '> 4 REGISTRIES SEARCHED — 0 MATCHES',
      ], { tk, gap: 300 });
      const dl = $('#own-fields');
      const fields = [['NETWORK OWNER', 'UNKNOWN'], ['OPERATING AUTHORITY', '███████████'], ['FUNDING SOURCE', '███████████'], ['ESTABLISHED', 'PRE-1974'], ['AUTHORIZED USERS', '17'], ['IDENTITIES AVAILABLE', '0']];
      for (const [k, v] of fields) {
        dl.append(el('dt', '', k));
        const dd = el('dd'); dl.append(dd);
        await typeInto(dd, v, { tk, speed: 30 });
        await sleep(250, tk);
      }
      await sleep(600, tk);
      $('#own-request').hidden = false;
    },
    exit() { document.body.classList.remove('is-shaking'); },
    async breakdown(tk) {
      $('#own-request').disabled = true;
      const users = $('#own-users');
      users.innerHTML = '';
      for (let i = 1; i <= 17; i++) {
        users.append(el('div', '', `USER ${pad(i)} — <span class="redact">${'█'.repeat(randInt(6, 14))}</span> — CLEARANCE 0${randInt(1, 4)}`));
        Sound.click();
        await sleep(70, tk);
      }
      await sleep(400, tk);
      const files = ['W13_USERS.idx', 'FUNDING_1974.pdf', 'CAM04_LIVE_2023-10-02.strm', 'CONTRACT_██.doc', 'SUBJECT_023.trk', 'OBSERVERS.lst', 'CIVIC_SUBLEVEL_2.dwg', 'LEDGER_1989.tif'];
      for (const f of files) { this.pop(f); await sleep(rand(160, 320), tk); }
      for (const r of [...users.children].reverse()) { corrupt(r, 260); await sleep(45, tk); r.style.visibility = 'hidden'; }
      for (const dd of $$('#own-fields dd')) { await erase(dd, 22, tk); dd.textContent = '—'; }
      $('#own-print').classList.add('is-gone');
      document.body.classList.add('is-shaking');
      const alert = $('#own-alert');
      alert.hidden = false; alert.textContent = 'ACCESS LEVEL EXCEEDED';
      Sound.burst(.6, .12);
      await sleep(1500, tk);
      alert.classList.add('is-invert');
      alert.textContent = 'OBSERVER DETECTED';
      Sound.blip(180, .6, 'sawtooth', .06);
      await sleep(1700, tk);
      document.body.classList.remove('is-shaking');
      goTo(STAGES.findIndex(s => s.id === 'reversal'));
    },
    // a file window that opens and is closed by someone else
    pop(name) {
      const w = el('div', 'popwin', `<header><span>${name}</span><span>×</span></header><div>LOADING...\n${'█'.repeat(randInt(8, 22))} ${randInt(10, 99)}%\n${pick(['OWNER: —', 'SIGNED: ███', 'RECIPIENT: W-13', 'ORIGIN: CIVIC SUBLEVEL'])}</div>`);
      const box = $('#owner');
      w.style.left = `${rand(4, 70)}%`;
      w.style.top = `${rand(8, 70)}%`;
      $('#own-pops').append(w);
      Sound.blip(rand(500, 900), .05);
      setTimeout(() => { w.lastChild.textContent = 'FILE CLOSED BY REMOTE USER'; corrupt(w, 300); }, rand(600, 1200));
      setTimeout(() => w.remove(), rand(1500, 2300));
      return box;
    },
  },

  /* ===== 11 — REVERSAL ===== */
  {
    id: 'reversal', title: 'REVERSAL',
    label: 'NEW SUBJECT',
    init() {
      // REVERSAL IMAGE — the observer seen from behind, in front of the wall (replace the file to change it).
      // figs = where the figure is in the picture (0–1), so the first tracking box lands on them.
      const cam = {
        id: 'CAM ??', loc: 'ARCHIVE TERMINAL / LOCATION RESOLVING...', scene: 'room', seed: 999, status: 'LIVE', clock: ARCHIVE_START,
        still: 'assets/images/film/reversal-observer.jpg', figs: [{ x: .34, y: .18, w: .32, h: .82 }],
      };
      this.view = switchCamera($('#rev-feed'), cam, {
        w: 960, h: 540, fps: 12, silent: true, noise: .35,
        tracker: { target: 0, primary: () => this.label, words: ['YOU', 'ARE', 'HERE'], ghosts: 3, edges: 4, lag: .3, dropout: .01 },
      });
      this.pos = { x: .5, y: .55, cx: 0, cy: 0, moved: 0 };
      $('#reversal').addEventListener('pointermove', e => {
        const r = $('#rev-feed').getBoundingClientRect();
        Object.assign(this.pos, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, cx: Math.round(e.clientX), cy: Math.round(e.clientY), moved: Date.now() });
      });
    },
    async enter(tk) {
      const msg = $('#rev-msg'), data = $('#rev-data'), trail = $('#rev-trail');
      this.label = 'NEW SUBJECT';
      this.view.tracker.manual = null;
      this.trail = [];
      $$('span', trail).forEach(s => s.remove());
      $('#rev-trail-svg').innerHTML = '';
      msg.textContent = ''; data.innerHTML = '';
      this.profile = 38;

      await sleep(700, tk);
      msg.textContent = 'NEW SUBJECT DETECTED'; corrupt(msg); Sound.blip(880, .2);
      await sleep(2600, tk);
      msg.textContent = 'UNAUTHORIZED OBSERVER IDENTIFIED'; corrupt(msg); Sound.blip(440, .3);
      this.label = 'OBSERVER';
      every(1000, () => this.readout());
      this.readout();
      await sleep(2000, tk);

      // the box leaves the figure and starts following the visitor's cursor
      msg.textContent = '';
      this.label = 'OBSERVER — YOU';
      every(90, () => {
        const p = this.pos;
        if (Date.now() - p.moved > 2500) {             // touch / idle: drift on its own
          const t = Date.now() / 1000;
          p.x = .5 + Math.sin(t * .7) * .25; p.y = .5 + Math.sin(t * 1.1) * .2;
          const r = $('#rev-feed').getBoundingClientRect();
          p.cx = Math.round(r.left + p.x * r.width); p.cy = Math.round(r.top + p.y * r.height);
        }
        this.view.tracker.manual = { x: p.x - .06, y: p.y - .1, w: .12, h: .2 };
      });
      every(550, () => this.drop());
      await sleep(6000, tk);
      showProceed('DISCONNECT →');
    },
    exit() { this.view.tracker.manual = null; },
    drop() {                                           // leave a coordinate where the cursor was
      const p = this.pos, trail = $('#rev-trail');
      const r = $('#rev-feed').getBoundingClientRect();
      const s = el('span', '', `X:${p.cx} Y:${p.cy}`);
      s.style.left = `${p.x * r.width}px`; s.style.top = `${p.y * r.height}px`;
      trail.append(s);
      this.trail.push([p.x * r.width, p.y * r.height]);
      if (this.trail.length > 24) this.trail.shift();
      const spans = $$('span', trail); if (spans.length > 24) spans[0].remove();
      const svg = $('#rev-trail-svg');
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      svg.innerHTML = `<polyline points="${this.trail.map(a => a.join(',')).join(' ')}"/>`;
    },
    readout() {
      this.profile = Math.min(100, this.profile + randInt(1, 4));
      const t = elapsed();
      $('#rev-data').innerHTML = [
        `# SUBJECT 0??`,
        kv('CLASS', 'OBSERVER → SUBJECT'),
        kv('ACCESS DURATION', `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`),
        kv('FEEDS OPENED', STATE.feedsOpened),
        kv('FILES OPENED', STATE.filesOpened),
        kv('NODES INSPECTED', STATE.nodesInspected),
        kv('CLICKS', STATE.clicks),
        kv('CURSOR', `X:${this.pos.cx} Y:${this.pos.cy}`),
        kv('PROFILE', `${this.profile}% COMPILED`),
      ].map(l => `<div>${l}</div>`).join('');
    },
  },

  /* ===== 12 — ENDING ===== */
  {
    id: 'ending', title: 'END',
    init() {
      $('#end-reconnect').addEventListener('click', () => {
        Object.assign(STATE, { start: Date.now(), clicks: 0, feedsOpened: 0, filesOpened: 0, nodesInspected: 0 });
        goTo(0);
      });
    },
    async enter(tk) {
      const box = $('#end-lines'), fin = $('#end-final');
      box.innerHTML = ''; fin.hidden = true; fin.innerHTML = '';
      $('#ending').classList.remove('is-off');
      $('#end-reconnect').hidden = true;
      await sleep(1200, tk);
      for (const ln of ['WE WATCHED HIM.', 'SOMEONE WATCHED US.', 'THEY WERE HERE FIRST.']) {
        const p = el('p', 'end-line', ln);
        box.append(p);
        Sound.blip(160, .25, 'sine', .05);
        await sleep(2100, tk);
        p.classList.add('is-dim');
      }
      await sleep(900, tk);
      box.innerHTML = '';
      box.append(el('p', 'end-line end-q', 'CAN SURVEILLANCE BE JUST?'));
      await sleep(2800, tk);
      box.append(el('p', 'end-small', 'ISSUE 01 — WHO HAS THE RIGHT TO PUNISH?'));
      await sleep(1500, tk);
      box.append(el('p', 'end-small', 'ISSUE 02 — WHO HAS THE RIGHT TO WATCH?'));
      await sleep(1500, tk);
      box.append(el('p', 'end-small', 'CAN AN UNJUST METHOD PRODUCE JUSTICE?'));
      await sleep(3200, tk);
      box.innerHTML = '';
      box.append(el('p', 'end-line end-q', 'WHO WAS WATCHING FIRST?'));
      await sleep(3200, tk);
      box.innerHTML = '';
      fin.hidden = false;
      await typeLines(fin, ['# WATCHMAN', '## CASE REMAINS OPEN'], { tk, speed: 40, gap: 700 });
      await sleep(2600, tk);
      $('#ending').classList.add('is-off');
      Sound.burst(.5, .1);
      await sleep(2200, tk);
      $('#end-reconnect').hidden = false;
    },
  },
];


/* ---------- SIMPLIFIED VERSION (after the presentation feedback) ----------
   Only the stages listed here are live. Everything else (film opening, tracking,
   Morrow St., log, network, subjects, owner, reversal, ending) is still in the
   code above — add its id back to this list to switch it on again.
   Full previous version: _backup/v1-presentation/ */
const LIVE_STAGES = ['desk', 'wall'];
for (let i = STAGES.length - 1; i >= 0; i--) if (!LIVE_STAGES.includes(STAGES[i].id)) STAGES.splice(i, 1);


/* ---------- 11 NAVIGATION + BOOT ---------- */
let current = -1;

// opts.quiet  → no static flash (used when a stage makes its own entrance)
// opts.arrive → passed on to the stage's enter() (the wall uses it to come in from far away)
function goTo(n, opts = {}) {
  n = clamp(n, 0, STAGES.length - 1);
  if (n === current) return;
  RUN++;
  clearStageTimers();
  hideProceed();
  Viewer.close();
  Tip.hide();
  const prev = STAGES[current];
  if (prev) { prev.exit?.(); $('#' + prev.id).classList.remove('is-active'); }

  current = n;
  STATE.max = Math.max(STATE.max, n);
  const st = STAGES[n];
  if (!st._init) { st.init?.(); st._init = true; }
  const node = $('#' + st.id);
  node.classList.add('is-active');
  node.scrollTop = 0;
  document.body.dataset.stage = st.id;
  updateBar();
  if (!opts.quiet) { flash(); Sound.burst(.25, .06); }
  Promise.resolve(st.enter?.(RUN, opts)).catch(quiet);
}

function updateBar() {
  $('#sys-num').textContent = pad(current + 1);
  $('#sys-total').textContent = pad(STAGES.length);
  $('#sys-title').textContent = STAGES[current].title;
  $$('#sys-ticks li').forEach((li, i) => {
    li.className = i === current ? 'is-current' : i <= STATE.max ? 'is-done' : '';
    li.firstChild.disabled = i > STATE.max;
  });
}

function startGrain() {
  const c = $('#fx-grain'), x = c.getContext('2d');
  const size = () => { c.width = Math.max(1, Math.ceil(innerWidth / 3)); c.height = Math.max(1, Math.ceil(innerHeight / 3)); };
  size(); addEventListener('resize', size);
  const draw = () => {
    const img = x.createImageData(c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(img, 0, 0);
  };
  draw();
  if (!REDUCED) setInterval(draw, 90);
}

function boot() {
  makeNoise();
  startGrain();
  Tip.node = $('#tip');

  // progress ticks — revisit any stage already reached
  const ticks = $('#sys-ticks');
  STAGES.forEach((s, i) => {
    const li = el('li');
    const b = el('button'); b.type = 'button'; b.title = `${pad(i + 1)} — ${s.title}`; b.setAttribute('aria-label', b.title);
    b.addEventListener('click', () => goTo(i));
    li.append(b); ticks.append(li);
  });

  // SOUND button = background music on / off (the old synth effects stay off)
  $('#sound-toggle').addEventListener('click', e => {
    const on = Music.toggle();
    e.currentTarget.textContent = `SOUND: ${on ? 'ON' : 'OFF'}`;
    e.currentTarget.setAttribute('aria-pressed', on);
  });
  // the music starts with the visitor's first click or key (browsers block sound before that)
  const firstTouch = e => {
    if (e.target?.closest?.('#sound-toggle')) return;   // that click is handled by the button itself
    Music.start();
    removeEventListener('pointerdown', firstTouch); removeEventListener('keydown', firstTouch);
  };
  addEventListener('pointerdown', firstTouch); addEventListener('keydown', firstTouch);

  $('#viewer-close').addEventListener('click', () => Viewer.close());
  $('#viewer-prev').addEventListener('click', () => Viewer.show(Viewer.i - 1));
  $('#viewer-next').addEventListener('click', () => Viewer.show(Viewer.i + 1));
  $('#viewer').addEventListener('click', e => { if (e.target.id === 'viewer') Viewer.close(); });

  document.addEventListener('click', () => { STATE.clicks++; });
  document.addEventListener('keydown', e => {
    const viewerOpen = !$('#viewer').hidden;
    if (e.key === 'Escape' && viewerOpen) Viewer.close();
    if (viewerOpen && e.key === 'ArrowRight') Viewer.show(Viewer.i + 1);
    if (viewerOpen && e.key === 'ArrowLeft') Viewer.show(Viewer.i - 1);
    if (STAGES[current]?.id === 'film' && (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ')) { e.preventDefault(); Film.next(); return; }
    if (e.key === 'Enter' && !viewerOpen && !/BUTTON|INPUT/.test(document.activeElement.tagName)) {
      if (!$('#proceed').hidden) $('#proceed').click();
    }
  });

  setInterval(tickClocks, 1000);
  requestAnimationFrame(renderFeeds);

  // DEV: index.html#stage=4 jumps straight to stage 4
  const m = location.hash.match(/stage=(\d+)/);
  if (m) history.replaceState(null, '', location.pathname + location.search);   // a normal reload always starts with the film
  const start = m ? clamp(+m[1], 0, STAGES.length - 1) : 0;
  STATE.max = start;
  goTo(start, { quiet: true });   // no static flash on the very first page
}

boot();
