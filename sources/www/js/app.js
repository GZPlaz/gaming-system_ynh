'use strict';
// Tiny DOM helper: h('div', {class: 'x', onclick: fn}, child, ...)
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(2).filter(k => k != null && k !== false && k !== ''));
  return e;
};

const BG = {
  games: [],
  subs: [], // cleanup callbacks for timers/listeners of the current game
  add(g) { this.games.push(g); },
  store: {
    get(k, d) { try { const v = localStorage.getItem('bg:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('bg:' + k, JSON.stringify(v)); } catch {} },
  },
  today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  async daily(id, el) {
    try {
      const r = await fetch('api/daily/' + id);
      if (!r.ok) throw 0;
      const p = await r.json();
      p.data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.data), c => c.charCodeAt(0))));
      if (!el.isConnected) return null;
      el.append(h('p', {class: 'sub'}, `#${p.number} · ${p.date}` + (p.rerun ? ' · replay (no new puzzle today)' : '')));
      return p;
    } catch {
      el.append(h('p', {class: 'msg'}, 'No puzzle available today. Check back later!'));
      return null;
    }
  },
  done(id, date) { this.store.set('done:' + id, date); },
  best(id, v, lower) {
    const b = this.store.get('best:' + id);
    if (b == null || (lower ? v < b : v > b)) { this.store.set('best:' + id, v); return v; }
    return b;
  },
  toast(text, ms = 1800) { const t = h('div', {class: 'toast'}, text); document.body.append(t); setTimeout(() => t.remove(), ms); },
  share(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => this.toast('Copied to clipboard'), () => prompt('Copy your result:', text));
  },
  rng(seed) { // deterministic PRNG (mulberry32) from a string
    let a = [...seed].reduce((s, c) => Math.imul(s ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },
  shuffle(a, rnd = Math.random) {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },
  later(fn, ms) { const id = setTimeout(fn, ms); this.subs.push(() => clearTimeout(id)); },
  every(fn, ms) { const id = setInterval(fn, ms); this.subs.push(() => clearInterval(id)); return () => clearInterval(id); },
  keys(fn) {
    const f = e => { if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches('input,textarea')) fn(e); };
    document.addEventListener('keydown', f);
    this.subs.push(() => document.removeEventListener('keydown', f));
  },
  home(app) {
    document.title = 'Brain Games';
    const today = this.today();
    const card = g => {
      const done = g.daily && this.store.get('done:' + g.id) === today;
      return h('a', {class: 'card', href: '#/' + g.id}, h('span', {class: 'icon'}, g.icon), h('b', {}, g.name), h('small', {}, g.desc),
        g.daily && h('span', {class: 'badge' + (done ? ' done' : '')}, done ? '✓ Done today' : 'Daily'));
    };
    app.append(h('h2', {}, 'Daily puzzles'), h('div', {class: 'grid'}, this.games.filter(g => g.daily).map(card)),
      h('h2', {}, 'Anytime games'), h('div', {class: 'grid'}, this.games.filter(g => !g.daily).map(card)));
  },
  route() {
    this.subs.splice(0).forEach(f => f());
    const app = document.getElementById('app');
    app.replaceChildren();
    scrollTo(0, 0);
    const g = this.games.find(x => x.id === location.hash.slice(2));
    if (!g) return this.home(app);
    document.title = g.name + ' · Brain Games';
    const body = h('div', {class: 'game ' + g.id});
    app.append(h('a', {href: '#/', class: 'back'}, '← All games'), h('h1', {}, g.icon + ' ' + g.name), h('p', {class: 'how'}, g.how || g.desc), body);
    g.play(body);
  },
  start() { addEventListener('hashchange', () => this.route()); this.route(); },
};
