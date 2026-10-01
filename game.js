// Orbit Hop — one-tap space hopper. Vanilla JS + canvas, no build step.
(() => {
'use strict';

// ---------- Tuning ----------
const LW = 420;              // logical play-column width
const LH_MIN = 700;          // minimum logical height on screen
const FLY_SPEED = 410;       // px/s after launch
const MAX_FLIGHT = 2.6;      // s in the air before you're lost in space
const PLAYER_R = 7;
const ORBIT_GAP = 20;        // orbit distance from planet surface
const CAPTURE_GAP = 32;      // capture distance from planet surface
const PERFECT_TIME = 0.5;    // s; faster captures are "perfect"
const CAM_FOLLOW = 5;        // camera lerp per second
const CAM_ANCHOR = 0.68;     // player sits this far down the screen

// game-juice numbers (see ~/.claude/skills/game-juice/data/recipes.md)
const TRAUMA_DECAY = 1.5, SHAKE_MAX = 14, SHAKE_FREQ = 25;
const HITSTOP_CAPTURE = 0.04, HITSTOP_DEATH = 0.2, SLOWMO_DEATH = 0.4;

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const easeOutElastic = t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
// cheap smooth 1D noise for shake that sways instead of jitters
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = n => { const s = Math.sin(n * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
  return lerp(h(i), h(i + 1), u);
}

function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

const store = {
  get(k, d) { try { const v = localStorage.getItem('orbithop.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('orbithop.' + k, JSON.stringify(v)); } catch (e) {} },
};

// ---------- Canvas ----------
const canvas = $('c'), ctx = canvas.getContext('2d');
let cssW = 0, cssH = 0, dpr = 1, scale = 1, viewH = LH_MIN, offX = 0, bgStars = [];

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = window.innerWidth; cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  scale = Math.min(cssW / LW, cssH / LH_MIN);
  viewH = cssH / scale;
  offX = (cssW - LW * scale) / 2;
  bgStars = [];
  const n = Math.round(cssW * cssH / 5000);
  for (let i = 0; i < n; i++) bgStars.push({ x: Math.random() * cssW, y: Math.random() * cssH, d: rand(0.15, 1), s: rand(0.6, 1.8), tw: rand(0, 6.28) });
}
window.addEventListener('resize', resize);
resize();

// ---------- Skins ----------
const SKINS = [
  { id: 'comet',  name: 'Comet',  cost: 0,    body: '#ffffff', trail: '#7ad7ff' },
  { id: 'ember',  name: 'Ember',  cost: 40,   body: '#ffe2b0', trail: '#ff6b3d' },
  { id: 'mint',   name: 'Mint',   cost: 80,   body: '#d9fff0', trail: '#3dffb0' },
  { id: 'violet', name: 'Violet', cost: 150,  body: '#f0d9ff', trail: '#b26bff' },
  { id: 'rose',   name: 'Rose',   cost: 250,  body: '#ffe0ea', trail: '#ff4d8d' },
  { id: 'gold',   name: 'Gold',   cost: 400,  body: '#fff3b0', trail: '#ffc400' },
  { id: 'ice',    name: 'Ice',    cost: 600,  body: '#e8fbff', trail: '#a5f3fc' },
  { id: 'void',   name: 'Void',   cost: 800,  body: '#c4b5fd', trail: '#312e81' },
  { id: 'prism',  name: 'Prism',  cost: 1200, body: '#ffffff', trail: null, rainbow: true },
];
let owned = store.get('owned', ['comet']);
let skinId = store.get('skin', 'comet');
const skin = () => SKINS.find(s => s.id === skinId) || SKINS[0];
const trailColor = (i = 0) => skin().rainbow ? `hsl(${(time * 220 + i * 18) % 360},100%,65%)` : skin().trail;

// ---------- Audio (synthesized, no asset files) ----------
const Sfx = (() => {
  let ac = null, muted = store.get('muted', false), adPaused = false;
  const vary = f => f * rand(0.9, 1.1); // ±10% pitch on every repeat
  function ensure() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ac && ac.state === 'suspended' && !adPaused) ac.resume();
  }
  function tone(freq, dur, type = 'sine', vol = 0.15, slide = 1, delay = 0) {
    if (muted || adPaused || !ac) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  return {
    ensure,
    get muted() { return muted; },
    toggle() { muted = !muted; store.set('muted', muted); return muted; },
    adPause() { adPaused = true; if (ac) ac.suspend(); },
    adResume() { adPaused = false; if (ac) ac.resume(); },
    launch() { tone(vary(300), 0.13, 'triangle', 0.12, 1.9); },
    capture(chain) { const f = 392 * Math.min(1.6, 1 + 0.06 * chain); tone(vary(f), 0.16, 'sine', 0.16, 1.5); tone(vary(f * 2), 0.08, 'triangle', 0.05, 1, 0.02); },
    perfect() { tone(988, 0.1, 'square', 0.05); tone(1319, 0.14, 'square', 0.05, 1, 0.07); },
    coin(chain) { tone(880 * Math.min(1.6, 1 + 0.06 * chain), 0.07, 'square', 0.045, 1.25); },
    bounce() { tone(vary(180), 0.06, 'triangle', 0.08); },
    die() { tone(220, 0.55, 'sawtooth', 0.12, 0.25); tone(70, 0.4, 'sine', 0.2, 0.5); },
    click() { tone(vary(660), 0.04, 'triangle', 0.05); },
    buy() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.08, 1, i * 0.06)); },
  };
})();

// ---------- World state ----------
let state = 'menu';           // menu | play | over | shop
let shopReturn = 'menu';
let planets = [], asteroids = [], coins = [], particles = [], texts = [];
let player = null, camY = 0, score = 0, shownScore = 0, maxIndex = 0, runCoins = 0, bankedThisRun = 0;
let trauma = 0, hitstop = 0, slowmo = 0, flight = 0, spawnIndex = 0, revived = false, lastPlanet = null;
let coinChain = 0, captureChain = 0, gamesPlayed = 0, time = 0, overReady = false, lastDeath = '', runId = 0;
let best = store.get('best', 0), bank = store.get('coins', 0);
const isTutorial = () => best < 5 && score < 3; // new players get aim help for their first planets

const PLANET_COLORS = [
  ['#ff9a62', '#9a3412'], ['#7dd3fc', '#075985'], ['#a78bfa', '#4c1d95'], ['#86efac', '#166534'],
  ['#fda4af', '#9f1239'], ['#fde68a', '#92400e'], ['#67e8f9', '#155e75'], ['#f0abfc', '#86198f'],
];

const difficulty = i => clamp(i / 60, 0, 1);

function makePlanet(x, y, r, index) {
  const d = difficulty(index), c = PLANET_COLORS[index % PLANET_COLORS.length];
  const craters = [];
  for (let i = 0; i < 3; i++) craters.push({ a: rand(0, 6.28), d: rand(0.2, 0.6), r: rand(0.12, 0.22) });
  return { x, y, r, index, c1: c[0], c2: c[1], ring: Math.random() < 0.3, speed: 150 + d * 120 + rand(-10, 10), bump: 0, craters };
}

function spawnNext() {
  spawnIndex++;
  const d = difficulty(spawnIndex);
  const prev = planets[planets.length - 1];
  const gap = rand(155, 205) + d * 55;
  const y = prev.y - gap;
  const r = clamp(rand(24, 38) - d * 10, 16, 38);
  let x = rand(55, LW - 55);
  if (Math.abs(x - prev.x) < 45) x = clamp(prev.x + (x < prev.x ? -1 : 1) * rand(60, 150), 55, LW - 55);
  const p = makePlanet(x, y, r, spawnIndex);
  planets.push(p);

  if (Math.random() < 0.55) {
    for (let i = 1; i <= 3; i++) {
      const k = i / 4;
      coins.push({ x: lerp(prev.x, p.x, k), y: lerp(prev.y, p.y, k), got: false, spin: Math.random() * 6 });
    }
  }
  if (spawnIndex > 4 && Math.random() < 0.2 + d * 0.5) {
    const pts = [], k = 7 + (Math.random() * 3 | 0);
    for (let i = 0; i < k; i++) pts.push(rand(0.75, 1.15));
    asteroids.push({ x: rand(0, LW), y: (prev.y + p.y) / 2, r: rand(9, 14), vx: (Math.random() < 0.5 ? -1 : 1) * rand(50, 90 + d * 90), rot: 0, vr: rand(-2, 2), pts });
  }
}

function attach(p, angle, dir, dist) {
  player.mode = 'orbit'; player.planet = p; player.angle = angle; player.dir = dir; player.r = dist;
  player.x = p.x + Math.cos(angle) * dist; player.y = p.y + Math.sin(angle) * dist;
}

function newRun() {
  runId++;
  planets = []; asteroids = []; coins = []; particles = []; texts = [];
  score = 0; shownScore = 0; maxIndex = 0; runCoins = 0; bankedThisRun = 0;
  trauma = 0; hitstop = 0; slowmo = 0; flight = 0; spawnIndex = 0; revived = false; lastPlanet = null;
  coinChain = 0; captureChain = 0;
  const p0 = makePlanet(LW / 2, 0, 34, 0);
  planets.push(p0);
  for (let i = 0; i < 8; i++) spawnNext();
  player = { mode: 'orbit', trail: [], sx: 1, sy: 1, squashT: 1, x: 0, y: 0, vx: 0, vy: 0 };
  attach(p0, -Math.PI / 2, 1, p0.r + ORBIT_GAP);
  camY = player.y - viewH * CAM_ANCHOR;
}

// ---------- Effects ----------
function burst(x, y, color, n, speed, opts = {}) {
  for (let i = 0; i < n; i++) {
    const a = opts.dir !== undefined ? opts.dir + rand(-opts.spread, opts.spread) : rand(0, Math.PI * 2);
    const s = rand(speed * 0.4, speed);
    const life = rand(0.25, opts.life || 0.6);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: rand(1.5, opts.size || 3.5), drag: opts.drag || 2.5 });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}
