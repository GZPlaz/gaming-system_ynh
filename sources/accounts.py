"""Player accounts: sign-up, sign-in, saved stats and the global leaderboard (kept in one JSON file)."""
import datetime
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import threading
import time

LOCK = threading.Lock()
PATH = ""  # set by server.py
BANS_PATH = ""  # set by server.py
SECRET = lambda: ""  # set by server.py: returns the cookie-signing secret
TTL = 90 * 86400
POINTS = {"daily": 100, "daily_try": 25, "win": 10, "play": 2, "mp_win": 30, "mp_play": 10}
CAPS = {"play": 200, "mp": 300}  # most points per day from anytime and multiplayer games
MAX_ACCOUNTS = 20000
_db = None
_bans = None
RANK = {"writer": 1, "admin": 2, "super": 3}  # game writer < full admin < super admin
RESERVED = {"admin", "administrator", "root", "superadmin", "moderator", "mod", "staff", "system"}
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


def _ban_db():
    global _bans
    if _bans is None:
        try:
            with open(BANS_PATH, encoding="utf-8") as f:
                _bans = json.load(f)
        except FileNotFoundError:
            _bans = {"ips": {}}
    return _bans


def _save_bans():
    tmp = BANS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_bans, f, indent=1)
    os.replace(tmp, BANS_PATH)


def _seen(u, ip):  # remember the last few addresses an account used, for IP bans
    if ip:
        u["ips"] = ([ip] + [x for x in u.get("ips", []) if x != ip])[:5]


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
    return key if u and not u.get("banned") and hmac.compare_digest(sig, _sig(key, exp, u["pw"])) else None


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
        if key in db or key in RESERVED:
            raise Err("That username is taken")
        if len(db) >= MAX_ACCOUNTS:
            raise Err("Sign-ups are closed right now")
        db[key] = {"name": name, "pw": _hash(pw), "joined": _today(), **_blank()}
        _seen(db[key], ip)
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
    if u.get("banned"):
        raise Err("This account has been banned")
    with LOCK:
        _seen(u, ip)
        _save()
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
        if u and not u.get("cheats"):  # games played with cheats on don't count
            u["mpPlayed"] += 1
            u["mpWins"] += won
            _add(u, POINTS["mp_win" if won else "mp_play"], "mp")
            _save()


def _ranked(db):
    return sorted((k for k, u in db.items() if u["points"] > 0 and not u.get("banned")), key=lambda k: (-db[k]["points"], -db[k]["dailySolved"], db[k]["joined"]))


def profile(key):
    with LOCK:
        db = _users()
        u = db.get(key) if key else None
        if not u:
            return None
        order = _ranked(db)
        cur, best = _streaks(u["days"])
        return {"name": u["name"], "joined": u["joined"], "points": u["points"], "rank": order.index(key) + 1 if key in order else None,
                "streak": cur, "bestStreak": best, "role": u.get("role"), "mustChange": bool(u.get("mustChange")),
                "cheats": bool(u.get("cheats")) if u.get("role") == "super" else None, **{k: u[k] for k in ("dailySolved", "dailyPlayed", "played", "wins", "mpPlayed", "mpWins", "best")}}


def leaderboard(key):
    with LOCK:
        db = _users()
        order = _ranked(db)
        top = [{"rank": i + 1, "name": db[k]["name"], "points": db[k]["points"], "streak": _streaks(db[k]["days"])[0],
                "dailySolved": db[k]["dailySolved"], "wins": db[k]["wins"] + db[k]["mpWins"]} for i, k in enumerate(order[:100])]
        me = {"rank": order.index(key) + 1 if key in order else None, "points": db[key]["points"]} if key in db else None
        return {"top": top, "me": me, "players": len(order)}


def ensure_admin():
    """Create the default super admin (admin / admin, must change on first sign-in) when there is none."""
    with LOCK:
        db = _users()
        if any(u.get("role") == "super" for u in db.values()):
            return False
        if "admin" in db:  # a player registered "admin" before roles existed: move them aside
            n = 1
            while f"admin_{n}" in db:
                n += 1
            db[f"admin_{n}"] = {**db.pop("admin"), "name": f"admin_{n}"}
        db["admin"] = {"name": "admin", "pw": _hash("admin"), "joined": _today(), "role": "super", "mustChange": True, **_blank()}
        _save()
        return True


