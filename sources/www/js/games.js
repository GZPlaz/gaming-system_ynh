'use strict';
// Anytime games: generated locally, no admin input needed.

BG.add({
  id: 'sudoku', name: 'Sudoku', icon: '🔢',
  desc: 'Every row, column and box gets 1–9.',
  how: 'Tap a cell, then a number (or type it). Wrong entries turn red. "Daily" is the same grid for everyone today.',
  play(el) {
    const D = [1, 2, 3, 4, 5, 6, 7, 8, 9], levels = {Easy: 36, Medium: 46, Hard: 54};
    const ok = (g, i, v) => {
      const r = Math.floor(i / 9), c = i % 9, br = r - r % 3, bc = c - c % 3;
      for (let k = 0; k < 9; k++) if (g[r * 9 + k] === v || g[k * 9 + c] === v || g[(br + Math.floor(k / 3)) * 9 + bc + k % 3] === v) return false;
      return true;
    };
    // Counts solutions up to `limit` (fills g when it finds one). Picks the most constrained cell first.
    const solve = (g, rnd, limit) => {
      let at = -1, cands;
      for (let i = 0; i < 81; i++) if (!g[i]) {
        const c = D.filter(v => ok(g, i, v));
        if (at < 0 || c.length < cands.length) { at = i; cands = c; if (c.length < 2) break; }
      }
      if (at < 0) return 1;
      let n = 0;
      for (const v of rnd ? BG.shuffle(cands, rnd) : cands) { g[at] = v; n += solve(g, rnd, limit); if (n >= limit) return n; }
      g[at] = 0;
      return n;
    };
    const gen = (holes, rnd) => {
      const sol = Array(81).fill(0);
      solve(sol, rnd, 1);
      const puz = [...sol];
      for (const i of BG.shuffle([...Array(81).keys()], rnd)) {
        if (holes <= 0) break;
        const v = puz[i]; puz[i] = 0;
        if (solve([...puz], null, 2) !== 1) puz[i] = v; else holes--;
      }
      return {sol, puz};
    };
    let game, cur, sel = -1;
    const grid = h('div', {class: 'sd-grid'}), pad = h('div', {class: 'sd-pad'}), msg = h('div', {class: 'msg'});
    const start = (l, rnd = Math.random) => { game = gen(levels[l], rnd); cur = [...game.puz]; sel = -1; msg.textContent = ''; draw(); };
    const set = v => {
      if (sel < 0 || game.puz[sel]) return;
      cur[sel] = v; draw();
      if (cur.every((x, i) => x === game.sol[i])) msg.textContent = 'Solved! 🎉';
    };
    const draw = () => grid.replaceChildren(...cur.map((v, i) => h('button', {
      class: 'cell' + (game.puz[i] ? ' given' : '') + (i === sel ? ' sel' : '') + (v && !game.puz[i] && v !== game.sol[i] ? ' bad' : '') + (sel >= 0 && v && v === cur[sel] ? ' same' : ''),
      onclick: () => { sel = i; draw(); }}, v || '')));
    el.append(h('div', {class: 'row-btns'}, Object.keys(levels).map(l => h('button', {onclick: () => start(l)}, l)),
      h('button', {class: 'primary', onclick: () => start('Medium', BG.rng('sudoku' + BG.today()))}, 'Daily')), grid, pad, msg);
    pad.append(...D.map(v => h('button', {onclick: () => set(v)}, v)), h('button', {onclick: () => set(0)}, '⌫'));
    BG.keys(e => {
      if (/^[1-9]$/.test(e.key)) set(+e.key);
      else if (['Backspace', 'Delete', '0'].includes(e.key)) set(0);
      else {
        const m = {ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1}[e.key];
        if (m && sel >= 0) { e.preventDefault(); sel = (sel + m + 81) % 81; draw(); }
      }
    });
    start('Easy');
  },
});