function addText(x, y, text, color, size = 18) { texts.push({ x, y, text, color, size, life: 0.9, max: 0.9 }); }
function addTrauma(v) { trauma = Math.min(1, trauma + v); }
function squash(sx, sy) { player.sx = sx; player.sy = sy; player.squashT = 0; }

// ---------- Actions ----------
function launch() {
  const pl = player;
  if (state !== 'play' || pl.mode !== 'orbit') return;
  setTip('');
  const tx = -Math.sin(pl.angle) * pl.dir, ty = Math.cos(pl.angle) * pl.dir;
  pl.vx = tx * FLY_SPEED; pl.vy = ty * FLY_SPEED;
  lastPlanet = pl.planet; pl.mode = 'fly'; flight = 0;
  squash(0.8, 1.3);
  Sfx.launch();
  burst(pl.x, pl.y, '#ffffff', 7, 140, { dir: Math.atan2(-ty, -tx), spread: 0.5, life: 0.3 });
}

function capture(p, d, dx, dy) {
  const pl = player;
  const cross = dx * pl.vy - dy * pl.vx; // sign gives orbit direction
  attach(p, Math.atan2(dy, dx), cross >= 0 ? 1 : -1, d);
  p.bump = 1;
  squash(1.35, 0.7);
  hitstop = HITSTOP_CAPTURE;
  buzz(12);
  if (p.index > maxIndex) {
    const gained = p.index - maxIndex;
    maxIndex = p.index; score += gained; captureChain++;
    addTrauma(0.12);
    if (flight < PERFECT_TIME) {
      runCoins += 1;
      addText(p.x, p.y - p.r - 30, 'PERFECT +1★', '#ffd54a', 18);
      Sfx.perfect();
    }
    if (gained > 1) addText(p.x, p.y - p.r - 52, 'SKIP ×' + gained, '#7ad7ff', 20);
    Sfx.capture(captureChain);
    burst(pl.x, pl.y, p.c1, 14, 220, { dir: Math.atan2(dy, dx), spread: 0.6 });
  } else {
    Sfx.capture(0);
    burst(pl.x, pl.y, p.c1, 6, 120);
  }
  flight = 0;
}