def reset_super(pw):
    """Command-line recovery: set the super admin's password (and lift any ban)."""
    ensure_admin()
    with LOCK:
        key, u = next((k, u) for k, u in _users().items() if u.get("role") == "super")
        u.update(pw=_hash(pw), mustChange=False, banned=False)
        _save()
        return u["name"]


def staff(key):
    """(role, must_change) for a signed-in account."""
    with LOCK:
        u = _users().get(key) if key else None
        return (u.get("role"), bool(u.get("mustChange"))) if u else (None, False)


def credentials(key, current, new_name, new_pw, ip=None):
    new_name, new_pw = str(new_name or "").strip(), str(new_pw or "")
    with LOCK:
        db = _users()
        u = db.get(key)
        if not u or not _check(str(current or ""), u["pw"]):
            raise Err("Your current password is wrong")
        new_name = new_name or u["name"]
        new_key = new_name.lower()
        if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", new_name):
            raise Err("Usernames are 3–20 letters, numbers or _")
        if new_key != key and (new_key in db or new_key in RESERVED):
            raise Err("That username is taken")
        if len(new_pw) < 6:
            raise Err("Use a new password of at least 6 characters")
        if _check(new_pw, u["pw"]):
            raise Err("Pick a password different from the current one")
        u.update(name=new_name, pw=_hash(new_pw), mustChange=False)
        _seen(u, ip)
        if new_key != key:
            db[new_key] = db.pop(key)
        _save()
        return new_key, _token(new_key, u)


def set_cheats(key, on):
    with LOCK:
        u = _users().get(key)
        if not u or u.get("role") != "super" or u.get("mustChange"):
            raise Err("Only the super admin can use cheats")
        u["cheats"] = bool(on)
        _save()


def cheat_mode(key):
    """None if this account can't use cheats, else whether they are switched on."""
    with LOCK:
        u = _users().get(key) if key else None
        return bool(u.get("cheats")) if u and u.get("role") == "super" and not u.get("mustChange") else None


def admin_list(viewer_role):
    with LOCK:
        rows = [{"name": u["name"], "points": u["points"], "joined": u["joined"], "role": u.get("role"), "banned": bool(u.get("banned")),
                 **({"ips": u.get("ips", [])} if viewer_role == "super" else {})} for u in _users().values()]
    return sorted(rows, key=lambda a: (-RANK.get(a["role"], 0), -a["points"]))


def _target(name):
    u = _users().get(str(name).lower())
    if not u:
        raise Err("No such account")
    return u


def set_role(name, role):
    if role not in (None, "admin", "writer"):
        raise Err("Unknown role")
    with LOCK:
        u = _target(name)
        if u.get("role") == "super":
            raise Err("The super admin's role can't be changed")
        u["role"] = role
        _save()


def set_ban(name, banned):
    with LOCK:
        u = _target(name)
        if u.get("role") == "super":
            raise Err("The super admin can't be banned")
        u["banned"] = bool(banned)
        _save()


def _valid_ip(ip):
    try:
        return str(ipaddress.ip_address(str(ip).strip()))
    except ValueError:
        raise Err("That isn't a valid IP address")


def add_ip_ban(ip, note, actor_ip):
    ip = _valid_ip(ip)
    if ip == actor_ip:
        raise Err("That's your own IP address")
    with LOCK:
        _ban_db()["ips"][ip] = {"note": str(note or "")[:60], "at": _today()}
        _save_bans()
    return ip


def ip_ban_account(name, actor_ip):
    with LOCK:
        u = _target(name)
        if u.get("role") == "super":
            raise Err("The super admin can't be banned")
        ips = [ip for ip in u.get("ips", []) if ip != actor_ip]
        if not ips:
            raise Err("No known IP address for this account")
        for ip in ips:
            _ban_db()["ips"][ip] = {"note": u["name"], "at": _today()}
        _save_bans()
    return ips


def remove_ip_ban(ip):
    with LOCK:
        if _ban_db()["ips"].pop(str(ip).strip(), None) is None:
            raise Err("That IP isn't banned")
        _save_bans()


def ip_bans():
    with LOCK:
        return [{"ip": ip, **b} for ip, b in sorted(_ban_db()["ips"].items())]


def is_ip_banned(ip):
    with LOCK:
        return ip in _ban_db()["ips"]


def admin_delete(name, actor_role):
    with LOCK:
        u = _target(name)
        if u.get("role") == "super" or (u.get("role") and actor_role != "super"):
            raise Err("Only the super admin can delete staff accounts" if u.get("role") != "super" else "The super admin can't be deleted")
        _users().pop(str(name).lower())
        _save()
