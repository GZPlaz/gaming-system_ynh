'use strict';
// Second batch of games: three admin-managed daily puzzles, one seeded daily, six anytime games.

BG.add({
  id: 'trivia', name: 'Daily Trivia', icon: '🧠', daily: true,
  desc: 'A few questions, one shot each.',
  async play(el) {
    const p = await BG.daily('trivia', el); if (!p) return;
    const Q = p.data.questions, K = 'trivia:' + p.date, st = BG.store.get(K, {a: []});
    const box = h('div', {class: 'tv'});
    el.append(box);
    const draw = () => {
      const i = st.a.length;
      if (i >= Q.length) {
        const s = st.a.filter((a, k) => a === Q[k].answer).length;
        BG.done('trivia', p.date);
        return box.replaceChildren(h('p', {class: 'msg'}, `Score: ${s}/${Q.length}`),
          Q.map((q, k) => h('p', {}, (st.a[k] === q.answer ? '✅ ' : '❌ ') + q.q + ' → ' + q.options[q.answer])),
          h('button', {onclick: () => BG.share(`Trivia #${p.number} ${s}/${Q.length}\n` + st.a.map((a, k) => (a === Q[k].answer ? '🟩' : '🟥')).join(''))}, 'Share'));
      }
      const order = BG.shuffle(Q[i].options.map((_, j) => j), BG.rng(p.date + i));
      box.replaceChildren(h('p', {class: 'sub'}, `Question ${i + 1} of ${Q.length}`), h('blockquote', {class: 'riddle'}, Q[i].q),
        h('div', {class: 'tv-opts'}, order.map(j => h('button', {onclick: () => {
          st.a.push(j); BG.store.set(K, st);
          BG.toast(j === Q[i].answer ? 'Correct! ✅' : 'Answer: ' + Q[i].options[Q[i].answer]);
          draw();
        }}, Q[i].options[j]))));
    };
    draw();
  },
});

BG.add({
  id: 'hangman', name: 'Hangman', icon: '🪢', daily: true,
  desc: 'Guess today’s phrase letter by letter.',
  how: 'Pick letters to reveal the phrase. Six wrong letters and you are out.',
  async play(el) {
    const p = await BG.daily('hangman', el); if (!p) return;
    const P = p.data.phrase, K = 'hangman:' + p.date, MAX = 6, st = BG.store.get(K, {g: []});
    const letters = new Set([...P].filter(c => /[A-Z]/.test(c)));
    const wrong = () => st.g.filter(c => !letters.has(c)).length;
    const won = () => [...letters].every(c => st.g.includes(c));
    const over = () => won() || wrong() >= MAX;
    const phrase = h('div', {class: 'hm-phrase'}), lives = h('p'), kb = h('div', {class: 'kb'}), msg = h('div', {class: 'msg'});
    if (p.data.category) el.append(h('p', {}, 'Category: ', h('b', {}, p.data.category)));
    el.append(phrase, lives, msg, kb);
    const guess = c => {
      if (over() || st.g.includes(c) || !/^[A-Z]$/.test(c)) return;
      st.g.push(c); BG.store.set(K, st);
      if (over()) BG.done('hangman', p.date);
      draw();
    };
    const draw = () => {
      phrase.replaceChildren(...P.split(' ').map(w => h('span', {class: 'hm-word'},
        [...w].map(c => h('span', {class: 'hm-ch'}, !/[A-Z]/.test(c) || st.g.includes(c) || over() ? c : '_')))));
      lives.textContent = '❤️'.repeat(MAX - wrong()) + '🖤'.repeat(Math.min(wrong(), MAX));
      msg.textContent = won() ? 'Solved! 🎉' : over() ? 'Out of lives!' : '';
      kb.replaceChildren(...['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map(row => h('div', {}, [...row].map(c => h('button', {
        class: 'key ' + (st.g.includes(c) ? (letters.has(c) ? 'correct' : 'absent') : ''), onclick: () => guess(c)}, c)))));
    };
    BG.keys(e => guess(e.key.toUpperCase()));
    draw();
  },
});

