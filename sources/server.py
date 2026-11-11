#!/usr/bin/env python3
"""Brain Games: tiny stdlib-only server (static files + JSON API for daily puzzles)."""
import base64
import datetime
import getpass
import json
import os
import re
import secrets
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import accounts
import siteconf
import multiplayer

ROOT = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(ROOT, "www")
DATA = os.environ.get("BG_DATA", os.path.join(ROOT, "data"))
PORT = int(os.environ.get("BG_PORT", "8095"))
CONF = os.path.join(DATA, "config.json")
PUZ = os.path.join(DATA, "puzzles.json")
multiplayer.PUZZLE_FILES = (os.path.join(ROOT, "seed.json"), PUZ)
multiplayer.ON_RESULT = accounts.mp_result
accounts.PATH, accounts.SECRET = os.path.join(DATA, "accounts.json"), lambda: config()["secret"]
accounts.BANS_PATH = os.path.join(DATA, "bans.json")
siteconf.PATH = os.path.join(DATA, "site.json")
accounts.CONFIG = siteconf.get
multiplayer.HIDDEN = lambda: siteconf.get()["hidden"]
multiplayer.CHEAT_MODE, multiplayer.SET_CHEATS = accounts.cheat_mode, accounts.set_cheats
GAMES = ("wordle", "connections", "scramble", "riddle", "trivia", "hangman", "wordsearch", "spellingbee", "cryptogram", "emoji")
EPOCH = datetime.date(2026, 1, 1)
LOCK = threading.Lock()
USER_COOKIE = f"bg_user_{PORT}"


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def config():
    c = load(CONF, {})
    if "secret" not in c:
        c["secret"] = secrets.token_hex(32)
        save(CONF, c)
    return c












def clean(game, p):
    """Validate and normalise a puzzle submitted from the admin panel."""
    s = lambda v, n=200: str(v or "").strip()[:n]
    if game == "wordle":
        w = s(p.get("word")).upper()
        if not re.fullmatch(r"[A-Z]{4,8}", w):
            raise ValueError("Word must be 4-8 letters (A-Z)")
        return {"word": w}
    if game == "connections":
        groups, seen = [], set()
        for i, g in enumerate(p.get("groups") or []):
            words = [s(w, 40).upper() for w in g.get("words") or [] if s(w)]
            if len(words) != 4:
                raise ValueError(f"Group {i + 1} needs exactly 4 words")
            groups.append({"name": s(g.get("name"), 80) or f"Group {i + 1}", "words": words})
            seen.update(words)
        if len(groups) != 4:
            raise ValueError("Need exactly 4 groups")
        if len(seen) != 16:
            raise ValueError("All 16 words must be different")
        return {"groups": groups}
    if game == "scramble":
        words = []
        for it in p.get("words") or []:
            w = s(it.get("word"), 30).upper()
            if not re.fullmatch(r"[A-Z]{3,15}", w):
                raise ValueError(f"'{w}' must be 3-15 letters (A-Z)")
            words.append({"word": w, "hint": s(it.get("hint"), 120)})
        if not 1 <= len(words) <= 10:
            raise ValueError("Give between 1 and 10 words")
        return {"words": words}
    if game == "riddle":
        q, answers = s(p.get("question"), 1000), [s(a, 100) for a in p.get("answers") or [] if s(a)]
        if not q or not answers:
            raise ValueError("Riddle needs a question and at least one answer")
        return {"question": q, "answers": answers[:10], "hint": s(p.get("hint"), 200)}
    if game == "trivia":
        qs = []
        for q in p.get("questions") or []:
            opts, a = [s(o, 120) for o in q.get("options") or [] if s(o)], q.get("answer")
            if not s(q.get("q")) or not 2 <= len(opts) <= 6 or not isinstance(a, int) or not 0 <= a < len(opts):
                raise ValueError(f"Question {len(qs) + 1}: needs text, 2-6 options and one marked correct")
            qs.append({"q": s(q.get("q"), 300), "options": opts, "answer": a})
        if not 1 <= len(qs) <= 15:
            raise ValueError("Give between 1 and 15 questions")
        return {"questions": qs}
    if game == "hangman":
        ph = re.sub(r"\s+", " ", s(p.get("phrase"), 60).upper())
        if not re.fullmatch(r"[A-Z0-9 ,.'!?&-]{2,60}", ph) or not re.search("[A-Z]", ph):
            raise ValueError("Phrase: 2-60 characters, letters A-Z (spaces and basic punctuation allowed)")
        return {"phrase": ph, "category": s(p.get("category"), 60)}
    if game == "spellingbee":
        letters = re.sub(r"[^A-Z]", "", s(p.get("letters"), 30).upper())
        if len(letters) != 7 or len(set(letters)) != 7:
            raise ValueError("Need exactly 7 different letters (centre letter first)")
        words = sorted({s(w, 30).upper() for w in p.get("words") or [] if s(w)})
        bad = [w for w in words if len(w) < 4 or letters[0] not in w or set(w) - set(letters)]
        if bad:
            raise ValueError("Invalid words (too short, missing centre letter or other letters): " + ", ".join(bad[:10]))
        if not 1 <= len(words) <= 300:
            raise ValueError("Give between 1 and 300 words")
        return {"letters": letters, "words": words}
    if game == "cryptogram":
        q = re.sub(r"\s+", " ", s(p.get("quote"), 300).upper())
        if len(re.findall("[A-Z]", q)) < 10:
            raise ValueError("Quote needs at least 10 letters (A-Z)")
        return {"quote": q, "author": s(p.get("author"), 80)}
    if game == "emoji":
        items = []
        for it in p.get("items") or []:
            e, ans = s(it.get("emoji"), 40), [s(a, 80) for a in it.get("answers") or [] if s(a)]
            if not e or not ans:
                raise ValueError(f"Puzzle {len(items) + 1} needs emojis and an answer")
            items.append({"emoji": e, "answers": ans[:5], "hint": s(it.get("hint"), 100)})
        if not 1 <= len(items) <= 10:
            raise ValueError("Give between 1 and 10 puzzles")
        return {"items": items}
    if game == "wordsearch":
        words = list(dict.fromkeys(s(w, 20).upper() for w in p.get("words") or [] if s(w)))
        if not 4 <= len(words) <= 12 or not all(re.fullmatch(r"[A-Z]{3,10}", w) for w in words):
            raise ValueError("Give 4-12 different words of 3-10 letters (A-Z)")
        return {"words": words, "theme": s(p.get("theme"), 60)}
    raise ValueError("Unknown game")


