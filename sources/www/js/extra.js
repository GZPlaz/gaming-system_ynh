'use strict';
// Third batch: three admin-managed daily puzzles and seven anytime games.

BG.add({
  id: 'spellingbee', name: 'Spelling Bee', icon: '🐝', daily: true,
  desc: 'Make as many words as you can from seven letters.',
  how: 'Words need 4+ letters and must use the centre letter. Letters can repeat. Using all seven is a pangram (+7).',
  async play(el) {
    const p = await BG.daily('spellingbee', el); if (!p) return;
    const L = p.data.letters, C = L[0], W = new Set(p.data.words), K = 'spellingbee:' + p.date, st = BG.store.get(K, {found: []});
    const pangram = w => new Set(w).size === 7;
    const pts = w => (w.length === 4 ? 1 : w.length) + (pangram(w) ? 7 : 0);
    const max = [...W].reduce((s, w) => s + pts(w), 0);
    const RANKS = [['Beginner', 0], ['Good', 0.2], ['Great', 0.4], ['Amazing', 0.55], ['Genius', 0.7], ['Queen Bee', 1]];
    let outer = [...L.slice(1)], cur = '';
    const info = h('p', {class: 'msg'}), word = h('div', {class: 'sb-word'}), hive = h('div', {class: 'sb-hive'}), list = h('div', {class: 'sb-found'});
    const enter = () => {
      const w = cur; cur = '';
      const err = w.length < 4 ? 'Too short' : !w.includes(C) ? 'Missing centre letter' : st.found.includes(w) ? 'Already found' : !W.has(w) ? 'Not in word list' : null;
      if (err) BG.toast(err);
      else { st.found.push(w); BG.store.set(K, st); BG.toast((pangram(w) ? 'Pangram! ' : '') + '+' + pts(w)); }
      draw();
    };
    const del = () => { cur = cur.slice(0, -1); draw(); };
    el.append(info, word, hive, h('div', {class: 'row-btns center'}, h('button', {onclick: del}, 'Delete'),
      h('button', {onclick: () => { outer = BG.shuffle(outer); draw(); }}, '🔀 Shuffle'), h('button', {class: 'primary', onclick: enter}, 'Enter')), list);
    const draw = () => {
      const score = st.found.reduce((s, w) => s + pts(w), 0);
      if (score >= 0.7 * max) BG.done('spellingbee', p.date);
      info.textContent = `${RANKS.filter(([, f]) => score >= f * max).at(-1)[0]} · ${score}/${max} points · ${st.found.length}/${W.size} words`;
      word.replaceChildren(...[...cur].map(c => h('span', {class: c === C ? 'c' : ''}, c)), h('span', {class: 'caret'}, '|'));
      const cell = (c, cls) => h('button', {class: 'sb-cell ' + cls, onclick: () => { cur += c; draw(); }}, c);
      hive.replaceChildren(...outer.map((c, i) => cell(c, 'o' + i)), cell(C, 'center'));
      list.replaceChildren(...[...st.found].sort().map(w => h('span', {class: pangram(w) ? 'pg' : ''}, w)));
    };
    BG.keys(e => {
      const k = e.key.toUpperCase();
      if (k === 'ENTER') enter();
      else if (k === 'BACKSPACE') del();
      else if (k.length === 1 && L.includes(k)) { cur += k; draw(); }
    });
    draw();
  },
});