BG.add({
  id: 'wordsearch', name: 'Word Search', icon: '🔎', daily: true,
  desc: 'Find all of today’s hidden words.',
  how: 'Tap the first letter of a word, then its last letter. Words run in any direction.',
  async play(el) {
    const p = await BG.daily('wordsearch', el); if (!p) return;
    const rnd = BG.rng(p.date + 'ws'), K = 'wordsearch:' + p.date, st = BG.store.get(K, {found: [], cells: []});
    const N = Math.min(12, Math.max(8, ...p.data.words.map(w => w.length + 1)));
    const grid = Array(N * N).fill(''), D = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]], words = [];
    for (const w of [...p.data.words].sort((a, b) => b.length - a.length)) {
      for (let t = 0; t < 300; t++) {
        const [dr, dc] = D[Math.floor(rnd() * 8)], r = Math.floor(rnd() * N), c = Math.floor(rnd() * N);
        const cells = [...w].map((_, k) => [r + dr * k, c + dc * k]);
        if (cells.every(([y, x], k) => y >= 0 && y < N && x >= 0 && x < N && (!grid[y * N + x] || grid[y * N + x] === w[k]))) {
          cells.forEach(([y, x], k) => { grid[y * N + x] = w[k]; });
          words.push(w);
          break;
        }
      }
    }
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = String.fromCharCode(65 + Math.floor(rnd() * 26));
    let start = -1;
    const board = h('div', {class: 'ws-grid', style: `--n:${N}`}), list = h('div', {class: 'ws-words'}), msg = h('div', {class: 'msg'});
    if (p.data.theme) el.append(h('p', {}, 'Theme: ', h('b', {}, p.data.theme)));
    el.append(board, list, msg);
    const pick = i => {
      if (start < 0) { start = i; return draw(); }
      const r1 = Math.floor(start / N), c1 = start % N, r2 = Math.floor(i / N), c2 = i % N;
      start = -1;
      if (r1 !== r2 && c1 !== c2 && Math.abs(r2 - r1) !== Math.abs(c2 - c1)) return draw();
      const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1), len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
      const cells = Array.from({length: len}, (_, k) => (r1 + dr * k) * N + c1 + dc * k), s = cells.map(k => grid[k]).join('');
      const w = words.find(x => !st.found.includes(x) && (x === s || x === [...s].reverse().join('')));
      if (w) {
        st.found.push(w); st.cells.push(...cells); BG.store.set(K, st);
        if (st.found.length === words.length) BG.done('wordsearch', p.date);
      }
      draw();
    };
    const draw = () => {
      const hit = new Set(st.cells);
      board.replaceChildren(...grid.map((ch, i) => h('button', {class: 'ws-cell' + (hit.has(i) ? ' hit' : '') + (i === start ? ' sel' : ''), onclick: () => pick(i)}, ch)));
      list.replaceChildren(...words.map(w => h('span', {class: st.found.includes(w) ? 'found' : ''}, w)));
      msg.textContent = st.found.length === words.length ? 'All found! 🎉' : `${st.found.length}/${words.length} found`;
    };
    draw();
  },
});

