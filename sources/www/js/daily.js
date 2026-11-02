'use strict';
// Daily games: puzzles come from the admin panel via api/daily/<id>.

BG.add({
  id: 'wordle', name: 'Wordle', icon: '🟩', daily: true,
  desc: 'Guess the hidden word in six tries.',
  how: 'Type a word and press Enter. After each guess the tiles change colour: 🟩 right letter in the right spot, 🟨 in the word but in another spot, ⬛ not in the word.',
  async play(el) {
    const p = await BG.daily('wordle', el); if (!p) return;
    const W = p.data.word, N = W.length, K = 'wordle:' + p.date, ROWS = 6, TITLES = ['Genius!', 'Magnificent!', 'Impressive!', 'Splendid!', 'Great!', 'Phew!'];
    const st = BG.store.get(K, {guesses: []});
    let cur = '', reveal = -1, win = -1, pop = false, busy = false;
    const score = g => {
      const r = Array(N).fill('absent'), left = {};
      for (let i = 0; i < N; i++) if (g[i] === W[i]) r[i] = 'correct'; else left[W[i]] = (left[W[i]] || 0) + 1;
      for (let i = 0; i < N; i++) if (r[i] !== 'correct' && left[g[i]] > 0) { r[i] = 'present'; left[g[i]]--; }
      return r;
    };
    const won = () => st.guesses.includes(W);
    const finished = () => won() || st.guesses.length >= ROWS;
    const shareText = () => `Wordle #${p.number} ${won() ? st.guesses.length : 'X'}/${ROWS}\n`
      + st.guesses.map(g => score(g).map(s => ({correct: '🟩', present: '🟨', absent: '⬛'})[s]).join('')).join('\n');
    const board = h('div', {class: 'wd-board', style: `--n:${N}`}), msg = h('div', {class: 'msg'}), kb = h('div', {class: 'kb'});
    el.append(board, msg, kb);
    const draw = () => {
      board.replaceChildren(Array.from({length: ROWS}, (_, r) => {
        const g = st.guesses[r] ?? (r === st.guesses.length ? cur : ''), sc = st.guesses[r] && score(g);
        return h('div', {class: 'row'}, Array.from({length: N}, (_, c) => {
          let cls = 'tile';
          if (sc) cls += ' ' + sc[c] + (r === reveal ? ' flip' : r === win ? ' bounce' : '');
          else if (g[c]) cls += ' filled' + (pop && c === cur.length - 1 ? ' pop' : '');
          const delay = r === reveal ? c * 0.25 : r === win ? c * 0.1 : null;
          return h('div', {class: cls, style: delay == null ? null : `animation-delay:${delay}s`}, g[c] || '');
        }));
      }));
      // keyboard colours wait until the reveal animation is over
      const best = {}, rank = {absent: 1, present: 2, correct: 3};
      (reveal >= 0 ? st.guesses.slice(0, -1) : st.guesses).forEach(g => score(g).forEach((s, i) => { if ((rank[best[g[i]]] || 0) < rank[s]) best[g[i]] = s; }));
      kb.replaceChildren(['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'].map(row => h('div', {},
        [...row].map(k => h('button', {class: 'key ' + (best[k] || '') + ('⏎⌫'.includes(k) ? ' wide' : ''), 'aria-label': {'⏎': 'Enter', '⌫': 'Backspace'}[k] || k, onclick: () => press(k)},
          k === '⏎' ? 'ENTER' : k)))));
      msg.replaceChildren(finished() && !busy ? [won() ? '' : `The word was ${W}`, h('button', {class: 'primary', onclick: () => BG.share(shareText())}, 'Share result')] : '');
      reveal = win = -1; pop = false;
    };
    const press = k => {
      if (finished() || busy) return;
      if (k === '⏎' || k === 'ENTER') {
        if (cur.length < N) { BG.toast('Not enough letters'); board.children[st.guesses.length].classList.add('shake'); return; }
        st.guesses.push(cur); cur = '';
        BG.store.set(K, st);
        const row = st.guesses.length - 1, wait = N * 250 + 300;
        reveal = row; busy = true; draw();
        BG.later(() => { busy = false; if (won()) win = row; draw(); }, wait);
        if (finished()) {
          BG.done('wordle', p.date, {won: won(), delay: wait + 900, title: won() ? TITLES[row] : 'So close!',
            text: won() ? `You found ${W} in ${row + 1} of ${ROWS} guesses.` : `The word was ${W}.`, share: shareText()});
        }
        return;
      }
      if (k === '⌫' || k === 'BACKSPACE') cur = cur.slice(0, -1);
      else if (/^[A-Z]$/.test(k) && cur.length < N) { cur += k; pop = true; }
      else return;
      draw();
    };
    BG.keys(e => press(e.key.toUpperCase()));
    draw();
  },
});