BG.add({
  id: 'minesweeper', name: 'Minesweeper', icon: '💣',
  desc: 'Clear the field without hitting a mine.',
  how: 'Tap to reveal; right-click or use Flag mode to flag. Numbers count neighbouring mines.',
  play(el) {
    const W = 9, H = 9, M = 10;
    let mines, opened, flags, started, over, flagMode = false;
    const grid = h('div', {class: 'ms-grid'}), msg = h('div', {class: 'msg'});
    const fbtn = h('button', {onclick: () => { flagMode = !flagMode; fbtn.classList.toggle('primary', flagMode); }}, '🚩 Flag mode');
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game'), fbtn), grid, msg);
    const nb = i => {
      const r = Math.floor(i / W), c = i % W, out = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < H && cc >= 0 && cc < W) out.push(rr * W + cc);
      }
      return out;
    };
    const count = i => nb(i).filter(j => mines.has(j)).length;
    const reset = () => { mines = new Set(); opened = new Set(); flags = new Set(); started = over = false; msg.textContent = ''; draw(); };
    const reveal = i => {
      if (over || opened.has(i) || flags.has(i)) return;
      if (!started) { // first tap is always safe
        started = true;
        const safe = new Set([i, ...nb(i)]);
        while (mines.size < M) { const j = Math.floor(Math.random() * W * H); if (!safe.has(j)) mines.add(j); }
      }
      if (mines.has(i)) { over = true; msg.textContent = 'Boom! 💥'; return draw(); }
      const stack = [i];
      while (stack.length) {
        const j = stack.pop();
        if (opened.has(j)) continue;
        opened.add(j); flags.delete(j);
        if (!count(j)) stack.push(...nb(j).filter(k => !opened.has(k)));
      }
      if (opened.size === W * H - M) { over = true; msg.textContent = 'Cleared! 🎉'; }
      draw();
    };
    const flag = i => { if (over || opened.has(i)) return; if (!flags.delete(i)) flags.add(i); draw(); };
    const draw = () => grid.replaceChildren(...Array.from({length: W * H}, (_, i) => {
      const o = opened.has(i), boom = over && mines.has(i), n = o ? count(i) : 0;
      return h('button', {class: 'ms-cell' + (o ? ' open n' + n : '') + (boom ? ' mine' : ''),
        onclick: () => (flagMode ? flag(i) : reveal(i)), oncontextmenu: e => { e.preventDefault(); flag(i); }},
      boom ? '💣' : flags.has(i) ? '🚩' : n || '');
    }));
    reset();
  },
});

BG.add({
  id: 'lightsout', name: 'Lights Out', icon: '💡',
  desc: 'Switch off every light.',
  how: 'Tapping a light toggles it and its four neighbours.',
  play(el) {
    const N = 5;
    let g, moves;
    const grid = h('div', {class: 'lo-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New puzzle')), grid, msg);
    const toggle = i => [i, i - N, i + N, i % N ? i - 1 : -1, (i + 1) % N ? i + 1 : -1].forEach(j => { if (j >= 0 && j < N * N) g[j] ^= 1; });
    const reset = () => {
      g = Array(N * N).fill(0); // scramble from solved so it is always solvable
      for (let k = 0; k < 12; k++) toggle(Math.floor(Math.random() * N * N));
      if (!g.some(Boolean)) toggle(12);
      moves = 0; draw();
    };
    const draw = () => {
      const on = g.some(Boolean);
      grid.replaceChildren(...g.map((v, i) => h('button', {class: 'lo-cell' + (v ? ' on' : ''), onclick: () => { if (on) { toggle(i); moves++; draw(); } }})));
      msg.textContent = on ? `Moves: ${moves}` : `Lights out in ${moves} moves! 🎉`;
    };
    reset();
  },
});