BG.add({
  id: 'cryptogram', name: 'Cryptogram', icon: '🔐', daily: true,
  desc: 'Decode today’s secret quote.',
  how: 'Every letter was swapped for another. Type a guess under any letter and it fills in everywhere that code letter appears.',
  async play(el) {
    const p = await BG.daily('cryptogram', el); if (!p) return;
    const Q = p.data.quote, K = 'cryptogram:' + p.date, st = BG.store.get(K, {map: {}, hints: 0}), rnd = BG.rng(p.date + 'cg');
    const A = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    let key;
    do key = BG.shuffle(A, rnd); while (key.some((c, i) => c === A[i])); // no letter maps to itself
    const enc = Object.fromEntries(A.map((c, i) => [c, key[i]])), dec = Object.fromEntries(A.map((c, i) => [key[i], c]));
    const used = [...new Set([...Q].filter(c => enc[c]).map(c => enc[c]))];
    const solved = () => used.every(c => st.map[c] === dec[c]);
    const inputs = [], msg = h('div', {class: 'msg'});
    const set = (c, v) => { st.map[c] = v; BG.store.set(K, st); sync(); };
    const box = h('div', {class: 'cg'}, Q.split(' ').map(w => h('span', {class: 'cg-word'}, [...w].map(ch => {
      if (!enc[ch]) return h('span', {class: 'cg-punct'}, ch);
      const c = enc[ch], inp = h('input', {'data-c': c, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'code ' + c});
      inputs.push(inp);
      inp.addEventListener('input', () => {
        set(c, inp.value.toUpperCase().replace(/[^A-Z]/g, '').slice(-1));
        if (inp.value) inputs[inputs.indexOf(inp) + 1]?.focus();
      });
      return h('label', {class: 'cg-cell'}, inp, h('small', {}, c));
    }))));
    const sync = () => {
      inputs.forEach(i => { i.value = st.map[i.dataset.c] || ''; });
      const ok = solved();
      if (ok) { BG.done('cryptogram', p.date); inputs.forEach(i => { i.disabled = true; }); }
      msg.textContent = ok ? `Solved! 🎉 ${p.data.author ? '— ' + p.data.author : ''}${st.hints ? ` (${st.hints} hints)` : ''}` : '';
    };
    const hint = () => {
      const left = used.filter(c => st.map[c] !== dec[c]);
      if (!left.length) return;
      st.hints++;
      const c = left[Math.floor(Math.random() * left.length)];
      set(c, dec[c]);
    };
    el.append(box, msg, h('div', {class: 'row-btns center'}, h('button', {onclick: hint}, 'Hint'),
      h('button', {onclick: () => { if (!solved()) { st.map = {}; BG.store.set(K, st); sync(); } }}, 'Clear')));
    sync();
  },
});

BG.add({
  id: 'emoji', name: 'Emoji Decoder', icon: '😎', daily: true,
  desc: 'Guess the film, phrase or thing from emojis.',
  async play(el) {
    const p = await BG.daily('emoji', el); if (!p) return;
    const K = 'emoji:' + p.date, st = BG.store.get(K, {res: {}}), items = p.data.items;
    const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/^(a|an|the) /, '').replace(/\s+/g, ' ').trim();
    const list = h('div', {class: 'sc-list'}), msg = h('div', {class: 'msg'});
    el.append(list, msg);
    const save = (i, r) => {
      st.res[i] = r; BG.store.set(K, st);
      if (Object.keys(st.res).length === items.length) BG.done('emoji', p.date);
      draw();
    };
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => {
        const r = st.res[i], head = h('div', {class: 'letters emo'}, it.emoji);
        if (r) return h('div', {class: 'sc-item ' + r}, head, h('b', {}, it.answers[0]), r === 'solved' ? ' ✓' : ' (revealed)');
        const inp = h('input', {placeholder: 'Your answer', autocomplete: 'off'}), hint = h('small', {class: 'hint'});
        const check = () => {
          const n = norm(inp.value);
          if (n && it.answers.some(a => norm(a) === n)) save(i, 'solved');
          else { BG.toast('Not quite'); inp.select(); }
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
        return h('div', {class: 'sc-item'}, head, inp, h('button', {class: 'primary', onclick: check}, 'Check'),
          it.hint && h('button', {onclick: () => { hint.textContent = '💡 ' + it.hint; }}, 'Hint'),
          h('button', {onclick: () => save(i, 'revealed')}, 'Reveal'), hint);
      }));
      const res = Object.values(st.res);
      msg.textContent = res.length === items.length ? `Done! ${res.filter(r => r === 'solved').length}/${items.length} solved.` : '';
    };
    draw();
  },
});

