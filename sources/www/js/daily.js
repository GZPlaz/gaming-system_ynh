'use strict';
// Daily games: puzzles come from the admin panel via api/daily/<id>.

BG.add({
  id: 'wordle', name: 'Wordle', icon: '🟩', daily: true,
  desc: 'Guess the hidden word in six tries.',
  how: 'Type a guess and press Enter. Green = right spot, yellow = in the word, grey = not in it.',
  async play(el) {
    const p = await BG.daily('wordle', el); if (!p) return;
    const W = p.data.word, N = W.length, K = 'wordle:' + p.date, ROWS = 6;
    const st = BG.store.get(K, {guesses: []});
    let cur = '';
    const score = g => {
      const r = Array(N).fill('absent'), left = {};
      for (let i = 0; i < N; i++) if (g[i] === W[i]) r[i] = 'correct'; else left[W[i]] = (left[W[i]] || 0) + 1;
      for (let i = 0; i < N; i++) if (r[i] !== 'correct' && left[g[i]] > 0) { r[i] = 'present'; left[g[i]]--; }
      return r;
    };
    const finished = () => st.guesses.includes(W) || st.guesses.length >= ROWS;
    const board = h('div', {class: 'wd-board', style: `--n:${N}`}), msg = h('div', {class: 'msg'}), kb = h('div', {class: 'kb'});
    el.append(board, msg, kb);
    const draw = () => {
      board.replaceChildren(...Array.from({length: ROWS}, (_, r) => {
        const g = st.guesses[r] ?? (r === st.guesses.length ? cur : ''), sc = st.guesses[r] && score(g);
        return h('div', {class: 'row'}, Array.from({length: N}, (_, c) => h('div', {class: 'tile ' + (sc ? sc[c] : g[c] ? 'filled' : '')}, g[c] || '')));
      }));
      const best = {}, rank = {absent: 1, present: 2, correct: 3};
      st.guesses.forEach(g => score(g).forEach((s, i) => { if ((rank[best[g[i]]] || 0) < rank[s]) best[g[i]] = s; }));
      kb.replaceChildren(...['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'].map(row => h('div', {},
        [...row].map(k => h('button', {class: 'key ' + (best[k] || '') + ('⏎⌫'.includes(k) ? ' wide' : ''), onclick: () => press(k)}, k)))));
      if (!finished()) return;
      const won = st.guesses.includes(W);
      const grid = st.guesses.map(g => score(g).map(s => ({correct: '🟩', present: '🟨', absent: '⬛'})[s]).join('')).join('\n');
      msg.replaceChildren(won ? `Solved in ${st.guesses.length}/${ROWS}! 🎉 ` : `The word was ${W}. `,
        h('button', {onclick: () => BG.share(`Wordle #${p.number} ${won ? st.guesses.length : 'X'}/${ROWS}\n${grid}`)}, 'Share'));
    };
    const press = k => {
      if (finished()) return;
      if (k === '⏎' || k === 'ENTER') {
        if (cur.length < N) return BG.toast('Not enough letters');
        st.guesses.push(cur); cur = '';
        BG.store.set(K, st);
        if (finished()) BG.done('wordle', p.date);
      } else if (k === '⌫' || k === 'BACKSPACE') cur = cur.slice(0, -1);
      else if (/^[A-Z]$/.test(k) && cur.length < N) cur += k;
      draw();
    };
    BG.keys(e => press(e.key.toUpperCase()));
    draw();
  },
});

BG.add({
  id: 'connections', name: 'Connections', icon: '🔗', daily: true,
  desc: 'Find four groups of four related words.',
  how: 'Select four words that share something, then Submit. You can make four mistakes.',
  async play(el) {
    const p = await BG.daily('connections', el); if (!p) return;
    const G = p.data.groups, K = 'connections:' + p.date, COL = ['🟨', '🟩', '🟦', '🟪'];
    const st = BG.store.get(K, {solved: [], mistakes: 0, hist: []});
    const groupOf = w => G.findIndex(g => g.words.includes(w));
    const over = () => st.solved.length === 4 || st.mistakes >= 4;
    let order = BG.shuffle(G.flatMap(g => g.words));
    const sel = new Set();
    const top = h('div'), grid = h('div', {class: 'cn-grid'}), info = h('div', {class: 'msg'}), ctl = h('div', {class: 'row-btns'});
    el.append(top, grid, info, ctl);
    const draw = () => {
      const shown = over() ? [...st.solved, ...[0, 1, 2, 3].filter(i => !st.solved.includes(i))] : st.solved;
      top.replaceChildren(...shown.map(i => h('div', {class: 'cn-group c' + i}, h('b', {}, G[i].name), h('span', {}, G[i].words.join(', ')))));
      grid.replaceChildren(...(over() ? [] : order.filter(w => !st.solved.includes(groupOf(w))).map(w =>
        h('button', {class: 'cn-word' + (sel.has(w) ? ' sel' : ''), onclick: () => { if (sel.has(w)) sel.delete(w); else if (sel.size < 4) sel.add(w); draw(); }}, w))));
      info.replaceChildren(!over() ? 'Mistakes left: ' + '●'.repeat(4 - st.mistakes) : st.solved.length === 4 ? 'Perfect! 🎉 ' : 'Next time! ',
        over() && h('button', {onclick: () => BG.share(`Connections #${p.number}\n` + st.hist.map(r => r.map(i => COL[i]).join('')).join('\n'))}, 'Share'));
      ctl.replaceChildren(...(over() ? [] : [
        h('button', {onclick: () => { order = BG.shuffle(order); draw(); }}, 'Shuffle'),
        h('button', {onclick: () => { sel.clear(); draw(); }}, 'Deselect'),
        h('button', {class: 'primary', disabled: sel.size !== 4, onclick: submit}, 'Submit')]));
    };
    const submit = () => {
      const ids = [...sel].map(groupOf);
      st.hist.push(ids);
      if (ids.every(i => i === ids[0])) { st.solved.push(ids[0]); sel.clear(); }
      else {
        st.mistakes++;
        if ([0, 1, 2, 3].some(g => ids.filter(i => i === g).length === 3)) BG.toast('One away…');
      }
      if (over()) BG.done('connections', p.date);
      BG.store.set(K, st);
      draw();
    };
    draw();
  },
});

