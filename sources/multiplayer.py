"""Lightweight multiplayer: in-memory rooms, server-side rules, long-polling clients."""
import hmac
import json
import random
import re
import secrets
import threading
import time
from collections import Counter

import mp_content

COND = threading.Condition()  # guards ROOMS; notified on every change so long-polls wake up
ROOMS = {}
MAX_ROOMS, MAX_PLAYERS, IDLE_SECS, POLL_SECS = 300, 12, 3 * 3600, 20
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
PUZZLE_FILES = ()  # set by server.py: JSON files whose "trivia" puzzles feed Trivia Race
ON_RESULT = None  # set by server.py: called (account, won) for signed-in players when a game ends
CHEAT_MODE = None  # set by server.py: account -> None (no cheats allowed) / False (off) / True (on)
SET_CHEATS = None  # set by server.py: (account, on)
HIDDEN = lambda: []  # set by server.py: games switched off in the site settings


class Err(ValueError):
    pass


def text(v, n, what="some text"):
    t = re.sub(r"\s+", " ", str(v or "")).strip()[:n]
    if not t:
        raise Err(f"Enter {what}")
    return t


def norm(s):
    s = re.sub(r"[^\w ]", "", str(s).lower())
    return re.sub(r"^(a|an|the) ", "", re.sub(r"\s+", " ", s).strip())


def trivia_pool():
    seen, out = set(), []
    for path in PUZZLE_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                days = json.load(f).get("trivia", {})
        except (OSError, ValueError):
            continue
        for day in days.values():
            for q in day.get("questions", []):
                if q["q"] not in seen:
                    seen.add(q["q"])
                    out.append(q)
    return out


class Game:
    min_players, resets_scores = 2, True
    SETTINGS = {}  # key -> {label, options: [[value, label], ...], default, multi?}; the host changes them between rounds

    def __init__(self, room):
        self.room, self.ids, self.deadline, self.i = room, [], 0, -1

    @property
    def phase(self):
        return self.room["phase"]

    def opt(self, key):
        return self.room["settings"].get(key, self.SETTINGS[key]["default"])

    def name(self, pid):
        return next((p["name"] for p in self.room["players"] if p["id"] == pid), "Someone")

    def active(self):  # players in this round who are still in the room
        live = {p["id"] for p in self.room["players"]}
        return [i for i in self.ids if i in live]

    def everyone(self, done):
        a = self.active()
        return bool(a) and all(i in done for i in a)

    def award(self, pid, pts):
        for p in self.room["players"]:
            if p["id"] == pid:
                p["score"] += pts

    def set_phase(self, phase, secs=0):
        self.room["phase"], self.deadline = phase, (time.time() + secs if secs else 0)

    def left(self):
        return max(0, round(self.deadline - time.time())) if self.deadline else None

    def host(self, pid):
        return pid == self.room["host"]

    def begin(self):
        self.ids = [p["id"] for p in self.room["players"]]
        if self.resets_scores:
            for p in self.room["players"]:
                p["score"] = 0
        self.i = -1
        self.start()

    def tick(self):
        if self.deadline and time.time() >= self.deadline and self.phase != "lobby":
            self.deadline = 0
            self.timeout()
            return True
        return False

    def timeout(self):
        pass

    def report(self, winners, who=None):
        for p in self.room["players"]:
            if ON_RESULT and p.get("user") and p["id"] in (who or self.active()):
                ON_RESULT(p["user"], p["id"] in winners)

    def cheat(self, pid):  # secret info shown to the super admin when cheats are on
        return None

    def round_info(self):
        return {"n": self.i + 1, "total": len(self.qs), "left": self.left(), "of": len(self.active())}

    def next(self):
        self.i += 1
        if self.i >= len(self.qs):
            self.set_phase("final")
            scores = {p["id"]: p["score"] for p in self.room["players"] if p["id"] in self.active()}
            top = max(scores.values(), default=0)
            return self.report([i for i, s in scores.items() if s == top and top > 0])
        self.new_round()


def opts(*vals):
    return [[v, str(v)] for v in vals]


