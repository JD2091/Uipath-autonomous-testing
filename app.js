(function () {
'use strict';
const D = window.DECK;
const root = document.documentElement;
const deckEl = document.getElementById('deck');
const sections = Array.from(document.querySelectorAll('.slide'));
const N = sections.length;
const W = D.w, H = D.h;
const GAP = 600; // ms between on-click steps in scroll mode
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let mode = 'scroll';
let active = -1;
const uipBtn = document.getElementById('uip');
const fbEl = document.getElementById('fb');
uipBtn.addEventListener('click', () => openLive());
function hydrate(i) {
const s = sections[i];
if (!s) return;
const t = s.querySelector('template');
if (t) { s.querySelector('.stage').appendChild(t.content); t.remove(); }
}
function preload(i) {
if (!sections[i]) return;
hydrate(i);
sections[i].querySelectorAll('img').forEach((im) => { if (im.decode) im.decode().catch(() => {}); });
}
function easing(a, d) {
if (!a && !d) return 'linear';
const v = 1 / (1 - a / 2 - d / 2), pts = [];
for (let k = 0; k <= 20; k++) {
const t = k / 20;
const p = t < a ? v * t * t / (2 * a) : t <= 1 - d ? v * (t - a / 2) : 1 - v * (1 - t) * (1 - t) / (2 * d);
pts.push(+p.toFixed(4));
}
return 'linear(' + pts.join(',') + ')';
}
const fcache = {};
function evalF(x, v) {
if (x == null) return null;
if (typeof x === 'number' || typeof x === 'boolean') return x;
if (/^-?[\d.]+$/.test(x)) return +x;
if (!/#ppt_|[\d.]/.test(x)) return x; // plain string value (e.g. "visible")
const f = fcache[x] || (fcache[x] = new Function('v', 'with(Math){return (' + x.replace(/#(ppt_\w+)/g, 'v.$1') + ')}'));
return f(v);
}
function base(el) { // shape geometry as PowerPoint sees it (fractions of the slide)
let x = 0, y = 0, n = el;
while (n && n.classList && n.classList.contains('o')) { x += n.offsetLeft; y += n.offsetTop; n = n.parentElement; }
const w = el.offsetWidth, h = el.offsetHeight;
return { ppt_x: (x + w / 2) / W, ppt_y: (y + h / 2) / H, ppt_w: w / W, ppt_h: h / H, ppt_r: 0 };
}
function targets(stage, t) {
if (!t) return [];
const el = stage.querySelector('[data-spid="' + t.spid + '"]');
if (!el) return [];
if (!t.para) return [el];
return Array.from(el.querySelectorAll('[data-p]')).filter((p) => +p.dataset.p >= t.para[0] && +p.dataset.p <= t.para[1]);
}
function filterFrames(filter) {
const m = /^(\w+)(?:\(([^)]*)\))?/.exec(filter || 'fade') || [];
const name = m[1], arg = m[2] || '';
const full = 'inset(0% 0% 0% 0%)';
switch (name) {
case 'fade': case 'dissolve': return ['opacity', 0, 1];
case 'wipe': return ['clipPath', { left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)', up: 'inset(100% 0% 0% 0%)', down: 'inset(0% 0% 100% 0%)' }[arg] || 'inset(0% 100% 0% 0%)', full];
case 'barn':
if (arg === 'outVertical') return ['clipPath', 'inset(0% 50% 0% 50%)', full];
if (arg === 'outHorizontal') return ['clipPath', 'inset(50% 0% 50% 0%)', full];
if (arg === 'inVertical') return ['clipPath', 'polygon(0% 0%,0% 0%,0% 100%,0% 100%,0% 0%,100% 0%,100% 0%,100% 100%,100% 100%,100% 0%)', 'polygon(0% 0%,50% 0%,50% 100%,0% 100%,0% 0%,50% 0%,100% 0%,100% 100%,50% 100%,50% 0%)'];
return ['clipPath', 'polygon(0% 0%,100% 0%,100% 0%,0% 0%,0% 0%,0% 100%,100% 100%,100% 100%,0% 100%,0% 100%)', 'polygon(0% 0%,100% 0%,100% 50%,0% 50%,0% 0%,0% 50%,100% 50%,100% 100%,0% 100%,0% 50%)'];
case 'box': return ['clipPath', 'inset(50% 50% 50% 50%)', full];
case 'circle': return ['clipPath', 'circle(0% at 50% 50%)', 'circle(71% at 50% 50%)'];
case 'diamond': return ['clipPath', 'polygon(50% 50%,50% 50%,50% 50%,50% 50%)', 'polygon(50% -50%,150% 50%,50% 150%,-50% 50%)'];
default:
console.info('[deck] transition filter "' + filter + '" approximated by fade');
return ['opacity', 0, 1];
}
}
function motionFrames(path) { // "M 0 0 L 0.25 0.1 C ... E" in slide fractions -> [[offset, 'xpx ypx']]
const tok = path.replace(/([MLCZEmlcze])/g, ' $1 ').trim().split(/[\s,]+/);
const pts = []; let i = 0, cur = [0, 0], cmd = 'M';
while (i < tok.length) {
if (/[A-Za-z]/.test(tok[i])) { cmd = tok[i++]; if (cmd === 'E' || cmd === 'Z' || cmd === 'e' || cmd === 'z') continue; }
const rel = cmd === cmd.toLowerCase();
const num = () => +tok[i++];
if (/[ML]/i.test(cmd)) {
let p = [num(), num()]; if (rel) p = [cur[0] + p[0], cur[1] + p[1]];
cur = p; pts.push(p);
} else if (/C/i.test(cmd)) {
const c = [num(), num(), num(), num(), num(), num()];
const o = rel ? cur : [0, 0];
const p0 = cur, p1 = [o[0] + c[0], o[1] + c[1]], p2 = [o[0] + c[2], o[1] + c[3]], p3 = [o[0] + c[4], o[1] + c[5]];
for (let k = 1; k <= 12; k++) {
const t = k / 12, u = 1 - t;
pts.push([0, 1].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]));
}
cur = p3;
} else i++;
}
if (!pts.length) return [[0, '0px 0px'], [1, '0px 0px']];
let len = 0; const acc = [0];
for (let k = 1; k < pts.length; k++) { len += Math.hypot((pts[k][0] - pts[k - 1][0]) * W, (pts[k][1] - pts[k - 1][1]) * H); acc.push(len); }
return pts.map((p, k) => [len ? acc[k] / len : k / Math.max(pts.length - 1, 1), (p[0] * W).toFixed(2) + 'px ' + (p[1] * H).toFixed(2) + 'px']);
}
function behaviourTracks(b, eff, stage) {
const out = [];
const els = targets(stage, b.t || eff.target);
const attr = (b.attr && b.attr[0]) || '';
els.forEach((el) => {
const bv = base(el);
const conv = (a, v) => {
switch (a) {
case 'ppt_x': return ['tx', (v - bv.ppt_x) * W];
case 'ppt_y': return ['ty', (v - bv.ppt_y) * H];
case 'ppt_w': return ['sx', bv.ppt_w ? v / bv.ppt_w : 1];
case 'ppt_h': return ['sy', bv.ppt_h ? v / bv.ppt_h : 1];
case 'ppt_r': case 'r': case 'style.rotation': return ['rotate', v + 'deg'];
case 'style.opacity': return ['opacity', v];
case 'style.visibility': return ['visibility', v];
default: return null;
}
};
if (b.k === 'set') {
const c = conv(attr, evalF(b.to, bv));
if (c) out.push({ el, prop: c[0], kf: [[0, c[1]], [1, c[1]]], discrete: true });
} else if (b.k === 'animEffect') {
const f = filterFrames(b.filter);
const inn = b.transition !== 'out';
out.push({ el, prop: f[0], kf: [[0, inn ? f[1] : f[2]], [1, inn ? f[2] : f[1]]] });
} else if (b.k === 'anim') {
let kf;
if (b.tav && b.tav.length) kf = b.tav.map((t, k, arr) => [t.tm == null ? k / Math.max(arr.length - 1, 1) : t.tm / 100, evalF(t.val, bv)]);
else {
const cur = bv[attr] != null ? bv[attr] : 0;
const from = b.from != null ? evalF(b.from, bv) : cur;
const to = b.to != null ? evalF(b.to, bv) : from + (+evalF(b.by, bv) || 0);
kf = [[0, from], [1, to]];
}
const mapped = kf.map(([o, v]) => { const c = conv(attr, v); return c && [o, c[1], c[0]]; });
if (mapped.every(Boolean)) out.push({ el, prop: mapped[0][2], kf: mapped.map((m) => [m[0], m[1]]), discrete: b.calcmode === 'discrete' || attr === 'style.visibility' });
} else if (b.k === 'animScale') {
const from = b.from || [1, 1];
const to = b.to || (b.by ? [from[0] * b.by[0], from[1] * b.by[1]] : [1, 1]);
out.push({ el, prop: 'scale', kf: [[0, from[0] + ' ' + from[1]], [1, to[0] + ' ' + to[1]]], composite: 'add' });
} else if (b.k === 'animRot') {
const from = b.from || 0, to = b.to != null ? b.to : from + (b.by || 0);
out.push({ el, prop: 'rotate', kf: [[0, from + 'deg'], [1, to + 'deg']], composite: 'add' });
} else if (b.k === 'animMotion') {
out.push({ el, prop: 'translate', kf: motionFrames(b.path || ''), composite: 'add' });
} else if (b.k === 'animClr' && b.to) {
out.push({ el, prop: 'color', kf: [[1, b.to.hex]] });
}
});
return out;
}
function mergeAxes(tracks) {
const res = [];
const pair = { tx: ['ty', 'translate', (x, y) => x.toFixed(2) + 'px ' + y.toFixed(2) + 'px', 0], sx: ['sy', 'scale', (x, y) => +x.toFixed(5) + ' ' + +y.toFixed(5), 1] };
const used = new Set();
tracks.forEach((t, i) => {
if (used.has(i)) return;
const p = pair[t.prop] || pair[Object.keys(pair).find((k) => pair[k][0] === t.prop)];
if (!p) { res.push(t); return; }
const isX = !!pair[t.prop];
const otherName = isX ? p[0] : Object.keys(pair).find((k) => pair[k][0] === t.prop);
const j = tracks.findIndex((u, k) => k > i && !used.has(k) && u.el === t.el && u.prop === otherName && u.win[0] === t.win[0] && u.win[1] === t.win[1] && u.kf.length === t.kf.length && u.kf.every((f, m) => f[0] === t.kf[m][0]));
const X = isX ? t : tracks[j], Y = isX ? tracks[j] : t;
if (j >= 0) used.add(j);
res.push(Object.assign({}, t, { prop: p[1], composite: res.some((r) => r.el === t.el && r.prop === p[1]) ? 'add' : undefined,
kf: t.kf.map((f, m) => [f[0], p[2](X ? X.kf[m][1] : p[3], Y ? Y.kf[m][1] : p[3])]) }));
});
return res;
}
function span(b) {
const rep = b.repeat === 'indefinite' ? 1 : (b.repeat || 1000) / 1000;
return (+b.dur || 0) * rep * (b.autoRev ? 2 : 1);
}
function compileEffect(eff, stage) {
const Dur = Math.max(1, ...eff.b.map((b) => (b.d || 0) + span(b)));
let tracks = [];
eff.b.forEach((b) => {
const bt = behaviourTracks(b, eff, stage);
const s0 = (b.d || 0) / Dur, s1 = ((b.d || 0) + span(b)) / Dur;
bt.forEach((t) => {
t.win = [s0, s1];
t.ease = easing(b.accel || eff.accel || 0, b.decel || eff.decel || 0);
const rep = b.repeat === 'indefinite' ? 1 : Math.max(1, Math.round((b.repeat || 1000) / 1000));
let kf = t.kf;
if (b.autoRev) kf = kf.map(([o, v]) => [o / 2, v]).concat(kf.slice().reverse().map(([o, v]) => [1 - o / 2, v]));
if (rep > 1) { const one = kf; kf = []; for (let r = 0; r < rep; r++) one.forEach(([o, v]) => kf.push([(r + o) / rep, v])); }
t.kf = kf;
});
tracks = tracks.concat(bt);
});
tracks = mergeAxes(tracks);
const rep = eff.repeat === 'indefinite' ? Infinity : (eff.repeat || 1000) / 1000;
return tracks.map((t) => {
const frames = [];
const [w0, w1] = t.win;
const at = (o) => w0 + o * (w1 - w0);
const first = t.kf[0], last = t.kf[t.kf.length - 1];
const fr = (offset, v, extra) => { const f = { offset: Math.min(1, Math.max(0, offset)) }; f[t.prop] = v; return Object.assign(f, extra); };
if (t.discrete) {
if (w0 > 0) { const cur = getComputedStyle(t.el)[t.prop]; frames.push(fr(0, cur), fr(w0, cur)); }
t.kf.forEach(([o, v], k) => { if (k > 0) frames.push(fr(at(o), t.kf[k - 1][1])); frames.push(fr(at(o), v)); });
if (at(last[0]) < 1) frames.push(fr(1, last[1]));
} else {
if (w0 > 0) frames.push(fr(0, first[1]));
t.kf.forEach(([o, v], k) => frames.push(fr(at(o), v, k < t.kf.length - 1 ? { easing: t.ease } : {})));
if (at(last[0]) < 1) frames.push(fr(1, last[1]));
}
if (frames[0].offset > 0) frames.unshift(fr(0, frames[0][t.prop]));
return {
el: t.el, frames,
opts: {
delay: eff.start, duration: Dur,
iterations: eff.autoRev ? rep * 2 : rep, direction: eff.autoRev ? 'alternate' : 'normal',
fill: eff.fill === 'remove' ? 'none' : 'forwards', composite: t.composite || 'replace', easing: 'linear',
},
};
});
}
class Player {
constructor(i) {
this.i = i; this.sec = sections[i];
const t = D.slides[i].t;
this.steps = t ? t.main : [];
this.inter = t ? t.interactive : [];
this.pos = 0; // steps started
this.anims = []; // per step: Animation[]
this.token = 0;
this.lead = 0; while (this.lead < this.steps.length && this.steps[this.lead].trigger === 'auto') this.lead++;
}
stage() { hydrate(this.i); return this.sec.querySelector('.stage'); }
play(k) { // start step k as one timeline; resolves when it ends
const stage = this.stage();
const specs = [];
this.steps[k].groups.forEach((g) => g.effects.forEach((e) => compileEffect(e, stage).forEach((s) => { s.eff = e; specs.push(s); })));
const els = new Set(specs.map((s) => s.el));
els.forEach((el) => { el.style.willChange = 'transform,opacity,clip-path'; });
const list = specs.map((s) => { const a = s.el.animate(s.frames, s.opts); a.pause(); a.__eff = s.eff; a.__step = k; return a; });
const t0 = document.timeline.currentTime;
list.forEach((a) => { a.startTime = t0; });
this.anims[k] = list;
this.pos = Math.max(this.pos, k + 1);
if (reduced.matches) list.forEach((a) => { try { a.finish(); } catch (e) { /* infinite */ } });
const done = Promise.all(list.map((a) => a.finished.catch(() => null)));
done.then(() => els.forEach((el) => { el.style.willChange = ''; }));
return done;
}
finishRunning() { this.anims.forEach((l) => l && l.forEach((a) => { if (a.playState === 'running' || a.playState === 'paused') { try { a.finish(); } catch (e) { /* infinite */ } } })); }
rewind() { // undo the last started step exactly
const k = this.pos - 1; if (k < 0) return;
(this.anims[k] || []).forEach((a) => a.cancel()); this.anims[k] = null; this.pos = k;
}
reset() {
this.token++;
this.anims.forEach((l) => l && l.forEach((a) => a.cancel()));
this.anims = []; this.pos = 0;
this.sec.querySelectorAll('[style*="will-change"]').forEach((el) => { el.style.willChange = ''; });
}
async auto() { // leading/next auto steps (start-of-slide, or trailing auto steps)
while (this.pos < this.steps.length && this.steps[this.pos].trigger === 'auto') await this.play(this.pos);
}
finishAll() {
const tok = ++this.token;
while (this.pos < this.steps.length) this.play(this.pos);
this.finishRunning(); this.token = tok;
}
goToStep(n) { this.reset(); for (let k = 0; k < Math.min(n, this.steps.length); k++) this.play(k); this.finishRunning(); }
async autoplay() { // scroll mode: everything in order, 600 ms between on-click steps
const tok = ++this.token;
while (this.pos < this.steps.length) {
if (this.steps[this.pos].trigger !== 'auto') { await wait(reduced.matches ? 0 : GAP); if (tok !== this.token) return; }
await this.play(this.pos);
if (tok !== this.token) return;
updateHash();
}
}
wire() { // interactive sequences: click a trigger shape to play its next step
if (this.wired || !this.inter.length) return; this.wired = true;
const stage = this.stage();
this.inter.forEach((seq) => {
const el = stage.querySelector('[data-spid="' + seq.trigger + '"]'); if (!el) return;
let k = 0; el.style.cursor = 'pointer';
el.addEventListener('click', (ev) => {
ev.stopPropagation();
const sub = Object.assign(Object.create(Player.prototype), this, { steps: seq.steps, anims: [], pos: 0 });
sub.play(k % seq.steps.length); k++;
});
});
}
timeline() { // for QA: effect start/end (ms, step-relative) read back from the live Animations
return this.anims.map((l, k) => {
const per = new Map();
(l || []).forEach((a) => {
const t = a.effect.getComputedTiming(); const e = a.__eff;
const st = a.effect.getTiming().delay; const end = st + t.activeDuration;
const cur = per.get(e.id) || { id: e.id, spid: e.target && e.target.spid, node: e.node, cls: e.cls, preset: e.preset, step: k, start: st, end, startTime: a.startTime };
cur.start = Math.min(cur.start, st); cur.end = Math.max(cur.end, end); per.set(e.id, cur);
});
return Array.from(per.values());
});
}
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const players = sections.map((s, i) => new Player(i));
function updateHash() {
if (active < 0) return;
const p = players[active];
history.replaceState(null, '', '#/' + (active + 1) + (p.pos > p.lead ? '/' + (p.pos - p.lead) : ''));
syncPresenter();
}
function setActive(i, focus) {
if (i === active) return;
active = i;
arrive(i);
[i - 1, i, i + 1].forEach(hydrate);
players[i].wire();
root.style.setProperty('--p', (i + 1) / N);
document.getElementById('counter').textContent = (i + 1) + ' / ' + N;
dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
document.getElementById('live').textContent = 'Slide ' + (i + 1) + ' of ' + N + ': ' + sections[i].dataset.title;
if (focus) sections[i].focus({ preventScroll: true });
uipBtn.hidden = !sections[i].dataset.liveUrl;
uipBtn.textContent = '↗ ' + (sections[i].dataset.liveLabel || '');
if (!fbEl.hidden) toggleFallback(false);
updateNotes();
updateHash();
}
function scrollToSlide(i, smooth) {
deckEl.scrollTo({ top: sections[i].offsetTop, behavior: smooth && !reduced.matches ? 'smooth' : 'instant' });
}
function show(i, state) {
i = Math.max(0, Math.min(N - 1, i));
const p = players[i];
if (active >= 0 && active !== i) players[active].reset();
p.reset();
if (state === 'end') p.finishAll(); else if (typeof state === 'number') p.goToStep(p.lead + state); else p.auto();
scrollToSlide(i, false);
setActive(i, true);
updateHash();
}
function visibleNeighbour(i, dir) { // present mode skips slides hidden in PowerPoint
let j = i + dir;
while (j >= 0 && j < N && D.slides[j].hidden) j += dir;
return j >= 0 && j < N ? j : -1;
}
function next() {
if (mode === 'scroll') { if (active < N - 1) scrollToSlide(active + 1, true); return; }
const p = players[active];
if (p.pos < p.steps.length) {
p.finishRunning();
p.play(p.pos).then(() => { if (mode === 'present') p.auto(); });
updateHash();
} else {
const j = visibleNeighbour(active, 1); if (j >= 0) show(j, 'start');
}
}
function prev() {
if (mode === 'scroll') { if (active > 0) scrollToSlide(active - 1, true); return; }
const p = players[active];
if (p.pos > p.lead) { p.finishRunning(); p.rewind(); updateHash(); } else {
const j = visibleNeighbour(active, -1); if (j >= 0) show(j, 'end');
}
}
function setMode(m) {
mode = m;
root.classList.toggle('present', m === 'present');
const p = players[active];
if (m === 'present') { p.reset(); p.auto(); } else p.autoplay();
document.getElementById('live').textContent = (m === 'present' ? 'Present' : 'Scroll') + ' mode';
updateHash();
}
const io = new IntersectionObserver((entries) => {
entries.forEach((en) => {
const i = sections.indexOf(en.target);
if (en.intersectionRatio >= 0.5) preload(i + 1);
if (en.intersectionRatio >= 0.6 && mode === 'scroll' && i !== active) {
if (active >= 0 && players[active] && !isVisible(active)) players[active].reset();
setActive(i, false);
players[i].autoplay();
}
if (!en.isIntersecting && i !== active) players[i].reset(); // leaving resets so it replays on return
});
}, { root: deckEl, threshold: [0, 0.5, 0.6] });
const isVisible = (i) => { const r = sections[i].getBoundingClientRect(); return r.bottom > 1 && r.top < innerHeight - 1; };
sections.forEach((s) => io.observe(s));
const dotsEl = document.getElementById('dots');
const dots = sections.map((s, i) => {
const b = document.createElement('button');
b.type = 'button'; b.setAttribute('aria-label', 'Slide ' + (i + 1) + ': ' + s.dataset.title);
b.addEventListener('click', (e) => { e.stopPropagation(); go(i); });
dotsEl.appendChild(b); return b;
});
function go(i, state) { if (mode === 'present') show(i, state || 'start'); else scrollToSlide(i, true); }
let idleT;
function wake() { root.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add('idle'), 2000); }
['mousemove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, wake, { passive: true, capture: true }));
wake();
const notesEl = document.getElementById('notes-drawer');
function updateNotes() {
if (notesEl.hidden || active < 0) return;
const a = sections[active].querySelector('.notes');
notesEl.querySelector('.nb').innerHTML = a ? a.innerHTML : '<em>No notes for this slide.</em>';
}
function toggleNotes(force) {
if (pwOpen() && force !== false) { pw.focus(); return; }
notesEl.hidden = force != null ? !force : !notesEl.hidden; updateNotes();
}
const gridEl = document.getElementById('grid');
let lastFocus = null;
function toggleGrid(force) {
const open = force != null ? force : gridEl.hidden;
if (!open) { gridEl.hidden = true; if (lastFocus) lastFocus.focus({ preventScroll: true }); return; }
lastFocus = document.activeElement;
const gw = gridEl.querySelector('.gw');
if (!gw.children.length) {
sections.forEach((s, i) => {
hydrate(i);
const b = document.createElement('button'); b.type = 'button';
b.setAttribute('aria-label', 'Go to slide ' + (i + 1) + ': ' + s.dataset.title);
const st = s.querySelector('.stage').cloneNode(true);
st.querySelectorAll('.ah').forEach((e) => e.classList.remove('ah')); // thumbnails show the finished slide
st.querySelectorAll('[data-spid]').forEach((e) => e.removeAttribute('data-spid'));
st.setAttribute('aria-hidden', 'true');
b.appendChild(st);
const lab = document.createElement('span'); lab.textContent = String(i + 1); b.appendChild(lab);
b.addEventListener('click', () => { toggleGrid(false); go(i); });
gw.appendChild(b);
});
}
gridEl.hidden = false;
const w = gw.firstElementChild.clientWidth;
gridEl.style.setProperty('--gs', w / W);
Array.from(gw.children).forEach((b, i) => b.setAttribute('aria-current', i === active ? 'true' : 'false'));
gw.children[Math.max(active, 0)].focus();
}
let liveOpened = false;
function openLive(fromPopup) {
const url = active >= 0 && sections[active].dataset.liveUrl;
if (!url) return;
const pop = fromPopup === true && pwOpen();
if (!pop) { liveOpened = true; if (pwOpen()) { try { pe('hint').hidden = true; } catch (e) { /* popup closing */ } } }
if (D.open === 'split') {
if (pop && !liveOpened) { pe('hint').hidden = false; return; }
const d = pop ? pw.document : document, a = d.createElement('a');
a.href = url; a.target = 'uipath-live';
if (pop) d.body.appendChild(a); // attached: Chromium ignores a detached link with a named target
a.click(); a.remove(); return;
}
const sw = screen.availWidth, sh = screen.availHeight, x = (screen.availLeft || 0) + Math.round(sw * D.split);
const w = (pop ? pw : window).open(url, 'uipath-live', 'left=' + x + ',top=' + (screen.availTop || 0) + ',width=' + (sw - x + (screen.availLeft || 0)) + ',height=' + sh);
if (w) w.focus();
}
function toggleFallback(force) {
const src = active >= 0 && sections[active].dataset.fallback;
const open = force != null ? force : fbEl.hidden;
if (!open || !src) { fbEl.hidden = true; fbEl.textContent = ''; return; }
const m = document.createElement(/\.(mp4|webm)$/i.test(src) ? 'video' : 'img');
m.src = src; if (m.tagName === 'VIDEO') { m.controls = true; m.autoplay = true; }
fbEl.appendChild(m); fbEl.hidden = false;
}
let clk = { start: null, paused: 0, slide: 0, at: 0 };
try { Object.assign(clk, JSON.parse(sessionStorage.getItem('deck.clock'))); } catch (e) { /* no storage: the clock lives in memory */ }
const saveClock = () => { try { sessionStorage.setItem('deck.clock', JSON.stringify(clk)); } catch (e) { /* no storage */ } };
const elapsed = () => (clk.start == null ? clk.paused : (Date.now() - clk.start) / 1000);
const fmt = (s) => { const a = Math.round(Math.abs(s)); return (s < 0 && a ? '-' : '') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); };
function arrive(i) { if (clk.slide !== i + 1) { clk.slide = i + 1; clk.at = elapsed(); saveClock(); } }
function toggleClock() {
if (clk.start == null) clk.start = Date.now() - clk.paused * 1000; else { clk.paused = elapsed(); clk.start = null; }
saveClock(); renderClock();
}
let resetArmed = 0; // Reset needs a second click within 3 s, so a stray click cannot wipe the clock mid-talk
function resetClick() {
if (Date.now() - resetArmed > 3000) { resetArmed = Date.now(); renderClock(); return; }
resetArmed = 0; clk = { start: null, paused: 0, slide: active + 1, at: 0 }; saveClock(); renderClock();
}
function planTime(n) {
const T = D.timing;
if (!T) return null;
if (T.marks[n] != null) return T.marks[n];
if (T.block && T.block.from === n) return T.block.start;
const c = (T.checkpoints || []).find((x) => x.slide === n);
return c ? c.at : null;
}
function syncClock() { // rehearsal helper: jump the clock to where the plan says this slide starts
const t = planTime(active + 1);
if (t == null) return;
if (clk.start == null) clk.paused = t; else clk.start = Date.now() - t * 1000;
clk.slide = active + 1; clk.at = t; saveClock(); renderClock();
}
function renderClock() {
if (!pwOpen() || active < 0) return;
const now = elapsed(), started = clk.start != null || clk.paused > 0, t = planTime(active + 1);
pe('clock').textContent = fmt(now);
pe('start').textContent = clk.start != null ? 'Pause' : clk.paused > 0 ? 'Resume' : 'Start';
pe('reset').textContent = Date.now() - resetArmed <= 3000 ? 'Click again to reset' : 'Reset';
pe('sync').disabled = t == null;
pe('sync').title = t == null ? 'This slide has no plan time' : 'Set the clock to ' + fmt(t);
const st = started ? planState(active + 1, clk.at, now) : null;
let line = started ? '' : 'Press Start to begin the talk clock.';
if (st && st.kind === 'slide') {
const d = Math.round(st.drift);
line = 'On this slide ' + fmt(st.onSlide) + ' / ' + fmt(st.budget) + ' · arrived ' + (d === 0 ? 'on plan' : fmt(Math.abs(d)) + (d > 0 ? ' behind plan' : ' ahead of plan'));
} else if (st && st.kind === 'block') line = D.timing.block.name + ' ' + fmt(st.blockElapsed) + ' / ' + fmt(st.blockTotal);
pe('status').textContent = line;
const nx = st && st.next;
pe('cp').className = nx ? (nx.left <= 0 ? 'red' : nx.left <= 120 ? 'amber' : '') : '';
pe('cp').textContent = nx ? (nx.left > 0 ? 'Next: ' + nx.label + ' in ' + fmt(nx.left) : 'Due now: ' + nx.label + ' (' + fmt(-nx.left) + ' over)') : '';
}
let pw = null, pwSlide = -1;
const pwOpen = () => !!pw && !pw.closed;
const pe = (id) => pw.document.getElementById(id);
function toast(msg) {
const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}
function drawPresenter() {
if (!pwOpen() || active < 0) return;
const a = sections[active].querySelector('.notes');
const j = mode === 'present' ? visibleNeighbour(active, 1) : (active + 1 < N ? active + 1 : -1);
pe('ttl').textContent = (active + 1) + ' / ' + N + '   ' + sections[active].dataset.title;
pe('notes').innerHTML = a ? a.innerHTML : '<em>No notes for this slide.</em>';
if (pwSlide !== active) { pe('notes').scrollTop = 0; pwSlide = active; } // keep the reading position while steps play
pe('nxt').textContent = j >= 0 ? 'Next: ' + sections[j].dataset.title : 'End of deck';
pe('live').hidden = !sections[active].dataset.liveUrl;
pe('live').textContent = '↗ ' + (sections[active].dataset.liveLabel || 'Open live page');
}
function syncPresenter() { try { drawPresenter(); renderClock(); } catch (e) { /* popup mid-reload or closing */ } }
function pwKey(e) {
if (e.ctrlKey || e.metaKey || e.altKey) return;
const k = e.key;
if ((k === ' ' || k === 'Enter') && e.target.closest && e.target.closest('button')) return; // the button's own click handles it
const fn = { ArrowRight: next, ArrowDown: next, PageDown: next, Enter: next, ArrowLeft: prev, ArrowUp: prev, PageUp: prev, Backspace: prev, ' ': e.shiftKey ? prev : next }[k];
if (fn) { e.preventDefault(); fn(); }
}
function openPresenter() {
if (pwOpen()) { pw.focus(); return; }
if (!D.pv) { toast('This build has no presenter window.'); return; }
pw = window.open('', 'deck-presenter', 'popup,width=900,height=720');
if (!pw) { toast('The browser blocked the presenter window. Allow pop-ups for this page, then press S again.'); return; }
toggleNotes(false); // never leave the on-stage notes drawer open next to it
pw.document.open(); pw.document.write(D.pv); pw.document.close();
pe('prev').onclick = prev; pe('next').onclick = next; pe('live').onclick = () => openLive(true);
pe('start').onclick = toggleClock; pe('reset').onclick = resetClick; pe('sync').onclick = syncClock;
pw.document.addEventListener('keydown', pwKey);
if (!pw.__tk) pw.__tk = pw.setInterval('try{opener.deck.tickPresenter()}catch(e){if(e.name=="SecurityError")close()}', 1000);
pwSlide = -1;
syncPresenter();
}
addEventListener('pagehide', () => { if (pwOpen()) { try { pe('ban').hidden = false; } catch (e) { /* popup already gone */ } } });
function fullscreen() {
if (document.fullscreenElement) document.exitFullscreen(); else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
}
addEventListener('keydown', (e) => {
if (e.ctrlKey || e.metaKey || e.altKey) return;
const k = e.key;
if (k === 'Escape') { if (!fbEl.hidden) toggleFallback(false); else if (!gridEl.hidden) toggleGrid(false); else if (!notesEl.hidden) toggleNotes(false); return; }
if (!gridEl.hidden) return; // grid has its own (native) button navigation
if (e.target.closest && e.target.closest('a,button,input,textarea')) { if (k === ' ' || k === 'Enter') return; }
const map = {
ArrowRight: next, ArrowDown: next, PageDown: next, Enter: next,
ArrowLeft: prev, ArrowUp: prev, PageUp: prev, Backspace: prev,
' ': e.shiftKey ? prev : next,
Home: () => go(0), End: () => go(N - 1, 'end'),
f: fullscreen, F: fullscreen, g: () => toggleGrid(), G: () => toggleGrid(), n: () => toggleNotes(), N: () => toggleNotes(),
p: () => setMode(mode === 'present' ? 'scroll' : 'present'), P: () => setMode(mode === 'present' ? 'scroll' : 'present'),
l: openLive, L: openLive, b: () => toggleFallback(), B: () => toggleFallback(), s: openPresenter, S: openPresenter,
};
if (mode === 'scroll' && (k === 'Enter')) return;
const fn = map[k];
if (fn) { e.preventDefault(); fn(); }
});
deckEl.addEventListener('click', (e) => {
if (mode !== 'present' || e.target.closest('a,button')) return;
if (e.clientX < innerWidth / 3) prev(); else next();
});
let ty = null;
deckEl.addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
deckEl.addEventListener('touchend', (e) => {
if (mode !== 'present' || ty == null) return;
const dy = e.changedTouches[0].clientY - ty; ty = null;
if (Math.abs(dy) > 50) { e.preventDefault(); if (dy < 0) next(); else prev(); }
});
reduced.addEventListener('change', () => { if (reduced.matches) players.forEach((p) => p.finishRunning()); });
addEventListener('resize', () => { if (!gridEl.hidden) gridEl.style.setProperty('--gs', gridEl.querySelector('.gw').firstElementChild.clientWidth / W); if (active >= 0) scrollToSlide(active, false); });
function planState(n, arrival, now) {
const T = D.timing;
const cp = T && (T.checkpoints || []).slice().sort((a, b) => a.at - b.at).find((c) => c.at + 60 > now && !(c.slide && n >= c.slide));
const next = cp ? { label: cp.label, left: cp.at - now } : null;
const B = T && T.block;
if (B && n >= B.from && n <= B.to) return { kind: 'block', blockElapsed: now - B.start, blockTotal: B.end - B.start, next };
const mark = T && T.marks[n];
if (mark == null) return { kind: 'none', next };
const end = Math.min(...Object.values(T.marks).concat(B ? [B.start] : [], T.talk).filter((t) => t > mark));
return { kind: 'slide', drift: arrival - mark, onSlide: now - arrival, budget: end - mark, next };
}
function fromHash() {
const m = /^#\/(\d+)(?:\/(\d+))?/.exec(location.hash);
if (!m) return null;
return { i: Math.max(0, Math.min(N - 1, +m[1] - 1)), step: m[2] != null ? +m[2] : null };
}
function restore(h) {
const p = players[h.i];
hydrate(h.i);
if (h.step != null) { p.goToStep(p.lead + h.step); }
scrollToSlide(h.i, false);
setActive(h.i, mode === 'present');
if (mode === 'present') { if (h.step == null) p.auto(); } else p.autoplay();
}
addEventListener('hashchange', () => { const h = fromHash(); if (h) { players[h.i].reset(); active = -1; restore(h); } });
const h0 = fromHash();
if (h0) restore(h0);
window.deck = {
get active() { return active; }, get mode() { return mode; }, setMode, next, prev, players,
goto(n, step) { const i = n - 1; players[i].reset(); hydrate(i); if (step === 'end') players[i].finishAll(); else players[i].goToStep(players[i].lead + (step || 0)); scrollToSlide(i, false); setActive(i, false); },
finishAll() { players.forEach((p, i) => { hydrate(i); p.reset(); p.finishAll(); }); },
timeline: (n) => players[n - 1].timeline(),
planState, tickPresenter: renderClock,
};
})();