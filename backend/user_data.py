"""Single-user persistent application data with bounded, atomic JSON writes."""
import json
import os
import tempfile
import threading
from copy import deepcopy


USER_DATA_FILE = os.environ.get(
    "FINFORGE_USER_DATA_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "user-data.json"),
)

_LOCK = threading.RLock()
_SECTIONS = {
    "profile",
    "watchlist",
    "stockChats",
    "watchlistChats",
    "aiWatchLocks",
    "alerts",
}
_MAX_BYTES = {
    "profile": 512_000,
    "watchlist": 8_000,
    "stockChats": 1_200_000,
    "watchlistChats": 1_500_000,
    "aiWatchLocks": 4_000,
    "alerts": 4_000,
}


def _defaults():
    return {
        "version": 1,
        "profile": {},
        "watchlist": [],
        "stockChats": [],
        "watchlistChats": [],
        "aiWatchLocks": [],
        "alerts": {"enabled": False, "intervalMin": 30},
    }


def _bounded(value, section):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > _MAX_BYTES[section]:
        raise ValueError(f"{section} 数据超过大小限制")
    return value


def _codes(value, limit):
    result = []
    for item in value if isinstance(value, list) else []:
        code = str(item or "").strip()
        if code.isdigit() and len(code) == 6 and code not in result:
            result.append(code)
        if len(result) >= limit:
            break
    return result


def _sanitize(section, value):
    if section == "watchlist":
        return _codes(value, 100)
    if section == "aiWatchLocks":
        return _codes(value, 10)
    if section == "alerts":
        raw = value if isinstance(value, dict) else {}
        try:
            interval = int(raw.get("intervalMin", 30))
        except (TypeError, ValueError):
            interval = 30
        return {"enabled": bool(raw.get("enabled")), "intervalMin": max(5, min(240, interval))}
    if section == "profile":
        return _bounded(value if isinstance(value, dict) else {}, section)
    if section == "stockChats":
        return _bounded((value if isinstance(value, list) else [])[:40], section)
    if section == "watchlistChats":
        return _bounded((value if isinstance(value, list) else [])[:30], section)
    raise ValueError("不支持的数据分区")


def _read_unlocked():
    if not os.path.exists(USER_DATA_FILE):
        return _defaults(), False
    try:
        with open(USER_DATA_FILE, encoding="utf-8") as file:
            raw = json.load(file)
    except (OSError, json.JSONDecodeError):
        return _defaults(), False
    data = _defaults()
    if isinstance(raw, dict):
        for section in _SECTIONS:
            if section in raw:
                try:
                    data[section] = _sanitize(section, raw[section])
                except ValueError:
                    pass
    return data, True


def _write_unlocked(data):
    target = os.path.abspath(USER_DATA_FILE)
    directory = os.path.dirname(target)
    os.makedirs(directory, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".user-data-", suffix=".json.tmp", dir=directory)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_user_data():
    with _LOCK:
        data, initialized = _read_unlocked()
        return deepcopy(data), initialized


def replace_user_data(value):
    raw = value if isinstance(value, dict) else {}
    data = _defaults()
    for section in _SECTIONS:
        if section in raw:
            data[section] = _sanitize(section, raw[section])
    with _LOCK:
        _write_unlocked(data)
    return deepcopy(data)


def save_user_data_section(section, value):
    if section not in _SECTIONS:
        raise ValueError("不支持的数据分区")
    sanitized = _sanitize(section, value)
    with _LOCK:
        data, _ = _read_unlocked()
        data[section] = sanitized
        _write_unlocked(data)
    return deepcopy(sanitized)