class Imposter(Game):
    min_players, resets_scores = 3, False
    SETTINGS = {  # "cats" is added at the bottom of the file, once the word list is loaded
        "rounds": {"label": "Clue rounds", "options": opts(1, 2, 3), "default": 2},
        "imposters": {"label": "Imposters", "options": [[1, "1"], [2, "2 (needs 5+ players)"]], "default": 1},
        "hint": {"label": "Imposter sees the category", "options": [[True, "Yes"], [False, "No"]], "default": True},
    }

    def start(self):
        random.shuffle(self.ids)
        cats = self.opt("cats") or IMPOSTER_CATS
        self.cat, self.word = random.choice([w for w in IMPOSTER_WORDS if w[0] in cats])
        self.imps = random.sample(self.ids, 2 if self.opt("imposters") == 2 and len(self.ids) >= 5 else 1)
        self.rounds, self.hint = self.opt("rounds"), self.opt("hint")
        self.clues, self.votes, self.accused, self.guess, self.imp_wins = [], {}, None, None, None
        self.set_phase("clues")

    def turn(self):
        a = self.active()
        return a[len(self.clues) % len(a)] if a and self.phase == "clues" else None

    def act(self, pid, action, d):
        if action == "clue" and self.phase == "clues":
            if pid != self.turn():
                raise Err("It's not your turn")
            clue = text(d.get("text"), 30, "a clue")
            if re.search(rf"\b{re.escape(norm(self.word))}\b", norm(clue)):
                raise Err("You can't say the secret word!")
            self.clues.append((pid, clue))
            if len(self.clues) >= self.rounds * len(self.active()):
                self.set_phase("vote")
        elif action == "vote_now" and self.phase == "clues" and self.host(pid):
            self.set_phase("vote")
        elif action == "vote" and self.phase == "vote":
            t = d.get("target")
            if pid not in self.active() or t not in self.active() or t == pid:
                raise Err("Pick another player")
            self.votes[pid] = t
            if self.everyone(self.votes):
                self.resolve()
        elif action == "guess" and self.phase == "guess" and pid == self.accused:
            self.guess = text(d.get("text"), 40, "a guess")
            self.finish(norm(self.guess) == norm(self.word))
        else:
            raise Err("You can't do that right now")

    def cheat(self, pid):
        if self.phase not in ("clues", "vote", "guess"):
            return None
        if pid in self.imps:
            return f"The secret word is “{self.word}”"
        names = " & ".join(self.name(i) for i in self.imps)
        return f"The imposter{'s are' if len(self.imps) > 1 else ' is'} {names}"

    def resolve(self):
        tally = Counter(self.votes.values()).most_common()
        top = [t for t, c in tally if c == tally[0][1]]
        self.accused = top[0] if len(top) == 1 else None
        if self.accused in self.imps:
            self.set_phase("guess")
        else:
            self.finish(True)

    def finish(self, imp_wins):
        self.imp_wins = imp_wins
        for i in self.active():
            if (i in self.imps) == imp_wins:
                self.award(i, 2 if imp_wins else 1)
        self.set_phase("reveal")
        self.report([i for i in self.active() if (i in self.imps) == imp_wins])

    def view(self, pid):
        v = {"order": [{"id": i, "name": self.name(i)} for i in self.active()], "turn": self.turn(),
             "clues": [{"name": self.name(i), "text": t} for i, t in self.clues], "cluesNeeded": self.rounds * len(self.active())}
        if pid in self.ids:
            imp = pid in self.imps
            v.update(role="imposter" if imp else "crew", category=self.cat if self.hint or not imp else None)
            if imp:
                v["partner"] = [self.name(i) for i in self.imps if i != pid]
            else:
                v["word"] = self.word
        if self.phase == "vote":
            v.update(voted=list(self.votes), myVote=self.votes.get(pid))
        if self.phase in ("guess", "reveal"):
            v.update(accused=self.accused and self.name(self.accused), guesser=self.accused == pid)
        if self.phase == "reveal":
            v.update(imposter=" & ".join(self.name(i) for i in self.imps), caught=self.accused in self.imps, word=self.word,
                     category=self.cat, impWins=self.imp_wins, guess=self.guess,
                     tally=[{"name": self.name(t), "votes": c} for t, c in Counter(self.votes.values()).most_common()])
        return v


class TriviaRace(Game):
    SETTINGS = {
        "count": {"label": "Questions", "options": opts(5, 10, 15, 20), "default": 10},
        "time": {"label": "Seconds per question", "options": opts(10, 15, 20, 30), "default": 20},
        "source": {"label": "Questions from", "options": [["all", "Everything"], ["builtin", "Built-in"], ["daily", "Your daily trivia"]], "default": "all"},
    }

    def start(self):
        src = self.opt("source")
        pool = list({q["q"]: q for q in (TRIVIA if src != "daily" else []) + (trivia_pool() if src != "builtin" else [])}.values())
        if len(pool) < 3:
            raise Err("Not enough questions there yet. Add Daily Trivia in the admin panel or pick another source.")
        self.qtime = self.opt("time")
        self.qs = random.sample(pool, min(self.opt("count"), len(pool)))
        self.next()

    def new_round(self):
        q = self.qs[self.i]
        order = random.sample(range(len(q["options"])), len(q["options"]))
        self.opts, self.correct, self.answers = [q["options"][k] for k in order], order.index(q["answer"]), {}
        self.set_phase("question", self.qtime)

    def act(self, pid, action, d):
        if action == "answer" and self.phase == "question" and pid in self.active() and pid not in self.answers:
            c = int(d.get("choice", -1))
            if not 0 <= c < len(self.opts):
                raise Err("Pick an answer")
            pts = 500 + round(500 * max(0, self.deadline - time.time()) / self.qtime) if c == self.correct else 0
            self.answers[pid] = (c, pts)
            self.award(pid, pts)
            if self.everyone(self.answers):
                self.set_phase("reveal")
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "question":
            self.set_phase("reveal")

    def cheat(self, pid):
        return f"Answer: {self.opts[self.correct]}" if self.phase == "question" else None

    def view(self, pid):
        if self.phase == "final":
            return {}
        mine = self.answers.get(pid)
        v = {**self.round_info(), "q": self.qs[self.i]["q"], "options": self.opts, "answered": len(self.answers), "mine": mine and mine[0]}
        if self.phase == "reveal":
            v.update(correct=self.correct, pts=mine[1] if mine else 0,
                     counts=[sum(1 for c, _ in self.answers.values() if c == k) for k in range(len(self.opts))])
        return v


class Estimate(Game):
    SETTINGS = {
        "rounds": {"label": "Rounds", "options": opts(5, 7, 10, 15), "default": 7},
        "time": {"label": "Seconds per round", "options": opts(20, 30, 45, 60), "default": 30},
    }

    def start(self):
        self.qs, self.secs = random.sample(ESTIMATES, self.opt("rounds")), self.opt("time")
        self.next()

    def new_round(self):
        self.guesses, self.ranked = {}, []
        self.set_phase("question", self.secs)

    def act(self, pid, action, d):
        if action == "guess" and self.phase == "question" and pid in self.active():
            try:
                g = float(str(d.get("value")).replace(",", "").strip())
            except ValueError:
                raise Err("Enter a number")
            if g != g or abs(g) > 1e12:
                raise Err("Enter a number")
            self.guesses[pid] = g
            if self.everyone(self.guesses):
                self.reveal()
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "question":
            self.reveal()

    def cheat(self, pid):
        q, unit, ans = self.qs[self.i]
        return f"Answer: {ans:,} {unit}".strip() if self.phase == "question" else None

    def reveal(self):
        ans = self.qs[self.i][2]
        rows = sorted((abs(g - ans), pid, g) for pid, g in self.guesses.items())
        dists = sorted({r[0] for r in rows})
        for diff, pid, g in rows:
            rank = dists.index(diff)
            pts = (3, 2, 1)[rank] if rank < 3 else 0
            pts += 2 if diff == 0 else 0
            self.award(pid, pts)
            self.ranked.append({"name": self.name(pid), "guess": g, "pts": pts})
        self.set_phase("reveal")

    def view(self, pid):
        if self.phase == "final":
            return {}
        q, unit, ans = self.qs[self.i]
        v = {**self.round_info(), "q": q, "unit": unit, "answered": len(self.guesses), "mine": self.guesses.get(pid)}
        if self.phase == "reveal":
            v.update(answer=ans, ranked=self.ranked)
        return v