BG.add({
  id: 'slide', name: 'Sliding Puzzle', icon: '🧩',
  desc: 'Put tiles 1–15 back in order.',
  how: 'Tap a tile next to the gap to slide it.',
  play(el) {
    const N = 4;
    let t, moves;
    const grid = h('div', {class: 'sl-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'Shuffle')), grid, msg);
    const adj = (a, b) => Math.abs(a - b) === N || (Math.abs(a - b) === 1 && Math.floor(a / N) === Math.floor(b / N));
    const solved = () => t.every((v, i) => v === (i + 1) % (N * N));
    const move = i => { const z = t.indexOf(0); if (!adj(i, z)) return false; [t[i], t[z]] = [t[z], t[i]]; return true; };
    const reset = () => {
      t = [...Array(N * N).keys()].map(i => (i + 1) % (N * N));
      for (let k = 0; k < 300; k++) { const z = t.indexOf(0), opts = t.map((_, i) => i).filter(i => adj(i, z)); move(opts[Math.floor(Math.random() * opts.length)]); }
      if (solved()) return reset();
      moves = 0; draw();
    };
    const draw = () => {
      grid.replaceChildren(...t.map((v, i) => h('button', {class: 'sl-tile' + (v ? '' : ' empty'), onclick: () => { if (!solved() && move(i)) { moves++; draw(); } }}, v || '')));
      msg.textContent = solved() ? `Solved in ${moves} moves! 🎉` : `Moves: ${moves}`;
    };
    reset();
  },
});

BG.add({
  id: 'codebreaker', name: 'Code Breaker', icon: '🎯',
  desc: 'Crack the secret 4-colour code.',
  how: 'Pick 4 colours and Submit. ● = right colour, right place; ○ = right colour, wrong place. 10 tries.',
  play(el) {
    const C = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    let code, rows, cur;
    const board = h('div', {class: 'cb-board'}), pal = h('div', {class: 'row-btns'}), msg = h('div', {class: 'msg'});
    el.append(board, pal, msg);
    const peg = c => h('span', {class: 'peg', style: c == null ? null : `background:${C[c]}`});
    const fb = g => {
      let b = 0, w = 0; const a = {}, s = {};
      g.forEach((v, i) => { if (v === code[i]) b++; else { a[v] = (a[v] || 0) + 1; s[code[i]] = (s[code[i]] || 0) + 1; } });
      for (const k in a) w += Math.min(a[k], s[k] || 0);
      return [b, w];
    };
    const won = () => rows.length > 0 && fb(rows.at(-1))[0] === 4;
    const reset = () => { code = Array.from({length: 4}, () => Math.floor(Math.random() * C.length)); rows = []; cur = []; draw(); };
    const draw = () => {
      const done = won() || rows.length >= 10;
      board.replaceChildren(...rows.map(g => { const [b, w] = fb(g); return h('div', {class: 'cb-row'}, g.map(peg), h('span', {class: 'fb'}, '●'.repeat(b) + '○'.repeat(w))); }),
        done ? h('div', {class: 'cb-row'}, code.map(peg), h('span', {class: 'fb'}, 'secret')) : h('div', {class: 'cb-row cur'}, [0, 1, 2, 3].map(i => peg(cur[i]))));
      pal.replaceChildren(...(done ? [h('button', {class: 'primary', onclick: reset}, 'Play again')] : [
        ...C.map((col, c) => h('button', {class: 'peg big', style: `background:${col}`, 'aria-label': 'colour ' + (c + 1), onclick: () => { if (cur.length < 4) { cur.push(c); draw(); } }})),
        h('button', {onclick: () => { cur.pop(); draw(); }}, '⌫'),
        h('button', {class: 'primary', onclick: () => { if (cur.length === 4) { rows.push(cur); cur = []; draw(); } }}, 'Submit')]));
      msg.textContent = won() ? `Cracked in ${rows.length}! 🎉` : done ? 'Out of tries!' : `Try ${rows.length + 1} of 10`;
    };
    reset();
  },
});

BG.add({
  id: '2048', name: '2048', icon: '🔷',
  desc: 'Merge tiles to reach 2048.',
  how: 'Arrow keys or swipe. Two equal tiles merge into one.',
  play(el) {
    let g, score;
    const board = h('div', {class: 'g2-grid'}), info = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game')), board, info);
    const lines = d => [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => ({L: i * 4 + j, R: i * 4 + 3 - j, U: j * 4 + i, D: (3 - j) * 4 + i})[d]));
    const add = () => { const e = g.map((v, i) => (v ? -1 : i)).filter(i => i >= 0); if (e.length) g[e[Math.floor(Math.random() * e.length)]] = Math.random() < 0.9 ? 2 : 4; };
    const move = d => {
      let moved = false;
      for (const line of lines(d)) {
        const v = line.map(k => g[k]).filter(Boolean), out = [];
        for (let i = 0; i < v.length; i++) if (v[i] === v[i + 1]) { out.push(v[i] * 2); score += v[i] * 2; i++; } else out.push(v[i]);
        line.forEach((k, i) => { const n = out[i] || 0; if (g[k] !== n) moved = true; g[k] = n; });
      }
      if (moved) { add(); draw(); }
    };
    const stuck = () => !g.includes(0) && !g.some((v, i) => (i % 4 < 3 && v === g[i + 1]) || (i < 12 && v === g[i + 4]));
    const reset = () => { g = Array(16).fill(0); score = 0; add(); add(); draw(); };
    const draw = () => {
      board.replaceChildren(...g.map(v => h('div', {class: 'g2-tile v' + Math.min(v, 4096)}, v || '')));
      info.textContent = `Score: ${score} · Best: ${BG.best('2048', score)}` + (stuck() ? ' · Game over!' : g.some(v => v >= 2048) ? ' · 2048! 🎉' : '');
    };
    BG.keys(e => { const d = {ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D'}[e.key]; if (d) { e.preventDefault(); move(d); } });
    let sx = 0, sy = 0;
    board.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive: true});
    board.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 25) move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
    });
    reset();
  },
});