function die(reason) {
  if (state !== 'play') return;
  lastDeath = reason;
  state = 'over'; overReady = false;
  hitstop = HITSTOP_DEATH; slowmo = SLOWMO_DEATH;
  addTrauma(0.6);
  Sfx.die();
  buzz([40, 30, 80]);
  burst(player.x, player.y, trailColor(), 40, 320, { life: 0.9, size: 4.5 });
  burst(player.x, player.y, '#ffffff', 16, 160, { life: 1.2, size: 2 });
  player.mode = 'dead';
  bank += runCoins - bankedThisRun; bankedThisRun = runCoins; store.set('coins', bank);
  const isBest = score > best;
  if (isBest) { best = score; store.set('best', best); }
  Monetize.gameplayStop();
  const run = runId;
  setTimeout(() => { if (run === runId && state === 'over') showOver(isBest); }, 750);
}

function revive() {
  runId++;
  const p = planets.find(q => q.index === maxIndex) ||
    planets.reduce((a, b) => (Math.abs(b.y - player.y) < Math.abs(a.y - player.y) ? b : a));
  revived = true;
  asteroids = asteroids.filter(a => Math.abs(a.y - p.y) > 140);
  player.trail = [];
  attach(p, -Math.PI / 2, 1, p.r + ORBIT_GAP);
  camY = player.y - viewH * CAM_ANCHOR;
  trauma = 0; hitstop = 0; slowmo = 0; flight = 0;
  state = 'play';
  showPanel(null);
  Monetize.gameplayStart();
}