class Bluff(Game):
    min_players = 3
    SETTINGS = {
        "rounds": {"label": "Rounds", "options": opts(3, 5, 7, 10), "default": 5},
        "wtime": {"label": "Seconds to write", "options": opts(30, 60, 90), "default": 60},
        "ptime": {"label": "Seconds to pick", "options": opts(20, 30, 45), "default": 30},
    }

    def start(self):
        self.qs, self.wtime, self.ptime = random.sample(BLUFFS, self.opt("rounds")), self.opt("wtime"), self.opt("ptime")
        self.next()

    def new_round(self):
        self.fakes, self.picks, self.opts = {}, {}, []
        self.set_phase("write", self.wtime)

    def act(self, pid, action, d):
        if action == "fake" and self.phase == "write" and pid in self.active():
            f = text(d.get("text"), 40, "an answer")
            if norm(f) == norm(self.qs[self.i][1]):
                raise Err("That's the real answer! Write a convincing fake instead.")
            self.fakes[pid] = f
            if self.everyone(self.fakes):
                self.to_pick()
        elif action == "pick" and self.phase == "pick" and pid in self.active():
            c = int(d.get("choice", -1))
            if not 0 <= c < len(self.opts):
                raise Err("Pick an answer")
            if pid in self.opts[c]["by"]:
                raise Err("You can't pick your own answer")
            self.picks[pid] = c
            if self.everyone(self.picks):
                self.reveal()
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "write":
            self.to_pick()
        elif self.phase == "pick":
            self.reveal()

    def cheat(self, pid):
        return f"The real answer is “{self.qs[self.i][1]}”" if self.phase in ("write", "pick") else None

    def to_pick(self):
        truth = self.qs[self.i][1]
        opts = {norm(truth): {"text": truth, "by": [], "truth": True}}
        for pid, f in self.fakes.items():
            opts.setdefault(norm(f), {"text": f, "by": [], "truth": False})["by"].append(pid)
        self.opts = random.sample(list(opts.values()), len(opts))
        self.set_phase("pick", self.ptime)

    def reveal(self):
        for pid, c in self.picks.items():
            o = self.opts[c]
            if o["truth"]:
                self.award(pid, 2)
            for author in o["by"]:
                if author != pid:
                    self.award(author, 1)
        self.set_phase("reveal")

    def view(self, pid):
        if self.phase == "final":
            return {}
        v = {**self.round_info(), "q": self.qs[self.i][0], "wrote": pid in self.fakes, "picked": self.picks.get(pid),
             "answered": len(self.fakes if self.phase == "write" else self.picks)}
        if self.phase in ("pick", "reveal"):
            v["options"] = [{"text": o["text"], "mine": pid in o["by"]} for o in self.opts]
        if self.phase == "reveal":
            for k, o in enumerate(self.opts):
                v["options"][k].update(truth=o["truth"], by=[self.name(a) for a in o["by"]],
                                       pickedBy=[self.name(p) for p, c in self.picks.items() if c == k])
        return v


class MostLikely(Game):
    min_players = 3
    SETTINGS = {
        "public": {"label": "Votes", "options": [[False, "Secret"], [True, "Show who voted for whom"]], "default": False},
        "selfvote": {"label": "Vote for yourself", "options": [[True, "Allowed"], [False, "Not allowed"]], "default": True},
    }

    def start(self):
        self.qs = random.sample(PROMPTS, len(PROMPTS))
        self.next()

    def next(self):
        self.i = (self.i + 1) % len(self.qs)
        self.votes, self.winners = {}, []
        self.public, self.selfvote = self.opt("public"), self.opt("selfvote")
        self.set_phase("vote")

    def act(self, pid, action, d):
        if action == "vote" and self.phase == "vote" and pid in self.active():
            if d.get("target") not in self.active():
                raise Err("Pick a player")
            if d["target"] == pid and not self.selfvote:
                raise Err("No voting for yourself this game!")
            self.votes[pid] = d["target"]
            if self.everyone(self.votes):
                tally = Counter(self.votes.values()).most_common()
                self.winners = [t for t, c in tally if c == tally[0][1]]
                for w in self.winners:
                    self.award(w, 1)
                self.set_phase("reveal")
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def cheat(self, pid):
        if self.phase != "vote":
            return None
        return "Votes so far: " + (", ".join(f"{self.name(p)} → {self.name(t)}" for p, t in self.votes.items()) or "none yet")

    def view(self, pid):
        v = {"prompt": self.qs[self.i], "order": [{"id": i, "name": self.name(i)} for i in self.active()],
             "answered": len(self.votes), "of": len(self.active()), "myVote": self.votes.get(pid), "selfvote": self.selfvote}
        if self.phase == "reveal":
            v.update(tally=[{"name": self.name(t), "votes": c, "voters": [self.name(p) for p, x in self.votes.items() if x == t] if self.public else []}
                            for t, c in Counter(self.votes.values()).most_common()],
                     winners=[self.name(w) for w in self.winners])
        return v