BG.add({
  id: 'connect4', name: 'Connect Four', icon: '🟡',
  desc: 'Line up four before the computer does.',
  how: 'You are red. Tap a column to drop a disc. Four in a row in any direction wins.',
  play(el) {
    const R = 6, C = 7, W = [], ORDER = [3, 2, 4, 1, 5, 0, 6], VAL = [0, 1, 4, 32];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [0, 1, 2, 3].map(k => [r + dr * k, c + dc * k]);
      if (cells.every(([y, x]) => y >= 0 && y < R && x >= 0 && x < C)) W.push(cells.map(([y, x]) => y * C + x));
    }
    const winner = b => { // 1 player, 2 computer, 3 draw, 0 ongoing
      for (const w of W) if (b[w[0]] && w.every(i => b[i] === b[w[0]])) return b[w[0]];
      return b.includes(0) ? 0 : 3;
    };
    const drop = (b, c, p) => { for (let r = R - 1; r >= 0; r--) if (!b[r * C + c]) { b[r * C + c] = p; return r * C + c; } return -1; };
    const heur = b => {
      let s = 0;
      for (const w of W) {
        let me = 0, you = 0;
        for (const i of w) { if (b[i] === 2) me++; else if (b[i] === 1) you++; }
        if (!you) s += VAL[me]; else if (!me) s -= VAL[you] * 1.2;
      }
      return s;
    };
    const mm = (b, d, al, be, max) => { // alpha-beta minimax, computer maximises
      const w = winner(b);
      if (w === 2) return 1e6 + d;
      if (w === 1) return -1e6 - d;
      if (w === 3) return 0;
      if (!d) return heur(b);
      let best = max ? -Infinity : Infinity;
      for (const c of ORDER) {
        const i = drop(b, c, max ? 2 : 1);
        if (i < 0) continue;
        const v = mm(b, d - 1, al, be, !max);
        b[i] = 0;
        if (max) { best = Math.max(best, v); al = Math.max(al, v); } else { best = Math.min(best, v); be = Math.min(be, v); }
        if (al >= be) break;
      }
      return best;
    };
    let b, depth = 2, busy = false;
    const ai = () => {
      let best = -Infinity, pick = 3;
      for (const c of ORDER) {
        const i = drop(b, c, 2);
        if (i < 0) continue;
        const v = mm(b, depth, -Infinity, Infinity, false);
        b[i] = 0;
        if (v > best) { best = v; pick = c; }
      }
      return pick;
    };
    const grid = h('div', {class: 'c4-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, [['Easy', 0], ['Medium', 2], ['Hard', 4]].map(([n, d]) => h('button', {onclick: () => { depth = d; reset(); }}, n))), grid, msg);
    const reset = () => { b = Array(R * C).fill(0); busy = false; draw(); };
    const move = c => {
      if (busy || winner(b) || drop(b, c, 1) < 0) return;
      if (!winner(b)) { busy = true; BG.later(() => { drop(b, ai(), 2); busy = false; draw(); }, 250); }
      draw();
    };
    const draw = () => {
      const w = winner(b);
      grid.replaceChildren(...b.map((v, i) => h('button', {class: 'c4-cell p' + v, 'aria-label': 'column ' + (i % C + 1), onclick: () => move(i % C)})));
      msg.textContent = w === 1 ? 'You win! 🎉' : w === 2 ? 'Computer wins.' : w === 3 ? 'Draw.' : busy ? 'Thinking…' : 'Your move';
    };
    reset();
  },
});

BG.add({
  id: 'reversi', name: 'Reversi', icon: '⚫',
  desc: 'Outflank the computer to own the board.',
  how: 'You are black. Place a disc to sandwich white discs in any line; they flip to black. Most discs at the end wins.',
  play(el) {
    const D = [-9, -8, -7, -1, 1, 7, 8, 9];
    const WT = [100, -20, 10, 5, 5, 10, -20, 100, -20, -50, -2, -2, -2, -2, -50, -20, 10, -2, 1, 1, 1, 1, -2, 10, 5, -2, 1, 0, 0, 1, -2, 5,
      5, -2, 1, 0, 0, 1, -2, 5, 10, -2, 1, 1, 1, 1, -2, 10, -20, -50, -2, -2, -2, -2, -50, -20, 100, -20, 10, 5, 5, 10, -20, 100];
    const step = (j, d) => j + d >= 0 && j + d < 64 && Math.abs(((j + d) % 8) - (j % 8)) <= 1; // no wrapping across edges
    const flips = (b, i, p) => {
      if (b[i]) return [];
      const out = [];
      for (const d of D) {
        const line = [];
        let j = i;
        while (step(j, d) && b[j + d] === 3 - p) { j += d; line.push(j); }
        if (line.length && step(j, d) && b[j + d] === p) out.push(...line);
      }
      return out;
    };
    const moves = (b, p) => b.map((_, i) => i).filter(i => flips(b, i, p).length);
    const place = (b, i, p) => { flips(b, i, p).forEach(j => { b[j] = p; }); b[i] = p; };
    let b, busy;
    const grid = h('div', {class: 'rv-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game')), grid, msg);
    const reset = () => { b = Array(64).fill(0); b[27] = b[36] = 2; b[28] = b[35] = 1; busy = false; draw(); };
    const score = i => { const t = [...b]; place(t, i, 2); return WT[i] + flips(b, i, 2).length - 2 * moves(t, 1).length; };
    const turn = () => { // after any move: player goes if able, else computer, else game over
      busy = false;
      if (!moves(b, 1).length && moves(b, 2).length) { busy = true; BG.later(ai, 500); }
      draw();
    };
    const ai = () => { const m = moves(b, 2); if (m.length) place(b, m.reduce((a, i) => (score(i) > score(a) ? i : a)), 2); turn(); };
    const tap = i => {
      if (busy || !flips(b, i, 1).length) return;
      place(b, i, 1);
      if (moves(b, 2).length) { busy = true; BG.later(ai, 400); draw(); } else turn();
    };
    const draw = () => {
      const valid = busy ? [] : moves(b, 1), n1 = b.filter(v => v === 1).length, n2 = b.filter(v => v === 2).length;
      const over = !moves(b, 1).length && !moves(b, 2).length;
      grid.replaceChildren(...b.map((v, i) => h('button', {class: 'rv-cell', onclick: () => tap(i)},
        v ? h('span', {class: 'disc p' + v}) : valid.includes(i) ? h('span', {class: 'dot'}) : null)));
      msg.textContent = `⚫ ${n1} · ⚪ ${n2}` + (over ? (n1 > n2 ? ' · You win! 🎉' : n1 < n2 ? ' · Computer wins.' : ' · Draw.') : busy ? ' · Thinking…' : '');
    };
    reset();
  },
});