// ---------- Update ----------
function update(rawDt) {
  time += rawDt;
  trauma = Math.max(0, trauma - TRAUMA_DECAY * rawDt);

  // particles and floating text ignore hit-stop (recipes: exempt UI/particles from the freeze)
  for (const q of particles) { q.life -= rawDt; q.x += q.vx * rawDt; q.y += q.vy * rawDt; const k = Math.exp(-q.drag * rawDt); q.vx *= k; q.vy *= k; }
  particles = particles.filter(q => q.life > 0);
  for (const tx of texts) { tx.life -= rawDt; tx.y -= 45 * rawDt; }
  texts = texts.filter(tx => tx.life > 0);
  shownScore = lerp(shownScore, score, Math.min(1, rawDt * 10));
  if (Math.abs(shownScore - score) < 0.05) shownScore = score;

  if (hitstop > 0) { hitstop -= rawDt; return; }
  let dt = rawDt;
  if (slowmo > 0) { slowmo -= rawDt; dt *= 0.3; }

  for (const p of planets) p.bump = Math.max(0, p.bump - dt * 2.5);
  for (const c of coins) c.spin += dt * 3;
  if (player.squashT < 1) player.squashT = Math.min(1, player.squashT + dt / 0.28);

  const pl = player;
  if (pl.mode === 'orbit' && (state === 'play' || state === 'menu' || state === 'shop')) {
    const p = pl.planet;
    pl.r = lerp(pl.r, p.r + ORBIT_GAP, Math.min(1, dt * 6));
    pl.angle += pl.dir * (p.speed / pl.r) * dt;
    pl.x = p.x + Math.cos(pl.angle) * pl.r;
    pl.y = p.y + Math.sin(pl.angle) * pl.r;
  }
  for (const a of asteroids) {
    a.x += a.vx * dt; a.rot += a.vr * dt;
    if (a.x < -30) a.x = LW + 30; else if (a.x > LW + 30) a.x = -30;
  }
  if (pl.mode !== 'dead') {
    pl.trail.push({ x: pl.x, y: pl.y });
    if (pl.trail.length > 24) pl.trail.shift();
  }
  if (state !== 'play') return;

  if (pl.mode === 'fly') {
    flight += dt;
    pl.x += pl.vx * dt; pl.y += pl.vy * dt;
    if (pl.x < PLAYER_R || pl.x > LW - PLAYER_R) {
      pl.x = clamp(pl.x, PLAYER_R, LW - PLAYER_R); pl.vx = -pl.vx;
      addTrauma(0.08); Sfx.bounce(); squash(0.75, 1.25);
      burst(pl.x, pl.y, '#ffffff', 5, 100, { dir: pl.vx > 0 ? 0 : Math.PI, spread: 0.8, life: 0.3 });
    }
    for (const p of planets) {
      if (p === lastPlanet && flight < 0.3) continue;
      const dx = pl.x - p.x, dy = pl.y - p.y, d = Math.hypot(dx, dy);
      if (d < p.r + CAPTURE_GAP) { capture(p, d, dx, dy); break; }
    }
    if (pl.mode === 'fly' && (pl.y > camY + viewH + 20 || flight > MAX_FLIGHT)) { captureChain = 0; return die(flight > MAX_FLIGHT ? 'lost' : 'fell'); }
  }

  for (const a of asteroids) {
    if (Math.hypot(a.x - pl.x, a.y - pl.y) < a.r + PLAYER_R - 2) {
      burst(a.x, a.y, '#9b9bb5', 18, 200, { life: 0.7 });
      return die('asteroid');
    }
  }
  let gotAny = false;
  for (const c of coins) {
    if (!c.got && Math.hypot(c.x - pl.x, c.y - pl.y) < 20) {
      c.got = true; gotAny = true; runCoins++; Sfx.coin(coinChain++);
      burst(c.x, c.y, '#ffd54a', 8, 150, { life: 0.4 });
      popCoins();
    }
  }
  if (!gotAny && pl.mode === 'orbit') coinChain = 0;

  // camera: follow upward only, with a little lead in the direction of travel
  const lead = pl.mode === 'fly' ? pl.vy * 0.15 : 0;
  const target = pl.y + lead - viewH * CAM_ANCHOR;
  if (target < camY) camY = lerp(camY, target, Math.min(1, dt * CAM_FOLLOW));

  while (planets[planets.length - 1].y > camY - viewH) spawnNext();
  const cutoff = camY + viewH + 220;
  planets = planets.filter(p => p.y < cutoff || p === pl.planet);
  asteroids = asteroids.filter(a => a.y < cutoff);
  coins = coins.filter(c => c.y < cutoff && !(c.got && c.y > camY + viewH));
  hudScore();
}