BG.add({
  id: 'scramble', name: 'Word Scramble', icon: '🔀', daily: true,
  desc: 'Unscramble today’s words.',
  how: 'Rearrange the letters to find each word. Hints are free; Reveal gives up that word.',
  async play(el) {
    const p = await BG.daily('scramble', el); if (!p) return;
    const K = 'scramble:' + p.date, st = BG.store.get(K, {res: {}}), rnd = BG.rng(p.date);
    const items = p.data.words.map((w, i) => {
      let s = w.word;
      for (let t = 0; t < 10 && s === w.word; t++) s = BG.shuffle([...w.word], rnd).join('');
      return {...w, s, i};
    });
    const list = h('div', {class: 'sc-list'}), msg = h('div', {class: 'msg'});
    el.append(list, msg);
    const save = () => {
      BG.store.set(K, st);
      if (Object.keys(st.res).length === items.length) BG.done('scramble', p.date);
      draw();
    };
    const draw = () => {
      list.replaceChildren(...items.map(it => {
        const r = st.res[it.i];
        if (r) return h('div', {class: 'sc-item ' + r}, h('b', {}, it.word), r === 'solved' ? ' ✓' : ' (revealed)');
        const inp = h('input', {placeholder: 'Your answer', maxlength: it.word.length, autocomplete: 'off', autocapitalize: 'characters'});
        const hint = h('small', {class: 'hint'});
        const check = () => {
          if (inp.value.trim().toUpperCase() === it.word) { st.res[it.i] = 'solved'; save(); }
          else { BG.toast('Not quite'); inp.select(); }
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
        return h('div', {class: 'sc-item'}, h('div', {class: 'letters'}, it.s), inp, h('button', {class: 'primary', onclick: check}, 'Check'),
          it.hint && h('button', {onclick: () => { hint.textContent = '💡 ' + it.hint; }}, 'Hint'),
          h('button', {onclick: () => { st.res[it.i] = 'revealed'; save(); }}, 'Reveal'), hint);
      }));
      const res = Object.values(st.res);
      msg.textContent = res.length === items.length ? `Done! ${res.filter(r => r === 'solved').length}/${items.length} solved.` : '';
    };
    draw();
  },
});

BG.add({
  id: 'riddle', name: 'Daily Riddle', icon: '❓', daily: true,
  desc: 'One riddle a day, three guesses.',
  async play(el) {
    const p = await BG.daily('riddle', el); if (!p) return;
    const K = 'riddle:' + p.date, st = BG.store.get(K, {tries: []});
    const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/^(a|an|the) /, '').replace(/\s+/g, ' ').trim();
    const ok = s => { const n = norm(s); return !!n && p.data.answers.some(a => norm(a) === n); };
    const box = h('div');
    el.append(h('blockquote', {class: 'riddle'}, p.data.question), box);
    const draw = () => {
      const won = st.tries.some(ok);
      if (won || st.tries.length >= 3) {
        BG.done('riddle', p.date);
        return box.replaceChildren(h('p', {class: 'msg'}, won ? `Correct! 🎉 (${st.tries.length}/3)` : `The answer was: ${p.data.answers[0]}`));
      }
      const inp = h('input', {placeholder: 'Your answer', autocomplete: 'off'});
      const go = () => {
        if (!inp.value.trim()) return;
        st.tries.push(inp.value.trim());
        BG.store.set(K, st);
        if (!ok(inp.value)) BG.toast('Nope!');
        draw();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      box.replaceChildren(h('div', {class: 'row-btns'}, inp, h('button', {class: 'primary', onclick: go}, 'Guess')),
        h('p', {}, `Guesses left: ${3 - st.tries.length}`),
        st.tries.length > 0 && h('p', {class: 'sub'}, 'Tried: ' + st.tries.join(', ')),
        st.tries.length > 0 && p.data.hint && h('p', {class: 'hint'}, '💡 ' + p.data.hint));
      inp.focus();
    };
    draw();
  },
});