def puzzle_for(game, day):
    """Today's puzzle; if none is scheduled, replay one from the archive."""
    pz, key = load(PUZ, {}).get(game, {}), day.isoformat()
    out = {"date": key, "number": (day - EPOCH).days + 1}
    if key in pz:
        return {**out, "data": pz[key]}
    pool = sorted(d for d in pz if d < key)
    return {**out, "data": pz[pool[day.toordinal() % len(pool)]], "rerun": True} if pool else None


class Denied(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WWW, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        if not self.path.startswith("/api/"):  # make browsers re-check pages and scripts, so upgrades never mix old and new files
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)

    def send_json(self, obj, status=200, user_cookie=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if user_cookie is not None:
            self.send_header("Set-Cookie", f"{USER_COOKIE}={user_cookie}; Path=/; Max-Age={accounts.TTL if user_cookie else 0}; HttpOnly; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("Body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return ""

    def user(self):
        return accounts.user_from_token(self.cookie(USER_COOKIE))

    def account(self, method, p):
        if p == ["me"]:
            return self.send_json({"user": accounts.profile(self.user())})
        if method != "POST":
            raise ValueError("Bad request")
        b = self.body()
        if p in (["login"], ["register"]):
            key, tok = (accounts.register if p == ["register"] else accounts.login)(b.get("name"), b.get("password"), self.ip())
            return self.send_json({"user": accounts.profile(key)}, user_cookie=tok)
        if p == ["logout"]:
            return self.send_json({"ok": True}, user_cookie="")
        key = self.user()
        if not key:
            return self.send_json({"error": "Sign in first"}, 401)
        if p == ["record"]:
            accounts.record(key, b)
            return self.send_json({"user": accounts.profile(key)})
        if p == ["credentials"]:
            key, tok = accounts.credentials(key, b.get("current"), b.get("name"), b.get("password"), self.ip())
            return self.send_json({"user": accounts.profile(key)}, user_cookie=tok)
        if p == ["cheats"]:
            accounts.set_cheats(key, b.get("on"))
            return self.send_json({"user": accounts.profile(key)})
        raise ValueError("Not found")

    def ip(self):  # the server only listens on localhost, so X-Real-IP always comes from nginx
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def banned(self):
        if not accounts.is_ip_banned(self.ip()):
            return False
        if self.path.startswith("/api/"):
            self.send_json({"error": "You have been banned from this site"}, 403)
        else:
            body = "<!doctype html><meta charset=utf-8><title>Banned</title><body style='font:18px system-ui;text-align:center;padding:60px'><h1>🚫</h1>You have been banned from this site.".encode()
            self.send_response(403)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        return True

    def staff(self, need):
        """The signed-in account if its role is at least `need` (writer < admin < super), else refuse."""
        key = self.user()
        role, must_change = accounts.staff(key)
        if not key:
            raise Denied(401, "Sign in with an admin account")
        if must_change:
            raise Denied(403, "Change the default username and password first")
        if accounts.RANK.get(role, 0) < accounts.RANK[need]:
            raise Denied(403, "Your account doesn't have permission for that")
        return key, role


    def do_GET(self):
        if self.banned():
            return
        if self.path.startswith("/api/"):
            return self.api("GET")
        super().do_GET()

    def do_POST(self):
        if not self.banned():
            self.api("POST")

    def do_PUT(self):
        if not self.banned():
            self.api("PUT")

    def do_DELETE(self):
        if not self.banned():
            self.api("DELETE")

    def api(self, method):
        try:
            self.route(method, self.path.split("?")[0].strip("/").split("/")[1:])
        except Denied as e:
            self.send_json({"error": str(e)}, e.status)
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            self.send_json({"error": str(e)}, 400)

    def route(self, method, p):
        today = datetime.date.today()
        if p[:1] == ["account"]:
            return self.account(method, p[1:])
        if p == ["leaderboard"] and method == "GET":
            if not siteconf.get()["leaderboard"]:
                return self.send_json({"disabled": True, "top": [], "me": None, "players": 0})
            return self.send_json(accounts.leaderboard(self.user()))
        if p == ["site"] and method == "GET":
            return self.send_json(siteconf.get())
        if p[:1] == ["mp"]:
            query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            return self.send_json(multiplayer.handle(method, p[1:], query, self.body() if method == "POST" else {}, self.user()))
        if method == "GET" and len(p) == 2 and p[0] == "daily" and p[1] in GAMES:
            r = puzzle_for(p[1], today)
            if not r:
                return self.send_json({"error": "No puzzle yet"}, 404)
            r["data"] = base64.b64encode(json.dumps(r["data"]).encode()).decode()  # no casual spoilers
            return self.send_json(r)
        if p[:1] != ["admin"]:
            return self.send_json({"error": "Not found"}, 404)
        p = [unquote(x) for x in p]
        if p == ["admin", "whoami"]:
            return self.send_json({"user": accounts.profile(self.user())})
        if p == ["admin", "puzzles"] and method == "GET":
            self.staff("writer")
            return self.send_json({"today": today.isoformat(), "puzzles": load(PUZ, {})})
        if p == ["admin", "accounts"] and method == "GET":
            _, role = self.staff("admin")
            return self.send_json({"accounts": accounts.admin_list(role)})
        if len(p) == 3 and p[1] == "accounts" and method == "DELETE":
            _, role = self.staff("admin")
            accounts.admin_delete(p[2], role)
            return self.send_json({"ok": True})
        if len(p) == 4 and p[1] == "accounts" and method == "POST":
            self.staff("super")
            b = self.body()
            if p[3] == "role":
                accounts.set_role(p[2], b.get("role") or None)
            elif p[3] == "ban":
                accounts.set_ban(p[2], b.get("banned"))
            elif p[3] == "stats":
                accounts.set_stats(p[2], b)
            elif p[3] == "ipban":
                return self.send_json({"ips": accounts.ip_ban_account(p[2], self.ip())})
            else:
                raise ValueError("Not found")
            return self.send_json({"ok": True})
        if p == ["admin", "site"] and method == "PUT":
            self.staff("admin")
            return self.send_json(siteconf.save(self.body()))
        if p == ["admin", "bans"]:
            self.staff("super")
            if method == "POST":
                b = self.body()
                accounts.add_ip_ban(b.get("ip"), b.get("note"), self.ip())
            return self.send_json({"bans": accounts.ip_bans(), "yourIp": self.ip()})
        if len(p) == 3 and p[1] == "bans" and method == "DELETE":
            self.staff("super")
            accounts.remove_ip_ban(p[2])
            return self.send_json({"ok": True})
        if len(p) == 4 and p[1] == "puzzles" and p[2] in GAMES and method in ("PUT", "DELETE"):
            self.staff("writer")
            if not re.fullmatch(r"\d{4}-\d\d-\d\d", p[3]):
                raise ValueError("Bad date")
            datetime.date.fromisoformat(p[3])
            with LOCK:
                db = load(PUZ, {})
                g = db.setdefault(p[2], {})
                if method == "PUT":
                    g[p[3]] = clean(p[2], self.body())
                else:
                    g.pop(p[3], None)
                save(PUZ, db)
            return self.send_json({"ok": True, "data": g.get(p[3])})
        self.send_json({"error": "Not found"}, 404)


def main():
    if sys.argv[1:] == ["set-password"]:  # recovery: reset the super admin account's password
        pw = getpass.getpass("New super admin password: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\r\n")
        if len(pw) < 6:
            sys.exit("Password too short (6+ characters)")
        os.makedirs(DATA, exist_ok=True)
        return print(f"Password updated for super admin account '{accounts.reset_super(pw)}'.")
    # Queue bundled puzzles (seed.json) once each: never overwrite the admin's own puzzles,
    # and never bring back one the admin deleted.
    db, seed, c = load(PUZ, {}), load(os.path.join(ROOT, "seed.json"), {}), config()
    applied = set(c.get("seeded", []))
    new = [(g, d) for g, days in seed.items() for d in days if f"{g}/{d}" not in applied]
    if new:
        for g, d in new:
            db.setdefault(g, {}).setdefault(d, seed[g][d])
        c["seeded"] = sorted(applied | {f"{g}/{d}" for g, d in new})
        save(PUZ, db)
        save(CONF, c)
    if accounts.ensure_admin():
        print("Created the default super admin account: admin / admin. Sign in and change it right away!", flush=True)
    print(f"Brain Games listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