// ---------- Draw ----------
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, cssH);
  g.addColorStop(0, '#060716'); g.addColorStop(1, '#17113a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cssW, cssH);
  for (const s of bgStars) {
    let y = (s.y - camY * scale * s.d * 0.25) % cssH; if (y < 0) y += cssH;
    ctx.globalAlpha = (0.35 + 0.35 * Math.sin(time * 2 + s.tw)) * s.d;
    ctx.fillStyle = '#fff'; ctx.fillRect(s.x, y, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  const shake = trauma * trauma;
  const sx = shake * SHAKE_MAX * noise1(time * SHAKE_FREQ);
  const sy = shake * SHAKE_MAX * noise1(time * SHAKE_FREQ + 100);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + sx), dpr * sy);
  ctx.translate(0, -camY);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, camY - 60, LW, viewH + 120); ctx.clip();

  for (const p of planets) drawPlanet(p);
  for (const c of coins) if (!c.got) drawCoin(c);
  for (const a of asteroids) drawAsteroid(a);
  if (player) drawPlayer();
  for (const q of particles) {
    ctx.globalAlpha = Math.max(0, q.life / q.max);
    ctx.fillStyle = q.color;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (q.life / q.max), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of texts) {
    const age = 1 - tx.life / tx.max;
    const sc = age < 0.12 ? lerp(1.4, 1, age / 0.12) : 1;
    ctx.globalAlpha = Math.min(1, tx.life / 0.25);
    ctx.font = `800 ${tx.size * sc}px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (offX > 4) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.strokeRect(offX + 0.5, -1, LW * scale - 1, cssH + 2);
  }
}

function drawPlanet(p) {
  const r = p.r * (1 + 0.14 * p.bump * (1 - easeOutElastic(1 - p.bump)));
  if (player && player.mode === 'orbit' && player.planet === p) {
    ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.setLineDash([3, 7]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + ORBIT_GAP, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  const glow = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 2.3);
  glow.addColorStop(0, hexA(p.c1, 0.22 + p.bump * 0.25)); glow.addColorStop(1, hexA(p.c1, 0));
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.3, 0, Math.PI * 2); ctx.fill();
  if (p.ring) {
    ctx.strokeStyle = hexA(p.c1, 0.5); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.65, r * 0.42, -0.4, Math.PI, Math.PI * 2); ctx.stroke();
  }
  const rg = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
  rg.addColorStop(0, p.c1); rg.addColorStop(1, p.c2);
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  for (const c of p.craters) { ctx.beginPath(); ctx.arc(p.x + Math.cos(c.a) * r * c.d, p.y + Math.sin(c.a) * r * c.d, r * c.r, 0, Math.PI * 2); ctx.fill(); }
  if (p.ring) {
    ctx.strokeStyle = hexA(p.c1, 0.75); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.65, r * 0.42, -0.4, 0, Math.PI); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawCoin(c) {
  const s = 7, w = Math.abs(Math.cos(c.spin)) * 0.7 + 0.3;
  ctx.save(); ctx.translate(c.x, c.y); ctx.scale(w, 1);
  ctx.fillStyle = 'rgba(255,213,74,.25)'; ctx.beginPath(); ctx.arc(0, 0, s * 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd54a'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.45 : s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawAsteroid(a) {
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.rot);
  ctx.fillStyle = 'rgba(255,90,90,.10)'; ctx.beginPath(); ctx.arc(0, 0, a.r * 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5d5a73'; ctx.strokeStyle = '#9b97b8'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  a.pts.forEach((m, i) => { const ang = i / a.pts.length * Math.PI * 2; ctx.lineTo(Math.cos(ang) * a.r * m, Math.sin(ang) * a.r * m); });
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); ctx.lineWidth = 1;
}

function drawPlayer() {
  const pl = player, tr = pl.trail;
  for (let i = 1; i < tr.length; i++) {
    const k = i / tr.length;
    ctx.strokeStyle = trailColor(i); ctx.globalAlpha = k * 0.8; ctx.lineWidth = PLAYER_R * 1.6 * k;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineWidth = 1;
  if (pl.mode === 'dead') return;

  if (pl.mode === 'orbit' && state === 'play') {
    // aim hint along the launch tangent
    const tx = -Math.sin(pl.angle) * pl.dir, ty = Math.cos(pl.angle) * pl.dir;
    let onTarget = false, tgt = null;
    if (isTutorial()) {
      tgt = planets.find(q => q.index === maxIndex + 1);
      if (tgt) {
        const dx = tgt.x - pl.x, dy = tgt.y - pl.y;
        onTarget = dx * tx + dy * ty > 0 && Math.abs(dx * ty - dy * tx) < tgt.r + CAPTURE_GAP * 0.6;
        ctx.strokeStyle = `rgba(255,213,74,${0.35 + 0.25 * Math.sin(time * 6)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tgt.x, tgt.y, tgt.r + CAPTURE_GAP, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const len = onTarget ? 140 : 70;
    ctx.strokeStyle = onTarget ? 'rgba(255,213,74,.9)' : 'rgba(255,255,255,.28)'; ctx.setLineDash([4, 6]); ctx.lineWidth = onTarget ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(pl.x + tx * 12, pl.y + ty * 12); ctx.lineTo(pl.x + tx * len, pl.y + ty * len); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    setTip(isTutorial() ? (onTarget ? 'TAP NOW!' : 'Tap when the arrow points at the glowing planet') : '');
  }
  const e = easeOutElastic(pl.squashT);
  const sxs = lerp(pl.sx, 1, e), sys = lerp(pl.sy, 1, e);
  const ang = pl.mode === 'fly' ? Math.atan2(pl.vy, pl.vx) : pl.angle + Math.PI / 2 * pl.dir;
  ctx.save(); ctx.translate(pl.x, pl.y); ctx.rotate(ang); ctx.scale(sys, sxs);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, PLAYER_R * 3);
  glow.addColorStop(0, hexA(skin().rainbow ? '#ffffff' : skin().trail, 0.55)); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, PLAYER_R * 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin().body; ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------- UI ----------
const panels = { menu: $('menu'), over: $('over'), shop: $('shop') };
function showPanel(name) {
  if (name !== null) setTip('');
  for (const k in panels) panels[k].classList.toggle('hidden', k !== name);
  $('score').classList.toggle('hidden', name !== null);
}
let tipText = null;
function setTip(text) {
  if (text === tipText) return;
  tipText = text;
  $('tip').textContent = text;
  $('tip').classList.toggle('hidden', !text);
}
function hudScore() { $('score').textContent = Math.round(shownScore); }
function hudCoins() { $('coins').textContent = '★ ' + (bank + runCoins - bankedThisRun); }
function popCoins() {
  hudCoins();
  const el = $('coins');
  el.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 1800);
}
function refreshMenu() { $('menuBest').textContent = best; $('menuCoins').textContent = bank; hudCoins(); }