BG.add({
  id: 'floodit', name: 'Flood It', icon: '🌊',
  desc: 'Flood the board with one colour in limited moves.',
  how: 'Pick a colour (or tap a tile) to grow the top-left area. Fill the whole board within the move limit.',
  play(el) {
    const N = 12, LIMIT = 22, COLS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
    let g, moves;
    const grid = h('div', {class: 'fl-grid', style: `--n:${N}`}), pal = h('div', {class: 'row-btns center'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game')), grid, pal, msg);
    const reset = () => { g = Array.from({length: N * N}, () => Math.floor(Math.random() * COLS.length)); moves = 0; draw(); };
    const won = () => g.every(v => v === g[0]);
    const fill = c => {
      if (c === g[0] || won() || moves >= LIMIT) return;
      const old = g[0], stack = [0];
      while (stack.length) {
        const i = stack.pop();
        if (g[i] !== old) continue;
        g[i] = c;
        if (i % N) stack.push(i - 1);
        if ((i + 1) % N) stack.push(i + 1);
        if (i >= N) stack.push(i - N);
        if (i < N * N - N) stack.push(i + N);
      }
      moves++; draw();
    };
    const draw = () => {
      grid.replaceChildren(...g.map(v => h('div', {class: 'fl-cell', style: `background:${COLS[v]}`, onclick: () => fill(v)})));
      pal.replaceChildren(...COLS.map((col, c) => h('button', {class: 'peg big', style: `background:${col}`, 'aria-label': 'colour ' + (c + 1), onclick: () => fill(c)})));
      msg.textContent = won() ? `Flooded in ${moves} moves! 🎉` : moves >= LIMIT ? 'Out of moves!' : `Moves: ${moves}/${LIMIT}`;
    };
    reset();
  },
});

BG.add({
  id: 'visualmemory', name: 'Visual Memory', icon: '🔲',
  desc: 'Remember which tiles lit up.',
  how: 'Tiles flash briefly; tap them all. Three wrong taps in a round costs a life. You have three lives.',
  play(el) {
    let level, lives, n, target = null, picked, misses, showing;
    const grid = h('div', {class: 'vm-grid'}), msg = h('div', {class: 'msg'}, 'Press Start');
    el.append(grid, msg, h('div', {class: 'row-btns center'}, h('button', {class: 'primary', onclick: () => { level = 1; lives = 3; round(); }}, 'Start')));
    const round = () => {
      n = Math.min(7, 3 + Math.floor(level / 3));
      target = new Set(BG.shuffle([...Array(n * n).keys()]).slice(0, level + 2));
      picked = new Set(); misses = 0; showing = true;
      draw();
      BG.later(() => { showing = false; draw(); }, 1300);
    };
    const tap = i => {
      if (showing || !target || picked.has(i)) return;
      picked.add(i);
      if (target.has(i)) {
        if ([...target].every(t => picked.has(t))) { level++; showing = true; BG.later(round, 600); }
      } else if (++misses >= 3) {
        lives--; showing = true;
        if (!lives) {
          draw();
          target = null;
          msg.textContent = `Game over! Reached level ${level} · Best: ${BG.best('visualmemory', level)}`;
          return;
        }
        BG.later(round, 900);
      }
      draw();
    };
    const draw = () => {
      grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
      grid.replaceChildren(...Array.from({length: n * n}, (_, i) => h('button', {
        class: 'vm-cell' + (target.has(i) && (showing || picked.has(i)) ? ' on' : picked.has(i) ? ' miss' : ''), onclick: () => tap(i)})));
      msg.textContent = `Level ${level} · ${'❤️'.repeat(lives)}`;
    };
  },
});

BG.add({
  id: 'chimp', name: 'Chimp Test', icon: '🐒',
  desc: 'Remember where the numbers were.',
  how: 'Tap the numbers in order from 1. After your first tap the rest are hidden. Three strikes and you are out.',
  play(el) {
    const W = 8, H = 5;
    let n, strikes, pos = [], next;
    const grid = h('div', {class: 'ch-grid'}), msg = h('div', {class: 'msg'}, 'Press Start');
    el.append(grid, msg, h('div', {class: 'row-btns center'}, h('button', {class: 'primary', onclick: () => { n = 4; strikes = 0; round(); }}, 'Start')));
    const round = () => { pos = BG.shuffle([...Array(W * H).keys()]).slice(0, n); next = 1; draw(); };
    const tap = i => {
      const k = pos.indexOf(i) + 1;
      if (!k || k < next) return;
      if (k === next) {
        if (++next > n) { n++; BG.later(round, 400); }
        return draw();
      }
      if (++strikes < 3) return round();
      pos = []; draw();
      msg.textContent = `Game over! Score: ${n - 1} · Best: ${BG.best('chimp', n - 1)}`;
    };
    const draw = () => {
      grid.replaceChildren(...Array.from({length: W * H}, (_, i) => {
        const k = pos.indexOf(i) + 1;
        return h('button', {class: 'ch-cell' + (k >= next ? ' on' : ''), onclick: () => tap(i)}, k >= next && next === 1 ? k : '');
      }));
      msg.textContent = `Numbers: ${n} · Strikes: ${strikes}/3`;
    };
  },
});

BG.add({
  id: 'sequence', name: 'Number Sequence', icon: '🔮',
  desc: 'Find the next number in the pattern.',
  how: 'Ten sequences. Spot the rule and type the next number.',
  play(el) {
    const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const gens = [
      () => { const a = r(1, 20), d = r(2, 12); return k => a + d * k; },
      () => { const a = r(50, 99), d = r(3, 9); return k => a - d * k; },
      () => { const a = r(1, 5), q = r(2, 3); return k => a * q ** k; },
      () => { const a = r(0, 5); return k => (k + a) ** 2; },
      () => { const a = r(1, 3); return k => (k + a) ** 3; },
      () => { const a = r(1, 10), d = r(1, 4); return k => a + d * k * (k + 1) / 2; },
      () => { const s = [r(1, 5), r(1, 5)]; return k => { while (s.length <= k) s.push(s.at(-1) + s.at(-2)); return s[k]; }; },
      () => { const a = r(10, 30), x = r(4, 9), y = r(1, 3); return k => a + Math.ceil(k / 2) * x - Math.floor(k / 2) * y; },
    ];
    let round, score;
    const box = h('div', {class: 'mt-box'});
    el.append(box);
    const next = () => {
      if (round === 10) return box.replaceChildren(h('p', {class: 'msg'}, `Score: ${score}/10 · Best: ${BG.best('sequence', score)}`), h('button', {class: 'primary', onclick: start}, 'Play again'));
      round++;
      const f = gens[Math.floor(Math.random() * gens.length)](), terms = [0, 1, 2, 3, 4].map(f), ans = f(5);
      const inp = h('input', {inputmode: 'numeric', autocomplete: 'off'});
      const go = () => {
        if (inp.value.trim() === '') return;
        const ok = +inp.value === ans;
        if (ok) score++;
        BG.toast(ok ? 'Correct! ✅' : `It was ${ans}`);
        next();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      box.replaceChildren(h('p', {class: 'sub'}, `Sequence ${round} of 10 · Score ${score}`), h('div', {class: 'seq'}, terms.join(', ') + ', ?'), inp, h('button', {class: 'primary', onclick: go}, 'Answer'));
      inp.focus();
    };
    const start = () => { round = 0; score = 0; next(); };
    box.append(h('button', {class: 'primary', onclick: start}, 'Start'));
  },
});

BG.add({
  id: 'oddone', name: 'Odd One Out', icon: '🟪',
  desc: 'Spot the tile with a slightly different shade.',
  how: 'Tap the odd tile. It gets harder each level. 60 seconds; wrong taps cost 3 seconds.',
  play(el) {
    let level, left;
    const box = h('div', {class: 'mt-box'}), grid = h('div', {class: 'oo-grid'}), stat = h('p');
    el.append(box);
    const upd = () => { stat.textContent = `⏱ ${left}s · Level ${level}`; };
    const intro = t => box.replaceChildren(h('p', {}, t || 'Ready?'), h('button', {class: 'primary', onclick: go}, t ? 'Play again' : 'Start'));
    const round = () => {
      const n = Math.min(8, 2 + Math.floor(level / 3)), odd = Math.floor(Math.random() * n * n);
      const hue = Math.floor(Math.random() * 360), L = 40 + Math.floor(Math.random() * 20), d = Math.max(3, 20 - level);
      grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
      grid.replaceChildren(...Array.from({length: n * n}, (_, i) => h('button', {class: 'oo-cell', style: `background:hsl(${hue},65%,${i === odd ? L + d : L}%)`,
        onclick: () => { if (i === odd) { level++; round(); } else left = Math.max(0, left - 3); upd(); }})));
      upd();
    };
    const go = () => {
      level = 1; left = 60;
      box.replaceChildren(stat, grid);
      round();
      const stop = BG.every(() => {
        left--; upd();
        if (left <= 0) { stop(); intro(`Time! Reached level ${level} · Best: ${BG.best('oddone', level)}`); }
      }, 1000);
    };
    intro();
  },
});