BG.add({
  id: 'target', name: 'Number Target', icon: '🎰', daily: true,
  desc: 'Reach the target using six numbers.',
  how: 'Tap a number, an operation, then another number to combine them. Each number is used once. Hit the target exactly.',
  play(el) {
    const today = BG.today();
    const gen = rnd => {
      const r = n => Math.floor(rnd() * n);
      for (;;) {
        const nums = [...BG.shuffle([25, 50, 75, 100], rnd).slice(0, 2), ...Array.from({length: 4}, () => 1 + r(10))];
        const pool = BG.shuffle(nums, rnd), steps = 3 + r(3);
        let v = pool[0];
        for (let k = 1; k <= steps; k++) {
          const n = pool[k], o = r(4);
          v = o === 1 && v > n ? v - n : o === 2 && v * n < 1000 ? v * n : o === 3 && v % n === 0 ? v / n : v + n;
        }
        if (v > 100 && v < 1000) return {nums, target: v};
      }
    };
    let game, nums, hist, sel, op, isDaily;
    const top = h('div', {class: 'big'}), tiles = h('div', {class: 'row-btns center'}), ops = h('div', {class: 'row-btns center'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {class: 'primary', onclick: () => start(true)}, 'Daily'), h('button', {onclick: () => start(false)}, 'Practice')), top, tiles, ops, msg);
    const clear = () => { sel = op = null; };
    const start = d => { isDaily = d; game = gen(d ? BG.rng('target' + today) : Math.random); nums = [...game.nums]; hist = []; clear(); draw(); };
    const tap = i => {
      if (nums.includes(game.target)) return;
      if (sel === null || op === null || i === sel) { sel = sel === i ? null : i; return draw(); }
      const a = nums[sel], b = nums[i], r = {'+': a + b, '−': a - b, '×': a * b, '÷': a / b}[op];
      if (!(r > 0) || r % 1) return BG.toast('Results must be positive whole numbers');
      hist.push(nums);
      nums = nums.filter((_, k) => k !== sel && k !== i).concat(r);
      clear();
      if (isDaily && nums.includes(game.target)) BG.done('target', today);
      draw();
    };
    const draw = () => {
      top.textContent = '🎯 ' + game.target + (isDaily ? '' : ' (practice)');
      tiles.replaceChildren(...nums.map((v, i) => h('button', {class: 'tg-num' + (i === sel ? ' primary' : ''), onclick: () => tap(i)}, v)));
      ops.replaceChildren(...['+', '−', '×', '÷'].map(o => h('button', {class: o === op ? 'primary' : '', onclick: () => { if (sel !== null) { op = o; draw(); } }}, o)),
        h('button', {onclick: () => { if (hist.length) { nums = hist.pop(); clear(); draw(); } }}, 'Undo'),
        h('button', {onclick: () => { nums = [...game.nums]; hist = []; clear(); draw(); }}, 'Reset'));
      const best = nums.reduce((b, v) => (Math.abs(v - game.target) < Math.abs(b - game.target) ? v : b));
      msg.textContent = nums.includes(game.target) ? 'Target hit! 🎉' : `Closest so far: ${best}`;
    };
    start(true);
  },
});