function showOver(isBest) {
  state = 'over';
  $('overScore').textContent = score; $('overBest').textContent = best; $('overCoins').textContent = '+' + runCoins;
  $('newBest').classList.toggle('hidden', !isBest);
  $('reviveBtn').classList.toggle('hidden', revived || !Monetize.hasRewarded() || score < 3);
  showPanel('over'); hudCoins();
  setTimeout(() => { overReady = true; }, 400);
}

function startGame() {
  Sfx.ensure();
  newRun();
  state = 'play';
  showPanel(null); hudScore(); hudCoins();
  Monetize.gameplayStart();
}

function playAgain() {
  gamesPlayed++;
  if (gamesPlayed % 3 === 0) { state = 'ad'; Monetize.midgame().then(startGame); }
  else startGame();
}

function openShop(from) {
  shopReturn = from; state = 'shop';
  renderShop(); showPanel('shop');
}
function renderShop() {
  $('shopCoins').textContent = bank;
  const grid = $('skinGrid'); grid.innerHTML = '';
  for (const s of SKINS) {
    const b = document.createElement('button');
    const has = owned.includes(s.id);
    b.className = 'skin' + (s.id === skinId ? ' on' : '') + (has ? '' : ' locked');
    const bg = s.rainbow ? 'conic-gradient(#ff4d8d,#ffd54a,#3dffb0,#7ad7ff,#b26bff,#ff4d8d)' : `radial-gradient(circle, ${s.body} 35%, ${s.trail})`;
    b.innerHTML = `<div class="dot" style="background:${bg}"></div>${s.name}<br>` +
      (s.id === skinId ? 'Equipped' : has ? 'Owned' : `<span class="price">★ ${s.cost}</span>`);
    b.onclick = () => {
      if (has) { skinId = s.id; store.set('skin', skinId); Sfx.click(); }
      else if (bank >= s.cost) {
        bank -= s.cost; owned.push(s.id); skinId = s.id;
        store.set('coins', bank); store.set('owned', owned); store.set('skin', skinId);
        Sfx.buy(); toast(`Unlocked ${s.name}!`);
      } else { toast(`Need ${s.cost - bank} more ★`); }
      renderShop(); hudCoins();
    };
    grid.appendChild(b);
  }
}

