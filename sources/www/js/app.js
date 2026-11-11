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
  site: {}, // customisation from the admin panel
  siteName() { return this.site.name || 'Brain Games'; },
  async loadSite() {
    try { this.site = await (await fetch('api/site', {cache: 'no-store'})).json(); } catch { this.site = {}; }
    this.applySite();
  },
  applySite() {
    const s = this.site, root = document.documentElement.style;
    if (s.accent) { root.setProperty('--accent', s.accent); root.setProperty('--accent-2', s.accent2 || s.accent); }
    const logo = document.querySelector('.logo');
    if (logo && s.name) logo.replaceChildren(h('span', {class: 'logo-mark'}, s.logo || '🧠'), s.name);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta && s.accent) meta.setAttribute('content', s.accent);
    const old = document.getElementById('site-banner');
    if (old) old.remove();
    const b = s.banner || {}, key = 'banner:' + b.text;
    if (b.on && b.text && !this.store.get(key)) {
      document.querySelector('header').after(h('div', {id: 'site-banner', class: 'site-banner ' + (b.style || 'info'), role: 'status'},
        h('span', {}, b.text), b.link ? h('a', {href: b.link}, b.linkText || 'Learn more') : null,
        h('button', {class: 'banner-x', 'aria-label': 'Dismiss', onclick: () => { this.store.set(key, 1); document.getElementById('site-banner').remove(); }}, '✕')));
    }
  },
  user: null, // signed-in account (profile with stats) or null
  async account(path, body) {
    const r = await fetch('api/account/' + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {cache: 'no-store'});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  },
  async loadUser() {
    try { this.user = (await this.account('me')).user; } catch { this.user = null; }
    this.updateUser();
  },
  updateUser() {
    const el = document.getElementById('user');
    if (el) el.replaceChildren(this.user ? h('a', {href: '#/profile', class: 'chip user-chip'}, h('span', {class: 'avatar sm', style: `--hue:${this.hue(this.user.name)}`}, this.user.name[0].toUpperCase()), this.user.name)
      : h('button', {class: 'chip', onclick: () => this.signIn()}, 'Sign in'));
  },
  hue(name) { return [...name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 360, 7); },
  signIn(mode = 'login') {
    const reg = mode === 'register', err = h('p', {class: 'err'});
    const name = h('input', {placeholder: 'Username', autocomplete: 'username', maxlength: 20, autocapitalize: 'off', 'aria-label': 'Username'});
    const pw = h('input', {type: 'password', placeholder: reg ? 'Password (6+ characters)' : 'Password', autocomplete: reg ? 'new-password' : 'current-password', 'aria-label': 'Password'});
    let close;
    const go = async e => {
      e.preventDefault();
      try {
        this.user = (await this.account(mode, {name: name.value, password: pw.value})).user;
        close();
        this.toast(reg ? `Welcome, ${this.user.name}! Your stats are saved from now on.` : `Welcome back, ${this.user.name}!`, 2600);
        this.route();
      } catch (x) { err.textContent = x.message; }
    };
    close = this.modal(reg ? 'Create account' : 'Sign in', h('form', {class: 'auth-form', onsubmit: go},
      h('p', {}, reg ? 'Pick a username. It shows on the global leaderboard.' : 'Sign in to save your stats and climb the leaderboard.'), name, pw, err,
      h('button', {class: 'primary'}, reg ? 'Create account' : 'Sign in'),
      (reg || this.site.signups !== false) && h('button', {type: 'button', class: 'linkish', onclick: () => { close(); this.signIn(reg ? 'login' : 'register'); }},
        reg ? 'Already have an account? Sign in' : 'New here? Create an account')));
    name.focus();
  },
  changeCredentials(forced) {
    const err = h('p', {class: 'err'});
    const cur = h('input', {type: 'password', autocomplete: 'current-password'});
    const name = h('input', {autocomplete: 'username', autocapitalize: 'off', maxlength: 20});
    const pw = h('input', {type: 'password', placeholder: '6+ characters', autocomplete: 'new-password'}), pw2 = h('input', {type: 'password', autocomplete: 'new-password'});
    name.value = this.user.name;
    let close;
    const go = async e => {
      e.preventDefault();
      if (pw.value !== pw2.value) { err.textContent = "The new passwords don't match"; return; }
      try {
        this.user = (await this.account('credentials', {current: cur.value, name: name.value, password: pw.value})).user;
        close();
        this.toast('Sign-in details updated ✓');
        this.route();
      } catch (x) { err.textContent = x.message; }
    };
    close = this.modal(forced ? '🔐 Change the default sign-in' : 'Change username or password', h('form', {class: 'auth-form', onsubmit: go},
      forced ? h('p', {}, 'This admin account still uses the default username and password, so anyone could sign in with them. Choose new ones now.') : null,
      h('label', {}, 'Current password', cur), h('label', {}, 'Username', name), h('label', {}, 'New password', pw), h('label', {}, 'Confirm new password', pw2),
      err, h('button', {class: 'primary'}, 'Save')));
    cur.focus();
  },
  record(body) {
    if (this.user) this.account('record', body).then(r => { this.user = r.user; }).catch(() => {});
  },
  // An anytime game finished. Repeat reports within a few seconds (screen redraws) are ignored.
  played(id, {won = true, best, lower, label} = {}) {
    const now = Date.now();
    if (now - (this.lastPlayed[id] || 0) < 4000) return;
    this.lastPlayed[id] = now;
    this.record({kind: 'play', game: id, won, best, lower, label});
  },
  lastPlayed: {},
  done(id, date, info) {
    const first = this.store.get('done:' + id) !== date;
    if (first) this.record({kind: 'daily', game: id, date, won: !info || info.won !== false});
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
    document.title = this.siteName();
    const daily = this.games.filter(g => g.daily), done = daily.filter(g => this.isDone(g.id)).length, streak = this.streak(), hr = new Date().getHours();
    const left = daily.length - done;
    app.append(h('section', {class: 'hero'},
      h('div', {}, h('p', {class: 'eyebrow'}, new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})),
        h('h1', {}, hr < 12 ? 'Good morning!' : hr < 18 ? 'Good afternoon!' : 'Good evening!'),
        this.site.tagline ? h('p', {class: 'lead tagline'}, this.site.tagline) : null,
        h('p', {class: 'lead'}, left ? `${left} daily puzzle${left === 1 ? '' : 's'} waiting for you.` : 'You finished every daily puzzle. Legendary! 🏆')),
      h('div', {class: 'hero-stats'}, h('div', {class: 'stat'}, h('b', {}, '🔥 ' + streak), h('small', {}, 'day streak')),
        h('div', {class: 'stat'}, h('b', {}, `${done}/${daily.length}`), h('small', {}, 'solved today'))),
      h('div', {class: 'hero-actions'}, this.site.leaderboard !== false ? h('a', {class: 'btn hero-btn', href: '#/leaderboard'}, '🏆 Leaderboard') : null,
        this.user ? h('a', {class: 'btn hero-btn', href: '#/profile'}, `👤 ${this.user.name} · ${this.user.points.toLocaleString()} pts`)
          : h('button', {class: 'btn hero-btn', onclick: () => this.signIn('register')}, '👤 Create an account to save stats')),
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
      h('p', {class: 'footer'}, this.site.footer || `${this.games.length} games · new daily puzzles every midnight`));
  },
  route() {
    this.subs.splice(0).forEach(f => f());
    this.updateStreak();
    this.updateUser();
    if (this.user && this.user.mustChange) this.later(() => this.changeCredentials(true), 50);
    const app = document.getElementById('app');
    app.replaceChildren();
    scrollTo(0, 0);
    const [id, arg] = location.hash.slice(2).split('/'), g = this.games.find(x => x.id === id);
    if (this.pages[id]) return this.pages[id].call(this, app);
    if (!g) return this.home(app);
    document.title = g.name + ' · ' + this.siteName();
    const body = h('div', {class: 'game g-' + g.id});
    const help = () => this.modal('How to play', h('p', {class: 'how'}, g.how || g.desc));
    app.append(h('div', {class: 'game-top', style: `--hue:${g.hue}`}, h('a', {href: '#/', class: 'icon-btn', 'aria-label': 'All games'}, '←'),
      h('span', {class: 'card-icon'}, g.icon), h('div', {class: 'game-title'}, h('h1', {}, g.name), h('p', {}, g.desc)),
      h('button', {class: 'icon-btn', 'aria-label': 'How to play', onclick: help}, '?')), h('section', {class: 'stage'}, body));
    if (g.how && !this.store.get('seen:' + g.id)) { this.store.set('seen:' + g.id, 1); help(); }
    g.play(body, arg);
  },
  pageTop(icon, title, sub, hue) {
    return h('div', {class: 'game-top', style: `--hue:${hue}`}, h('a', {href: '#/', class: 'icon-btn', 'aria-label': 'All games'}, '←'),
      h('span', {class: 'card-icon'}, icon), h('div', {class: 'game-title'}, h('h1', {}, title), h('p', {}, sub)));
  },
  pages: {
    async leaderboard(app) {
      document.title = 'Leaderboard · ' + this.siteName();
      if (this.site.leaderboard === false) {
        return app.append(this.pageTop('🏆', 'Leaderboard', 'Turned off', 45), h('section', {class: 'stage'}, h('p', {class: 'muted'}, 'The leaderboard is turned off on this site.')));
      }
      const box = h('section', {class: 'stage'}, h('p', {class: 'muted'}, 'Loading…'));
      app.append(this.pageTop('🏆', 'Leaderboard', 'Top 100 players with accounts', 45), box);
      try {
        const r = await fetch('api/leaderboard', {cache: 'no-store'}).then(x => x.json());
        if (!box.isConnected) return;
        const me = this.user && this.user.name;
        box.replaceChildren(
          !this.user ? h('div', {class: 'lb-cta'}, h('span', {}, 'Create an account to get on the board.'), h('button', {class: 'primary', onclick: () => this.signIn('register')}, 'Create account'))
            : h('div', {class: 'lb-me'}, r.me && r.me.rank ? `You're #${r.me.rank} of ${r.players} with ${r.me.points.toLocaleString()} points` : 'Finish a game to get on the board!'),
          r.top.length ? h('div', {class: 'lb'}, h('div', {class: 'lb-row lb-head'}, h('span', {}, '#'), h('span', {}, 'Player'), h('span', {title: 'Day streak'}, '🔥'), h('span', {}, 'Points')),
            r.top.map(p => h('div', {class: 'lb-row' + (p.name === me ? ' me' : '')}, h('span', {class: 'rank'}, ['🥇', '🥈', '🥉'][p.rank - 1] || p.rank),
              h('span', {class: 'lb-name'}, h('span', {class: 'avatar sm', style: `--hue:${this.hue(p.name)}`}, p.name[0].toUpperCase()), h('span', {}, p.name)),
              h('span', {class: 'muted'}, p.streak), h('b', {}, p.points.toLocaleString()))))
            : h('p', {class: 'muted'}, 'Nobody is on the board yet. Be the first!'),
          (P => h('p', {class: 'muted small'}, `Points: ${P.daily} per daily puzzle solved (${P.daily_try} for trying), ${P.win} per win in other games (up to ${P.cap_play} a day), and ${P.mp_win} per multiplayer win or ${P.mp_play} per game played (up to ${P.cap_mp} a day).`))(
            this.site.points || {daily: 100, daily_try: 25, win: 10, cap_play: 200, mp_win: 30, mp_play: 10, cap_mp: 300}));
      } catch { box.replaceChildren(h('p', {class: 'err'}, 'Could not load the leaderboard.')); }
    },
    async profile(app) {
      document.title = 'Your stats · ' + this.siteName();
      await this.loadUser();
      const u = this.user, games = Object.fromEntries(this.games.map(g => [g.id, g.name]));
      if (!u) {
        return app.append(this.pageTop('👤', 'Your stats', 'Sign in to save them', 260), h('section', {class: 'stage mt-box'},
          h('p', {}, 'Accounts keep your stats and streaks, and put you on the global leaderboard.'),
          h('div', {class: 'row-btns'}, h('button', {class: 'primary', onclick: () => this.signIn('register')}, 'Create account'), h('button', {onclick: () => this.signIn()}, 'Sign in'))));
      }
      const stat = (v, l) => h('div', {class: 'stat-box'}, h('b', {}, v), h('small', {}, l));
      const bests = Object.entries(u.best);
      app.append(this.pageTop('👤', u.name, `${{super: 'Super admin · ', admin: 'Full admin · ', writer: 'Game writer · '}[u.role] || ''}Joined ${new Date(u.joined + 'T12:00').toLocaleDateString(undefined, {month: 'long', year: 'numeric'})}`, this.hue(u.name)),
        h('section', {class: 'stage'}, h('div', {class: 'game'},
          h('div', {class: 'stat-grid'}, stat(u.points.toLocaleString(), 'points'), stat(u.rank ? '#' + u.rank : '—', 'global rank'), stat('🔥 ' + u.streak, 'day streak'),
            stat(u.bestStreak, 'best streak'), stat(u.dailySolved, 'dailies solved'), stat(u.dailyPlayed, 'dailies played'), stat(u.wins, 'wins'), stat(u.played, 'games played'),
            stat(u.mpWins, 'multiplayer wins'), stat(u.mpPlayed, 'multiplayer games')),
          bests.length ? [h('h3', {}, 'Personal bests'), h('div', {class: 'mp-list'}, bests.map(([k, v]) => {
            const [id, label] = k.split(':');
            return h('div', {class: 'mp-row'}, h('b', {}, (games[id] || id) + (label ? ` (${label})` : '')), h('span', {}, String(v)));
          }))] : null,
          h('div', {class: 'row-btns'}, h('a', {class: 'btn primary', href: '#/leaderboard'}, '🏆 Leaderboard'),
            h('button', {onclick: () => this.changeCredentials(false)}, '🔑 Change username or password'),
            u.role ? h('a', {class: 'btn', href: 'admin.html'}, '🛠️ Admin panel') : null,
            h('button', {onclick: async () => { await this.account('logout', {}).catch(() => {}); this.user = null; this.updateUser(); location.hash = '#/'; }}, 'Sign out')))));
    },
  },
  start() {
    addEventListener('hashchange', () => this.route());
    Promise.all([this.loadSite(), this.loadUser()]).finally(() => {
      const hidden = this.site.hidden || [];
      this.games = this.games.filter(g => !hidden.includes(g.id));
      this.route();
    });
  },
};
