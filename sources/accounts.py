"""Player accounts: sign-up, sign-in, saved stats and the global leaderboard (kept in one JSON file)."""
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

LOCK = threading.Lock()
PATH = ""  # set by server.py
SECRET = lambda: ""  # set by server.py: returns the cookie-signing secret
TTL = 90 * 86400
POINTS = {"daily": 100, "daily_try": 25, "win": 10, "play": 2, "mp_win": 30, "mp_play": 10}
CAPS = {"play": 200, "mp": 300}  # most points per day from anytime and multiplayer games
MAX_ACCOUNTS = 20000
_db = None
_signups = {}  # ip -> recent sign-up times


class Err(ValueError):
    pass


def _users():
    global _db
    if _db is None:
        try:
            with open(PATH, encoding="utf-8") as f:
                _db = json.load(f)
        except FileNotFoundError:
            _db = {}
    return _db


def _save():
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_db, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, PATH)


def _today():
    return datetime.date.today().isoformat()


def _hash(pw, salt=None, it=150_000):
    salt = salt or secrets.token_hex(16)
    return f"pbkdf2${it}${salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), it).hex()}"


def _check(pw, stored):
    try:
        _, it, salt, _ = stored.split("$")
        return hmac.compare_digest(_hash(pw, salt, int(it)), stored)
    except (AttributeError, ValueError):
        return False


def _sig(key, exp, pw_hash):  # tied to the password hash, so changing it signs everyone out
    return hmac.new(SECRET().encode(), f"user:{key}:{exp}:{pw_hash[-16:]}".encode(), "sha256").hexdigest()


def _token(key, u):
    exp = str(int(time.time()) + TTL)
    return f"{key}.{exp}.{_sig(key, exp, u['pw'])}"


def user_from_token(tok):
    key, exp, sig = (str(tok).split(".") + ["", "", ""])[:3]
    if not exp.isdigit() or int(exp) < time.time():
        return None
    with LOCK:
        u = _users().get(key)
    return key if u and hmac.compare_digest(sig, _sig(key, exp, u["pw"])) else None


def _blank():
    return {"points": 0, "daily": {}, "days": [], "dailySolved": 0, "dailyPlayed": 0, "played": 0, "wins": 0,
            "mpPlayed": 0, "mpWins": 0, "best": {}, "capDay": "", "capPlay": 0, "capMp": 0}


def register(name, pw, ip):
    name, pw = str(name or "").strip(), str(pw or "")
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", name):
        raise Err("Usernames are 3–20 letters, numbers or _")
    if len(pw) < 6:
        raise Err("Use a password of at least 6 characters")
    now = time.time()
    recent = [t for t in _signups.get(ip, []) if now - t < 3600]
    if len(recent) >= 5:
        raise Err("Too many new accounts from here. Try again later.")
    with LOCK:
        db, key = _users(), name.lower()
        if key in db:
            raise Err("That username is taken")
        if len(db) >= MAX_ACCOUNTS:
            raise Err("Sign-ups are closed right now")
        db[key] = {"name": name, "pw": _hash(pw), "joined": _today(), **_blank()}
        _save()
        _signups[ip] = recent + [now]
        return key, _token(key, db[key])


def login(name, pw, ip=None):
    key = str(name or "").strip().lower()
    with LOCK:
        u = _users().get(key)
    if not u or not _check(str(pw or ""), u["pw"]):
        time.sleep(1)
        raise Err("Wrong username or password")
    return key, _token(key, u)


def _add(u, pts, cap=None):
    if u["capDay"] != _today():
        u.update(capDay=_today(), capPlay=0, capMp=0)
    if cap:
        field = "capPlay" if cap == "play" else "capMp"
        pts = max(0, min(pts, CAPS[cap] - u[field]))
        u[field] += pts
    u["points"] += pts


def _streaks(days):
    ds = sorted({datetime.date.fromisoformat(d) for d in days})
    best = run = 0
    prev = None
    for d in ds:
        run = run + 1 if prev and (d - prev).days == 1 else 1
        best, prev = max(best, run), d
    return (run if ds and (datetime.date.today() - ds[-1]).days <= 1 else 0), best


def record(key, b):
    kind, game, won = b.get("kind"), str(b.get("game") or "")[:30], b.get("won") is not False
    if not re.fullmatch(r"[a-z0-9]+", game):
        raise Err("Unknown game")
    with LOCK:
        u = _users().get(key)
        if not u:
            raise Err("Account not found")
        if kind == "daily":
            date = str(b.get("date") or "")
            try:
                age = abs((datetime.date.fromisoformat(date) - datetime.date.today()).days)
            except ValueError:
                raise Err("Bad date")
            if age > 1 or u["daily"].get(game) == date:
                return  # too old, or already counted
            u["daily"][game] = date
            u["dailyPlayed"] += 1
            u["dailySolved"] += won
            if date not in u["days"]:
                u["days"] = (u["days"] + [date])[-800:]
            _add(u, POINTS["daily" if won else "daily_try"])
        elif kind == "play":
            u["played"] += 1
            u["wins"] += won
            _add(u, POINTS["win" if won else "play"], "play")
            best = b.get("best")
            if isinstance(best, (int, float)) and not isinstance(best, bool) and abs(best) < 1e9:
                k = game + (":" + str(b["label"])[:16] if b.get("label") else "")
                old = u["best"].get(k)
                if old is None or (best < old if b.get("lower") else best > old):
                    u["best"][k] = best
        else:
            raise Err("Unknown record")
        _save()


def mp_result(key, won):
    with LOCK:
        u = _users().get(key)
        if u:
            u["mpPlayed"] += 1
            u["mpWins"] += won
            _add(u, POINTS["mp_win" if won else "mp_play"], "mp")
            _save()


def _ranked(db):
    return sorted((k for k, u in db.items() if u["points"] > 0), key=lambda k: (-db[k]["points"], -db[k]["dailySolved"], db[k]["joined"]))


def profile(key):
    with LOCK:
        db = _users()
        u = db.get(key) if key else None
        if not u:
            return None
        order = _ranked(db)
        cur, best = _streaks(u["days"])
        return {"name": u["name"], "joined": u["joined"], "points": u["points"], "rank": order.index(key) + 1 if key in order else None,
                "streak": cur, "bestStreak": best, **{k: u[k] for k in ("dailySolved", "dailyPlayed", "played", "wins", "mpPlayed", "mpWins", "best")}}


def leaderboard(key):
    with LOCK:
        db = _users()
        order = _ranked(db)
        top = [{"rank": i + 1, "name": db[k]["name"], "points": db[k]["points"], "streak": _streaks(db[k]["days"])[0],
                "dailySolved": db[k]["dailySolved"], "wins": db[k]["wins"] + db[k]["mpWins"]} for i, k in enumerate(order[:100])]
        me = {"rank": order.index(key) + 1 if key in order else None, "points": db[key]["points"]} if key in db else None
        return {"top": top, "me": me, "players": len(order)}


def admin_list():
    with LOCK:
        db = _users()
        return sorted(({"name": u["name"], "points": u["points"], "joined": u["joined"]} for u in db.values()), key=lambda a: -a["points"])


def admin_delete(name):
    with LOCK:
        if _users().pop(str(name).lower(), None) is None:
            raise Err("No such account")
        _save()
