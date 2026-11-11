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
  name.value = BG.user ? BG.user.name : BG.store.get('mp:name', '');
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
    BG.user ? h('p', {class: 'muted small'}, `Signed in as ${BG.user.name}: your wins count toward your stats.`) : null,
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
    draft: key => drafts[key],
    setDraft: (key, val) => { drafts[key] = val; },
    quiet: (action, data = {}) => MP.call('act', {code, token, action, ...data}).catch(() => {}),
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
      h('div', {class: 'mp-body'}, v.phase === 'lobby' ? lobby() : [v.cheat ? h('div', {class: 'cheat-box'}, '🕶️ ', v.cheat) : null, def.render(v, ui)]),
      ui.host && v.phase !== 'lobby' && v.schema.length ? h('details', {class: 'set-box', open: local.settingsOpen || null, ontoggle: e => { local.settingsOpen = e.target.open; }},
        h('summary', {}, '⚙️ Settings', h('small', {class: 'muted'}, ' · changes apply from the next round')), settings(true)) : null,
      h('div', {class: 'row-btns mp-foot'}, ui.host && v.phase !== 'lobby' ? h('button', {onclick: () => act('lobby')}, 'Back to lobby') : null, v.cheatsAllowed ? h('button', {class: v.cheatsOn ? 'cheat-on' : '', title: 'Only you can see cheats.',
        onclick: () => act('cheats', {on: !v.cheatsOn})}, v.cheatsOn ? '🕶️ Cheats ON' : '🕶️ Cheats off') : null, h('button', {onclick: leave}, 'Leave room')));
    if (focused) {
      const i = el.querySelector(`[data-key="${focused}"]`);
      if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch {} }
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

const spectrum = (ends, marks) => h('div', {class: 'spectrum'}, h('div', {class: 'spec-ends'}, h('span', {}, '← ' + ends[0]), h('span', {}, ends[1] + ' →')),
  h('div', {class: 'spec-track'}, marks.map(m => h('span', {class: 'spec-mark ' + (m.cls || ''), style: `left:${m.at}%`, title: m.label || ''}, m.label || ''))));

