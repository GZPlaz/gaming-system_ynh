'use strict';
const A = document.getElementById('admin');
const api = async (method, url, body) => {
  const r = await fetch('api/admin/' + url, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), {status: r.status});
  return j;
};
const list = s => s.split(',').map(x => x.trim()).filter(Boolean);
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// One entry per daily game: form fields, and conversions between form values and stored puzzle data.
const FORMS = {
  wordle: {
    name: 'Wordle', fields: [['word', 'Secret word (4–8 letters)']],
    to: v => ({word: v.word}), from: d => d, sum: d => d.word,
  },
  connections: {
    name: 'Connections',
    fields: ['🟨 easiest', '🟩', '🟦', '🟪 hardest'].flatMap((c, i) => [[`n${i}`, `Group ${i + 1} ${c}: category name`], [`w${i}`, 'Its 4 words, comma separated']]),
    to: v => ({groups: [0, 1, 2, 3].map(i => ({name: v['n' + i], words: list(v['w' + i])}))}),
    from: d => Object.fromEntries(d.groups.flatMap((g, i) => [['n' + i, g.name], ['w' + i, g.words.join(', ')]])),
    sum: d => d.groups.map(g => g.name).join(' · '),
  },
  scramble: {
    name: 'Word Scramble', fields: [['lines', 'One word per line, optional hint after | (e.g. PLANET | Earth is one)', 'textarea']],
    to: v => ({words: v.lines.split('\n').filter(l => l.trim()).map(l => { const [w, ...hint] = l.split('|'); return {word: w.trim(), hint: hint.join('|').trim()}; })}),
    from: d => ({lines: d.words.map(w => w.word + (w.hint ? ' | ' + w.hint : '')).join('\n')}),
    sum: d => d.words.map(w => w.word).join(', '),
  },
  riddle: {
    name: 'Daily Riddle', fields: [['question', 'Riddle', 'textarea'], ['answers', 'Accepted answers, comma separated'], ['hint', 'Hint (optional)']],
    to: v => ({question: v.question, answers: list(v.answers), hint: v.hint}),
    from: d => ({...d, answers: d.answers.join(', ')}),
    sum: d => d.question.slice(0, 70),
  },
  trivia: {
    name: 'Daily Trivia', fields: [['lines', 'One question per line: Question | *Right answer | Wrong | Wrong (the * marks the right one)', 'textarea']],
    to: v => ({questions: v.lines.split('\n').filter(l => l.trim()).map(l => {
      const [q, ...o] = l.split('|').map(x => x.trim()), opts = o.filter(Boolean);
      return {q, options: opts.map(x => x.replace(/^\*\s*/, '')), answer: opts.findIndex(x => x.startsWith('*'))};
    })}),
    from: d => ({lines: d.questions.map(q => [q.q, ...q.options.map((o, i) => (i === q.answer ? '*' : '') + o)].join(' | ')).join('\n')}),
    sum: d => `${d.questions.length} questions: ${d.questions[0].q.slice(0, 50)}`,
  },
  hangman: {
    name: 'Hangman', fields: [['phrase', 'Phrase (letters, spaces, basic punctuation)'], ['category', 'Category (optional)']],
    to: v => ({phrase: v.phrase, category: v.category}), from: d => d, sum: d => (d.category ? d.category + ': ' : '') + d.phrase,
  },
  wordsearch: {
    name: 'Word Search', fields: [['theme', 'Theme (optional)'], ['words', '4–12 words, comma separated (3–10 letters each)']],
    to: v => ({theme: v.theme, words: list(v.words)}), from: d => ({...d, words: d.words.join(', ')}),
    sum: d => (d.theme ? d.theme + ': ' : '') + d.words.join(', '),
  },
  spellingbee: {
    name: 'Spelling Bee',
    fields: [['letters', '7 different letters, centre letter first (e.g. TRAINEG)'], ['words', 'Every accepted word (4+ letters, must contain the centre letter), separated by spaces, commas or new lines', 'textarea']],
    to: v => ({letters: v.letters, words: v.words.split(/[\s,]+/).filter(Boolean)}),
    from: d => ({letters: d.letters, words: d.words.join(' ')}),
    sum: d => `${d.letters[0]} + ${d.letters.slice(1)} (${d.words.length} words)`,
  },
  cryptogram: {
    name: 'Cryptogram', fields: [['quote', 'Quote (at least 10 letters)', 'textarea'], ['author', 'Author (optional)']],
    to: v => ({quote: v.quote, author: v.author}), from: d => d, sum: d => d.quote.slice(0, 60),
  },
  emoji: {
    name: 'Emoji Decoder', fields: [['lines', 'One per line: emojis | answer (alternatives separated by /) | hint', 'textarea']],
    to: v => ({items: v.lines.split('\n').filter(l => l.trim()).map(l => {
      const [emoji, a = '', hint = ''] = l.split('|').map(x => x.trim());
      return {emoji, answers: a.split('/').map(x => x.trim()).filter(Boolean), hint};
    })}),
    from: d => ({lines: d.items.map(it => [it.emoji, it.answers.join(' / '), it.hint].join(' | ')).join('\n')}),
    sum: d => d.items.map(it => it.emoji).join('   '),
  },
};

