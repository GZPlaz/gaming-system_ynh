'use strict';
// Let append/replaceChildren take the same children as h(): nested arrays, with false/null skipped.
for (const m of ['append', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...kids) { return orig.apply(this, kids.flat(2).filter(k => k != null && k !== false)); };
}

// Tiny DOM helper: h('div', {class: 'x', onclick: fn}, child, ...)
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids);
  return e;
};

const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CATS = {
  Logic: ['sudoku', 'nonogram', 'minesweeper', 'lightsout', 'slide', 'hanoi', 'codebreaker', 'floodit'],
  Memory: ['memory', 'simon', 'numbermemory', 'visualmemory', 'chimp'],
  Numbers: ['2048', 'mathsprint', 'sequence'],
  Strategy: ['tictactoe', 'connect4', 'reversi'],
  Speed: ['schulte', 'stroop', 'oddone'],
};

const BG = {
  games: [],
  subs: [], // cleanup callbacks for timers/listeners/modals of the current page
  add(g) { g.hue = Math.round(this.games.length * 137.508) % 360; this.games.push(g); },
  store: {
    get(k, d) { try { const v = localStorage.getItem('bg:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('bg:' + k, JSON.stringify(v)); } catch {} },
  },
  today() { return fmt(new Date()); },
  async daily(id, el) {
    try {
      const r = await fetch('api/daily/' + id);
      if (!r.ok) throw 0;
      const p = await r.json();
      p.data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p.data), c => c.charCodeAt(0))));
      if (!el.isConnected) return null;
      el.append(h('p', {class: 'sub'}, `Puzzle #${p.number} · ${new Date(p.date + 'T12:00').toLocaleDateString(undefined, {month: 'long', day: 'numeric'})}`
        + (p.rerun ? ' · replay' : '')));
      return p;
    } catch {
      el.append(h('div', {class: 'mt-box'}, h('div', {class: 'result-emoji'}, '🗓️'), h('h2', {}, 'No puzzle yet today'), h('p', {class: 'muted'}, 'Check back a little later!')));
      return null;
    }
  },
  isDone(id) { return this.store.get('done:' + id) === this.today(); },
  streak() {
    const days = new Set(this.store.get('days', [])), d = new Date();
    if (!days.has(fmt(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(fmt(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  },
  // Mark a daily puzzle finished; the first time today, show the results card.
  done(id, date, info) {
    const first = this.store.get('done:' + id) !== date;
    this.store.set('done:' + id, date);
    const days = this.store.get('days', []);
    if (!days.includes(date)) this.store.set('days', [...days, date].slice(-400));
    this.updateStreak();
    if (first && info) this.later(() => this.finish(info), info.delay ?? 700);
  },
  finish({won = true, title, text, share}) {
    if (won) this.confetti();
    const cd = h('b', {class: 'countdown'});
    const tick = () => {
      const now = new Date(), next = new Date(now); next.setHours(24, 0, 0, 0);
      const s = Math.max(0, Math.floor((next - now) / 1000));
      cd.textContent = [s / 3600, (s % 3600) / 60, s % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':');
    };
    tick(); this.every(tick, 1000);
    const daily = this.games.filter(g => g.daily), left = daily.filter(g => !this.isDone(g.id)).length;
    const close = this.modal(null,
      h('div', {class: 'result-emoji'}, won ? '🎉' : '🧠'), h('h2', {}, title || (won ? 'Solved!' : 'Nice try!')), text && h('p', {}, text),
      h('div', {class: 'stat-row'}, h('div', {class: 'stat-box'}, h('b', {}, '🔥 ' + this.streak()), h('small', {}, 'day streak')),
        h('div', {class: 'stat-box'}, h('b', {}, `${daily.length - left}/${daily.length}`), h('small', {}, 'dailies done'))),
      share && h('button', {class: 'primary', onclick: () => this.share(share)}, 'Share result'),
      h('p', {}, 'Next puzzle in ', cd),
      h('div', {class: 'row-btns'}, h('a', {class: 'btn', href: '#/'}, left ? `${left} more to play →` : 'All games'), h('button', {onclick: () => close()}, 'Close')));
  },
  modal(title, ...content) {
    const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 180); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const wrap = h('div', {class: 'modal-wrap', onclick: e => { if (e.target === wrap) close(); }},
      h('div', {class: 'modal', role: 'dialog', 'aria-modal': 'true'}, h('button', {class: 'icon-btn modal-x', 'aria-label': 'Close', onclick: close}, '✕'),
        title && h('h2', {}, title), content));
    document.addEventListener('keydown', esc);
    document.body.append(wrap);
    this.subs.push(() => { wrap.remove(); document.removeEventListener('keydown', esc); });
    return close;
  },
  confetti() {
    const box = h('div', {class: 'confetti', 'aria-hidden': 'true'});
    for (let i = 0; i < 70; i++) {
      box.append(h('i', {style: `left:${Math.random() * 100}%;background:hsl(${Math.random() * 360} 90% 60%);animation-delay:${Math.random() * 0.5}s;animation-duration:${1.8 + Math.random() * 1.6}s`}));
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 4200);
  },
  best(id, v, lower) {
    const b = this.store.get('best:' + id);
    if (b == null || (lower ? v < b : v > b)) { this.store.set('best:' + id, v); return v; }
    return b;
  },
  toast(text, ms = 1600) {
    let box = document.querySelector('.toasts');
    if (!box) document.body.append(box = h('div', {class: 'toasts', 'aria-live': 'polite'}));
    const t = h('div', {class: 'toast'}, text);
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
  },
  share(text) {
    text += '\n' + location.href.split('#')[0];
    if (navigator.share) return navigator.share({text}).catch(() => {});
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
    const f = e => { if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches('input,textarea') && !document.querySelector('.modal-wrap')) fn(e); };
    document.addEventListener('keydown', f);
    this.subs.push(() => document.removeEventListener('keydown', f));
  },
  updateStreak() {
    const el = document.getElementById('streak'), n = this.streak();
    if (el) { el.hidden = !n; el.textContent = `🔥 ${n}`; el.title = `${n} day streak`; }
  },
  card(g) {
    const done = g.daily && this.isDone(g.id);
    return h('a', {class: 'card', href: '#/' + g.id, style: `--hue:${g.hue}`}, h('span', {class: 'card-icon'}, g.icon),
      h('span', {class: 'card-body'}, h('b', {}, g.name), h('small', {}, g.desc)),
      g.daily && h('span', {class: 'pill' + (done ? ' done' : '')}, done ? '✓ Done' : 'Today'),
      g.mp && h('span', {class: 'pill'}, `${g.min}+ players`));
  },
  home(app) {
    document.title = 'Brain Games';
    const daily = this.games.filter(g => g.daily), done = daily.filter(g => this.isDone(g.id)).length, streak = this.streak(), hr = new Date().getHours();
    const left = daily.length - done;
    app.append(h('section', {class: 'hero'},
      h('div', {}, h('p', {class: 'eyebrow'}, new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})),
        h('h1', {}, hr < 12 ? 'Good morning!' : hr < 18 ? 'Good afternoon!' : 'Good evening!'),
        h('p', {class: 'lead'}, left ? `${left} daily puzzle${left === 1 ? '' : 's'} waiting for you.` : 'You finished every daily puzzle. Legendary! 🏆')),
      h('div', {class: 'hero-stats'}, h('div', {class: 'stat'}, h('b', {}, '🔥 ' + streak), h('small', {}, 'day streak')),
        h('div', {class: 'stat'}, h('b', {}, `${done}/${daily.length}`), h('small', {}, 'solved today'))),
      h('div', {class: 'progress', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': daily.length}, h('i', {style: `width:${(done / daily.length) * 100}%`}))));
    // unfinished dailies first
    app.append(h('div', {class: 'section-head'}, h('h2', {}, "Today's puzzles")),
      h('div', {class: 'grid'}, [...daily].sort((a, b) => this.isDone(a.id) - this.isDone(b.id)).map(g => this.card(g))));
    const mp = this.games.filter(g => g.mp);
    if (mp.length) {
      const codeIn = h('input', {class: 'code-input', placeholder: 'CODE', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Room code'});
      const join = async () => {
        try { const r = await MP.call('peek?code=' + encodeURIComponent(codeIn.value.trim())); location.hash = `#/${r.game}/${r.code}`; } catch (x) { this.toast(x.message, 2500); }
      };
      codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
      app.append(h('div', {class: 'section-head'}, h('h2', {}, 'Play with friends'), h('div', {class: 'join-row'}, codeIn, h('button', {class: 'primary', onclick: join}, 'Join room'))),
        h('div', {class: 'grid'}, mp.map(g => this.card(g))));
    }
    let cat = this.store.get('cat', 'All');
    if (!CATS[cat]) cat = 'All';
    const chips = h('div', {class: 'chips'}), grid = h('div', {class: 'grid'});
    const draw = () => {
      chips.replaceChildren(['All', ...Object.keys(CATS)].map(c => h('button', {class: 'chip-btn' + (c === cat ? ' on' : ''), onclick: () => { cat = c; this.store.set('cat', c); draw(); }}, c)));
      grid.replaceChildren(this.games.filter(g => !g.daily && !g.mp && (cat === 'All' || CATS[cat].includes(g.id))).map(g => this.card(g)));
    };
    draw();
    app.append(h('div', {class: 'section-head'}, h('h2', {}, 'Play anytime'), chips), grid,
      h('p', {class: 'footer'}, `${this.games.length} games · new daily puzzles every midnight`));
  },
  route() {
    this.subs.splice(0).forEach(f => f());
    this.updateStreak();
    const app = document.getElementById('app');
    app.replaceChildren();
    scrollTo(0, 0);
    const [id, arg] = location.hash.slice(2).split('/'), g = this.games.find(x => x.id === id);
    if (!g) return this.home(app);
    document.title = g.name + ' · Brain Games';
    const body = h('div', {class: 'game g-' + g.id});
    const help = () => this.modal('How to play', h('p', {class: 'how'}, g.how || g.desc));
    app.append(h('div', {class: 'game-top', style: `--hue:${g.hue}`}, h('a', {href: '#/', class: 'icon-btn', 'aria-label': 'All games'}, '←'),
      h('span', {class: 'card-icon'}, g.icon), h('div', {class: 'game-title'}, h('h1', {}, g.name), h('p', {}, g.desc)),
      h('button', {class: 'icon-btn', 'aria-label': 'How to play', onclick: help}, '?')), h('section', {class: 'stage'}, body));
    if (g.how && !this.store.get('seen:' + g.id)) { this.store.set('seen:' + g.id, 1); help(); }
    g.play(body, arg);
  },
  start() { addEventListener('hashchange', () => this.route()); this.route(); },
};