class ConnectFour(Game):
    resets_scores = False
    SETTINGS = {"first": {"label": "First move", "options": [["alternate", "Take turns"], ["random", "Random"], ["loser", "Loser goes first"]],
                          "default": "alternate"}}

    def __init__(self, room):
        super().__init__(room)
        self.played, self.last_winner = 0, None

    def start(self):
        a, b = self.ids[:2]
        mode = self.opt("first")
        if mode == "random":
            self.pl = random.sample([a, b], 2)
        elif mode == "loser" and self.last_winner in (a, b):
            self.pl = [b, a] if self.last_winner == a else [a, b]
        else:
            self.pl = [a, b] if self.played % 2 == 0 else [b, a]
        self.played += 1
        self.board, self.turn, self.winner, self.line = [0] * 42, 0, None, []
        self.set_phase("play")

    def act(self, pid, action, d):
        if action != "drop" or self.phase != "play":
            raise Err("You can't do that right now")
        if pid != self.pl[self.turn]:
            raise Err("Wait for your turn")
        c = int(d.get("col", -1))
        r = next((r for r in range(5, -1, -1) if 0 <= c < 7 and not self.board[r * 7 + c]), None)
        if r is None:
            raise Err("That column is full")
        self.board[r * 7 + c] = self.turn + 1
        self.line = self.win(r, c)
        if self.line:
            self.winner = self.last_winner = pid
            self.award(pid, 1)
            self.set_phase("end")
            self.report([pid], self.pl)
        elif all(self.board):
            self.set_phase("end")
            self.report([], self.pl)
        else:
            self.turn ^= 1

    def cheat(self, pid):
        if self.phase != "play" or pid != self.pl[self.turn]:
            return None
        cols = [c for c in range(7) if not self.board[c]]
        for who, why in ((self.turn + 1, "to win!"), (2 - self.turn, "to block!")):
            for c in cols:
                r = max(r for r in range(6) if not self.board[r * 7 + c])
                self.board[r * 7 + c] = who
                hit = self.win(r, c)
                self.board[r * 7 + c] = 0
                if hit:
                    return f"Play column {c + 1} {why}"
        return f"Try column {min(cols, key=lambda c: abs(c - 3)) + 1}" if cols else None

    def win(self, r, c):
        p = self.board[r * 7 + c]
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
            cells = [(r, c)]
            for s in (1, -1):
                rr, cc = r + dr * s, c + dc * s
                while 0 <= rr < 6 and 0 <= cc < 7 and self.board[rr * 7 + cc] == p:
                    cells.append((rr, cc))
                    rr, cc = rr + dr * s, cc + dc * s
            if len(cells) >= 4:
                return [y * 7 + x for y, x in cells]
        return []

    def view(self, pid):
        return {"board": self.board, "pair": [{"id": i, "name": self.name(i)} for i in self.pl],
                "turn": self.pl[self.turn] if self.phase == "play" else None,
                "slot": self.pl.index(pid) + 1 if pid in self.pl else 0, "winner": self.winner and self.name(self.winner), "line": self.line}


class SpyHunt(Game):
    min_players, resets_scores = 3, False
    SETTINGS = {
        "minutes": {"label": "Minutes to find the spy", "options": opts(3, 5, 8), "default": 5},
        "spies": {"label": "Spies", "options": [[1, "1"], [2, "2 (needs 6+ players)"]], "default": 1},
    }

    def start(self):
        self.loc = random.choice(SPY_LOCATIONS)
        self.spies = random.sample(self.ids, 2 if self.opt("spies") == 2 and len(self.ids) >= 6 else 1)
        self.asker, self.target, self.question = random.choice(self.ids), None, None
        self.log, self.votes, self.accused, self.guess, self.guesser, self.spy_wins = [], {}, None, None, None, None
        self.set_phase("ask", self.opt("minutes") * 60)

    def fix(self):  # keep the questioning going if someone leaves
        live = self.active()
        if live and self.asker not in live:
            self.asker, self.target, self.question = live[0], None, None
        if self.target is not None and self.target not in live:
            self.target, self.question = None, None

    def act(self, pid, action, d):
        self.fix()
        live = self.active()
        if action == "ask" and self.phase == "ask" and pid == self.asker and self.target is None:
            t = d.get("target")
            if t not in live or t == pid:
                raise Err("Pick another player to ask")
            self.target, self.question = t, text(d.get("text"), 120, "a question")
        elif action == "answer" and self.phase == "ask" and pid == self.target:
            self.log.append((self.asker, pid, self.question, text(d.get("text"), 120, "an answer")))
            self.asker, self.target, self.question = pid, None, None
        elif action == "vote_now" and self.phase == "ask" and self.host(pid):
            self.set_phase("vote")
        elif action == "guess" and self.phase == "ask" and pid in self.spies:
            if d.get("location") not in SPY_LOCATIONS:
                raise Err("Pick a location")
            self.guess, self.guesser = d["location"], pid
            self.finish(self.guess == self.loc)
        elif action == "vote" and self.phase == "vote":
            t = d.get("target")
            if pid not in live or t not in live or t == pid:
                raise Err("Pick another player")
            self.votes[pid] = t
            if self.everyone(self.votes):
                tally = Counter(self.votes.values()).most_common()
                top = [x for x, c in tally if c == tally[0][1]]
                self.accused = top[0] if len(top) == 1 else None
                self.finish(self.accused not in self.spies)
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "ask":
            self.set_phase("vote")

    def finish(self, spy_wins):
        self.spy_wins = spy_wins
        winners = [i for i in self.active() if (i in self.spies) == spy_wins]
        for i in winners:
            self.award(i, 2 if spy_wins else 1)
        self.set_phase("reveal")
        self.report(winners)

    def cheat(self, pid):
        if self.phase not in ("ask", "vote"):
            return None
        if pid in self.spies:
            return f"The location is {self.loc}"
        return f"The spy{' team is' if len(self.spies) > 1 else ' is'} {' & '.join(self.name(i) for i in self.spies)}"

    def view(self, pid):
        self.fix()
        v = {"order": [{"id": i, "name": self.name(i)} for i in self.active()], "asker": self.asker, "target": self.target,
             "question": self.question, "left": self.left(), "locations": SPY_LOCATIONS,
             "log": [{"from": self.name(a), "to": self.name(t), "q": q, "a": an} for a, t, q, an in self.log[-40:]]}
        if pid in self.ids:
            spy = pid in self.spies
            v["role"] = "spy" if spy else "agent"
            if spy:
                v["partner"] = [self.name(i) for i in self.spies if i != pid]
            else:
                v["location"] = self.loc
        if self.phase == "vote":
            v.update(voted=list(self.votes), myVote=self.votes.get(pid))
        if self.phase == "reveal":
            v.update(spy=" & ".join(self.name(i) for i in self.spies), location=self.loc, spyWins=self.spy_wins, guess=self.guess,
                     guesser=self.guesser and self.name(self.guesser), accused=self.accused and self.name(self.accused),
                     tally=[{"name": self.name(t), "votes": c} for t, c in Counter(self.votes.values()).most_common()])
        return v