BG.add({
  id: 'connections', name: 'Connections', icon: '🔗', daily: true,
  desc: 'Find four groups of four related words.',
  how: 'Select four words that share something in common and press Submit. Groups get trickier from 🟨 to 🟪. Watch out for words that seem to fit more than one group. You can make four mistakes.',
  async play(el) {
    const p = await BG.daily('connections', el); if (!p) return;
    const G = p.data.groups, K = 'connections:' + p.date, COL = ['🟨', '🟩', '🟦', '🟪'];
    const st = BG.store.get(K, {solved: [], mistakes: 0, hist: [], tried: []});
    st.tried ||= [];
    const groupOf = w => G.findIndex(g => g.words.includes(w));
    const won = () => st.solved.length === 4;
    const over = () => won() || st.mistakes >= 4;
    const shareText = () => `Connections #${p.number}\n` + st.hist.map(r => r.map(i => COL[i]).join('')).join('\n');
    let order = BG.shuffle(G.flatMap(g => g.words)), fresh = -1, shake = false;
    const sel = new Set();
    const solved = h('div', {class: 'cn-solved'}), grid = h('div', {class: 'cn-grid'}), info = h('div', {class: 'msg'}), ctl = h('div', {class: 'row-btns'});
    el.append(solved, grid, info, ctl);
    const draw = () => {
      const shown = over() ? [...st.solved, ...[0, 1, 2, 3].filter(i => !st.solved.includes(i))] : st.solved;
      solved.replaceChildren(shown.map(i => h('div', {class: `cn-group c${i}` + (i === fresh ? ' reveal' : '')}, h('b', {}, G[i].name), h('span', {}, G[i].words.join(', ')))));
      grid.replaceChildren(over() ? [] : order.filter(w => !st.solved.includes(groupOf(w))).map(w =>
        h('button', {class: 'cn-word' + (sel.has(w) ? ' sel' + (shake ? ' shake' : '') : ''),
          onclick: () => { if (sel.has(w)) sel.delete(w); else if (sel.size < 4) sel.add(w); draw(); }}, w)));
      info.replaceChildren(over()
        ? [won() ? (st.mistakes ? 'Solved!' : 'Perfect! 🎉') : 'Out of mistakes', h('button', {class: 'primary', onclick: () => BG.share(shareText())}, 'Share result')]
        : h('div', {class: 'mistakes'}, 'Mistakes remaining', h('span', {class: 'dots'}, [0, 1, 2, 3].map(i => h('i', {class: i < 4 - st.mistakes ? 'on' : ''})))));
      ctl.replaceChildren(over() ? [] : [
        h('button', {onclick: () => { order = BG.shuffle(order); draw(); }}, 'Shuffle'),
        h('button', {disabled: !sel.size, onclick: () => { sel.clear(); draw(); }}, 'Deselect all'),
        h('button', {class: 'primary', disabled: sel.size !== 4, onclick: submit}, 'Submit')]);
      fresh = -1; shake = false;
    };
    const submit = () => {
      const key = [...sel].sort().join(','), ids = [...sel].map(groupOf);
      if (st.tried.includes(key)) return BG.toast('Already guessed!');
      st.tried.push(key); st.hist.push(ids);
      if (ids.every(i => i === ids[0])) { st.solved.push(ids[0]); fresh = ids[0]; sel.clear(); }
      else {
        st.mistakes++; shake = true;
        BG.toast([0, 1, 2, 3].some(g => ids.filter(i => i === g).length === 3) ? 'One away…' : st.mistakes >= 4 ? 'Next time!' : 'Not quite');
      }
      BG.store.set(K, st);
      if (over()) {
        BG.done('connections', p.date, {won: won(), title: won() ? (st.mistakes ? 'Solved!' : 'Perfect!') : 'Next time!',
          text: won() ? `All four groups with ${st.mistakes} mistake${st.mistakes === 1 ? '' : 's'}.` : 'The groups are revealed on the board.', share: shareText()});
      }
      draw();
    };
    draw();
  },
});