mpGame({
  id: 'spyhunt', name: 'Spy Hunt', icon: '🗺️', min: 3,
  desc: 'Everyone knows the secret location, except the spy.',
  how: 'Everyone but the spy sees a secret location. Take turns asking another player a question about it, then they answer and ask the next question. Answers should prove you know the place without giving it away. When time runs out, vote for the spy. The spy can guess the location at any time to win instantly, but a wrong guess loses.',
  render(v, ui) {
    const out = [];
    if (v.role && v.phase !== 'reveal') {
      const open = ui.local.reveal;
      out.push(h('button', {class: 'role-card ' + (open ? (v.role === 'spy' ? 'imposter' : 'crew') : 'hidden'), onclick: () => { ui.local.reveal = !open; ui.rerender(); }},
        !open ? [h('b', {}, '👆 Tap to see your role'), h('span', {}, 'Keep your screen hidden from others')]
          : v.role === 'spy' ? [h('small', {}, 'You are the'), h('b', {}, 'SPY 🕶️'), h('span', {}, 'Work out the location from the questions'),
            v.partner && v.partner.length ? h('span', {}, `Fellow spy: ${v.partner.join(', ')}`) : null]
            : [h('small', {}, 'The location is'), h('b', {}, v.location), h('span', {}, 'Tap to hide')]));
    } else if (!v.role && v.phase !== 'reveal') out.push(h('p', {class: 'muted'}, '👀 You joined mid-round. You can play from the next round.'));
    if (v.phase === 'ask') {
      out.push(h('div', {class: 'mp-qhead'}, h('span', {}, 'Find the spy'), ui.timer(v.left)),
        h('div', {class: 'mp-list'}, v.log.length ? v.log.map(l => h('div', {class: 'mp-row qa'}, h('small', {}, `${l.from} → ${l.to}`), h('b', {}, l.q), h('span', {}, '“' + l.a + '”')))
          : h('p', {class: 'muted'}, 'No questions yet.')));
      if (v.target === ui.me) out.push(h('p', {class: 'msg'}, `${ui.name(v.asker)} asks: “${v.question}”`), ui.form('ans' + v.log.length, {placeholder: 'Your answer', maxlength: 120}, 'Answer', t => ui.act('answer', {text: t})));
      else if (v.target) out.push(h('p', {class: 'msg'}, `${ui.name(v.asker)} asked ${ui.name(v.target)}: “${v.question}”`));
      else if (v.asker === ui.me) {
        out.push(h('p', {class: 'msg'}, 'Your turn to ask! Pick a player and a question.'), h('div', {class: 'mp-vote'}, v.order.filter(p => p.id !== ui.me).map(p =>
          h('button', {class: ui.local.askTo === p.id ? 'primary' : '', onclick: () => { ui.local.askTo = p.id; ui.rerender(); }}, p.name))));
        if (ui.local.askTo) out.push(ui.form('q' + v.log.length, {placeholder: `Ask ${ui.name(ui.local.askTo)} something…`, maxlength: 120}, 'Ask', t => ui.act('ask', {target: ui.local.askTo, text: t})));
      } else out.push(h('p', {class: 'msg'}, `${ui.name(v.asker)} is choosing who to ask…`));
      if (v.role === 'spy') {
        const sel = h('select', {class: 'spy-select', 'aria-label': 'Location guess'}, h('option', {value: ''}, 'Guess the location…'), v.locations.map(l => h('option', {value: l}, l)));
        out.push(h('div', {class: 'set-box'}, h('h3', {}, '🕶️ Spy only: guess the location'), h('p', {class: 'muted'}, 'Right: you win now. Wrong: you lose.'),
          h('div', {class: 'join-row wide'}, sel, h('button', {class: 'primary', onclick: () => { if (sel.value && confirm(`Guess “${sel.value}”?`)) ui.act('guess', {location: sel.value}); }}, 'Guess'))));
      }
      out.push(h('details', {class: 'set-box'}, h('summary', {}, '📍 All possible locations'), h('div', {class: 'loc-list'}, v.locations.map(l => h('span', {}, l)))));
      if (ui.host) out.push(h('button', {onclick: () => ui.act('vote_now')}, 'Start the vote now'));
    } else if (v.phase === 'vote') {
      out.push(h('h2', {}, 'Who is the spy?'), v.role ? h('div', {class: 'mp-vote'}, v.order.filter(p => p.id !== ui.me).map(p =>
        h('button', {class: v.myVote === p.id ? 'primary' : '', onclick: () => ui.act('vote', {target: p.id})}, p.name))) : null,
      ui.waiting(v.voted.length, v.order.length, 'voted'));
    } else if (v.phase === 'reveal') {
      const story = v.guess ? `${v.guesser} guessed “${v.guess}”: ${v.spyWins ? 'correct!' : 'wrong!'}`
        : v.accused ? (v.spyWins ? `You voted out ${v.accused}, but they weren't the spy.` : `You caught ${v.accused}!`) : 'The vote was tied, so the spy escaped.';
      out.push(h('div', {class: 'result-emoji'}, v.spyWins ? '🕶️' : '🎉'), h('h2', {}, v.spyWins ? 'The spy wins!' : 'The agents win!'), h('p', {}, story),
        h('p', {}, 'The location was ', h('b', {}, v.location), '. The spy was ', h('b', {}, v.spy), '.'),
        v.tally.length ? h('div', {class: 'mp-list'}, v.tally.map(t => h('div', {class: 'mp-row'}, h('b', {}, t.name), h('span', {}, `${t.votes} vote${t.votes === 1 ? '' : 's'}`)))) : null,
        ui.board(), ui.hostNext('Next round', 'start'));
      ui.local.reveal = false; ui.local.askTo = null;
    }
    return out;
  },
});