async function share() {
  const text = `I hopped ${score} planets in Orbit Hop! Can you beat me?`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Orbit Hop', text, url: location.href }); return; }
    await navigator.clipboard.writeText(text + ' ' + location.href);
    toast('Link copied!');
  } catch (e) { /* share sheet dismissed */ }
}

// ---------- Input ----------
canvas.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.ensure(); if (state === 'play') launch(); });
window.addEventListener('keydown', e => {
  if (e.code !== 'Space' && e.code !== 'ArrowUp' && e.code !== 'Enter') return;
  e.preventDefault(); Sfx.ensure();
  if (state === 'play') launch();
  else if (state === 'menu') startGame();
  else if (state === 'over' && overReady) playAgain();
});
$('playBtn').onclick = () => { Sfx.click(); startGame(); };
$('againBtn').onclick = () => { Sfx.click(); playAgain(); };
$('menuShopBtn').onclick = () => { Sfx.ensure(); Sfx.click(); openShop('menu'); };
$('overShopBtn').onclick = () => { Sfx.click(); openShop('over'); };
$('shopBack').onclick = () => {
  Sfx.click();
  if (shopReturn === 'over') { state = 'over'; showPanel('over'); } else { state = 'menu'; refreshMenu(); showPanel('menu'); }
};
$('shareBtn').onclick = share;
$('reviveBtn').onclick = async () => {
  $('reviveBtn').classList.add('hidden');
  if (await Monetize.rewarded()) revive(); else toast('Ad not available right now');
};
const muteBtn = $('mute');
const syncMute = () => { muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; };
muteBtn.onclick = e => { e.stopPropagation(); Sfx.ensure(); Sfx.toggle(); syncMute(); };
syncMute();
Monetize.onAdPause(() => Sfx.adPause());
Monetize.onAdResume(() => Sfx.adResume());