BG.add({
  id: 'memory', name: 'Memory Match', icon: '🃏',
  desc: 'Find all the matching pairs.',
  play(el) {
    const E = ['🍎', '🚀', '🎸', '🐙', '🌵', '⚽', '🎲', '🦉'];
    let cards, up, matched, moves, lock;
    const grid = h('div', {class: 'mm-grid'}), msg = h('div', {class: 'msg'});
    el.append(h('div', {class: 'row-btns'}, h('button', {onclick: () => reset()}, 'New game')), grid, msg);
    const reset = () => { cards = BG.shuffle([...E, ...E]); up = []; matched = new Set(); moves = 0; lock = false; draw(); };
    const flip = i => {
      if (lock || up.includes(i) || matched.has(i)) return;
      up.push(i);
      if (up.length === 2) {
        moves++;
        const [a, b] = up;
        if (cards[a] === cards[b]) { matched.add(a).add(b); up = []; }
        else { lock = true; BG.later(() => { up = []; lock = false; draw(); }, 800); }
      }
      draw();
    };
    const draw = () => {
      grid.replaceChildren(...cards.map((c, i) => {
        const show = up.includes(i) || matched.has(i);
        return h('button', {class: 'mm-card' + (show ? ' up' : '') + (matched.has(i) ? ' ok' : ''), onclick: () => flip(i)}, show ? c : '');
      }));
      msg.textContent = matched.size === cards.length ? `All pairs in ${moves} moves! Best: ${BG.best('memory', moves, true)} 🎉` : `Moves: ${moves}`;
    };
    reset();
  },
});

BG.add({
  id: 'mathsprint', name: 'Math Sprint', icon: '➗',
  desc: 'Solve as many sums as you can in 60 seconds.',
  how: 'Type the answer; it is accepted automatically when right.',
  play(el) {
    let q, score, left;
    const box = h('div', {class: 'mt-box'});
    el.append(box);
    const next = () => {
      const op = '+-×÷'[Math.floor(Math.random() * 4)], r = n => 1 + Math.floor(Math.random() * n);
      let a = r(50), b = r(50);
      if (op === '-' && b > a) [a, b] = [b, a];
      if (op === '×') { a = r(12); b = r(12); }
      if (op === '÷') { b = r(12); a = b * r(12); }
      q = {t: `${a} ${op} ${b}`, v: op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a / b};
    };
    const intro = text => box.replaceChildren(h('p', {}, text || 'Ready?'), h('button', {class: 'primary', onclick: go}, text ? 'Play again' : 'Start'));
    const go = () => {
      score = 0; left = 60; next();
      const qEl = h('div', {class: 'big'}, q.t), inp = h('input', {inputmode: 'numeric', autocomplete: 'off'}), stat = h('p');
      const upd = () => { stat.textContent = `⏱ ${left}s · Score ${score}`; };
      inp.addEventListener('input', () => {
        if (inp.value.trim() !== '' && +inp.value === q.v) { score++; next(); qEl.textContent = q.t; inp.value = ''; upd(); }
      });
      box.replaceChildren(qEl, inp, stat);
      inp.focus(); upd();
      const stop = BG.every(() => {
        left--; upd();
        if (left <= 0) { stop(); intro(`Time! Score: ${score} · Best: ${BG.best('mathsprint', score)}`); }
      }, 1000);
    };
    intro();
  },
});

BG.add({
  id: 'simon', name: 'Simon Says', icon: '🔴',
  desc: 'Repeat the growing colour sequence.',
  play(el) {
    const F = [392, 330, 262, 196];
    let seq = null, pos = 0, busy = true, ac;
    const pads = ['green', 'red', 'yellow', 'blue'].map((c, i) => h('button', {class: 'si-pad ' + c, 'aria-label': c, onclick: () => tap(i)}));
    const msg = h('div', {class: 'msg'}, 'Press Start');
    el.append(h('div', {class: 'si-board'}, pads), msg, h('div', {class: 'row-btns'}, h('button', {class: 'primary', onclick: () => { seq = []; round(); }}, 'Start')));
    const flash = i => {
      pads[i].classList.add('lit');
      BG.later(() => pads[i].classList.remove('lit'), 300);
      try {
        ac = ac || new AudioContext();
        const o = ac.createOscillator(), gn = ac.createGain();
        o.frequency.value = F[i]; gn.gain.value = 0.1;
        o.connect(gn).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.25);
      } catch {}
    };
    const round = () => {
      seq.push(Math.floor(Math.random() * 4)); pos = 0; busy = true;
      msg.textContent = `Round ${seq.length}`;
      seq.forEach((v, k) => BG.later(() => flash(v), 600 + k * 550));
      BG.later(() => { busy = false; }, 600 + seq.length * 550);
    };
    const tap = i => {
      if (busy || !seq) return;
      flash(i);
      if (i !== seq[pos]) {
        const s = seq.length - 1;
        seq = null;
        msg.textContent = `Game over! Score: ${s} · Best: ${BG.best('simon', s)}`;
      } else if (++pos === seq.length) { busy = true; BG.later(round, 700); }
    };
  },
});