class MindReader(Game):
    SETTINGS = {
        "rounds": {"label": "Rounds", "options": opts(4, 6, 8, 10), "default": 6},
        "time": {"label": "Seconds to guess", "options": opts(30, 45, 60), "default": 45},
    }

    def start(self):
        self.qs, self.secs = random.sample(SPECTRUMS, min(self.opt("rounds"), len(SPECTRUMS))), self.opt("time")
        self.next()

    def new_round(self):
        live = self.active()
        self.psychic = live[self.i % len(live)]
        self.target, self.clue, self.guesses, self.results, self.psychic_pts = random.randint(0, 100), None, {}, [], 0
        self.set_phase("clue")

    def guessers(self):
        return [i for i in self.active() if i != self.psychic]

    def act(self, pid, action, d):
        if action == "clue" and self.phase == "clue" and pid == self.psychic:
            self.clue = text(d.get("text"), 60, "a clue")
            self.set_phase("guess", self.secs)
        elif action == "guess" and self.phase == "guess" and pid in self.guessers():
            self.guesses[pid] = max(0, min(100, int(d.get("value", 50))))
            if all(i in self.guesses for i in self.guessers()):
                self.reveal()
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "guess":
            self.reveal()

    def reveal(self):
        for pid, g in self.guesses.items():
            off = abs(g - self.target)
            pts = 4 if off <= 5 else 3 if off <= 12 else 2 if off <= 20 else 1 if off <= 30 else 0
            self.award(pid, pts)
            self.results.append({"name": self.name(pid), "guess": g, "pts": pts})
        if self.results:
            self.psychic_pts = round(sum(r["pts"] for r in self.results) / len(self.results))
            self.award(self.psychic, self.psychic_pts)
        self.set_phase("reveal")

    def cheat(self, pid):
        return f"The target is at {self.target}" if self.phase in ("clue", "guess") else None

    def view(self, pid):
        if self.phase == "final":
            return {}
        left, right = self.qs[self.i]
        v = {**self.round_info(), "ends": [left, right], "psychic": self.psychic, "psychicName": self.name(self.psychic), "clue": self.clue,
             "answered": len(self.guesses), "of": len(self.guessers()), "mine": self.guesses.get(pid)}
        if pid == self.psychic or self.phase == "reveal":
            v["target"] = self.target
        if self.phase == "reveal":
            v.update(results=sorted(self.results, key=lambda r: -r["pts"]), psychicPts=self.psychic_pts)
        return v


class LetterBlitz(Game):
    SETTINGS = {
        "rounds": {"label": "Rounds", "options": opts(3, 5, 8), "default": 3},
        "cats": {"label": "Categories per round", "options": opts(4, 6, 8), "default": 6},
        "time": {"label": "Seconds per round", "options": opts(60, 90, 120), "default": 90},
    }
    LETTERS = "ABCDEFGHIJKLMNOPRSTW"

    def start(self):
        self.qs, self.ncat, self.secs = random.sample(self.LETTERS, self.opt("rounds")), self.opt("cats"), self.opt("time")
        self.next()

    def new_round(self):
        self.letter, self.cats = self.qs[self.i], random.sample(BLITZ_CATEGORIES, self.ncat)
        self.answers, self.done, self.scored = {}, set(), []
        self.set_phase("write", self.secs)

    def save(self, pid, d):
        a = d.get("answers")
        if isinstance(a, list):
            self.answers[pid] = [re.sub(r"\s+", " ", str(x or "")).strip()[:40] for x in a[:self.ncat]]

    def act(self, pid, action, d):
        if action == "answers" and self.phase == "write" and pid in self.active():
            self.save(pid, d)
            return True  # quiet autosave: don't redraw everyone's screen
        if action == "done" and self.phase == "write" and pid in self.active():
            self.save(pid, d)
            self.done.add(pid)
            if self.everyone(self.done):
                self.score()
        elif action == "next" and self.phase == "reveal" and self.host(pid):
            self.next()
        else:
            raise Err("You can't do that right now")

    def timeout(self):
        if self.phase == "write":
            self.score()

    def valid(self, a):
        n = norm(a)
        return n if len(n) >= 2 and n[0] == self.letter.lower() else ""

    def score(self):
        for k, cat in enumerate(self.cats):
            given = {pid: (a[k] if k < len(a) else "") for pid, a in self.answers.items()}
            counts = Counter(self.valid(a) for a in given.values() if self.valid(a))
            row = []
            for pid, a in given.items():
                n = self.valid(a)
                pts = (2 if counts[n] == 1 else 1) if n else 0
                self.award(pid, pts)
                row.append({"name": self.name(pid), "answer": a, "pts": pts})
            self.scored.append({"cat": cat, "rows": sorted(row, key=lambda r: -r["pts"])})
        self.set_phase("reveal")

    def cheat(self, pid):
        if self.phase != "write":
            return None
        others = [f"{self.name(p)}: {', '.join(x for x in a if x) or '…'}" for p, a in self.answers.items() if p != pid]
        return "Answers so far — " + (" | ".join(others) if others else "nobody has typed anything yet")

    def view(self, pid):
        if self.phase == "final":
            return {}
        v = {**self.round_info(), "letter": self.letter, "cats": self.cats, "mine": self.answers.get(pid, []), "finished": pid in self.done,
             "answered": len(self.done)}
        if self.phase == "reveal":
            v["scored"] = self.scored
        return v


