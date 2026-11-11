"""Site customisation (name, colours, banner, hidden games, points...), kept in one JSON file."""
import json
import os
import re
import threading

LOCK = threading.Lock()
PATH = ""  # set by server.py
DEFAULTS = {
    "name": "Brain Games", "logo": "🧠", "tagline": "", "footer": "", "accent": "#6c5cf6", "accent2": "#a46cfa",
    "banner": {"on": False, "text": "", "style": "info", "link": "", "linkText": ""},
    "hidden": [], "signups": True, "leaderboard": True,
    "points": {"daily": 100, "daily_try": 25, "win": 10, "play": 2, "mp_win": 30, "mp_play": 10, "cap_play": 200, "cap_mp": 300},
}
_cache = None


def _copy(o):
    return json.loads(json.dumps(o))


def get():
    global _cache
    with LOCK:
        if _cache is None:
            try:
                with open(PATH, encoding="utf-8") as f:
                    stored = json.load(f)
            except (FileNotFoundError, ValueError):
                stored = {}
            _cache = _copy(DEFAULTS)
            for k, v in stored.items():
                if isinstance(_cache.get(k), dict) and isinstance(v, dict):
                    _cache[k].update({kk: vv for kk, vv in v.items() if kk in _cache[k]})
                elif k in _cache:
                    _cache[k] = v
        return _copy(_cache)


def clean(b):
    t = lambda v, n: re.sub(r"\s+", " ", str(v or "")).strip()[:n]
    color = lambda v, d: v if re.fullmatch(r"#[0-9a-fA-F]{6}", str(v or "")) else d
    bn, pts = b.get("banner") or {}, b.get("points") or {}
    link = t(bn.get("link"), 300)
    if link and not re.match(r"^(https?://|/|#)", link):
        raise ValueError("Banner links must start with https://, http://, / or #")
    return {
        "name": t(b.get("name"), 40) or DEFAULTS["name"], "logo": t(b.get("logo"), 8) or DEFAULTS["logo"],
        "tagline": t(b.get("tagline"), 120), "footer": t(b.get("footer"), 160),
        "accent": color(b.get("accent"), DEFAULTS["accent"]), "accent2": color(b.get("accent2"), DEFAULTS["accent2"]),
        "banner": {"on": bool(bn.get("on")), "text": t(bn.get("text"), 280), "link": link, "linkText": t(bn.get("linkText"), 40),
                   "style": bn.get("style") if bn.get("style") in ("info", "success", "warning", "danger") else "info"},
        "hidden": [g for g in b.get("hidden") or [] if re.fullmatch(r"[a-z0-9]{1,30}", str(g))][:100],
        "signups": bool(b.get("signups", True)), "leaderboard": bool(b.get("leaderboard", True)),
        "points": {k: max(0, min(100000, int(pts.get(k, v)))) for k, v in DEFAULTS["points"].items()},
    }


def save(body):
    global _cache
    c = clean(body)
    with LOCK:
        tmp = PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f, ensure_ascii=False, indent=1)
        os.replace(tmp, PATH)
        _cache = c
    return _copy(c)