mpGame({
  id: 'mindreader', name: 'Mind Reader', icon: '📡', min: 2,
  desc: 'Give a clue for a secret spot on a scale. Can your friends read your mind?',
  how: 'Each round one player is the psychic. They see a secret spot on a scale (like Cold ↔ Hot) and give a one-line clue: something that sits at that spot. Everyone else slides to where they think it is. Closer guesses score up to 4 points, and the psychic scores the average.',
  render(v, ui) {
    if (v.phase === 'final') return ui.final();
    const psychic = v.psychic === ui.me;
    const out = [h('div', {class: 'mp-qhead'}, h('span', {}, `Round ${v.n} of ${v.total} · 🔮 ${v.psychicName}`), v.phase === 'guess' ? ui.timer(v.left) : null)];
    if (v.phase === 'clue') {
      if (psychic) {
        out.push(h('p', {class: 'msg'}, 'You are the psychic! Give a clue that sits at the marked spot.'), spectrum(v.ends, [{at: v.target, cls: 'target', label: '🎯'}]),
          ui.form('clue' + v.n, {placeholder: 'e.g. “a cup of tea”', maxlength: 60}, 'Send clue', t => ui.act('clue', {text: t})));
      } else out.push(spectrum(v.ends, []), h('p', {class: 'msg'}, `${v.psychicName} is thinking of a clue…`));
    } else if (v.phase === 'guess') {
      out.push(h('blockquote', {class: 'riddle'}, '“' + v.clue + '”'));
      if (psychic) out.push(spectrum(v.ends, [{at: v.target, cls: 'target', label: '🎯'}]), h('p', {class: 'muted'}, 'Waiting for guesses…'));
      else {
        const key = 'g' + v.n, val = ui.local[key] ?? v.mine ?? 50;
        const out2 = h('b', {}, String(val));
        const slider = h('input', {type: 'range', min: 0, max: 100, value: val, class: 'spec-slider', 'aria-label': 'Your guess'});
        slider.addEventListener('input', () => { ui.local[key] = +slider.value; out2.textContent = slider.value; });
        out.push(h('div', {class: 'spectrum'}, h('div', {class: 'spec-ends'}, h('span', {}, '← ' + v.ends[0]), h('span', {}, v.ends[1] + ' →')), slider),
          h('div', {class: 'row-btns'}, h('span', {}, 'Your guess: ', out2), h('button', {class: 'primary', onclick: () => ui.act('guess', {value: +slider.value})}, v.mine != null ? 'Update guess' : 'Lock in')));
      }
      out.push(ui.waiting(v.answered, v.of, 'guessed'));
    } else {
      out.push(h('blockquote', {class: 'riddle'}, '“' + v.clue + '”'),
        spectrum(v.ends, [{at: v.target, cls: 'target', label: '🎯'}, ...v.results.map(r => ({at: r.guess, label: r.name[0].toUpperCase()}))]),
        h('div', {class: 'mp-list'}, v.results.map(r => h('div', {class: 'mp-row'}, h('b', {}, r.name), h('span', {}, `guessed ${r.guess}`), h('span', {class: 'pts'}, r.pts ? `+${r.pts}` : ''))),
          h('div', {class: 'mp-row'}, h('b', {}, `${v.psychicName} (psychic)`), h('span', {}, `target ${v.target}`), h('span', {class: 'pts'}, v.psychicPts ? `+${v.psychicPts}` : ''))),
        ui.board(), ui.hostNext(v.n === v.total ? 'See final scores' : 'Next round'));
    }
    return out;
  },
});

mpGame({
  id: 'letterblitz', name: 'Letter Blitz', icon: '🔤', min: 2,
  desc: 'One letter, lots of categories, not much time.',
  how: 'Each round has a letter and a list of categories. Write an answer for each category that starts with that letter before time runs out. Unique answers score 2 points, answers someone else also gave score 1, and answers that don\'t start with the letter score nothing. Your answers save as you type.',
  render(v, ui) {
    if (v.phase === 'final') return ui.final();
    const out = [h('div', {class: 'mp-qhead'}, h('span', {}, `Round ${v.n} of ${v.total}`), v.phase === 'write' ? ui.timer(v.left) : null),
      h('div', {class: 'blitz-letter'}, v.letter)];
    if (v.phase === 'write') {
      const inputs = v.cats.map((c, k) => {
        const key = `lb${v.n}-${k}`;
        if (ui.draft(key) == null && v.mine[k]) ui.setDraft(key, v.mine[k]);
        return [c, ui.input(key, {placeholder: `${v.letter}…`, maxlength: 40, autocapitalize: 'words', disabled: v.finished || null})];
      });
      const answers = () => inputs.map(([, i]) => i.value);
      inputs.forEach(([, i]) => i.addEventListener('input', () => {
        clearTimeout(ui.local.saveTimer);
        ui.local.saveTimer = setTimeout(() => ui.quiet('answers', {answers: answers()}), 600);
      }));
      out.push(h('div', {class: 'blitz-list'}, inputs.map(([c, i]) => h('label', {}, c, i))),
        v.finished ? h('p', {class: 'msg'}, '✅ Done! Waiting for the others…') : h('button', {class: 'primary', onclick: () => ui.act('done', {answers: answers()})}, "I'm done"),
        ui.waiting(v.answered, v.of, 'done'));
    } else {
      out.push(h('div', {class: 'mp-list'}, v.scored.map(s => h('div', {class: 'mp-row blitz-row'}, h('b', {}, s.cat),
        h('div', {class: 'blitz-answers'}, s.rows.map(r => h('span', {class: 'blitz-a p' + r.pts}, `${r.name}: ${r.answer || '—'}`, r.pts ? h('small', {}, ` +${r.pts}`) : null)))))),
      ui.board(), ui.hostNext(v.n === v.total ? 'See final scores' : 'Next round'));
    }
    return out;
  },
});