BG.add({
  id: 'nonogram', name: 'Nonogram', icon: '🖼️',
  desc: 'Fill cells to match the number clues.',
  how: 'Clues give the runs of filled cells in each row and column. Tap: fill → ✕ → clear (right-click marks ✕).',
  play(el) {
    let N, sol, cur;
    const runs = a => { const r = []; let n = 0; for (const v of [...a, 0]) if (v === 1) n++; else if (n) { r.push(n); n = 0; } return r.length ? r : [0]; };
    const row = (g, r) => g.slice(r * N, r * N + N), col = (g, c) => Array.from({length: N}, (_, r) => g[r * N + c]);
    const same = (a, b) => `${runs(a)}` === `${runs(b)}`;
    const board = h('div', {class: 'ng-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, [5, 7, 10].map(n => h('button', {onclick: () => reset(n)}, `${n}×${n}`))), board, msg);
    const reset = n => { N = n; sol = Array.from({length: N * N}, () => +(Math.random() < 0.58)); cur = Array(N * N).fill(0); draw(); };
    const solved = () => [...Array(N).keys()].every(i => same(row(cur, i), row(sol, i)) && same(col(cur, i), col(sol, i)));
    const set = (i, v) => { if (!solved()) { cur[i] = v; draw(); } };
    const draw = () => {
      const idx = [...Array(N).keys()];
      board.style.gridTemplateColumns = `auto repeat(${N}, minmax(0, 1fr))`;
      board.replaceChildren(h('div'), ...idx.map(c => h('div', {class: 'ng-clue col'}, runs(col(sol, c)).join('\n'))),
        ...idx.flatMap(r => [h('div', {class: 'ng-clue'}, runs(row(sol, r)).join(' ')), ...row(cur, r).map((v, c) => h('button', {
          class: 'ng-cell s' + v, onclick: () => set(r * N + c, (v + 1) % 3),
          oncontextmenu: e => { e.preventDefault(); set(r * N + c, v === 2 ? 0 : 2); }}, v === 2 ? '✕' : ''))]));
      msg.textContent = solved() ? 'Solved! 🎉' : '';
    };
    reset(5);
  },
});

BG.add({
  id: 'schulte', name: 'Schulte Table', icon: '👁️',
  desc: 'Tap 1 to 25 in order, as fast as you can.',
  how: 'Keep your eyes on the centre and use peripheral vision. The timer starts on 1.',
  play(el) {
    let nums, next, t0;
    const grid = h('div', {class: 'st-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New table')), grid, msg);
    const reset = () => { nums = BG.shuffle([...Array(25)].map((_, i) => i + 1)); next = 1; msg.textContent = 'Find 1'; draw(); };
    const tap = (n, b) => {
      if (n !== next) { b.classList.add('bad'); BG.later(() => b.classList.remove('bad'), 200); return; }
      if (next === 1) t0 = performance.now();
      b.classList.add('ok');
      if (++next <= 25) { msg.textContent = `Find ${next}`; return; }
      const s = +((performance.now() - t0) / 1000).toFixed(2);
      msg.textContent = `Done in ${s}s! Best: ${BG.best('schulte', s, true)}s`;
    };
    const draw = () => grid.replaceChildren(...nums.map(n => { const b = h('button', {class: 'st-cell', onclick: () => tap(n, b)}, n); return b; }));
    reset();
  },
});

BG.add({
  id: 'numbermemory', name: 'Number Memory', icon: '📟',
  desc: 'Remember ever-longer numbers.',
  how: 'A number appears briefly. Type it back. One digit longer each round.',
  play(el) {
    let len, num;
    const box = h('div', {class: 'mt-box'});
    el.append(box);
    const show = () => {
      num = Array.from({length: len}, (_, i) => (i ? 0 : 1) + Math.floor(Math.random() * (i ? 10 : 9))).join('');
      const ms = 1000 + len * 600, bar = h('div', {class: 'bar', style: `animation-duration:${ms}ms`});
      box.replaceChildren(h('div', {class: 'big mono'}, num), bar);
      BG.later(ask, ms);
    };
    const ask = () => {
      const inp = h('input', {inputmode: 'numeric', autocomplete: 'off'});
      const go = () => {
        if (inp.value.trim() === num) { len++; return show(); }
        box.replaceChildren(h('p', {}, `Number: ${num}`), h('p', {}, `You: ${inp.value || '—'}`),
          h('p', {class: 'msg'}, `Reached ${len - 1} digits · Best: ${BG.best('numbermemory', len - 1)}`), begin('Try again'));
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      box.replaceChildren(h('p', {}, 'What was the number?'), inp, h('button', {class: 'primary', onclick: go}, 'Submit'));
      inp.focus();
    };
    const begin = label => h('button', {class: 'primary', onclick: () => { len = 3; show(); }}, label);
    box.append(begin('Start'));
  },
});

BG.add({
  id: 'stroop', name: 'Color Clash', icon: '🎨',
  desc: 'Pick the ink colour, not the word. 30 seconds.',
  how: 'The word names one colour but is painted in another. Tap the colour of the INK. Wrong answers cost a point.',
  play(el) {
    const C = {RED: '#e53935', GREEN: '#43a047', BLUE: '#1e88e5', YELLOW: '#fbc02d', PURPLE: '#8e24aa'}, names = Object.keys(C);
    const pick = () => names[Math.floor(Math.random() * names.length)];
    const box = h('div', {class: 'mt-box'});
    el.append(box);
    const intro = text => box.replaceChildren(h('p', {}, text || 'Ready?'), h('button', {class: 'primary', onclick: go}, text ? 'Play again' : 'Start'));
    const go = () => {
      let score = 0, left = 30, ink;
      const word = h('div', {class: 'big'}), stat = h('p');
      const upd = () => { stat.textContent = `⏱ ${left}s · Score ${score}`; };
      const next = () => {
        ink = pick();
        let w; do w = pick(); while (w === ink && Math.random() < 0.8);
        word.textContent = w; word.style.color = C[ink]; upd();
      };
      box.replaceChildren(word, h('div', {class: 'row-btns center'}, names.map(n => h('button', {onclick: () => { score += n === ink ? 1 : -1; next(); }}, n))), stat);
      next();
      const stop = BG.every(() => {
        left--; upd();
        if (left <= 0) { stop(); intro(`Time! Score: ${score} · Best: ${BG.best('stroop', score)}`); }
      }, 1000);
    };
    intro();
  },
});

BG.add({
  id: 'hanoi', name: 'Tower of Hanoi', icon: '🗼',
  desc: 'Move the whole tower to the right-hand peg.',
  how: 'Tap a peg to pick up its top disk, then another peg to drop it. Never put a bigger disk on a smaller one.',
  play(el) {
    let pegs, n, sel, moves;
    const board = h('div', {class: 'hn-board'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, [3, 4, 5, 6, 7].map(k => h('button', {onclick: () => reset(k)}, `${k} disks`))), board, msg);
    const reset = k => { n = k; pegs = [[...Array(n)].map((_, i) => n - i), [], []]; sel = null; moves = 0; draw(); };
    const done = () => pegs[2].length === n;
    const tap = i => {
      if (done()) return;
      if (sel === null) { if (pegs[i].length) sel = i; }
      else {
        const top = pegs[i].at(-1);
        if (i !== sel && (!top || top > pegs[sel].at(-1))) { pegs[i].push(pegs[sel].pop()); moves++; }
        sel = null;
      }
      draw();
    };
    const draw = () => {
      board.replaceChildren(...pegs.map((p, i) => h('button', {class: 'hn-peg' + (i === sel ? ' sel' : ''), onclick: () => tap(i)},
        p.map(d => h('div', {class: 'hn-disk', style: `width:${20 + d * 75 / n}%;background:hsl(${d * 360 / n},65%,55%)`})))));
      msg.textContent = (done() ? `Solved in ${moves} moves! 🎉 ` : `Moves: ${moves} · `) + `Minimum: ${2 ** n - 1}`;
    };
    reset(4);
  },
});

BG.add({
  id: 'tictactoe', name: 'Tic-Tac-Toe', icon: '❌',
  desc: 'Beat the computer, if you can.',
  how: 'You are X. Perfect mode never loses, so a draw is a good result. Casual mode makes mistakes.',
  play(el) {
    const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const result = b => {
      for (const [a, c, d] of L) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
      return b.includes('') ? null : 'draw';
    };
    const mm = (b, p) => { // minimax: +1 computer (O) wins, -1 player wins
      const r = result(b);
      if (r) return r === 'O' ? 1 : r === 'X' ? -1 : 0;
      let best = p === 'O' ? -2 : 2;
      for (let i = 0; i < 9; i++) if (!b[i]) {
        b[i] = p; const s = mm(b, p === 'O' ? 'X' : 'O'); b[i] = '';
        best = p === 'O' ? Math.max(best, s) : Math.min(best, s);
      }
      return best;
    };
    let b, perfect = true;
    const tally = {X: 0, O: 0, draw: 0};
    const grid = h('div', {class: 'tt-grid'}), msg = h('div', {class: 'msg'});
    const modeBtn = h('button', {onclick: () => { perfect = !perfect; modeBtn.textContent = 'Mode: ' + (perfect ? 'Perfect' : 'Casual'); reset(); }}, 'Mode: Perfect');
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game'), modeBtn), grid, msg);
    const reset = () => { b = Array(9).fill(''); draw(); };
    const ai = () => {
      const free = b.map((v, i) => (v ? -1 : i)).filter(i => i >= 0);
      if (!perfect && Math.random() < 0.4) return free[Math.floor(Math.random() * free.length)];
      let best = -2, picks = [];
      for (const i of free) {
        b[i] = 'O'; const s = mm(b, 'X'); b[i] = '';
        if (s > best) { best = s; picks = [i]; } else if (s === best) picks.push(i);
      }
      return picks[Math.floor(Math.random() * picks.length)];
    };
    const tap = i => {
      if (b[i] || result(b)) return;
      b[i] = 'X';
      if (!result(b)) b[ai()] = 'O';
      const r = result(b);
      if (r) tally[r]++;
      draw();
    };
    const draw = () => {
      grid.replaceChildren(...b.map((v, i) => h('button', {class: 'tt-cell', onclick: () => tap(i)}, v)));
      const r = result(b);
      msg.textContent = ({X: 'You win! 🎉 ', O: 'Computer wins. ', draw: 'Draw. '}[r] || '') + `You ${tally.X} · Computer ${tally.O} · Draws ${tally.draw}`;
    };
    reset();
  },
});
