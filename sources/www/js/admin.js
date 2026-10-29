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

function login(err) {
  const pw = h('input', {type: 'password', placeholder: 'Admin password', autocomplete: 'current-password'});
  const go = async e => {
    e.preventDefault();
    try { await api('POST', 'login', {password: pw.value}); load(); } catch (x) { login(x.message); }
  };
  A.replaceChildren(h('form', {class: 'panel', onsubmit: go}, h('h2', {}, 'Admin login'), err && h('p', {class: 'err'}, err), pw, h('button', {class: 'primary'}, 'Log in')));
  pw.focus();
}

async function load() {
  try { ({puzzles: db, today} = await api('GET', 'puzzles')); } catch (x) { return login(x.status === 401 ? null : x.message); }
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
    h('div', {class: 'row-btns tabs'}, Object.keys(FORMS).map(g => h('button', {class: g === game ? 'primary' : '', onclick: () => { game = g; render(); }}, FORMS[g].name)),
      h('button', {onclick: async () => { await api('POST', 'logout'); login(); }}, 'Log out')),
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

load();