GAMES = {"imposter": Imposter, "triviarace": TriviaRace, "estimate": Estimate, "bluff": Bluff,
         "mostlikely": MostLikely, "connect4online": ConnectFour,
         "spyhunt": SpyHunt, "mindreader": MindReader, "letterblitz": LetterBlitz}


def new_player(name, user=None):
    return {"id": secrets.token_hex(4), "name": name, "token": secrets.token_urlsafe(16), "score": 0, "seen": time.time(), "user": user}


def bump(room):
    room["version"] += 1
    room["touched"] = time.time()
    COND.notify_all()


def view(room, me):
    now, g = time.time(), room["g"]
    v = {"code": room["code"], "game": room["game"], "phase": room["phase"], "host": room["host"], "me": me["id"],
         "version": room["version"], "min": g.min_players, "settings": room["settings"],
         "schema": [{"key": k, **s} for k, s in g.SETTINGS.items()],
         "players": [{"id": p["id"], "name": p["name"], "score": p["score"], "online": now - p["seen"] < 30} for p in room["players"]]}
    if room["phase"] != "lobby":
        v.update(g.view(me["id"]))
    mode = CHEAT_MODE(me["user"]) if CHEAT_MODE and me.get("user") else None
    v["cheatsAllowed"], v["cheatsOn"] = mode is not None, bool(mode)
    if mode and room["phase"] != "lobby":
        v["cheat"] = g.cheat(me["id"])
    return v


def room_act(room, me, action, d):
    g, is_host = room["g"], room["host"] == me["id"]
    if action in ("start", "lobby", "settings") and not is_host:
        raise Err("Only the host can do that")
    if action == "cheats":
        if not me.get("user") or not SET_CHEATS:
            raise Err("Sign in first")
        SET_CHEATS(me["user"], bool(d.get("on")))
    elif action == "settings":
        s = g.SETTINGS.get(d.get("key"))
        if not s:
            raise Err("Unknown setting")
        val, allowed = d.get("value"), [o[0] for o in s["options"]]
        if not (isinstance(val, list) and all(x in allowed for x in val) if s.get("multi") else val in allowed):
            raise Err("That setting isn't allowed")
        room["settings"][d["key"]] = val
    elif action == "start":
        if len(room["players"]) < g.min_players:
            raise Err(f"Need at least {g.min_players} players")
        g.begin()
    elif action == "lobby":
        room["phase"], g.deadline = "lobby", 0
    elif action == "leave":
        room["players"].remove(me)
        if not room["players"]:
            ROOMS.pop(room["code"], None)
        elif is_host:
            room["host"] = room["players"][0]["id"]
    elif room["phase"] == "lobby":
        raise Err("The game hasn't started yet")
    else:
        return g.act(me["id"], action, d)


def handle(method, path, q, body, user=None):
    with COND:
        now = time.time()
        for code in [c for c, r in ROOMS.items() if now - r["touched"] > IDLE_SECS]:
            del ROOMS[code]
        if path == ["create"] and method == "POST":
            game = GAMES.get(body.get("game"))
            if not game or body.get("game") in HIDDEN():
                raise Err("Unknown game")
            if len(ROOMS) >= MAX_ROOMS:
                raise Err("Too many rooms open right now, try again later")
            p = new_player(text(body.get("name"), 18, "your name"), user)
            code = "".join(random.choice(CODE_CHARS) for _ in range(4))
            while code in ROOMS:
                code = "".join(random.choice(CODE_CHARS) for _ in range(4))
            room = {"code": code, "game": body["game"], "players": [p], "host": p["id"], "phase": "lobby", "version": 0, "touched": now}
            room["settings"] = {k: list(v["default"]) if v.get("multi") else v["default"] for k, v in game.SETTINGS.items()}
            room["g"] = game(room)
            ROOMS[code] = room
            return {"code": code, "token": p["token"], "game": room["game"]}
        room = ROOMS.get(str(q.get("code") or body.get("code") or "").strip().upper())
        if not room:
            raise Err("Room not found. Check the code?")
        if path == ["peek"]:
            return {"game": room["game"], "code": room["code"]}
        if path == ["join"] and method == "POST":
            name = text(body.get("name"), 18, "your name")
            if len(room["players"]) >= MAX_PLAYERS:
                raise Err("This room is full")
            if any(p["name"].lower() == name.lower() for p in room["players"]):
                raise Err("That name is taken in this room")
            p = new_player(name, user)
            room["players"].append(p)
            bump(room)
            return {"code": room["code"], "token": p["token"], "game": room["game"]}
        tok = str(q.get("token") or body.get("token") or "")
        me = next((p for p in room["players"] if hmac.compare_digest(p["token"], tok)), None)
        if not me:
            raise Err("You're not in this room")
        if path == ["state"]:
            since, end = int(q.get("since") or -1), time.time() + POLL_SECS
            while True:
                me["seen"] = time.time()
                if room["g"].tick():
                    bump(room)
                if room["version"] != since or time.time() >= end or room["code"] not in ROOMS:
                    break
                COND.wait(min(1.0, end - time.time()))
            return view(room, me)
        if path == ["act"] and method == "POST":
            if not room_act(room, me, str(body.get("action")), body):  # quiet actions (autosaves) don't wake everyone
                bump(room)
            return view(room, me)
    raise Err("Not found")


