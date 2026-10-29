#!/usr/bin/env python3
"""Brain Games: tiny stdlib-only server (static files + JSON API for daily puzzles)."""
import base64
import datetime
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(ROOT, "www")
DATA = os.environ.get("BG_DATA", os.path.join(ROOT, "data"))
PORT = int(os.environ.get("BG_PORT", "8095"))
CONF = os.path.join(DATA, "config.json")
PUZ = os.path.join(DATA, "puzzles.json")
GAMES = ("wordle", "connections", "scramble", "riddle", "trivia", "hangman", "wordsearch", "spellingbee", "cryptogram", "emoji")
EPOCH = datetime.date(2026, 1, 1)
LOCK = threading.Lock()
COOKIE = f"bg_admin_{PORT}"
SESSION_TTL = 7 * 86400


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


def hash_pw(pw, salt=None, it=200_000):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), it).hex()
    return f"pbkdf2${it}${salt}${digest}"


def check_pw(pw, stored):
    try:
        _, it, salt, _ = stored.split("$")
        return hmac.compare_digest(hash_pw(pw, salt, int(it)), stored)
    except (AttributeError, ValueError):
        return False


def sign(secret, msg):
    return hmac.new(secret.encode(), msg.encode(), "sha256").hexdigest()


def make_token(secret):
    exp = str(int(time.time()) + SESSION_TTL)
    return exp + "." + sign(secret, exp)


def valid_token(tok, secret):
    exp, _, sig = tok.partition(".")
    return exp.isdigit() and int(exp) > time.time() and hmac.compare_digest(sig, sign(secret, exp))


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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WWW, **kw)

    def log_message(self, *a):
        pass

    def list_directory(self, path):
        self.send_error(404)

    def send_json(self, obj, status=200, cookie=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", f"{COOKIE}={cookie}; Path=/; Max-Age={SESSION_TTL if cookie else 0}; HttpOnly; SameSite=Strict")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise ValueError("Body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def is_admin(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                return valid_token(v, config()["secret"])
        return False

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        super().do_GET()

    def do_POST(self):
        self.api("POST")

    def do_PUT(self):
        self.api("PUT")

    def do_DELETE(self):
        self.api("DELETE")

    def api(self, method):
        try:
            self.route(method, self.path.split("?")[0].strip("/").split("/")[1:])
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            self.send_json({"error": str(e)}, 400)

    def route(self, method, p):
        today = datetime.date.today()
        if method == "GET" and len(p) == 2 and p[0] == "daily" and p[1] in GAMES:
            r = puzzle_for(p[1], today)
            if not r:
                return self.send_json({"error": "No puzzle yet"}, 404)
            r["data"] = base64.b64encode(json.dumps(r["data"]).encode()).decode()  # no casual spoilers
            return self.send_json(r)
        if p == ["admin", "login"] and method == "POST":
            c = config()
            if check_pw(str(self.body().get("password", "")), c.get("password")):
                return self.send_json({"ok": True}, cookie=make_token(c["secret"]))
            time.sleep(1)
            return self.send_json({"error": "Wrong password"}, 403)
        if p == ["admin", "logout"]:
            return self.send_json({"ok": True}, cookie="")
        if p[:1] != ["admin"]:
            return self.send_json({"error": "Not found"}, 404)
        if not self.is_admin():
            return self.send_json({"error": "Login required"}, 401)
        if p == ["admin", "puzzles"] and method == "GET":
            return self.send_json({"today": today.isoformat(), "puzzles": load(PUZ, {})})
        if len(p) == 4 and p[1] == "puzzles" and p[2] in GAMES and method in ("PUT", "DELETE"):
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
    if sys.argv[1:] == ["set-password"]:
        pw = getpass.getpass("New admin password: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\r\n")
        if len(pw) < 4:
            sys.exit("Password too short")
        c = config()
        c.update(password=hash_pw(pw), secret=secrets.token_hex(32))  # new secret logs out old sessions
        save(CONF, c)
        return print("Admin password updated.")
    db, seed = load(PUZ, {}), load(os.path.join(ROOT, "seed.json"), {})
    missing = {g: v for g, v in seed.items() if not db.get(g)}  # sample puzzles for games added in an upgrade
    if missing:
        save(PUZ, {**db, **missing})
    if "password" not in config():
        print("No admin password set: run 'server.py set-password'", flush=True)
    print(f"Brain Games listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