// ---------- Daily gift ----------
function dailyGift() {
  const day = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  const today = day(new Date()), yesterday = day(new Date(Date.now() - 864e5));
  const last = store.get('giftDay', '');
  if (last === today) return;
  const streak = last === yesterday ? store.get('giftStreak', 0) + 1 : 1;
  const gift = Math.min(50, 15 + (streak - 1) * 5);
  bank += gift;
  store.set('coins', bank); store.set('giftDay', today); store.set('giftStreak', streak);
  refreshMenu();
  setTimeout(() => toast(streak > 1 ? `Day ${streak} streak! Daily gift +${gift}★` : `Daily gift +${gift}★ — come back tomorrow for more`), 600);
}

// ---------- Boot ----------
newRun();
refreshMenu();
showPanel('menu');
dailyGift();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  update(dt); draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
Monetize.init().then(() => Monetize.loadingFinished());

// small read-only hook for automated tests
window.OrbitHop = {
  get state() { return state; }, get score() { return score; }, get mode() { return player && player.mode; }, get lastDeath() { return lastDeath; },
  start: startGame, tap: launch,
  snapshot: () => ({
    player: player && { x: player.x, y: player.y, angle: player.angle, dir: player.dir, mode: player.mode, planet: player.planet && player.planet.index },
    planets: planets.map(p => ({ x: p.x, y: p.y, r: p.r, index: p.index })),
    asteroids: asteroids.map(a => ({ x: a.x, y: a.y, r: a.r, vx: a.vx })),
    maxIndex, flySpeed: FLY_SPEED, captureGap: CAPTURE_GAP, lw: LW,
  }),
};
})();