# ---------- content ----------
IMPOSTER_WORDS = [(cat, w.strip()) for cat, words in {
    "Food": "Pizza, Sushi, Pancakes, Tacos, Popcorn, Spaghetti, Chocolate, Burger, Croissant, Ice cream, Lasagna, Burrito, Doughnut, "
            "Waffles, Curry, Ramen, Hot dog, Cheesecake, Omelette, Nachos, Dumplings, Kebab, Smoothie, Bagel, Fondue",
    "Animal": "Penguin, Giraffe, Octopus, Kangaroo, Elephant, Owl, Shark, Butterfly, Camel, Panda, Dolphin, Zebra, Flamingo, Hedgehog, "
              "Crocodile, Koala, Peacock, Squirrel, Gorilla, Jellyfish, Tortoise, Parrot, Wolf, Bat, Spider",
    "Place": "Beach, Airport, Library, Hospital, Cinema, Zoo, Gym, Museum, Supermarket, Campsite, Castle, Casino, Prison, Bakery, "
             "Volcano, Desert, Farm, Stadium, Train station, Hotel, Church, Theme park, Lighthouse, Space station, Waterpark",
    "Object": "Umbrella, Toothbrush, Ladder, Candle, Backpack, Mirror, Pillow, Scissors, Clock, Bicycle, Hammer, Lamp, Wallet, "
              "Sunglasses, Remote control, Kettle, Toaster, Headphones, Suitcase, Calendar, Paintbrush, Magnet, Doormat, Stapler, Flashlight",
    "Job": "Firefighter, Teacher, Pilot, Chef, Dentist, Astronaut, Farmer, Detective, Plumber, Magician, Nurse, Lawyer, Police officer, "
           "Barber, Lifeguard, Mechanic, Journalist, Architect, Vet, Librarian, Electrician, Baker, Photographer, Judge, Zookeeper",
    "Sport or hobby": "Football, Chess, Skiing, Surfing, Bowling, Karate, Golf, Knitting, Fishing, Yoga, Tennis, Basketball, Boxing, "
                      "Swimming, Cycling, Gardening, Painting, Rock climbing, Skateboarding, Baseball, Archery, Fencing, Volleyball, Juggling, Dancing",
    "Country": "France, Japan, Brazil, Egypt, Canada, Australia, Italy, Mexico, India, China, Germany, Spain, Kenya, Norway, Greece, "
               "Argentina, Thailand, Ireland, Iceland, Russia, Peru, Morocco, Switzerland, New Zealand, South Korea",
    "Movie": "Titanic, Frozen, Jaws, Shrek, Toy Story, Star Wars, Jurassic Park, The Lion King, Harry Potter, Finding Nemo, Avatar, "
             "Home Alone, The Matrix, Ghostbusters, Up, Cars, Spider-Man, Batman, Mary Poppins, The Wizard of Oz, Back to the Future, "
             "Inception, Moana, Ratatouille, Barbie",
    "Famous character": "Sherlock Holmes, Santa Claus, Mickey Mouse, SpongeBob, Pikachu, Mario, Cinderella, Dracula, Superman, Peter Pan, "
                        "Elsa, Darth Vader, Sonic, Winnie the Pooh, Scooby-Doo, Homer Simpson, Tooth Fairy, Robin Hood, Frankenstein, "
                        "Pinocchio, Willy Wonka, Gandalf, Wonder Woman, Garfield, James Bond",
    "Clothing": "Jeans, Scarf, Raincoat, Pyjamas, Tuxedo, Sneakers, Flip-flops, Bow tie, Hoodie, Swimsuit, Wedding dress, Cowboy hat, "
                "Mittens, Socks, Crown, Apron, Kilt, Uniform, Beanie, Sweater",
    "Vehicle": "Helicopter, Submarine, Tractor, Ambulance, Hot air balloon, Motorbike, Bus, Rocket, Canoe, Taxi, Fire truck, Train, "
               "Scooter, Yacht, Tank, Limousine, Tram, Cable car, Jet ski, Golf cart",
    "Nature": "Rainbow, Waterfall, Thunderstorm, Glacier, Rainforest, Island, Cave, Tornado, Snowflake, Sunset, Earthquake, Coral reef, "
              "Mountain, River, Swamp, Avalanche, Iceberg, Northern lights, Geyser, Moon",
    "Music": "Guitar, Piano, Drums, Violin, Trumpet, Saxophone, Harp, Flute, Microphone, Karaoke, Orchestra, Concert, Opera, DJ, Rap, "
             "Lullaby, National anthem, Bagpipes, Accordion, Ukulele",
    "Event": "Birthday, Wedding, Halloween, Christmas, New Year's Eve, Graduation, Picnic, Sleepover, Barbecue, Road trip, Easter, "
             "Thanksgiving, Valentine's Day, Baby shower, Fireworks, Job interview, First date, Talent show, Prom, Carnival",
    "In the house": "Kitchen, Bathroom, Attic, Basement, Garage, Balcony, Bunk bed, Fridge, Bathtub, Fireplace, Sofa, Chandelier, "
                    "Staircase, Garden shed, Doorbell",
}.items() for w in words.split(",")]

ESTIMATES = [
    ("How many bones are in the adult human body?", "bones", 206),
    ("How tall is the Eiffel Tower, including its antennas?", "metres", 330),
    ("In what year did the Titanic sink?", "", 1912),
    ("How many keys does a standard piano have?", "keys", 88),
    ("How many member states does the United Nations have?", "countries", 193),
    ("How tall is Mount Everest?", "metres", 8849),
    ("How many minutes are in a week?", "minutes", 10080),
    ("In what year was the first iPhone released?", "", 2007),
    ("What is the average distance from Earth to the Moon?", "km", 384400),
    ("How many elements are in the periodic table?", "elements", 118),
    ("At what temperature does water boil at sea level?", "°F", 212),
    ("In what year did the Berlin Wall fall?", "", 1989),
    ("How long is a marathon?", "metres", 42195),
    ("How many teeth does an adult have, including wisdom teeth?", "teeth", 32),
    ("How many Earth days does it take Mars to orbit the Sun?", "days", 687),
    ("How many years did the Hundred Years' War actually last?", "years", 116),
    ("How fast does sound travel through air at 20 °C?", "metres per second", 343),
    ("How many countries are there in Africa?", "countries", 54),
    ("In what year did people first walk on the Moon?", "", 1969),
    ("How many stripes are on the flag of the United States?", "stripes", 13),
    ("How many time zones does Russia span?", "time zones", 11),
    ("How long is the Great Wall of China, including all its branches?", "km", 21196),
]