let db = {}, today = '', game = 'wordle';
const nextFree = () => { let d = today; while (db[game]?.[d]) d = addDays(d, 1); return d; };

let me = null; // signed-in staff account
const LEVEL = {writer: 1, admin: 2, super: 3}, ROLE_NAMES = {super: 'Super admin', admin: 'Full admin', writer: 'Game writer'};
const can = need => (LEVEL[me && me.role] || 0) >= LEVEL[need];
const acct = async (path, body) => {
  const r = await fetch('api/account/' + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const tabs = active => h('div', {class: 'row-btns tabs'},
  Object.keys(FORMS).map(g => h('button', {class: active === g ? 'primary' : '', onclick: () => { game = g; render(); }}, FORMS[g].name)),
  can('admin') ? h('button', {class: active === 'players' ? 'primary' : '', onclick: players}, '👤 Players') : null,
  can('super') ? h('button', {class: active === 'bans' ? 'primary' : '', onclick: bans}, '🚫 IP bans') : null,
  can('admin') ? h('button', {class: active === 'site' ? 'primary' : '', onclick: siteTab}, '🎨 Site') : null,
  h('span', {class: 'chip'}, `${me.name} · ${ROLE_NAMES[me.role]}`),
  h('button', {onclick: async () => { await acct('logout', {}).catch(() => {}); me = null; login(); }}, 'Sign out'));

function login(err) {
  const name = h('input', {placeholder: 'Username', autocomplete: 'username', autocapitalize: 'off', 'aria-label': 'Username'});
  const pw = h('input', {type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password'});
  const go = async e => {
    e.preventDefault();
    try { await acct('login', {name: name.value, password: pw.value}); load(); } catch (x) { login(x.message); }
  };
  A.replaceChildren(h('form', {class: 'panel', onsubmit: go}, h('h2', {}, 'Admin sign-in'),
    h('p', {class: 'muted'}, 'Sign in with an account that has admin or game-writer access.'), err && h('p', {class: 'err'}, err), name, pw,
    h('button', {class: 'primary'}, 'Sign in')));
  name.focus();
}

function changeCredentials() {
  const cur = h('input', {type: 'password', autocomplete: 'current-password'});
  const name = h('input', {value: me.name, autocomplete: 'username', autocapitalize: 'off', maxlength: 20});
  const pw = h('input', {type: 'password', placeholder: '6+ characters', autocomplete: 'new-password'}), pw2 = h('input', {type: 'password', autocomplete: 'new-password'});
  const err = h('p', {class: 'err'});
  const go = async e => {
    e.preventDefault();
    if (pw.value !== pw2.value) { err.textContent = "The new passwords don't match"; return; }
    try { await acct('credentials', {current: cur.value, name: name.value, password: pw.value}); BG.toast('Saved ✓'); load(); } catch (x) { err.textContent = x.message; }
  };
  A.replaceChildren(h('form', {class: 'panel', onsubmit: go}, h('h2', {}, '🔐 Change the default sign-in'),
    h('p', {}, 'This account still uses the default username and password, so anyone could sign in with them. Choose new ones before using the admin panel.'),
    h('label', {}, 'Current password', cur), h('label', {}, 'New username (optional)', name), h('label', {}, 'New password', pw), h('label', {}, 'Confirm new password', pw2),
    err, h('button', {class: 'primary'}, 'Save and continue')));
  cur.focus();
}

async function load() {
  try { BG.loadSite(); } catch {}
  try { me = (await api('GET', 'whoami')).user; } catch { me = null; }
  if (!me) return login();
  if (me.mustChange) return changeCredentials();
  if (!me.role) return login(`${me.name} doesn't have admin access. Sign in with a staff account.`);
  try { ({puzzles: db, today} = await api('GET', 'puzzles')); } catch (x) { return login(x.message); }
  render();
}

function render(date = nextFree()) {
  const F = FORMS[game], pz = (db[game] ||= {}), data = pz[date], vals = data ? F.from(data) : {};
  const dateIn = h('input', {type: 'date', value: date, onchange: () => render(dateIn.value)});
  const inputs = Object.fromEntries(F.fields.map(([k, , type]) => [k, type === 'textarea' ? h('textarea', {rows: 5}) : h('input', {autocomplete: 'off'})]));
  for (const [k, i] of Object.entries(inputs)) i.value = vals[k] || '';
  const save = async e => {
    e.preventDefault();
    try {
      const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      pz[date] = (await api('PUT', `puzzles/${game}/${date}`, F.to(v))).data;
      BG.toast(`Saved ${date} ✓`);
      render();
    } catch (x) { BG.toast('⚠ ' + x.message, 4000); }
  };
  const del = async () => {
    if (!confirm(`Delete the ${F.name} puzzle for ${date}?`)) return;
    await api('DELETE', `puzzles/${game}/${date}`);
    delete pz[date];
    render(date);
  };
  const bulk = h('textarea', {rows: 6, placeholder: '{"2026-11-01": {...}, "2026-11-02": {...}}'});
  const importBulk = async () => {
    let n = 0;
    try {
      for (const [d, p] of Object.entries(JSON.parse(bulk.value))) { pz[d] = (await api('PUT', `puzzles/${game}/${d}`, p)).data; n++; }
      BG.toast(`Imported ${n} puzzles ✓`);
    } catch (x) { BG.toast(`⚠ Stopped after ${n}: ${x.message}`, 5000); }
    render();
  };
  const dates = Object.keys(pz).sort().reverse();
  const ahead = dates.filter(d => d >= today).length;
  A.replaceChildren(
    tabs(game),
    h('form', {class: 'panel', onsubmit: save},
      h('h2', {}, `${F.name} for `, dateIn, h('span', {class: 'sub'}, data ? ' editing' : ' new')),
      F.fields.map(([k, label]) => h('label', {}, label, inputs[k])),
      h('div', {class: 'row-btns'}, h('button', {class: 'primary'}, 'Save'), data && h('button', {type: 'button', onclick: del}, 'Delete'))),
    h('h3', {}, `Scheduled (${ahead} from today on)`),
    !pz[today] && h('p', {class: 'err'}, 'Nothing scheduled for today: players get a replay from the archive.'),
    h('table', {class: 'sched'}, dates.map(d => h('tr', {class: d === today ? 'today' : d > today ? 'future' : ''},
      h('td', {}, h('a', {href: '#', onclick: e => { e.preventDefault(); render(d); }}, d)), h('td', {}, F.sum(pz[d]))))),
    h('details', {class: 'panel'}, h('summary', {}, 'Bulk import (JSON, date → puzzle)'),
      h('p', {class: 'sub'}, 'Example: ' + JSON.stringify({[addDays(today, 1)]: Object.values(pz)[0] || {}})), bulk,
      h('button', {onclick: importBulk}, 'Import')));
}

async function players() {
  let accounts;
  try { ({accounts} = await api('GET', 'accounts')); } catch (x) { return BG.toast('⚠ ' + x.message, 4000); }
  const run = async (fn, msg) => { try { await fn(); if (msg) BG.toast(msg); players(); } catch (x) { BG.toast('⚠ ' + x.message, 4000); } };
  const sup = can('super');
  const row = a => {
    const enc = encodeURIComponent(a.name), isSuper = a.role === 'super';
    let roleCell = ROLE_NAMES[a.role] || 'Player';
    if (sup && !isSuper) {
      roleCell = h('select', {'aria-label': `Role for ${a.name}`}, [['', 'Player'], ['writer', 'Game writer'], ['admin', 'Full admin']]
        .map(([v, l]) => h('option', {value: v, selected: (a.role || '') === v}, l)));
      roleCell.addEventListener('change', () => run(() => api('POST', `accounts/${enc}/role`, {role: roleCell.value}), 'Role updated'));
    }
    return h('tr', {class: a.banned ? 'banned' : ''},
      h('td', {}, h('b', {}, a.name), a.banned ? h('span', {class: 'pill bad'}, ' banned') : null, h('br'),
        h('small', {class: 'muted'}, `${a.points} pts · joined ${a.joined}` + (a.ips && a.ips.length ? ` · IP ${a.ips.join(', ')}` : ''))),
      h('td', {}, roleCell),
      h('td', {class: 'actions'}, isSuper ? (sup ? h('button', {onclick: () => editStats(a)}, '📊 Stats') : null) : [
        sup ? h('button', {onclick: () => run(() => api('POST', `accounts/${enc}/ban`, {banned: !a.banned}), a.banned ? 'Account unbanned' : 'Account banned')}, a.banned ? 'Unban' : 'Ban') : null,
        sup ? h('button', {onclick: () => confirm(`Ban every IP address ${a.name} has used? Anyone else on those networks will be blocked too.`)
          && run(async () => { const r = await api('POST', `accounts/${enc}/ipban`); BG.toast('IP banned: ' + r.ips.join(', '), 4000); })}, 'IP ban') : null,
        sup ? h('button', {onclick: () => editStats(a)}, '📊 Stats') : null,
        sup || !a.role ? h('button', {onclick: () => confirm(`Delete the account "${a.name}" and all its stats? This can't be undone.`)
          && run(() => api('DELETE', 'accounts/' + enc), 'Deleted')}, 'Delete') : null]));
  };
  A.replaceChildren(tabs('players'), h('div', {class: 'panel'}, h('h2', {}, `Player accounts (${accounts.length})`),
    h('p', {class: 'muted'}, sup ? 'Game writers can edit daily puzzles. Full admins can also manage player accounts. Only you can change roles and ban.'
      : 'Delete player accounts to remove them (and their stats) from the leaderboard.'),
    h('div', {class: 'table-wrap'}, h('table', {class: 'sched players'}, accounts.map(row)))));
}

function editStats(a) {
  const FIELDS = [['points', 'Points'], ['streak', 'Current day streak'], ['dailySolved', 'Dailies solved'], ['dailyPlayed', 'Dailies played'],
    ['wins', 'Wins'], ['played', 'Games played'], ['mpWins', 'Multiplayer wins'], ['mpPlayed', 'Multiplayer games']];
  const inputs = Object.fromEntries(FIELDS.map(([k]) => { const i = h('input', {type: 'number', min: 0, inputmode: 'numeric'}); i.value = a[k] ?? 0; return [k, i]; }));
  const send = async body => {
    try { await api('POST', `accounts/${encodeURIComponent(a.name)}/stats`, body); close(); BG.toast('Stats saved ✓'); players(); } catch (x) { BG.toast('⚠ ' + x.message, 4000); }
  };
  const close = BG.modal(`📊 ${a.name}'s stats`, h('form', {class: 'auth-form stats-form', onsubmit: e => {
    e.preventDefault();
    send(Object.fromEntries(FIELDS.filter(([k]) => inputs[k].value !== String(a[k] ?? 0)).map(([k]) => [k, +inputs[k].value])));
  }}, h('div', {class: 'stats-grid'}, FIELDS.map(([k, l]) => h('label', {}, l, inputs[k]))),
  h('button', {class: 'primary'}, 'Save changes'),
  h('button', {type: 'button', onclick: () => confirm(`Reset ALL of ${a.name}'s stats to zero, including streaks and personal bests?`) && send({reset: true})}, '♻️ Reset all stats')));
}

async function siteTab() {
  let s;
  try { s = await (await fetch('api/site', {cache: 'no-store'})).json(); } catch { return BG.toast('⚠ Could not load the site settings', 4000); }
  const field = (val, attrs = {}) => { const i = h(attrs.rows ? 'textarea' : 'input', attrs); i.value = val ?? ''; return i; };
  const check = val => { const i = h('input', {type: 'checkbox'}); i.checked = !!val; return i; };
  const f = {
    name: field(s.name, {maxlength: 40}), logo: field(s.logo, {maxlength: 8}), tagline: field(s.tagline, {maxlength: 120, placeholder: 'Shown under the greeting on the home page'}),
    footer: field(s.footer, {maxlength: 160, placeholder: 'Leave empty for the default'}), accent: field(s.accent, {type: 'color'}), accent2: field(s.accent2, {type: 'color'}),
    bOn: check(s.banner.on), bText: field(s.banner.text, {rows: 2, maxlength: 280, placeholder: 'e.g. 🎉 New games this week!'}),
    bLink: field(s.banner.link, {placeholder: 'https://… or #/leaderboard (optional)'}), bLinkText: field(s.banner.linkText, {maxlength: 40, placeholder: 'Link text (optional)'}),
    signups: check(s.signups), leaderboard: check(s.leaderboard),
  };
  const style = h('select', {}, [['info', 'Info (purple)'], ['success', 'Success (green)'], ['warning', 'Warning (yellow)'], ['danger', 'Alert (red)']]
    .map(([v, l]) => h('option', {value: v, selected: s.banner.style === v}, l)));
  const PTS = [['daily', 'Daily puzzle solved'], ['daily_try', 'Daily puzzle tried'], ['win', 'Win (anytime games)'], ['play', 'Game played (anytime)'],
    ['cap_play', 'Daily cap: anytime games'], ['mp_win', 'Multiplayer win'], ['mp_play', 'Multiplayer game played'], ['cap_mp', 'Daily cap: multiplayer']];
  const pts = Object.fromEntries(PTS.map(([k]) => [k, field(s.points[k], {type: 'number', min: 0, max: 100000})]));
  const hidden = new Set(s.hidden);
  const gameChips = h('div', {class: 'seg multi'});
  const drawChips = () => gameChips.replaceChildren(BG.games.map(g => h('button', {type: 'button', class: hidden.has(g.id) ? '' : 'on', 'aria-pressed': !hidden.has(g.id),
    onclick: () => { if (hidden.has(g.id)) hidden.delete(g.id); else hidden.add(g.id); drawChips(); }}, `${g.icon} ${g.name}`)));
  drawChips();
  const save = async e => {
    e.preventDefault();
    const body = {name: f.name.value, logo: f.logo.value, tagline: f.tagline.value, footer: f.footer.value, accent: f.accent.value, accent2: f.accent2.value,
      banner: {on: f.bOn.checked, text: f.bText.value, style: style.value, link: f.bLink.value, linkText: f.bLinkText.value},
      hidden: [...hidden], signups: f.signups.checked, leaderboard: f.leaderboard.checked, points: Object.fromEntries(PTS.map(([k]) => [k, +pts[k].value]))};
    try { await api('PUT', 'site', body); BG.toast('Site settings saved ✓'); await BG.loadSite(); siteTab(); } catch (x) { BG.toast('⚠ ' + x.message, 4000); }
  };
  const sec = (title, ...kids) => h('div', {class: 'panel'}, h('h2', {}, title), kids);
  A.replaceChildren(tabs('site'), h('form', {class: 'site-form', onsubmit: save},
    sec('🏷️ Branding', h('label', {}, 'Site name', f.name), h('label', {}, 'Logo emoji', f.logo), h('label', {}, 'Tagline', f.tagline), h('label', {}, 'Footer text', f.footer),
      h('div', {class: 'color-row'}, h('label', {}, 'Main colour', f.accent), h('label', {}, 'Second colour', f.accent2),
        h('button', {type: 'button', onclick: () => { f.accent.value = '#6c5cf6'; f.accent2.value = '#a46cfa'; }}, 'Reset colours'))),
    sec('📣 Banner', h('label', {class: 'check'}, f.bOn, 'Show a banner across the top of the site'), h('label', {}, 'Message', f.bText), h('label', {}, 'Style', style),
      h('label', {}, 'Link', f.bLink), f.bLinkText, h('p', {class: 'muted'}, 'Players can dismiss the banner; changing the message shows it to everyone again.')),
    sec('🎮 Games', h('p', {class: 'muted'}, 'Highlighted games are shown. Tap a game to hide it from the site.'), gameChips),
    sec('👤 Players', h('label', {class: 'check'}, f.signups, 'Allow new sign-ups'), h('label', {class: 'check'}, f.leaderboard, 'Show the global leaderboard')),
    sec('🏆 Points', h('p', {class: 'muted'}, 'How many leaderboard points each result is worth. Changes apply from now on; existing points are kept.'),
      h('div', {class: 'stats-grid'}, PTS.map(([k, l]) => h('label', {}, l, pts[k])))),
    h('div', {class: 'row-btns sticky-save'}, h('button', {class: 'primary'}, '💾 Save site settings'))));
}

async function bans() {
  let r;
  try { r = await api('GET', 'bans'); } catch (x) { return BG.toast('⚠ ' + x.message, 4000); }
  const ip = h('input', {placeholder: 'IP address, e.g. 203.0.113.7', 'aria-label': 'IP address'}), note = h('input', {placeholder: 'Note (optional)', 'aria-label': 'Note'});
  const add = async e => {
    e.preventDefault();
    try { await api('POST', 'bans', {ip: ip.value, note: note.value}); BG.toast('IP banned'); bans(); } catch (x) { BG.toast('⚠ ' + x.message, 4000); }
  };
  A.replaceChildren(tabs('bans'), h('form', {class: 'panel', onsubmit: add}, h('h2', {}, '🚫 Ban an IP address'),
    h('p', {class: 'muted'}, `Banned addresses can't open the site at all. Your own IP is ${r.yourIp}.`), ip, note, h('button', {class: 'primary'}, 'Ban IP')),
  h('div', {class: 'panel'}, h('h2', {}, `Banned IPs (${r.bans.length})`), r.bans.length ? h('table', {class: 'sched'}, r.bans.map(b => h('tr', {},
    h('td', {}, h('b', {}, b.ip)), h('td', {}, b.note || ''), h('td', {}, b.at),
    h('td', {}, h('button', {onclick: async () => { await api('DELETE', 'bans/' + encodeURIComponent(b.ip)); BG.toast('Unbanned'); bans(); }}, 'Unban')))))
    : h('p', {class: 'muted'}, 'No IP bans.')));
}

load();
