'use strict';
// Multiplayer: rooms live on the server; every phone long-polls for updates.
const MP = {
  async call(path, body, signal) {
    const r = await fetch('api/mp/' + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {cache: 'no-store', signal});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Connection problem'), {status: r.status});
    return j;
  },
  link(id, code) { return `${location.href.split('#')[0]}#/${id}/${code}`; },
  hue(name) { return [...name].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 360, 7); },
};

const mpGame = def => BG.add({id: def.id, name: def.name, icon: def.icon, desc: def.desc, how: def.how, mp: true, min: def.min,
  play: (el, code) => mpPlay(el, def, (code || '').toUpperCase())});

function mpPlay(el, def, code) {
  const token = code && BG.store.get('mp:' + code);
  if (token) mpRoom(el, def, code, token); else mpEntry(el, def, code);
}

function mpEntry(el, def, code, err) {
  const name = h('input', {placeholder: 'Your name', maxlength: 18, autocomplete: 'nickname', 'aria-label': 'Your name'});
  name.value = BG.store.get('mp:name', '');
  const codeIn = h('input', {class: 'code-input', placeholder: 'CODE', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Room code'});
  const go = async (path, body) => {
    const n = name.value.trim();
    if (!n) { BG.toast('Enter your name first'); return name.focus(); }
    BG.store.set('mp:name', n);
    try {
      const r = await MP.call(path, {...body, name: n});
      BG.store.set('mp:' + r.code, r.token);
      if (location.hash === `#/${r.game}/${r.code}`) mpPlay(el, def, r.code); else location.hash = `#/${r.game}/${r.code}`;
    } catch (x) { BG.toast(x.message, 2600); }
  };
  el.replaceChildren(h('div', {class: 'mp-entry'}, h('div', {class: 'result-emoji'}, def.icon),
    h('h2', {}, code ? `Join room ${code}` : 'Play with friends'),
    h('p', {class: 'muted'}, `Everyone plays on their own phone or tablet · ${def.min}+ players`), err && h('p', {class: 'err'}, err),
    h('label', {}, 'Your name', name),
    code ? h('button', {class: 'primary', onclick: () => go('join', {code})}, 'Join game')
      : [h('button', {class: 'primary', onclick: () => go('create', {game: def.id})}, 'Create a room'),
        h('div', {class: 'or'}, 'or join a friend’s room'),
        h('div', {class: 'join-row'}, codeIn, h('button', {onclick: () => go('join', {code: codeIn.value})}, 'Join'))]));
  if (!name.value) name.focus();
}

function mpRoom(el, def, code, token) {
  let v = null, since = -1, alive = true, ctl;
  const drafts = {}, local = {};
  BG.subs.push(() => { alive = false; if (ctl) ctl.abort(); });
  const act = async (action, data = {}) => {
    try { show(await MP.call('act', {code, token, action, ...data})); } catch (x) { BG.toast(x.message, 2600); }
  };
  const invite = () => {
    const url = MP.link(def.id, code), text = `Join my ${def.name} game! Room code: ${code}`;
    if (navigator.share) navigator.share({text, url}).catch(() => {});
    else (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => BG.toast('Invite link copied'), () => prompt('Invite link:', url));
  };
  const leave = async () => {
    if (!confirm('Leave this room?')) return;
    await MP.call('act', {code, token, action: 'leave'}).catch(() => {});
    BG.store.set('mp:' + code, null);
    location.hash = '#/';
  };
  const ui = {
    act, local,
    get me() { return v.me; },
    get host() { return v.host === v.me; },
    name: id => (v.players.find(p => p.id === id) || {}).name || 'Someone',
    // text inputs keep what you typed when other players' updates redraw the screen
    input(key, attrs = {}) {
      const i = h('input', {autocomplete: 'off', ...attrs, 'data-key': key});
      i.value = drafts[key] || '';
      i.addEventListener('input', () => { drafts[key] = i.value; });
      return i;
    },
    form(key, attrs, label, send) {
      const i = ui.input(key, attrs);
      const go = () => { if (i.value.trim()) send(i.value.trim()); };
      i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      return h('div', {class: 'join-row wide'}, i, h('button', {class: 'primary', onclick: go}, label));
    },
    timer: left => left == null ? null : h('span', {class: 'mp-timer', 'data-end': Date.now() + left * 1000}, `${left}s`),
    waiting: (n, of, what = 'answered') => h('p', {class: 'muted'}, `${n}/${of} ${what}`),
    board: () => h('div', {class: 'mp-board'}, [...v.players].sort((a, b) => b.score - a.score).map((p, k) => h('div', {class: 'mp-board-row' + (p.id === v.me ? ' me' : '')},
      h('span', {class: 'rank'}, ['🥇', '🥈', '🥉'][k] || k + 1), h('span', {class: 'avatar', style: `--hue:${MP.hue(p.name)}`}, p.name[0].toUpperCase()), h('b', {}, p.name), h('span', {}, p.score)))),
    hostNext: (label, action = 'next') => ui.host ? h('button', {class: 'primary', onclick: () => act(action)}, label) : h('p', {class: 'muted'}, 'Waiting for the host…'),
    final: () => [h('div', {class: 'result-emoji'}, '🏆'), h('h2', {}, 'Final scores'), ui.board(),
      ui.host ? h('div', {class: 'row-btns'}, h('button', {class: 'primary', onclick: () => act('start')}, 'Play again'), h('button', {onclick: () => act('lobby')}, 'Back to lobby'))
        : h('p', {class: 'muted'}, 'Waiting for the host…')],
    rerender: () => render(),
  };
  const settings = editable => h('div', {class: 'mp-settings'}, v.schema.map(s => {
    const cur = v.settings[s.key], all = s.options.map(o => o[0]);
    const set = value => act('settings', {key: s.key, value});
    return h('div', {class: 'set-row'}, h('span', {class: 'set-label'}, s.label,
      s.multi && editable ? h('button', {class: 'set-all', onclick: () => set(cur.length === all.length ? [] : all)}, cur.length === all.length ? 'Clear' : 'All') : null),
    h('div', {class: 'seg' + (s.multi ? ' multi' : '')}, s.options.map(([val, label]) => {
      const on = s.multi ? cur.includes(val) : cur === val;
      return h('button', {class: on ? 'on' : '', disabled: !editable, 'aria-pressed': on,
        onclick: () => set(s.multi ? (on ? cur.filter(x => x !== val) : [...cur, val]) : val)}, label);
    })), s.multi && !cur.length ? h('small', {class: 'muted'}, 'None picked, so all are used') : null);
  }));
  const lobby = () => {
    const n = v.players.length, need = v.min - n;
    return [h('div', {class: 'result-emoji'}, def.icon), h('h2', {}, 'Waiting for players'),
      h('p', {class: 'muted'}, 'Friends join with code ', h('b', {class: 'code-big'}, v.code), ' or your invite link.'),
      h('div', {class: 'mp-roster'}, v.players.map(p => h('div', {class: 'mp-roster-item'},
        h('span', {class: 'avatar', style: `--hue:${MP.hue(p.name)}`}, p.name[0].toUpperCase()), p.name, p.id === v.host ? ' 👑' : '', p.id === v.me ? h('small', {}, ' (you)') : ''))),
      h('div', {class: 'row-btns'}, h('button', {onclick: invite}, '📨 Invite friends'),
        ui.host ? h('button', {class: 'primary', disabled: need > 0, onclick: () => act('start')}, need > 0 ? `Need ${need} more player${need === 1 ? '' : 's'}` : 'Start game') : null),
      !ui.host && h('p', {class: 'muted'}, 'Waiting for the host to start…'),
      v.schema.length ? h('div', {class: 'set-box'}, h('h3', {}, ui.host ? '⚙️ Game settings' : '⚙️ Settings (host picks)'), settings(ui.host)) : null];
  };
  const render = () => {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    el.replaceChildren(
      h('div', {class: 'mp-head'}, h('button', {class: 'mp-code', title: 'Invite friends', onclick: invite}, h('small', {}, 'ROOM'), h('b', {}, v.code)),
        h('div', {class: 'mp-players'}, v.players.map(p => h('span', {class: 'mp-player' + (p.id === v.me ? ' me' : '') + (p.online ? '' : ' away'), title: p.online ? '' : 'Away'},
          p.id === v.host ? '👑 ' : '', p.name, v.phase !== 'lobby' ? h('b', {}, p.score) : null)))),
      h('div', {class: 'mp-body'}, v.phase === 'lobby' ? lobby() : def.render(v, ui)),
      ui.host && v.phase !== 'lobby' && v.schema.length ? h('details', {class: 'set-box', open: local.settingsOpen || null, ontoggle: e => { local.settingsOpen = e.target.open; }},
        h('summary', {}, '⚙️ Settings', h('small', {class: 'muted'}, ' · changes apply from the next round')), settings(true)) : null,
      h('div', {class: 'row-btns mp-foot'}, ui.host && v.phase !== 'lobby' ? h('button', {onclick: () => act('lobby')}, 'Back to lobby') : null, h('button', {onclick: leave}, 'Leave room')));
    if (focused) {
      const i = el.querySelector(`[data-key="${focused}"]`);
      if (i) i.focus();
    }
  };
  const show = nv => {
    if (!alive || (v && nv.version <= v.version)) return;
    v = nv;
    render();
  };
  BG.every(() => el.querySelectorAll('.mp-timer').forEach(t => {
    const s = Math.max(0, Math.ceil((t.dataset.end - Date.now()) / 1000));
    t.textContent = s + 's';
    t.classList.toggle('low', s <= 5);
  }), 250);
  el.replaceChildren(h('p', {class: 'muted'}, 'Connecting…'));
  (async () => {
    while (alive) {
      ctl = new AbortController();
      try {
        show(await MP.call(`state?code=${code}&token=${encodeURIComponent(token)}&since=${v ? v.version : since}`, null, ctl.signal));
      } catch (x) {
        if (!alive) return;
        if (x.status === 400) { BG.store.set('mp:' + code, null); return mpEntry(el, def, '', x.message); }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  })();
}

const optButtons = (v, ui, choose, mine) => h('div', {class: 'tv-opts'}, v.options.map((o, k) => h('button', {
  class: (v.correct != null ? (k === v.correct ? 'correct' : k === mine ? 'wrong' : '') : k === mine ? 'chosen' : ''),
  disabled: v.correct == null && mine != null && k !== mine, onclick: () => { if (mine == null && v.correct == null) choose(k); }},
o, v.counts ? h('small', {class: 'opt-count'}, `${v.counts[k]} 👤`) : null)));

mpGame({
  id: 'imposter', name: 'Imposter', icon: '🕵️', min: 3,
  desc: 'Everyone knows the secret word, except the imposter.',
  how: 'Everyone gets the same secret word, except one imposter who only sees the category. Take turns giving a one-word clue (twice around), without making it too obvious. Then vote for who you think is faking it. If the imposter is caught, they get one guess at the word to steal the win.',
  render(v, ui) {
    const out = [];
    if (v.role && v.phase !== 'reveal') {
      const open = ui.local.reveal;
      out.push(h('button', {class: 'role-card ' + (open ? v.role : 'hidden'), onclick: () => { ui.local.reveal = !open; ui.rerender(); }},
        !open ? [h('b', {}, '👆 Tap to see your role'), h('span', {}, 'Keep your screen hidden from others')]
          : v.role === 'imposter' ? [h('small', {}, 'You are the'), h('b', {}, 'IMPOSTER 🕵️'),
            h('span', {}, v.category ? `Category: ${v.category} · blend in!` : 'No hints this time. Listen closely!'),
            v.partner && v.partner.length ? h('span', {}, `Your partner: ${v.partner.join(', ')}`) : null]
            : [h('small', {}, `Category: ${v.category}`), h('b', {}, v.word), h('span', {}, 'Tap to hide')]));
    } else if (!v.role && v.phase !== 'reveal') out.push(h('p', {class: 'muted'}, '👀 You joined mid-round. You can play from the next round.'));
    if (v.phase === 'clues') {
      out.push(h('div', {class: 'mp-list'}, v.clues.length ? v.clues.map(c => h('div', {class: 'mp-row'}, h('b', {}, c.name), h('span', {}, c.text)))
        : h('p', {class: 'muted'}, 'No clues yet.')), ui.waiting(v.clues.length, v.cluesNeeded, 'clues'));
      if (v.turn === ui.me) out.push(h('p', {class: 'msg'}, 'Your turn! Give a one-word clue.'), ui.form('clue' + v.clues.length, {placeholder: 'Your clue', maxlength: 30}, 'Send', t => ui.act('clue', {text: t})));
      else out.push(h('p', {class: 'msg'}, `${ui.name(v.turn)} is thinking of a clue…`));
      if (ui.host) out.push(h('button', {onclick: () => ui.act('vote_now')}, 'Skip to voting'));
    } else if (v.phase === 'vote') {
      out.push(h('div', {class: 'mp-list'}, v.clues.map(c => h('div', {class: 'mp-row'}, h('b', {}, c.name), h('span', {}, c.text)))),
        h('h2', {}, 'Who is the imposter?'),
        v.role ? h('div', {class: 'mp-vote'}, v.order.filter(p => p.id !== ui.me).map(p => h('button', {class: v.myVote === p.id ? 'primary' : '', onclick: () => ui.act('vote', {target: p.id})}, p.name)))
          : null, ui.waiting(v.voted.length, v.order.length, 'voted'));
    } else if (v.phase === 'guess') {
      out.push(h('div', {class: 'result-emoji'}, '🚨'), h('h2', {}, `${v.accused} was caught!`));
      if (v.guesser) out.push(h('p', {}, 'Last chance: guess the secret word to steal the win.'), ui.form('guess', {placeholder: 'The secret word is…'}, 'Guess', t => ui.act('guess', {text: t})));
      else out.push(h('p', {class: 'muted'}, 'They get one guess at the secret word…'));
    } else if (v.phase === 'reveal') {
      const story = v.caught ? (v.impWins ? `${v.accused} was caught, but guessed the word!` : `You caught ${v.accused}!`)
        : v.accused ? `You voted out ${v.accused}, but they were innocent.` : 'The vote was tied, so the imposter slipped away.';
      out.push(h('div', {class: 'result-emoji'}, v.impWins ? '🕵️' : '🎉'), h('h2', {}, v.impWins ? 'The imposter wins!' : 'The crew wins!'), h('p', {}, story),
        h('p', {}, 'The word was ', h('b', {}, v.word), ` (${v.category}). ${v.imposter.includes(' & ') ? 'The imposters were' : 'The imposter was'} `, h('b', {}, v.imposter), '.'),
        v.guess ? h('p', {class: 'muted'}, `Their guess: “${v.guess}”`) : null,
        v.tally.length ? h('div', {class: 'mp-list'}, v.tally.map(t => h('div', {class: 'mp-row'}, h('b', {}, t.name), h('span', {}, `${t.votes} vote${t.votes === 1 ? '' : 's'}`)))) : null,
        ui.board(), ui.hostNext('Next round', 'start'));
      ui.local.reveal = false;
    }
    return out;
  },
});

mpGame({
  id: 'triviarace', name: 'Trivia Race', icon: '⚡', min: 2,
  desc: 'Same question, everyone at once. Fastest right answer wins.',
  how: 'Everyone sees the same question at the same time. Answer correctly for 500 points, plus up to 500 more for answering fast. 10 questions, 20 seconds each.',
  render(v, ui) {
    if (v.phase === 'final') return ui.final();
    const out = [h('div', {class: 'mp-qhead'}, h('span', {}, `Question ${v.n} of ${v.total}`), v.phase === 'question' ? ui.timer(v.left) : null),
      h('blockquote', {class: 'riddle'}, v.q), optButtons(v, ui, k => ui.act('answer', {choice: k}), v.mine)];
    if (v.phase === 'question') out.push(v.mine != null ? h('p', {class: 'msg'}, 'Answer locked in!') : null, ui.waiting(v.answered, v.of));
    else out.push(h('p', {class: 'msg'}, v.mine === v.correct ? `✅ +${v.pts} points` : v.mine == null ? '⏰ Too slow!' : '❌ No points this time'),
      ui.board(), ui.hostNext(v.n === v.total ? 'See final scores' : 'Next question'));
    return out;
  },
});

mpGame({
  id: 'estimate', name: 'Closest Wins', icon: '📏', min: 2,
  desc: 'Guess the number. Closest guess takes the points.',
  how: 'Everyone guesses a number for the same question. Closest gets 3 points, second 2, third 1, and an exact answer earns 2 bonus points. 7 rounds, 30 seconds each.',
  render(v, ui) {
    if (v.phase === 'final') return ui.final();
    const fmt = n => Number(n).toLocaleString();
    const out = [h('div', {class: 'mp-qhead'}, h('span', {}, `Round ${v.n} of ${v.total}`), v.phase === 'question' ? ui.timer(v.left) : null),
      h('blockquote', {class: 'riddle'}, v.q, v.unit ? h('small', {class: 'unit'}, `Answer in ${v.unit}`) : null)];
    if (v.phase === 'question') {
      if (v.mine != null) out.push(h('p', {class: 'msg'}, `Your guess: ${fmt(v.mine)}`), h('p', {class: 'muted'}, 'You can change it until time runs out.'));
      out.push(ui.form('est' + v.n, {inputmode: 'decimal', placeholder: 'Your guess'}, v.mine != null ? 'Change' : 'Lock in', t => ui.act('guess', {value: t})), ui.waiting(v.answered, v.of, 'guessed'));
    } else {
      out.push(h('div', {class: 'answer-big'}, h('small', {}, 'The answer'), h('b', {}, fmt(v.answer)), v.unit ? h('span', {}, v.unit) : null),
        h('div', {class: 'mp-list'}, v.ranked.map(r => h('div', {class: 'mp-row'}, h('b', {}, r.name), h('span', {}, fmt(r.guess)), h('span', {class: 'pts'}, r.pts ? `+${r.pts}` : '')))),
        ui.board(), ui.hostNext(v.n === v.total ? 'See final scores' : 'Next round'));
    }
    return out;
  },
});

mpGame({
  id: 'bluff', name: 'Bluff', icon: '🎭', min: 3,
  desc: 'Write fake answers to strange facts. Spot the truth.',
  how: 'Each round shows a strange but true fact with a blank. Everyone writes a convincing fake answer, then all answers are mixed with the real one. Pick the truth for 2 points, and get 1 point for every player your fake fools. 5 rounds.',
  render(v, ui) {
    if (v.phase === 'final') return ui.final();
    const out = [h('div', {class: 'mp-qhead'}, h('span', {}, `Round ${v.n} of ${v.total}`), v.phase !== 'reveal' ? ui.timer(v.left) : null),
      h('blockquote', {class: 'riddle'}, v.q)];
    if (v.phase === 'write') {
      out.push(v.wrote ? h('p', {class: 'msg'}, '✍️ Fake answer submitted!') : [h('p', {}, 'Write a fake answer that sounds real:'),
        ui.form('fake' + v.n, {placeholder: 'Your fake answer', maxlength: 40}, 'Submit', t => ui.act('fake', {text: t}))], ui.waiting(v.answered, v.of, 'written'));
    } else if (v.phase === 'pick') {
      out.push(h('p', {}, 'Which one is the truth?'), h('div', {class: 'tv-opts'}, v.options.map((o, k) => h('button', {
        class: v.picked === k ? 'chosen' : '', disabled: o.mine || (v.picked != null && v.picked !== k), onclick: () => ui.act('pick', {choice: k})}, o.text, o.mine ? h('small', {}, ' (yours)') : null))),
      ui.waiting(v.answered, v.of, 'picked'));
    } else {
      out.push(h('div', {class: 'mp-list'}, v.options.map(o => h('div', {class: 'mp-row' + (o.truth ? ' truth' : '')},
        h('b', {}, o.text), h('span', {}, o.truth ? '✅ The truth' : `Fake by ${o.by.join(' & ')}`),
        o.pickedBy.length ? h('small', {}, `${o.truth ? 'Found by' : 'Fooled'}: ${o.pickedBy.join(', ')}`) : null))),
      ui.board(), ui.hostNext(v.n === v.total ? 'See final scores' : 'Next round'));
    }
    return out;
  },
});

mpGame({
  id: 'mostlikely', name: 'Most Likely To', icon: '👉', min: 3,
  desc: 'Vote on which friend is most likely to…',
  how: 'Read the prompt and secretly vote for the player who fits it best (you can vote for yourself). The most-voted player wins the title. Keep going as long as you like.',
  render(v, ui) {
    const out = [h('blockquote', {class: 'riddle'}, v.prompt)];
    if (v.phase === 'vote') {
      out.push(h('div', {class: 'mp-vote'}, v.order.filter(p => v.selfvote || p.id !== ui.me).map(p => h('button', {class: v.myVote === p.id ? 'primary' : '', onclick: () => ui.act('vote', {target: p.id})},
        p.id === ui.me ? `${p.name} (you)` : p.name))), ui.waiting(v.answered, v.of, 'voted'));
    } else {
      const max = Math.max(...v.tally.map(t => t.votes));
      out.push(h('h2', {}, `🏆 ${v.winners.join(' & ')}`), h('div', {class: 'bars'}, v.tally.map(t => h('div', {class: 'bar-row'},
        h('span', {}, t.name), h('div', {class: 'bar-track'}, h('i', {style: `width:${(t.votes / max) * 100}%`})), h('b', {}, t.votes),
        t.voters.length ? h('small', {class: 'voters'}, 'from ' + t.voters.join(', ')) : null))),
      h('p', {class: 'muted'}, 'Scores count titles won.'), ui.hostNext('Next prompt'));
    }
    return out;
  },
});

mpGame({
  id: 'connect4online', name: 'Connect Four Online', icon: '🔴', min: 2,
  desc: 'Head-to-head Connect Four on two phones.',
  how: 'The first two players in the room play; anyone else can watch. Take turns dropping discs; four in a row in any direction wins. Rematches swap who goes first.',
  render(v, ui) {
    const [a, b] = v.pair, myTurn = v.phase === 'play' && v.turn === ui.me;
    const status = v.phase === 'end' ? (v.winner ? `${v.winner} wins! 🎉` : 'It’s a draw!')
      : myTurn ? 'Your turn!' : `${ui.name(v.turn)}’s turn`;
    return [h('div', {class: 'c4-players'}, h('span', {class: 'c4-tag p1'}, a.name), h('span', {class: 'muted'}, 'vs'), h('span', {class: 'c4-tag p2'}, b ? b.name : '…')),
      h('p', {class: 'msg'}, status), !v.slot ? h('p', {class: 'muted'}, '👀 You are watching') : null,
      h('div', {class: 'c4-grid' + (myTurn ? ' live' : '')}, v.board.map((c, i) => h('button', {class: `c4-cell p${c}` + (v.line.includes(i) ? ' win' : ''),
        'aria-label': `Column ${(i % 7) + 1}`, onclick: () => { if (myTurn) ui.act('drop', {col: i % 7}); }}))),
      v.phase === 'end' ? ui.hostNext('Rematch', 'start') : null];
  },
});