BLUFFS = [
    ("A group of flamingos is called a ___.", "flamboyance"),
    ("The national animal of Scotland is the ___.", "unicorn"),
    ("The plastic tip at the end of a shoelace is called an ___.", "aglet"),
    ("The dot above a lowercase “i” is called a ___.", "tittle"),
    ("Wombat poop is shaped like ___.", "cubes"),
    ("Another name for the # symbol is the ___.", "octothorpe"),
    ("Before alarm clocks, people paid a ___ to tap on their windows.", "knocker-upper"),
    ("The designer of the Pringles can had some of his ashes buried in a ___.", "Pringles can"),
    ("In Switzerland it is illegal to own just one ___.", "guinea pig"),
    ("A group of crows is called a ___.", "murder"),
    ("Under their white fur, polar bears have ___ skin.", "black"),
    ("Botanically speaking, bananas are ___.", "berries"),
    ("Sea otters hold ___ while they sleep so they don't drift apart.", "hands"),
    ("A baby puffin is called a ___.", "puffling"),
    ("The fear of the number 13 is called ___.", "triskaidekaphobia"),
    ("The tiny front pocket on jeans was first made to hold ___.", "pocket watches"),
    ("After he died, the inventor of the Frisbee was turned into a ___.", "Frisbee"),
    ("Cleopatra lived closer in time to the ___ than to the building of the Great Pyramid.", "Moon landing"),
    ("A day on Venus is longer than its ___.", "year"),
    ("Peanuts aren't nuts. They are ___.", "legumes"),
]

PROMPTS = [f"Who is most likely to {p}?" for p in [
    "become famous", "survive a zombie apocalypse", "forget their own birthday", "win a TV game show", "get lost even with GPS",
    "adopt ten cats", "become a millionaire", "laugh at the worst possible moment", "eat food off the floor", "start their own business",
    "cry at a cartoon", "sleep through three alarms", "win any argument", "travel to space", "become a world leader",
    "be late to their own wedding", "talk their way out of a parking ticket", "binge a whole series in one night", "befriend a stranger on a train",
    "still be awake at 3am", "trip over absolutely nothing", "know the answer to a random trivia question", "write a bestselling book",
    "go viral online", "plan the group holiday", "get a tattoo on a whim", "run away to join the circus", "secretly be a spy",
    "eat dessert first", "win this game"]]


# ---------- extra content (mp_content.py) ----------
def _rows(block):
    return [line.split("|") for line in block.strip().splitlines() if line.strip()]


for _cat, _words in mp_content.IMPOSTER_EXTRA.items():
    IMPOSTER_WORDS += [(_cat, w.strip()) for w in _words.split(",")]
IMPOSTER_CATS = sorted({c for c, _ in IMPOSTER_WORDS})
Imposter.SETTINGS["cats"] = {"label": "Categories", "options": [[c, c] for c in IMPOSTER_CATS], "default": IMPOSTER_CATS, "multi": True}
TRIVIA = [{"q": q, "options": opts, "answer": 0} for q, *opts in _rows(mp_content.TRIVIA)]
ESTIMATES += [(q, unit, float(a) if "." in a else int(a)) for q, unit, a in _rows(mp_content.ESTIMATES)]
BLUFFS += [(q, a) for q, a in _rows(mp_content.BLUFFS)]
PROMPTS += [f"Who is most likely to {p.strip()}?" for p in mp_content.PROMPTS.strip().splitlines() if p.strip()]
SPY_LOCATIONS = [x.strip() for x in mp_content.SPY_LOCATIONS.split(",")]
SPECTRUMS = [tuple(r) for r in _rows(mp_content.SPECTRUMS)]
BLITZ_CATEGORIES = [x.strip() for x in mp_content.BLITZ_CATEGORIES.split(",")]

# content drop 2
TRIVIA += [{"q": q, "options": opts, "answer": 0} for q, *opts in _rows(mp_content.TRIVIA_MORE)]
ESTIMATES += [(q, unit, float(a) if "." in a else int(a)) for q, unit, a in _rows(mp_content.ESTIMATES_MORE)]
BLUFFS += [(q, a) for q, a in _rows(mp_content.BLUFFS_MORE)]
PROMPTS += [f"Who is most likely to {p.strip()}?" for p in mp_content.PROMPTS_MORE.strip().splitlines() if p.strip()]
SPY_LOCATIONS += [x.strip() for x in mp_content.SPY_LOCATIONS_MORE.split(",") if x.strip()]
SPECTRUMS += [tuple(r) for r in _rows(mp_content.SPECTRUMS_MORE)]
for _n in (x.strip() for x in mp_content.SPECTRUM_NOUNS.split(",") if x.strip()):
    SPECTRUMS.append((f"Bad {_n}", f"Great {_n}"))
BLITZ_CATEGORIES += [x.strip() for x in mp_content.BLITZ_MORE.split(",") if x.strip()]
for _n in (x.strip() for x in mp_content.SPECTRUM_NOUNS_MORE.split(",") if x.strip()):
    SPECTRUMS.append((f"Bad {_n}", f"Great {_n}"))
for _line in mp_content.SPECTRUM_TEMPLATES.strip().splitlines():
    _ends, _nouns = _line.split(":", 1)
    _l, _r = _ends.split("|")
    SPECTRUMS += [(f"{_l} {n.strip()}", f"{_r} {n.strip()}") for n in _nouns.split(",") if n.strip()]
for _name in ("TRIVIA", "ESTIMATES", "BLUFFS", "PROMPTS", "SPY_LOCATIONS", "SPECTRUMS", "BLITZ_CATEGORIES"):  # drop accidental repeats
    _seen, _keep = set(), []
    for _x in globals()[_name]:
        _k = str(_x["q"] if isinstance(_x, dict) else _x[0] if _name in ("ESTIMATES", "BLUFFS") else _x).lower()
        if _k not in _seen:
            _seen.add(_k)
            _keep.append(_x)
    globals()[_name][:] = _keep