BG.add({
  id: 'scramble', name: 'Word Scramble', icon: '🔀', daily: true,
  desc: 'Unscramble today’s words.',
  how: 'Rearrange the letters to find each word and press Check. Hints are free; Reveal gives up that word.',
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
    const count = () => Object.values(st.res).filter(r => r === 'solved').length;
    const save = () => {
      BG.store.set(K, st);
      if (Object.keys(st.res).length === items.length) {
        const n = count();
        BG.done('scramble', p.date, {won: n === items.length, title: `${n}/${items.length} unscrambled`, text: n === items.length ? 'Every word, no reveals. Sharp!' : 'Come back tomorrow for a new set.',
          share: `Word Scramble #${p.number} ${n}/${items.length}\n` + items.map(it => (st.res[it.i] === 'solved' ? '🟩' : '⬛')).join('')});
      }
      draw();
    };
    const draw = () => {
      list.replaceChildren(items.map(it => {
        const r = st.res[it.i];
        if (r) return h('div', {class: 'sc-item ' + r}, h('div', {class: 'letters'}, [...it.word].map(c => h('span', {}, c))), r === 'solved' ? '✓ Solved' : 'Revealed');
        const inp = h('input', {placeholder: `${it.word.length} letters`, maxlength: it.word.length, autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Your answer'});
        const hint = h('small', {class: 'hint'});
        const check = () => {
          if (inp.value.trim().toUpperCase() === it.word) { st.res[it.i] = 'solved'; save(); }
          else { BG.toast('Not quite'); inp.select(); }
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
        return h('div', {class: 'sc-item'}, h('div', {class: 'letters'}, [...it.s].map(c => h('span', {}, c))), inp,
          h('button', {class: 'primary', onclick: check}, 'Check'),
          it.hint && h('button', {onclick: () => { hint.textContent = '💡 ' + it.hint; }}, 'Hint'),
          h('button', {onclick: () => { st.res[it.i] = 'revealed'; save(); }}, 'Reveal'), hint);
      }));
      msg.textContent = Object.keys(st.res).length === items.length ? `${count()}/${items.length} solved` : '';
    };
    draw();
  },
});

BG.add({
  id: 'riddle', name: 'Daily Riddle', icon: '❓', daily: true,
  desc: 'One riddle a day, three guesses.',
  how: 'Read the riddle and type your answer. You get three guesses; a hint appears after your first miss.',
  async play(el) {
    const p = await BG.daily('riddle', el); if (!p) return;
    const K = 'riddle:' + p.date, st = BG.store.get(K, {tries: []});
    const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/^(a|an|the) /, '').replace(/\s+/g, ' ').trim();
    const ok = s => { const n = norm(s); return !!n && p.data.answers.some(a => norm(a) === n); };
    const box = h('div', {class: 'mt-box'});
    el.append(h('blockquote', {class: 'riddle'}, p.data.question), box);
    const draw = () => {
      const won = st.tries.some(ok), misses = st.tries.filter(t => !ok(t));
      const tried = misses.length > 0 && h('div', {class: 'tries'}, misses.map(t => h('span', {}, t)));
      if (won || st.tries.length >= 3) {
        BG.done('riddle', p.date, {won, title: won ? 'Correct!' : 'Stumped!', text: `The answer: ${p.data.answers[0]}.`,
          share: `Daily Riddle #${p.number} ${won ? st.tries.length : 'X'}/3`});
        return box.replaceChildren(h('div', {class: 'result-emoji'}, won ? '🎉' : '🤔'),
          h('p', {class: 'msg'}, won ? `Solved in ${st.tries.length}/3` : 'Out of guesses'), h('p', {}, 'Answer: ', h('b', {}, p.data.answers[0])), tried);
      }
      const inp = h('input', {placeholder: 'Your answer', autocomplete: 'off', 'aria-label': 'Your answer'});
      const go = () => {
        if (!inp.value.trim()) return;
        st.tries.push(inp.value.trim());
        BG.store.set(K, st);
        if (!ok(inp.value)) BG.toast(st.tries.length < 3 ? 'Not quite!' : 'Out of guesses');
        draw();
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      box.replaceChildren(h('div', {class: 'row-btns', style: 'width:100%'}, inp, h('button', {class: 'primary', onclick: go}, 'Guess')),
        h('p', {class: 'muted'}, `${3 - st.tries.length} guess${3 - st.tries.length === 1 ? '' : 'es'} left`), tried,
        misses.length > 0 && p.data.hint && h('p', {class: 'hint'}, '💡 ' + p.data.hint));
      inp.focus();
    };
    draw();
  },
});
