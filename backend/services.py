"""akshare 数据服务(腾讯 + 同花顺 + 乐咕源):
- 本机网络环境访问不了东财域名,新浪源又会对高频请求风控,
  故指数/行情/分时/日线走腾讯 gtimg,板块与资金流走同花顺,涨跌家数走乐咕。
- 所有函数带 TTL 缓存与容错;失败返回 None/空,由 app.py 兜底。
- NO_PROXY 必须在 import akshare 之前设置,否则 requests 走系统代理。
"""
import os
os.environ.setdefault("NO_PROXY", "*")
os.environ.setdefault("no_proxy", "*")

import json
import time
import threading
import concurrent.futures
import math
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
import akshare as ak

_SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

# 新浪等源个别生僻字会以孤代理对出现,导致前端 JSON.parse 失败,统一清理
def _clean(s):
    """过滤掉所有孤代理字符(U+D800-U+DFFF),逐字符判断最可靠。"""
    if s is None:
        return ""
    if isinstance(s, str) and any(0xD800 <= ord(ch) <= 0xDFFF for ch in s):
        return "".join(ch for ch in s if not (0xD800 <= ord(ch) <= 0xDFFF)).strip()
    return str(s).strip()

# ---------------- 简单 TTL 缓存 ----------------
_cache = {}
_cache_lock = threading.Lock()

def cached(ttl=60):
    def deco(fn):
        def wrapper(*args, **kwargs):
            def freeze(x):
                # 把 list/dict 递归冻结为可哈希形式(list 参数会进缓存 key)
                if isinstance(x, (list, tuple)):
                    return tuple(freeze(i) for i in x)
                if isinstance(x, dict):
                    return tuple(sorted((k, freeze(v)) for k, v in x.items()))
                return x
            key = (fn.__name__, freeze(args), tuple(sorted((k, freeze(v)) for k, v in kwargs.items())))
            now = time.time()
            with _cache_lock:
                hit = _cache.get(key)
                if hit and now - hit[0] < ttl:
                    return hit[1]
            val = fn(*args, **kwargs)
            with _cache_lock:
                _cache[key] = (now, val)
            return val
        return wrapper
    return deco

def _num(x):
    try:
        if x is None or (isinstance(x, str) and not x.strip()):
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _market_clock(source_time=None):
    """A 股常规交易时段。节假日仍以数据源是否更新为准。"""
    now = datetime.now(_SHANGHAI_TZ)
    minutes = now.hour * 60 + now.minute
    weekday = now.weekday() < 5
    if not weekday:
        phase, label, live = "weekend", "周末休市", False
        focus = "使用最近收盘数据复盘，不把静态报价描述为盘中信号。"
    elif minutes < 9 * 60 + 15:
        phase, label, live = "pre_open", "盘前准备", False
        focus = "盘前只制定条件，不使用尚未形成的分时量价判断方向。"
    elif minutes < 9 * 60 + 30:
        phase, label, live = "auction", "集合竞价", False
        focus = "竞价价格和量能容易跳变，只观察缺口与预期，不提前确认趋势。"
    elif minutes < 11 * 60 + 30:
        phase, label, live = "morning", "上午盘中", True
        focus = "盘中结论是临时快照，重点观察均价线、日内位置和短周期动量。"
    elif minutes < 13 * 60:
        phase, label, live = "lunch", "午间休市", False
        focus = "上午行情已暂停，等待午后开盘确认，不把午间静态价格当作持续信号。"
    elif minutes < 15 * 60:
        phase, label, live = "afternoon", "下午盘中", True
        focus = "结合均价线、尾盘量价与日内高低判断，收盘前不使用收盘确认措辞。"
    else:
        phase, label, live = "closed", "盘后复盘", False
        focus = "以收盘结果复盘趋势与风险条件，不再按实时盘中策略表述。"
    source_as_of = None
    if source_time:
        try:
            source_at = datetime.strptime(str(source_time)[:14], "%Y%m%d%H%M%S").replace(tzinfo=_SHANGHAI_TZ)
            source_as_of = source_at.isoformat(timespec="seconds")
            age_seconds = (now - source_at).total_seconds()
            if live and (source_at.date() != now.date() or age_seconds > 600):
                phase, label, live = "delayed", "行情延迟", False
                focus = "当前报价源超过 10 分钟未更新，暂停盘中信号判断，等待数据恢复。"
        except (TypeError, ValueError):
            pass
    minutes_to_close = max(0, 15 * 60 - minutes) if live else None
    return {
        "phase": phase,
        "label": label,
        "is_trading": live,
        "as_of": now.isoformat(timespec="seconds"),
        "time": now.strftime("%H:%M"),
        "minutes_to_close": minutes_to_close,
        "source_as_of": source_as_of,
        "strategy_focus": focus,
        "calendar_note": "按沪深市场常规时段判断，法定休市日以行情源实际更新为准。",
    }


def _intraday_context(minute, quote, clock):
    minute = minute if isinstance(minute, dict) else {}
    prices = minute.get("prices") or []
    averages = minute.get("avg_prices") or []
    times = minute.get("times") or []
    price = quote.get("price") or 0
    average = averages[-1] if averages else None
    base_index = max(0, len(prices) - 16)
    momentum_base = prices[base_index] if prices else None
    day_span = (quote.get("high") or 0) - (quote.get("low") or 0)
    return {
        "phase": clock["phase"],
        "latest_minute": times[-1] if times else None,
        "average_price": round(average, 2) if average else None,
        "vs_average_pct": round((price / average - 1) * 100, 2) if price and average else None,
        "momentum_15m_pct": round((price / momentum_base - 1) * 100, 2) if price and momentum_base else None,
        "day_position_pct": round((price - quote["low"]) / day_span * 100, 1) if price and day_span > 0 else None,
        "provisional": bool(clock["is_trading"]),
    }

# ---------------- 腾讯行情(自实现,规避 akshare 未封装/风控问题) ----------------
_QQ_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

def qq_quotes(codes):
    """腾讯实时行情。codes: ['sh000001', 'sz399001', ...]
    返回 {code: {name, price, prev_close, open, high, low, change, change_pct, amount}}
    字段以 ~ 分割:[1]名称 [3]最新 [4]昨收 [5]今开 [31]涨跌额 [32]涨跌幅 [33]最高 [34]最低 [35]价/量/额
    """
    url = "http://qt.gtimg.cn/q=" + ",".join(codes)
    r = requests.get(url, headers=_QQ_HEADERS, timeout=10)
    r.encoding = "gbk"
    out = {}
    for line in r.text.strip().split(";"):
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, val = line.split("=", 1)
        code = key.split("_")[-1]
        f = val.strip().strip('"').split("~")
        if len(f) < 35:
            continue
        def _f(i):
            try:
                v = f[i].strip()
                return float(v) if v not in ("", "-") else 0.0
            except (ValueError, IndexError):
                return 0.0
        try:
            out[code] = {
                "name": f[1],
                "price": float(f[3]),
                "prev_close": float(f[4]),
                "open": float(f[5]),
                "change": float(f[31]),
                "change_pct": float(f[32]),
                "high": float(f[33]),
                "low": float(f[34]),
                "amount": float(f[35].split("/")[-1]) if "/" in f[35] else 0.0,
                "turnover_rate": _f(38),  # 换手率 %
                "pe": _f(39),             # 动态市盈率
                "amplitude": _f(43),      # 振幅 %
                "circ_mv": _f(44),        # 流通市值(亿)
                "total_mv": _f(45),       # 总市值(亿)
                "pb": _f(46),             # 市净率
                "limit_up": _f(47),       # 涨停价
                "limit_down": _f(48),     # 跌停价
                "volume_ratio": _f(49),   # 量比
                "quote_time": f[30].strip() if len(f) > 30 else "",
            }
        except (ValueError, IndexError):
            continue
    return out

def qq_minute(code):
    """腾讯当日分时。返回 {times, prices, volumes(每分钟量), avg_prices(均价线)}。
    原始行格式: 时间 价格 累计成交量(手) 累计成交额(元)
    """
    url = f"http://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}"
    j = requests.get(url, headers=_QQ_HEADERS, timeout=10).json()
    d = j["data"][code]["data"]["data"]
    rows = [line.split() for line in d]
    prices = [float(r[1]) for r in rows]
    cum_vol = [float(r[2]) for r in rows]
    # 每分钟成交量 = 累计差分(第一分钟取自身),而非累计值
    volumes = [cum_vol[0]] + [max(cum_vol[i] - cum_vol[i - 1], 0) for i in range(1, len(cum_vol))]
    # 均价线 = 累计成交额 / 累计成交量(手 → 股)
    avg_prices = []
    if len(rows[0]) > 3:
        cum_amt = [float(r[3]) for r in rows]
        for cv, ca in zip(cum_vol, cum_amt):
            avg_prices.append(round(ca / (cv * 100), 2) if cv > 0 else prices[0])
    return {
        "times": [r[0] for r in rows],
        "prices": prices,
        "volumes": volumes,
        "avg_prices": avg_prices,
    }

def qq_kline(code, n=30, period="day"):
    """腾讯K线(前复权)。返回 [{date, open, close, high, low, volume}, ...] 最近 n 条(升序)。
    行格式:[date, open, close, high, low, volume, ...]
    period: day / week / month
    """
    url = f"http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{n},qfq"
    j = requests.get(url, headers=_QQ_HEADERS, timeout=10).json()
    node = j["data"][code]
    rows = node.get(f"qfq{period}") or node.get(period) or []
    return [
        {
            "date": r[0],
            "open": float(r[1]),
            "close": float(r[2]),
            "high": float(r[3]),
            "low": float(r[4]),
            "volume": float(r[5]),
        }
        for r in rows if len(r) >= 6
    ]

# ---------------- 指数行情(腾讯) ----------------
INDEX_MAP = {
    "sh000001": "上证指数",
    "sz399001": "深证成指",
    "sz399006": "创业板指",
    "sh000688": "科创50",
}

@cached(ttl=15)
def get_indices():
    q = qq_quotes(list(INDEX_MAP.keys()))
    out = []
    for code, name in INDEX_MAP.items():
        d = q.get(code)
        if not d:
            continue
        out.append({
            "code": code[2:],
            "name": name,
            "value": round(d["price"], 2),
            "change": round(d["change_pct"], 2),
            "points": round(d["change"], 2),
        })
    return out

# 市场页:更全的指数全景(含沪深300/中证500/上证50/北证50/恒生等)
MARKET_INDEXES = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000688", "科创50"),
    ("sh000300", "沪深300"),
    ("sh000905", "中证500"),
    ("sh000852", "中证1000"),
    ("sh000016", "上证50"),
    ("bj899050", "北证50"),
    ("hkHSI", "恒生指数"),
]

@cached(ttl=15)
def get_all_indices():
    q = qq_quotes([c for c, _ in MARKET_INDEXES])
    out = []
    for code, name in MARKET_INDEXES:
        d = q.get(code)
        if not d:
            continue
        out.append({
            "code": code[2:],
            "name": name,
            "value": round(d["price"], 2),
            "change": round(d["change_pct"], 2),
            "points": round(d["change"], 2),
            "amount": round(d["amount"] / 1e8, 1) if d["amount"] else 0.0,  # 元 → 亿
        })
    return out

# ---------------- 涨跌家数 / 大盘状态(乐咕) ----------------
# 乐咕源保守起见保持 30s;腾讯指数可 15s
@cached(ttl=30)
def get_breadth():
    df = ak.stock_market_activity_legu()
    m = dict(zip(df["item"], df["value"]))
    # 两市成交额:乐咕无此字段,用腾讯上证+深证指数快照的成交额(元)
    q = qq_quotes(["sh000001", "sz399001"])
    turnover = round(
        (q.get("sh000001", {}).get("amount", 0) + q.get("sz399001", {}).get("amount", 0)) / 1e8, 0
    )
    return {
        "up": int(_num(m.get("上涨")) or 0),
        "down": int(_num(m.get("下跌")) or 0),
        "flat": int(_num(m.get("平盘")) or 0),
        "limitUp": int(_num(m.get("涨停")) or 0),
        "limitDown": int(_num(m.get("跌停")) or 0),
        "turnover": turnover,  # 亿元
        "northbound": 0.0,
    }

# ---------------- 指数分时(腾讯) ----------------
@cached(ttl=60)
def get_curve():
    m = qq_minute("sh000001")
    if not m["prices"]:
        return None
    base = m["prices"][0] or 1
    vmax = max(m["volumes"]) or 1
    return {
        "points": [round(50 + (p / base - 1) * 100, 2) for p in m["prices"]],
        "open": round(m["prices"][0], 2),
        "high": round(max(m["prices"]), 2),
        "low": round(min(m["prices"]), 2),
        "volume": [round(v / vmax * 100, 1) for v in m["volumes"]],
        "labels": ["09:30", "10:30", "11:30", "13:30", "14:30", "15:00"],
    }

# ---------------- 板块排行 + 资金流向(新浪,普通 HTTP,不触发 mini_racer) ----------------
@cached(ttl=60)
def _sector_rows():
    """新浪全部行业板块,按涨跌幅降序。"""
    df = ak.stock_sector_spot(indicator="新浪行业")
    df = df.sort_values("涨跌幅", ascending=False)
    out = []
    for _, r in df.iterrows():
        code = str(r.get("股票代码", "") or "")
        out.append({
            "name": _clean(r.get("板块")),
            "change": round(_num(r.get("涨跌幅")) or 0, 2),
            "leader": _clean(r.get("股票名称")),
            "leaderCode": code[-6:] if code else "",
        })
    return out

@cached(ttl=60)
def get_sectors_all():
    """板块页:全部行业板块"""
    return _sector_rows()

@cached(ttl=60)
def get_sectors():
    return _sector_rows()[:10]

@cached(ttl=60)
def get_sector_boards():
    """市场页:涨幅榜 top8 + 跌幅榜 top8"""
    rows = _sector_rows()
    return {
        "top": rows[:8],
        "bottom": list(reversed(rows[-8:])),  # 跌幅最大的在榜首
    }

@cached(ttl=120)
def get_capital_flow():
    # 新浪行业资金流(即时):全部行业净额之和 ≈ 全市场主力净流入
    sf = ak.stock_fund_flow_industry(symbol="即时")
    sf = sf.sort_values("净额", ascending=False)
    main = round(float(sf["净额"].sum()), 1)

    top = sf.head(3)
    bottom = sf.tail(2)
    today = []
    for _, r in pd_concat([top, bottom]).iterrows():
        today.append({
            "name": _clean(r.get("行业")),
            "inflow": round(_num(r.get("净额")) or 0, 1),
            "color": "",
        })

    # 近 20 日:上证指数量能 × 涨跌方向(腾讯无历史资金流,以量能近似形态)
    k = qq_kline("sh000001", 20)
    if k:
        diff = [0.0] + [k[i]["close"] - k[i - 1]["close"] for i in range(1, len(k))]
        vmax = max(x["volume"] for x in k) or 1
        history = [round((1.0 if d >= 0 else -1.0) * (x["volume"] / vmax) * 100, 1)
                   for d, x in zip(diff, k)]
    else:
        history = []

    return {
        "main": main,
        "retail": round(-main, 1),  # 资金守恒近似:散户/其他 = -主力
        "northbound": 0.0,          # 北向实时披露已停止
        "history": history,
        "today": today,
    }

def pd_concat(frames):
    import pandas as pd
    return pd.concat(frames)

# ---------------- 自选股(腾讯,代码完全由前端用户管理) ----------------

# 热门股票:各行业龙头,共 30 只
HOT_STOCKS = [
    "600519", "300750", "688981", "601318", "000858", "600036", "000333", "600900",
    "601899", "002594", "600030", "000001", "600276", "002415", "601012", "600887",
    "000651", "601088", "600309", "002475", "600585", "000725", "601857", "600028",
    "300059", "688111", "002230", "601668", "600690", "000063",
]

@cached(ttl=30)
def get_hot_stocks():
    """热门股票实时行情(腾讯批量,30 只一次请求)"""
    q = qq_quotes([_tx_code(c) for c in HOT_STOCKS])
    out = []
    for code in HOT_STOCKS:
        d = q.get(_tx_code(code))
        if not d:
            continue
        out.append({
            "code": code,
            "name": _clean(d["name"]),
            "price": round(d["price"], 2),
            "change": round(d["change_pct"], 2),
        })
    return out

@cached(ttl=600)
def _stock_universe():
    """全市场 A 股代码+名称(新浪快照),缓存 10 分钟;首次约 20-30s。"""
    df = ak.stock_zh_a_spot()
    return [(str(r.get("代码", ""))[-6:], _clean(r.get("名称"))) for _, r in df.iterrows()]

@cached(ttl=30)
def search_stocks(q):
    """全市场搜索:代码/名称包含匹配,精确代码与名称前缀优先。"""
    q = (q or "").strip().lower()
    if len(q) < 2:
        return []
    universe = _stock_universe()
    hits = [(c, n) for c, n in universe if q in c or q in n.lower()]
    hits.sort(key=lambda u: (u[0] != q, not u[1].lower().startswith(q), not u[0].startswith(q)))
    return [{"code": c, "name": n} for c, n in hits[:15]]

def _tx_code(code):
    return ("sh" if code[0] in "69" else "sz") + code

@cached(ttl=60)
def get_watchlist(codes=None):
    codes = codes if isinstance(codes, (list, tuple)) else []
    codes = [c for c in codes if isinstance(c, str) and c.isdigit() and len(c) == 6]
    if not codes:
        return []
    q = qq_quotes([_tx_code(c) for c in codes])

    def spark(code):
        try:
            k = qq_kline(_tx_code(code), 15)
            return [round(x["close"], 2) for x in k[-12:]]
        except Exception:
            return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        sparks = dict(zip(codes, ex.map(spark, codes)))

    out = []
    for code in codes:
        d = q.get(_tx_code(code))
        if not d:
            continue
        out.append({
            "code": code,
            "name": _clean(d["name"]),
            "price": round(d["price"], 2),
            "change": round(d["change_pct"], 2),
            "spark": sparks.get(code, []),
        })
    return out

# ---------------- 个股详情(腾讯:实时 + 分时 + 日K) ----------------
@cached(ttl=300)
def _stock_history(tx):
    """历史周期与实时报价分层缓存，避免每次盘中刷新都重拉周/月 K。"""
    try:
        kline_all = qq_kline(tx, 250, "day")
    except Exception:
        kline_all = []
    try:
        kline_week = qq_kline(tx, 64, "week")
    except Exception:
        kline_week = []
    try:
        kline_month = qq_kline(tx, 36, "month")
    except Exception:
        kline_month = []
    return kline_all, kline_week, kline_month


@cached(ttl=8)
def get_stock(code):
    if not (code.isdigit() and len(code) == 6):
        return None
    tx = _tx_code(code)
    q = qq_quotes([tx]).get(tx)
    if not q:
        return None
    try:
        minute = qq_minute(tx)
    except Exception:
        minute = None
    kline_all, kline_week, kline_month = _stock_history(tx)
    kline = kline_all[-90:]  # 前端图表取最近 90 根,避免过密
    quote = {
        "code": code,
        "name": _clean(q["name"]),
        "price": round(q["price"], 2),
        "change_pct": round(q["change_pct"], 2),
        "change": round(q["change"], 2),
        "open": round(q["open"], 2),
        "prev_close": round(q["prev_close"], 2),
        "high": round(q["high"], 2),
        "low": round(q["low"], 2),
        "amount": round(q["amount"] / 1e8, 2),  # 元 → 亿
        "turnover_rate": round(q.get("turnover_rate", 0), 2),  # 换手率 %
        "volume_ratio": round(q.get("volume_ratio", 0), 2),    # 量比
        "pe": round(q.get("pe", 0), 2),                        # 动态市盈率
        "pb": round(q.get("pb", 0), 2),                        # 市净率
        "total_mv": round(q.get("total_mv", 0), 2),            # 总市值(亿)
        "circ_mv": round(q.get("circ_mv", 0), 2),              # 流通市值(亿)
        "amplitude": round(q.get("amplitude", 0), 2),          # 振幅 %
        "limit_up": round(q.get("limit_up", 0), 2),            # 涨停价
        "limit_down": round(q.get("limit_down", 0), 2),        # 跌停价
        "quote_time": q.get("quote_time") or "",
    }
    if kline_all:
        quote["high_52w"] = round(max(x["high"] for x in kline_all), 2)
        quote["low_52w"] = round(min(x["low"] for x in kline_all), 2)
    clock = _market_clock(quote.get("quote_time"))
    return {
        "quote": quote,
        "minute": minute,
        "kline": kline,            # 日K(近 90 根)
        "kline_week": kline_week,  # 周K
        "kline_month": kline_month,  # 月K
        "tech": _tech_signals(kline_all),
        "market_session": clock,
        "intraday": _intraday_context(minute, quote, clock),
    }

# ---------------- 技术指标(供 AI prompt 与规则降级使用) ----------------
def _ma(closes, n):
    if len(closes) < n:
        return None
    return round(sum(closes[-n:]) / n, 2)

def _ema(vals, n):
    k = 2 / (n + 1)
    e = vals[0]
    out = []
    for v in vals:
        e = v * k + e * (1 - k)
        out.append(e)
    return out

def _rsi(closes, n=14):
    if len(closes) <= n:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - n, len(closes)):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gains += d
        else:
            losses -= d
    if losses == 0:
        return 100.0
    rs = gains / losses
    return round(100 - 100 / (1 + rs), 1)

def _tech_signals(kline):
    """基于日K序列计算常用技术指标;数据不足的项为 None。"""
    if not kline or len(kline) < 2:
        return {}
    closes = [x["close"] for x in kline]
    highs = [x["high"] for x in kline]
    lows = [x["low"] for x in kline]
    last = closes[-1]
    ma5, ma10, ma20, ma60 = _ma(closes, 5), _ma(closes, 10), _ma(closes, 20), _ma(closes, 60)
    vols = [x["volume"] for x in kline]
    v5 = sum(vols[-5:]) / min(len(vols), 5)
    v20 = sum(vols[-20:]) / min(len(vols), 20)
    vol_ratio = round(v5 / v20, 2) if v20 else None
    hi = max(x["high"] for x in kline)
    lo = min(x["low"] for x in kline)
    range_pos = round((last - lo) / (hi - lo) * 100, 1) if hi > lo else None

    # 波动与回撤指标:ATR14、20日收益波动、60日最大回撤。
    true_ranges = []
    for i, bar in enumerate(kline):
        prev = closes[i - 1] if i > 0 else bar["open"]
        true_ranges.append(max(bar["high"] - bar["low"], abs(bar["high"] - prev), abs(bar["low"] - prev)))
    atr14 = round(sum(true_ranges[-14:]) / min(len(true_ranges), 14), 2) if true_ranges else None
    atr_pct = round(atr14 / last * 100, 2) if atr14 and last else None
    returns20 = [(closes[i] / closes[i - 1] - 1) * 100 for i in range(max(1, len(closes) - 20), len(closes)) if closes[i - 1]]
    volatility20 = None
    if len(returns20) >= 2:
        mean_ret = sum(returns20) / len(returns20)
        variance = sum((r - mean_ret) ** 2 for r in returns20) / (len(returns20) - 1)
        volatility20 = round(math.sqrt(variance), 2)
    window60 = closes[-60:]
    peak = window60[0] if window60 else last
    max_drawdown60 = 0.0
    for value in window60:
        peak = max(peak, value)
        if peak:
            max_drawdown60 = min(max_drawdown60, (value / peak - 1) * 100)

    def chg(n):
        if len(closes) <= n:
            return None
        base = closes[-1 - n]
        return round((last - base) / base * 100, 2) if base else None

    macd = macd_golden = None
    if len(closes) >= 35:
        dif = [a - b for a, b in zip(_ema(closes, 12), _ema(closes, 26))]
        dea = _ema(dif, 9)
        macd = round((dif[-1] - dea[-1]) * 2, 3)
        macd_golden = dif[-1] > dea[-1]
    return {
        "ma5": ma5, "ma10": ma10, "ma20": ma20, "ma60": ma60,
        "ma_bull": (ma5 > ma10 > ma20 > ma60) if all((ma5, ma10, ma20, ma60)) else None,
        "above_ma20": (last >= ma20) if ma20 else None,
        "macd": macd,
        "macd_golden": macd_golden,
        "rsi14": _rsi(closes),
        "vol_ratio": vol_ratio,
        "range_pos": range_pos,
        "chg20": chg(20),
        "chg60": chg(60),
        "high_52w": round(hi, 2),
        "low_52w": round(lo, 2),
        "high20": round(max(highs[-20:]), 2),
        "low20": round(min(lows[-20:]), 2),
        "atr14": atr14,
        "atr_pct": atr_pct,
        "volatility20": volatility20,
        "max_drawdown60": round(max_drawdown60, 2),
    }

# ---------------- 个股 AI 建议(DeepSeek + 降级) ----------------
def _clamp_score(value):
    return max(0, min(100, round(value)))

def _research_framework(q, sig, action, signal, support, resistance):
    """生成可解释的多维研究框架;不依赖模型,所有点位均来自行情与技术指标。"""
    trend = 50
    if sig.get("ma_bull") is not None:
        trend += 20 if sig["ma_bull"] else -6
    if sig.get("above_ma20") is not None:
        trend += 16 if sig["above_ma20"] else -18
    if sig.get("macd_golden") is not None:
        trend += 12 if sig["macd_golden"] else -12
    if sig.get("chg20") is not None:
        trend += max(-12, min(12, sig["chg20"] * 0.8))

    rsi = sig.get("rsi14")
    momentum = 50 if rsi is None else rsi
    if sig.get("chg20") is not None:
        momentum += max(-10, min(10, sig["chg20"] * 0.5))

    vol_ratio = sig.get("vol_ratio")
    volume = 50 if vol_ratio is None else 50 + (vol_ratio - 1) * 45

    atr_pct = sig.get("atr_pct") or 0
    volatility20 = sig.get("volatility20") or 0
    drawdown = abs(sig.get("max_drawdown60") or 0)
    risk_score = 24 + atr_pct * 12 + volatility20 * 8 + drawdown * 0.9

    dimensions = [
        {
            "key": "trend", "label": "趋势结构", "score": _clamp_score(trend), "tone": "direction",
            "note": "均线多头、价格位于20日线上方" if sig.get("ma_bull") else "均线尚未形成多头结构",
        },
        {
            "key": "momentum", "label": "动量强度", "score": _clamp_score(momentum), "tone": "direction",
            "note": f"RSI14 {rsi:.1f}" if rsi is not None else "动量数据不足",
        },
        {
            "key": "volume", "label": "量能活跃", "score": _clamp_score(volume), "tone": "activity",
            "note": f"5日/20日均量比 {vol_ratio:.2f}" if vol_ratio is not None else "量能数据不足",
        },
        {
            "key": "risk", "label": "波动风险", "score": _clamp_score(risk_score), "tone": "risk",
            "note": f"ATR {atr_pct:.2f}% · 20日波动 {volatility20:.2f}%" if atr_pct else "波动数据不足",
        },
    ]

    bull_points = []
    bear_points = []
    if sig.get("above_ma20"):
        bull_points.append(f"现价位于20日均线 {sig.get('ma20')} 上方")
    else:
        bear_points.append(f"现价未站稳20日均线 {sig.get('ma20') or '—'}")
    if sig.get("macd_golden"):
        bull_points.append("MACD结构偏强，趋势动能仍在")
    else:
        bear_points.append("MACD结构偏弱，反弹持续性需验证")
    if sig.get("chg20") is not None:
        target = bull_points if sig["chg20"] >= 0 else bear_points
        target.append(f"近20日累计涨跌 {sig['chg20']:+.2f}%")
    if vol_ratio is not None:
        if vol_ratio >= 1.1 and q["change_pct"] >= 0:
            bull_points.append(f"近期量能放大至20日均量的 {vol_ratio:.2f} 倍")
        elif vol_ratio < 0.85:
            bear_points.append(f"近期量能仅为20日均量的 {vol_ratio:.2f} 倍")
    if rsi is not None and rsi >= 70:
        bear_points.append(f"RSI {rsi:.1f} 进入偏热区，追涨性价比下降")
    elif rsi is not None and rsi <= 30:
        bull_points.append(f"RSI {rsi:.1f} 处于低位，存在技术修复可能")
    if sig.get("range_pos") is not None and sig["range_pos"] >= 85:
        bear_points.append(f"股价位于近一年区间 {sig['range_pos']:.0f}% 位置")
    bull_points = (bull_points or ["暂未出现明确的趋势确认信号"])[0:3]
    bear_points = (bear_points or ["当前主要不确定性来自量能与市场环境"])[0:3]

    if signal == "bullish":
        holding = f"已有仓位：以 {support:.2f} 为动态防守参考，趋势未破坏前可观察持有，避免加速段追高。"
    elif signal == "bearish":
        holding = f"已有仓位：优先控制回撤；若有效跌破 {support:.2f} 且不能快速收回，应重新评估仓位。"
    else:
        holding = f"已有仓位：维持观察，围绕 {support:.2f} 支撑与 {resistance:.2f} 压力管理预期。"
    watcher = f"未持仓：等待放量突破 {resistance:.2f}，或回踩 {support:.2f} 后出现企稳信号；避免在区间中部追价。"
    invalidation = f"失效条件：收盘有效跌破 {support:.2f}，或突破 {resistance:.2f} 后快速回落且量能放大。"

    pe, pb = q.get("pe") or 0, q.get("pb") or 0
    valuation = {
        "pe": pe,
        "pb": pb,
        "note": "仅展示动态PE/PB快照；缺少行业基准与盈利预测，不能据此单独判断高估或低估。",
    }
    return {
        "dimensions": dimensions,
        "bull_points": bull_points,
        "bear_points": bear_points,
        "plan": {"holding": holding, "watching": watcher, "invalidation": invalidation},
        "valuation": valuation,
        "scope": "基于实时价格、成交量、K线和PE/PB快照，不含财报质量、盈利预测、行业景气与个人风险承受能力。",
        "suitability": "系统未获取你的资产状况、投资期限和风险承受能力，因此不构成个性化适当性意见。",
    }

def _rule_stock_ai(q, sig=None):
    """规则引擎降级:基于量化信号生成与个股相关的话术(非静态模板)。"""
    sig = sig or {}
    up = q["change_pct"] >= 0
    pct = q["change_pct"]
    # ---- 概览:数字 + 关键结构信号 ----
    summary = (f"{q['name']} 今日{'上涨' if up else '下跌'} {abs(pct):.2f}%,"
               f"收于 {q['price']},日内区间 {q['low']} ~ {q['high']},成交 {q['amount']} 亿")
    extras = []
    if sig.get("ma_bull"):
        extras.append("均线多头排列")
    elif sig.get("above_ma20") is False:
        extras.append("股价位于20日线下方")
    if sig.get("range_pos") is not None:
        extras.append(f"近一年区间位置 {sig['range_pos']:.0f}%")
    if extras:
        summary += ";" + ";".join(extras[:2])
    # ---- 建议:按信号组合选择话术 ----
    if sig.get("ma_bull") and sig.get("vol_ratio") and sig["vol_ratio"] >= 1.1 and up:
        advice = "均线多头排列且量能配合,短线趋势偏强,可沿5日线持有观察;避免急涨后追高,中线关注板块景气度。"
    elif sig.get("ma_bull"):
        advice = "均线多头排列,趋势结构良好;短线回踩5/10日线可关注,中线持有需紧盯量能是否持续。"
    elif sig.get("above_ma20") is False and sig.get("macd_golden") is False:
        advice = "股价跌破20日均线且MACD走弱,短线转弱,建议控制仓位、等待企稳信号,不宜盲目抄底。"
    elif sig.get("rsi14") is not None and sig["rsi14"] >= 70:
        advice = "RSI进入超买区,短线回调压力增大,谨慎追涨;已持仓者可考虑分批兑现部分利润。"
    elif sig.get("rsi14") is not None and sig["rsi14"] <= 30:
        advice = "RSI处于超卖区,短线或有技术性修复,但需量能配合确认,左侧介入注意控制仓位。"
    elif pct >= 5:
        advice = "今日涨幅较大,短线注意追高风险,关注冲高回落信号,不宜重仓追进。"
    elif pct <= -5:
        advice = "今日跌幅较大,注意止损纪律,观察下方支撑与量能是否萎缩企稳。"
    elif sig.get("vol_ratio") is not None and sig["vol_ratio"] >= 1.5 and not up:
        advice = "放量下跌需警惕资金出逃,短线以防守为主,等待缩量止跌信号。"
    else:
        advice = "量价整体平稳,短线以5/10日均线为参考,中线结合所属板块景气度判断,耐心等待方向选择。"
    # ---- 风险:区间位置叠加基础风险 ----
    risk = "个股波动风险较大,注意仓位与止损纪律。"
    if sig.get("range_pos") is not None and sig["range_pos"] >= 90:
        risk = "股价处于近一年高位区间,追高风险大,谨防冲高回落。" + risk
    elif sig.get("range_pos") is not None and sig["range_pos"] <= 10:
        risk = "股价处于近一年低位,趋势未明,注意左侧介入的时间成本。" + risk
    # ---- 结构化投资倾向:始终由可解释指标计算,避免模型编造点位 ----
    score = 50
    score += 14 if sig.get("ma_bull") else 0
    if sig.get("above_ma20") is not None:
        score += 10 if sig["above_ma20"] else -12
    if sig.get("macd_golden") is not None:
        score += 8 if sig["macd_golden"] else -8
    if sig.get("chg20") is not None:
        score += 5 if sig["chg20"] >= 0 else -5
    if sig.get("rsi14") is not None and sig["rsi14"] >= 72:
        score -= 8
    if sig.get("vol_ratio") is not None and sig["vol_ratio"] >= 1.4:
        score += 4 if up else -5
    score = max(10, min(90, score))

    if score >= 68:
        action, signal = "持有关注", "bullish"
    elif score >= 54:
        action, signal = "逢低观察", "neutral"
    elif score >= 42:
        action, signal = "谨慎观望", "neutral"
    else:
        action, signal = "减仓防守", "bearish"

    confidence = min(88, max(52, round(54 + abs(score - 50) * 0.75)))
    horizon = "短中线" if sig.get("ma20") else "短线"
    below = [x for x in (sig.get("ma5"), sig.get("ma10"), sig.get("ma20"), sig.get("ma60"), sig.get("low20"), q.get("low")) if x and x <= q["price"]]
    above = [x for x in (sig.get("ma5"), sig.get("ma10"), sig.get("ma20"), sig.get("ma60"), sig.get("high20"), sig.get("high_52w"), q.get("high")) if x and x >= q["price"]]
    support = round(max(below), 2) if below else round(q.get("low") or q["price"], 2)
    resistance = round(min(above), 2) if above else round(q.get("high") or q["price"], 2)
    framework = _research_framework(q, sig, action, signal, support, resistance)
    return {
        "summary": summary,
        "advice": advice,
        "risk": risk,
        "action": action,
        "signal": signal,
        "confidence": confidence,
        "horizon": horizon,
        "support": support,
        "resistance": resistance,
        "source": "rule",
        **framework,
    }


def _long_term_zone(q, sig, support):
    """生成中长线技术观察区，不把单一技术价位包装成确定买点。"""
    price = q.get("price") or 0
    anchor_name = "60 日均线" if sig.get("ma60") else "20 日均线" if sig.get("ma20") else "结构支撑"
    anchor = sig.get("ma60") or sig.get("ma20") or support or price
    atr = sig.get("atr14") or price * 0.025
    half_width = max(atr * 0.65, anchor * 0.015)
    lower = round(max(0.01, anchor - half_width), 2)
    upper = round(anchor + half_width, 2)
    low20 = sig.get("low20") or lower
    invalidation = round(max(0.01, min(lower - atr * 0.5, low20)), 2)
    if price > upper:
        status = "等待回落观察"
        note = f"现价高于观察区，避免把追涨当成长线布局。"
    elif price >= lower:
        status = "进入技术观察区"
        note = "价格已进入观察区，仍需等待企稳和趋势确认。"
    else:
        status = "先等趋势修复"
        note = "现价跌破观察区，低价本身不等于低风险。"
    confirmation = (
        f"观察 {lower:.2f}–{upper:.2f} 附近能否止跌，并至少连续 2 个交易日收回 {anchor_name}；"
        "量能不出现持续放大下跌后再重新评估。"
    )
    return {
        "label": status,
        "lower": lower,
        "upper": upper,
        "anchor": round(anchor, 2),
        "anchor_name": anchor_name,
        "basis": f"以{anchor_name}为锚，结合 ATR14 波动带形成的中长线技术观察区。",
        "confirmation": confirmation,
        "invalidation": f"若收盘有效跌破 {invalidation:.2f}，观察逻辑失效，应先评估趋势和基本面变化。",
        "note": note,
        "scope": "仅是技术面分批观察提示；缺少盈利预测、行业景气、现金流和估值分位，不能视为长期价值买点。",
    }


def _monthly_trend_context(kline_month, clock=None):
    """把月 K 压缩成可直接回答“连跌多久/是否跌了一年”的事实数据。"""
    bars = []
    for item in kline_month if isinstance(kline_month, list) else []:
        if not isinstance(item, dict):
            continue
        close = _num(item.get("close"))
        date = str(item.get("date") or "")[:10]
        if close and date:
            bars.append({"date": date, "month": date[:7], "close": round(close, 2)})
    if len(bars) < 2:
        return {"available": False, "note": "月 K 数据不足，无法计算连续涨跌月份。"}

    now_month = datetime.now(_SHANGHAI_TZ).strftime("%Y-%m")
    current_month_incomplete = bars[-1]["month"] == now_month
    completed = bars[:-1] if current_month_incomplete else bars
    if len(completed) < 2:
        return {"available": False, "note": "已完成月 K 数量不足，无法计算连续涨跌月份。"}

    changes = []
    for previous, current in zip(completed, completed[1:]):
        pct = (current["close"] / previous["close"] - 1) * 100 if previous["close"] else 0
        changes.append({**current, "change_pct": round(pct, 2)})

    consecutive_down = 0
    for item in reversed(changes):
        if item["change_pct"] < 0:
            consecutive_down += 1
        else:
            break

    longest_down = 0
    current_streak = 0
    streak_start = streak_end = None
    current_start = None
    for item in changes[-24:]:
        if item["change_pct"] < 0:
            current_streak += 1
            current_start = current_start or item["month"]
            if current_streak > longest_down:
                longest_down = current_streak
                streak_start, streak_end = current_start, item["month"]
        else:
            current_streak = 0
            current_start = None

    window = completed[-18:]
    peak_index = max(range(len(window)), key=lambda index: window[index]["close"])
    peak = window[peak_index]
    latest = completed[-1]
    peak_to_latest_pct = round((latest["close"] / peak["close"] - 1) * 100, 2) if peak["close"] else None

    def month_number(value):
        year, month = value.split("-")
        return int(year) * 12 + int(month)

    months_since_peak = max(0, month_number(latest["month"]) - month_number(peak["month"]))
    trailing_12_pct = None
    if len(completed) >= 13:
        base = completed[-13]["close"]
        trailing_12_pct = round((latest["close"] / base - 1) * 100, 2) if base else None

    current_month = None
    if current_month_incomplete:
        current = bars[-1]
        current_month = {
            **current,
            "change_pct": round((current["close"] / latest["close"] - 1) * 100, 2) if latest["close"] else None,
            "incomplete": True,
        }

    completed_closes = [item["close"] for item in completed]
    ma5 = round(sum(completed_closes[-5:]) / 5, 2) if len(completed_closes) >= 5 else None
    ma10 = round(sum(completed_closes[-10:]) / 10, 2) if len(completed_closes) >= 10 else None
    previous_ma5 = round(sum(completed_closes[-6:-1]) / 5, 2) if len(completed_closes) >= 6 else None
    ma5_change_pct = (
        round((ma5 / previous_ma5 - 1) * 100, 2)
        if ma5 is not None and previous_ma5
        else None
    )
    if ma5 is not None and ma10 is not None and latest["close"] < ma10 and ma5 < ma10:
        trend_status = "中期下降趋势尚未扭转"
    elif ma5 is not None and ma10 is not None and latest["close"] >= ma5 >= ma10:
        trend_status = "月线趋势正在修复"
    else:
        trend_status = "月线方向仍需观察"

    return {
        "available": True,
        "latest_completed_month": latest["month"],
        "latest_completed_close": latest["close"],
        "latest_completed_change_pct": changes[-1]["change_pct"],
        "consecutive_down_months": consecutive_down,
        "longest_down_months_recent": longest_down,
        "longest_down_start": streak_start,
        "longest_down_end": streak_end,
        "peak_month": peak["month"],
        "peak_close": peak["close"],
        "months_since_peak": months_since_peak,
        "peak_to_latest_pct": peak_to_latest_pct,
        "trailing_12m_pct": trailing_12_pct,
        "ma5": ma5,
        "ma10": ma10,
        "ma5_change_pct": ma5_change_pct,
        "trend_status": trend_status,
        "current_month": current_month,
        "recent_completed": changes[-8:],
        "definition": "连续下跌按相邻两个已完成月 K 的收盘价逐月下降计算；本月未收盘时单独列示，不计入连续月份。",
    }


def get_stock_ai(code, profile=None):
    """个股 AI 建议:DeepSeek 生成,失败降级规则引擎。返回含 generated_at。"""
    st = get_stock(code)
    if not st:
        return None
    q = st["quote"]
    tech = st.get("tech") or {}
    clock = st.get("market_session") or _market_clock()
    intraday = st.get("intraday") or _intraday_context(st.get("minute"), q, clock)
    safe_profile = _safe_profile(profile, code)
    horizon = safe_profile.get("horizon") or "波段"
    horizon_label = {"短线": "短线", "波段": "波段（中线）", "中长线": "中长线技术面"}[horizon]
    closes = [x["close"] for x in (st.get("kline") or [])[-10:]]
    lines = [
        f"个股:{q['name']} ({q['code']})",
        f"最新价 {q['price']},涨跌幅 {q['change_pct']:+.2f}%,今开 {q['open']},最高 {q['high']},最低 {q['low']},昨收 {q['prev_close']},成交额 {q['amount']} 亿",
        f"市场阶段:{clock['label']}({clock['time']}),是否连续竞价盘中:{clock['is_trading']};策略要求:{clock['strategy_focus']}",
    ]
    if intraday.get("latest_minute"):
        lines.append(
            f"分时快照:最新分钟 {intraday['latest_minute']},均价 {intraday.get('average_price')},"
            f"偏离均价 {intraday.get('vs_average_pct')}%,近15分钟动量 {intraday.get('momentum_15m_pct')}%,"
            f"日内位置 {intraday.get('day_position_pct')}%"
        )
    if q.get("turnover_rate"):
        lines.append(f"换手率 {q['turnover_rate']}%,量比 {q['volume_ratio']},"
                     f"动态市盈率 {q['pe']},市净率 {q['pb']},总市值 {q['total_mv']} 亿")
    t = []
    for k in ("ma5", "ma10", "ma20", "ma60"):
        if tech.get(k):
            t.append(f"{k.upper()}={tech[k]}")
    if tech.get("ma_bull") is not None:
        t.append("均线多头排列" if tech["ma_bull"] else "均线未多头排列")
    if tech.get("above_ma20") is not None:
        t.append("现价位于20日线" + ("上方" if tech["above_ma20"] else "下方"))
    if tech.get("macd") is not None:
        t.append(f"MACD柱 {tech['macd']}({'金叉' if tech.get('macd_golden') else '死叉'})")
    if tech.get("rsi14") is not None:
        t.append(f"RSI14={tech['rsi14']}")
    if tech.get("vol_ratio") is not None:
        t.append(f"近5日/20日均量比 {tech['vol_ratio']}")
    if tech.get("chg20") is not None:
        t.append(f"近20日涨跌 {tech['chg20']:+.2f}%")
    if tech.get("chg60") is not None:
        t.append(f"近60日涨跌 {tech['chg60']:+.2f}%")
    if tech.get("range_pos") is not None:
        t.append(f"近一年区间位置 {tech['range_pos']}%")
    if tech.get("high_52w") is not None:
        t.append(f"近一年高低 {tech['low_52w']} ~ {tech['high_52w']}")
    if tech.get("atr_pct") is not None:
        t.append(f"ATR14占现价 {tech['atr_pct']}%")
    if tech.get("volatility20") is not None:
        t.append(f"20日单日收益波动 {tech['volatility20']}%")
    if tech.get("max_drawdown60") is not None:
        t.append(f"60日最大回撤 {tech['max_drawdown60']}%")
    if t:
        lines.append("技术指标: " + "; ".join(t))
    lines.append(f"近10日收盘价: {closes}")
    prompt = (
        "你是 A 股个股分析助手。基于以下实时行情与技术指标,给出一段简短、克制的中文分析建议。"
        f"用户主要周期是{horizon_label}。必须只按这一周期组织建议：短线重5/20日量价与动量，"
        "波段重20日趋势、确认信号与回撤，中长线重60日趋势与回撤。"
        "若 market stage 是上午盘中或下午盘中，必须明确结论为盘中临时快照，优先使用均价线、"
        "日内位置和15分钟动量，不得把未收盘日K或当日成交量当成完整收盘信号；午间休市则等待午后确认。"
        "中长线数据不含完整财报、行业景气和估值分位，不得下长期价值判断。"
        "输出 JSON,包含六个字段:summary(近期走势概述,≤60字,引用具体数字)、"
        "advice(操作建议,≤60字,只使用用户主要周期视角)、risk(风险提示,≤40字)、"
        "action(只能是持有关注/逢低观察/谨慎观望/减仓防守之一)、"
        f"confidence(45到90之间的整数置信度)、horizon(必须输出“{horizon_label}”)。"
        "只输出 JSON 对象,不要其他文字。数据不足时如实说明,不要编造数字。\n\n"
        + "\n".join(lines)
    )
    raw = _call_deepseek([{"role": "user", "content": prompt}])
    if not raw:
        out = _rule_stock_ai(q, tech)
    else:
        try:
            text = raw.strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            d = json.loads(text)
            if not isinstance(d, dict):
                out = _rule_stock_ai(q, tech)
            else:
                fallback = _rule_stock_ai(q, tech)
                allowed_actions = {"持有关注", "逢低观察", "谨慎观望", "减仓防守"}
                action = str(d.get("action", "")).strip()
                try:
                    confidence = int(d.get("confidence", fallback["confidence"]))
                except (TypeError, ValueError):
                    confidence = fallback["confidence"]
                action = action if action in allowed_actions else fallback["action"]
                out = {
                    "summary": str(d.get("summary", "")).strip()[:80] or fallback["summary"],
                    "advice": str(d.get("advice", "")).strip()[:80] or "关注量能与均线位置,结合板块表现判断。",
                    "risk": str(d.get("risk", "")).strip()[:60] or "个股波动风险,注意仓位控制。",
                    "action": action,
                    "signal": "bullish" if action == "持有关注" else "bearish" if action == "减仓防守" else "neutral",
                    "confidence": max(45, min(90, confidence)),
                    "horizon": horizon_label,
                    "support": fallback["support"],
                    "resistance": fallback["resistance"],
                    "source": "deepseek",
                    "dimensions": fallback["dimensions"],
                    "bull_points": fallback["bull_points"],
                    "bear_points": fallback["bear_points"],
                    "plan": fallback["plan"],
                    "valuation": fallback["valuation"],
                    "scope": fallback["scope"],
                    "suitability": fallback["suitability"],
                }
        except Exception:
            out = _rule_stock_ai(q, tech)
    if out.get("source") == "rule":
        support = out.get("support") or q.get("low") or q["price"]
        resistance = out.get("resistance") or q.get("high") or q["price"]
        if horizon == "短线":
            out["advice"] = f"短线只看量价确认：放量突破 {resistance:.2f} 或回踩 {support:.2f} 快速收回后再评估，避免追高。"
        elif horizon == "中长线":
            ma60 = tech.get("ma60") or tech.get("ma20") or support
            out["advice"] = f"中长线仅作技术面观察：重点看能否站稳60日均线 {ma60:.2f} 与控制回撤，不据此判断长期价值。"
        else:
            ma20 = tech.get("ma20") or support
            out["advice"] = f"波段重点观察20日均线 {ma20:.2f}、量价确认与回撤；未满足条件前保持观察。"
    out["horizon"] = horizon_label
    support = out.get("support") or q.get("low") or q["price"]
    out["market_session"] = clock
    out["intraday"] = intraday
    out["long_term_zone"] = _long_term_zone(q, tech, support)
    out["session_note"] = clock["strategy_focus"]
    out["style_scope"] = {
        "短线": "侧重量价、动量与5/20日结构，信号变化较快。",
        "波段": "侧重20日趋势、量价确认与回撤风险。",
        "中长线": "仅按60日趋势与回撤做技术面观察，不含完整基本面。",
    }[horizon]
    if clock["is_trading"]:
        out["advice"] = f"盘中快照：{clock['strategy_focus']}{out['advice']}"
    elif clock["phase"] == "lunch":
        out["advice"] = f"午间休市：上午信号尚需午后确认。{out['advice']}"
    out["suitability"] = (
        f"已按你的{horizon_label}周期组织技术面建议；具体资金与持仓适配，"
        "请以“问 AI”中结合当前资金档案的回答为准。"
    )
    out["generated_at"] = clock["time"]
    return out


def _safe_profile(profile, current_code):
    """只保留持仓分析需要的字段，限制数量和长度，避免任意客户端内容进入提示词。"""
    raw = profile if isinstance(profile, dict) else {}

    def money(value):
        number = _num(value)
        return round(max(0, number or 0), 2)

    positions = []
    for item in (raw.get("positions") or [])[:50]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        if not (code.isdigit() and len(code) == 6):
            continue
        positions.append({
            "code": code,
            "name": _clean(item.get("name"))[:16],
            "amount": money(item.get("amount")),
            "cost_price": money(item.get("costPrice")),
            "quantity": int(money(item.get("quantity"))),
        })
    transactions = []
    for item in (raw.get("transactions") or [])[:100]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        if not (code.isdigit() and len(code) == 6):
            continue
        side = "sell" if item.get("side") == "sell" else "buy"
        transactions.append({
            "trade_at": str(item.get("tradeAt") or "")[:16],
            "side": side,
            "code": code,
            "name": _clean(item.get("name"))[:16],
            "price": money(item.get("price")),
            "quantity": int(money(item.get("quantity"))),
            "amount": money(item.get("amount")),
            "stamp_duty": money(item.get("stampDuty")),
        })
    total = money(raw.get("totalCapital"))
    invested = round(sum(item["amount"] for item in positions), 2)
    bought = sum(item["amount"] for item in transactions if item["side"] == "buy")
    sold = sum(item["amount"] for item in transactions if item["side"] == "sell")
    stamp_duty = sum(item["stamp_duty"] for item in transactions)
    stamp_duty_rate = money(raw.get("stampDutyRate") if raw.get("stampDutyRate") is not None else 0.05)
    available = round(total - bought + sold - stamp_duty, 2) if transactions else round(total - invested, 2)
    current = next((item for item in positions if item["code"] == current_code), None)
    raw_horizon = str(raw.get("horizon") or "波段")[:8]
    horizon = {"中线": "波段", "长线": "中长线"}.get(raw_horizon, raw_horizon)
    if horizon not in {"短线", "波段", "中长线"}:
        horizon = "波段"
    return {
        "total_capital": total,
        "invested": invested,
        "available": available,
        "invested_pct": round(invested / total * 100, 1) if total else 0,
        "stamp_duty_total": round(stamp_duty, 2),
        "stamp_duty_rate_pct": min(stamp_duty_rate, 5),
        "risk_level": str(raw.get("riskLevel") or "稳健")[:8],
        "horizon": horizon,
        "positions": positions,
        "recent_transactions": sorted(transactions, key=lambda item: item["trade_at"], reverse=True)[:30],
        "current_position": current,
    }


def _minimum_buy_shares(code):
    """竞价买入最小申报数量：科创板 200 股，其余当前支持市场按 100 股估算。"""
    return 200 if str(code or "").startswith(("688", "689")) else 100


def _stock_chat_intent(question):
    text = "".join(str(question or "").lower().split())
    if any(word in text for word in (
        "月k", "月线", "月度", "连跌", "几个月", "一年多",
        "连续下跌", "一直下跌", "一路下跌", "下跌为0个月",
    )):
        return "monthly"
    if any(word in text for word in ("长期", "长线", "观察区", "买入点", "布局点")):
        return "long_term"
    if any(word in text for word in ("盘中", "分时", "均价", "今天", "今日", "开盘", "收盘")):
        return "intraday"
    if any(word in text for word in ("仓位", "资金", "成本", "买多少", "能买吗", "适合", "配置", "一手")):
        return "allocation"
    if any(word in text for word in ("全面", "综合", "整体", "详细分析", "完整分析")):
        return "overview"
    return "technical"


def _display_month(value):
    try:
        year, month = str(value).split("-")
        return f"{int(year)}年{int(month)}月"
    except Exception:
        return str(value or "—")


def _monthly_chat_answer(q, monthly):
    if not monthly.get("available"):
        return f"目前还不能准确回答 {q['name']} 连跌了几个月：{monthly.get('note') or '月 K 数据不足'}"

    consecutive = monthly["consecutive_down_months"]
    latest_month = _display_month(monthly["latest_completed_month"])
    latest_change = monthly["latest_completed_change_pct"]
    peak_month = _display_month(monthly["peak_month"])
    span = monthly["months_since_peak"]
    drawdown = monthly.get("peak_to_latest_pct")
    conclusion = (
        f"你看得没错：从趋势上看，{q['name']}月 K 仍处于“{monthly.get('trend_status') or '中期回撤'}”；"
        f"从{peak_month}月收盘高点 {monthly['peak_close']:.2f} 到{latest_month} "
        f"{monthly['latest_completed_close']:.2f}，已持续约 {span} 个月、累计 {drawdown:+.2f}%。"
    )

    if consecutive:
        strict_count = (
            f"如果严格按“每个月收盘都低于前一个月”计算，截至{latest_month}连续收跌 {consecutive} 个月，"
            f"最近一个完整月变动 {latest_change:+.2f}%。"
        )
    else:
        strict_count = (
            f"刚才的“0 个月”只表示严格的连续收跌计数被{latest_month}的 {latest_change:+.2f}% 反弹打断，"
            "不代表中期下降趋势已经结束。"
        )

    longest = monthly.get("longest_down_months_recent") or 0
    if longest:
        streak = (
            f"近两年最长连跌是 {longest} 个月"
            f"（{_display_month(monthly.get('longest_down_start'))}至{_display_month(monthly.get('longest_down_end'))}）"
        )
    else:
        streak = "近两年没有形成连续月线收跌"
    ma_note = ""
    if monthly.get("ma5") is not None and monthly.get("ma10") is not None:
        ma_note = (
            f"截至完整月，月线 MA5 约 {monthly['ma5']:.2f}、MA10 约 {monthly['ma10']:.2f}；"
            f"{streak}。"
        )
    else:
        ma_note = f"{streak}。"

    current = monthly.get("current_month")
    if current:
        current_note = (
            f"本月截至 {current['date']} 暂报 {current['close']:.2f}，较上月收盘 {current['change_pct']:+.2f}%；"
            "月 K 尚未收完，不计入连续涨跌结论。"
        )
    else:
        current_note = "以上只按已完成月 K 收盘价统计。"
    return "\n\n".join((conclusion, strict_count, ma_note + " " + current_note))


def _trim_chat_answer(value, limit=700):
    """限制聊天答案长度，并优先在完整句子处结束，避免硬截出半句话。"""
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    clipped = text[:limit]
    boundary = max(clipped.rfind("。"), clipped.rfind("！"), clipped.rfind("？"), clipped.rfind("\n"))
    if boundary >= int(limit * 0.55):
        return clipped[:boundary + 1].rstrip()
    return clipped.rstrip("，；、 ") + "。"


def _rule_stock_chat(q, tech, profile, question, clock=None, intraday=None, monthly=None):
    """模型不可用时按问题意图作答，避免无关的整套模板倾倒。"""
    framework = _rule_stock_ai(q, tech)
    position = profile.get("current_position")
    total = profile.get("total_capital") or 0
    invested = profile.get("invested") or 0
    available = profile.get("available") or 0
    stock_amount = position.get("amount", 0) if position else 0
    stock_weight = stock_amount / total * 100 if total else 0
    portfolio_weight = stock_amount / invested * 100 if invested else 0
    risk_cap = {"保守": 10, "稳健": 15, "进取": 20}.get(profile.get("risk_level"), 15)
    lot_size = _minimum_buy_shares(q.get("code"))
    lot_label = f"1手（{lot_size}股）" if lot_size == 100 else f"最低{lot_size}股"
    min_buy_amount = round(q["price"] * lot_size, 2)
    min_buy_weight = min_buy_amount / total * 100 if total else 0
    risk_budget = round(total * risk_cap / 100, 2) if total else 0
    horizon = profile.get("horizon") or "波段"
    horizon_label = {"短线": "短线", "波段": "波段（中线）", "中长线": "中长线技术面"}[horizon]
    clock = clock or _market_clock()
    intraday = intraday or {}
    monthly = monthly or {"available": False, "note": "月 K 数据不足。"}
    intent = _stock_chat_intent(question)

    if intent == "monthly":
        return _monthly_chat_answer(q, monthly)

    if intent == "long_term":
        zone = _long_term_zone(q, tech, framework["support"])
        return "\n\n".join((
            f"{q['name']}当前的长期技术观察区是 {zone['lower']:.2f}–{zone['upper']:.2f}，状态为“{zone['label']}”。",
            f"确认条件：{zone['confirmation']}",
            f"失效条件：{zone['invalidation']} {zone['scope']}",
        ))

    if intent == "intraday":
        detail = f"当前是{clock['label']}（{clock['time']}），现价 {q['price']:.2f}，今日 {q['change_pct']:+.2f}%。"
        if intraday.get("average_price"):
            detail += (
                f"现价较分时均价 {intraday.get('vs_average_pct'):+.2f}%，"
                f"近15分钟动量 {intraday.get('momentum_15m_pct'):+.2f}%。"
            )
        return "\n\n".join((detail, clock["strategy_focus"], f"参考支撑 {framework['support']:.2f}、压力 {framework['resistance']:.2f}。"))

    if intent == "allocation":
        if position and stock_amount:
            concentration = (
                f"当前 {q['name']} 持仓成本占初始资金 {stock_weight:.1f}%"
                f"，高于 {risk_cap}% 柔性参考线，集中度偏高。"
                if stock_weight > risk_cap else
                f"当前 {q['name']} 持仓成本占初始资金 {stock_weight:.1f}%，在 {risk_cap}% 柔性参考线内。"
            )
            return "\n\n".join((
                concentration,
                f"初始资金 {total:,.0f} 元、可用资金 {available:,.0f} 元、本股持仓成本 {stock_amount:,.0f} 元。比例用于提示集中度，不自动得出卖出结论。",
                f"后续重点观察 {framework['support']:.2f} 支撑；若有效跌破，再结合成本和交易记录评估仓位。",
            ))
        if not total:
            return f"还不能判断 {q['name']} 是否适合你的资金：请先设置初始资金。按现价买入 {lot_label} 约需 {min_buy_amount:,.0f} 元，另需预留交易费用。"
        if min_buy_amount > available:
            return (
                f"当前资金暂时买不了 {q['name']} 的最低申报数量。按现价 {q['price']:.2f} 元，"
                f"{lot_label}约需 {min_buy_amount:,.0f} 元，高于可用资金 {available:,.0f} 元，且尚未计入交易费用。"
            )
        concentration = (
            f"会占初始资金 {min_buy_weight:.1f}%，高于 {risk_cap}% 柔性参考线，集中度偏高；"
            "但资金可成交，这不是机械否决。"
            if min_buy_weight > risk_cap else
            f"会占初始资金 {min_buy_weight:.1f}%，在 {risk_cap}% 柔性参考线内。"
        )
        return "\n\n".join((
            f"资金上可以买到最低申报数量：{lot_label}约需 {min_buy_amount:,.0f} 元，{concentration}",
            f"是否进入还要看技术条件：参考支撑 {framework['support']:.2f}、压力 {framework['resistance']:.2f}，不要只因资金够就直接买入。",
        ))

    if intent == "technical":
        ma20 = tech.get("ma20")
        ma60 = tech.get("ma60")
        chg20 = tech.get("chg20")
        chg60 = tech.get("chg60")
        trend = "偏强" if tech.get("above_ma20") and tech.get("macd_golden") else "偏弱" if not tech.get("above_ma20") else "震荡"
        facts = [f"现价 {q['price']:.2f}，今日 {q['change_pct']:+.2f}%"]
        if chg20 is not None:
            facts.append(f"近20日 {chg20:+.2f}%")
        if chg60 is not None:
            facts.append(f"近60日 {chg60:+.2f}%")
        if ma20:
            facts.append(f"20日线 {ma20:.2f}")
        if ma60:
            facts.append(f"60日线 {ma60:.2f}")
        return "\n\n".join((
            f"从当前日线技术结构看，{q['name']}处于{trend}状态；这只能回答价格趋势，不能解释公司层面的下跌原因。",
            "关键数据：" + "，".join(facts) + "。",
            f"接下来观察 {framework['support']:.2f} 能否守住，以及 {framework['resistance']:.2f} 能否有效突破；若你想问月线持续多久，我可以按已完成月 K 单独统计。",
        ))

    lines = []
    if position and stock_amount:
        if stock_weight > risk_cap:
            lines.append(
                f"结论：当前 {q['name']} 仓位偏重。持仓成本占初始资金 {stock_weight:.1f}%，"
                f"高于你的{profile['risk_level']}型单股风险控制参考线 {risk_cap}%。"
            )
        else:
            lines.append(
                f"结论：当前 {q['name']} 仓位处于{profile['risk_level']}型参考范围内，"
                f"占初始资金 {stock_weight:.1f}%（参考线 {risk_cap}%）；是否继续持有仍取决于风险条件。"
            )
        position_text = (
            f"资金账本：初始资金 {total:,.0f} 元、账面可用资金 {available:,.0f} 元；"
            f"本股持仓成本 {stock_amount:,.0f} 元"
            + (f"、占已配置资金 {portfolio_weight:.1f}%" if invested else "")
        )
        cost = position.get("cost_price") or 0
        if cost:
            pnl = (q["price"] / cost - 1) * 100
            position_text += f"；成本价 {cost:.2f}，按现价 {q['price']:.2f} 估算价格变动 {pnl:+.2f}%"
        lines.append(position_text + "。")
        latest_trade = next((item for item in profile.get("recent_transactions", []) if item["code"] == q["code"]), None)
        if latest_trade:
            side_text = "买入" if latest_trade["side"] == "buy" else "卖出"
            lines.append(
                f"最近一笔记录为 {latest_trade['trade_at']} {side_text} {latest_trade['quantity']:,} 股，"
                f"成交价 {latest_trade['price']:.2f} 元，印花税 {latest_trade['stamp_duty']:.2f} 元。"
            )
    else:
        if not total:
            lines.append("结论：暂时无法判断是否适合你的资金配置，因为尚未设置初始资金。")
        elif min_buy_amount > available:
            lines.append(
                f"结论：当前不适合买入。按现价 {q['price']:.2f} 元估算，买入 {lot_label} 至少需要约 {min_buy_amount:,.0f} 元，"
                f"高于账面可用资金 {available:,.0f} 元，且尚未计入佣金等费用。"
            )
        elif min_buy_weight > risk_cap:
            required_capital = min_buy_amount / (risk_cap / 100)
            lines.append(
                f"结论：从资金配置角度，当前不适合直接买入。按现价买入 {lot_label} 约需 {min_buy_amount:,.0f} 元，"
                f"会占初始资金 {min_buy_weight:.1f}%，明显高于你的{profile['risk_level']}型单股风险控制参考线 {risk_cap}%。"
            )
            lines.append(
                f"你的单股参考预算约为 {risk_budget:,.0f} 元；若保持 {risk_cap}% 上限，"
                f"承接一手所需初始资金约 {required_capital:,.0f} 元，且还应预留交易费用和现金缓冲。"
            )
        else:
            lines.append(
                f"结论：资金条件允许纳入观察，但不是直接买入结论。{lot_label}约需 {min_buy_amount:,.0f} 元，"
                f"占初始资金 {min_buy_weight:.1f}%，处于{profile['risk_level']}型 {risk_cap}% 参考线以内。"
            )

    session_detail = f"当前为{clock['label']}（{clock['time']}）"
    if intraday.get("average_price"):
        session_detail += (
            f"，现价较分时均价 {intraday.get('vs_average_pct'):+.2f}%、"
            f"近15分钟 {intraday.get('momentum_15m_pct'):+.2f}%"
        )
    lines.append(session_detail + "。" + clock["strategy_focus"])
    lines.append(
        f"{horizon_label}行情条件：现价 {q['price']:.2f}，今日 {q['change_pct']:+.2f}%；"
        f"参考支撑 {framework['support']:.2f}、压力 {framework['resistance']:.2f}。"
    )
    if horizon == "短线":
        style_condition = f"短线重点等待放量突破 {framework['resistance']:.2f}，或回踩 {framework['support']:.2f} 后快速收回。"
    elif horizon == "中长线":
        ma60 = tech.get("ma60") or tech.get("ma20") or framework["support"]
        style_condition = f"中长线仅按技术面观察能否站稳60日均线 {ma60:.2f}；当前资料不足以判断长期价值。"
    else:
        ma20 = tech.get("ma20") or framework["support"]
        style_condition = f"波段重点观察20日均线 {ma20:.2f}、量价确认与回撤。"
    lines.append(style_condition)
    if not position:
        lines.append(
            f"下一步：先保持未持仓观察；只有资金集中度满足约束后，再结合站稳 {framework['support']:.2f} "
            f"或有效突破 {framework['resistance']:.2f} 等条件重新评估。跌破参考支撑则视为观察逻辑失效。"
        )
    else:
        lines.append(
            f"下一步：围绕 {framework['support']:.2f} 设置风险观察线；若有效跌破，应重新评估仓位，"
            f"而不是把当前量化信号“{framework['action']}”当作确定性持有依据。"
        )
    zone = _long_term_zone(q, tech, framework["support"])
    lines.append(
        f"中长线技术观察：{zone['lower']:.2f}–{zone['upper']:.2f} 为观察区，"
        f"需要先满足“{zone['confirmation']}”；{zone['scope']}"
    )
    return "\n\n".join(lines)


def get_stock_chat(code, question, messages=None, profile=None):
    """个股持仓问答：实时行情 + 用户资金档案 + 有限轮次历史。"""
    if not (isinstance(code, str) and code.isdigit() and len(code) == 6):
        return None
    st = get_stock(code)
    if not st:
        return None
    q = st["quote"]
    tech = st.get("tech") or {}
    clock = st.get("market_session") or _market_clock()
    intraday = st.get("intraday") or _intraday_context(st.get("minute"), q, clock)
    safe_profile = _safe_profile(profile, code)
    framework = _rule_stock_ai(q, tech)
    monthly = _monthly_trend_context(st.get("kline_month") or [], clock)
    position = safe_profile.get("current_position")
    risk_cap = {"保守": 10, "稳健": 15, "进取": 20}.get(safe_profile.get("risk_level"), 15)
    minimum_buy_shares = _minimum_buy_shares(q.get("code"))
    min_buy_amount = round(q["price"] * minimum_buy_shares, 2)
    stock_weight = (position.get("amount", 0) / safe_profile["total_capital"] * 100
                    if position and safe_profile["total_capital"] else 0)

    context = {
        "stock": {
            "code": q["code"], "name": q["name"], "price": q["price"],
            "change_pct": q["change_pct"], "high": q["high"], "low": q["low"],
            "pe": q.get("pe"), "pb": q.get("pb"),
        },
        "technical": tech,
        "research": {
            "action": framework["action"], "support": framework["support"],
            "resistance": framework["resistance"], "risk": framework["risk"],
        },
        "market_session": clock,
        "intraday": intraday,
        "monthly_trend": monthly,
        "long_term_zone": _long_term_zone(q, tech, framework["support"]),
        "allocation_constraints": {
            "minimum_buy_shares": minimum_buy_shares,
            "minimum_lot_value": min_buy_amount,
            "minimum_lot_weight_pct": round(min_buy_amount / safe_profile["total_capital"] * 100, 1)
            if safe_profile["total_capital"] else None,
            "single_stock_reference_cap_pct": risk_cap,
            "reference_cap_is_risk_control_assumption": True,
        },
        "investor": safe_profile,
    }
    system = (
        "你是 FinForge 的 A 股研究对话助手。你必须只依据提供的行情、技术指标和投资档案回答。"
        "先识别用户当前只问了什么；第一句话必须直接回答，不要自动附送资金、盘中、支撑、长期区间等整套报告。"
        "只补充回答当前问题所必需的依据；除非用户明确要求全面分析，否则控制在 3 个短段落内。"
        "用户询问月K、连跌月份或是否跌了一年时，必须优先引用 monthly_trend：先回答整体趋势是否仍在下跌，"
        "再解释“连续月线收跌”的严格计数。反弹月只会打断连续计数，不能据此否定中期下降趋势；"
        "若 trend_status 仍为下降趋势，禁止用‘没有下跌’或‘不是跌了一年’作为开头。"
        "同时区分从阶段高点回撤持续多久，并明确当月未完成 K 线不计入连续月份。"
        "涉及仓位时同时考虑初始资金使用率、上下文给出的最低买入股数及金额、单股占初始资金比例、"
        "组合集中度、风险偏好和投资周期。未持有该股票时不得使用‘持有、减仓、继续持有’等持仓措辞；"
        "必须严格按 investor.horizon 回答：短线重5/20日量价和动量，波段重20日趋势与回撤，"
        "中长线重60日趋势与回撤且必须声明缺少完整基本面，不能混用不同周期逻辑。"
        "必须感知 market_session：连续竞价盘中只给临时策略，优先解释均价线、日内位置和15分钟动量，"
        "不得使用收盘确认措辞；午间休市要明确等待午后确认；盘后才允许按收盘结果复盘。"
        "用户询问长期买点时，只能引用 long_term_zone 作为技术观察区，并同时给出确认条件、失效条件和数据边界。"
        "单股比例是柔性集中度参考；资金足够最低申报数量时，不得仅因超过参考比例就说绝对不能买。"
        "不要承诺收益，不要给出确定性买卖指令，"
        "不要把技术支撑位描述为保证。若资料不足，明确指出缺少什么。回答使用简洁中文，控制在 350 字内。"
        "投资档案仅用于本次回答。以下是可信数据上下文：\n" + json.dumps(context, ensure_ascii=False)
    )
    history = []
    for item in (messages if isinstance(messages, list) else [])[-8:]:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()[:1200]
        if content:
            history.append({"role": item["role"], "content": content})
    user_question = str(question or "").strip()[:1000]
    raw = _call_deepseek([{"role": "system", "content": system}, *history, {"role": "user", "content": user_question}], timeout=45)
    answer = _trim_chat_answer(raw) if raw else _rule_stock_chat(q, tech, safe_profile, user_question, clock, intraday, monthly)
    return {
        "message": answer,
        "source": "deepseek" if raw else "rule",
        "generated_at": time.strftime("%H:%M"),
        "context": {
            "profile_ready": bool(safe_profile["total_capital"]),
            "is_holding": bool(position and position.get("amount")),
            "stock_weight": round(stock_weight, 1),
            "market_phase": clock["phase"],
            "market_label": clock["label"],
            "intent": _stock_chat_intent(user_question),
        },
    }


# ---------------- 自选股智能优选（最多 10 只） ----------------
@cached(ttl=45)
def _watchlist_research_snapshots(codes):
    """批量行情只请求一次；日 K 并发获取，避免加载分时、周 K、月 K 等无关数据。"""
    clean_codes = []
    for value in codes if isinstance(codes, (list, tuple)) else []:
        code = str(value or "").strip()
        if code.isdigit() and len(code) == 6 and code not in clean_codes:
            clean_codes.append(code)
    clean_codes = clean_codes[:10]
    if not clean_codes:
        return []

    quotes = qq_quotes([_tx_code(code) for code in clean_codes])

    def load_kline(code):
        try:
            return qq_kline(_tx_code(code), 250, "day")
        except Exception:
            return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, len(clean_codes))) as executor:
        klines = dict(zip(clean_codes, executor.map(load_kline, clean_codes)))

    snapshots = []
    for code in clean_codes:
        raw = quotes.get(_tx_code(code))
        if not raw:
            continue
        kline = klines.get(code) or []
        quote = {
            "code": code,
            "name": _clean(raw.get("name")),
            "price": round(raw.get("price") or 0, 2),
            "change_pct": round(raw.get("change_pct") or 0, 2),
            "high": round(raw.get("high") or 0, 2),
            "low": round(raw.get("low") or 0, 2),
            "amount": round((raw.get("amount") or 0) / 1e8, 2),
            "turnover_rate": round(raw.get("turnover_rate") or 0, 2),
            "volume_ratio": round(raw.get("volume_ratio") or 0, 2),
            "pe": round(raw.get("pe") or 0, 2),
            "pb": round(raw.get("pb") or 0, 2),
        }
        snapshots.append({"quote": quote, "tech": _tech_signals(kline)})
    return snapshots


def _watchlist_rule_items(snapshots, safe_profile):
    positions = {item["code"]: item for item in safe_profile.get("positions", [])}
    total = safe_profile.get("total_capital") or 0
    available = safe_profile.get("available") or 0
    risk_cap = {"保守": 10, "稳健": 15, "进取": 20}.get(safe_profile.get("risk_level"), 15)
    horizon = safe_profile.get("horizon") or "波段"
    style = {
        "短线": {
            "label": "短线",
            "weights": {"trend": 0.24, "momentum": 0.29, "volume": 0.27, "risk": 0.20},
            "priority_score": 60,
        },
        "波段": {
            "label": "波段（中线）",
            "weights": {"trend": 0.38, "momentum": 0.22, "volume": 0.14, "risk": 0.26},
            "priority_score": 58,
        },
        "中长线": {
            "label": "中长线技术面",
            "weights": {"trend": 0.46, "momentum": 0.10, "volume": 0.06, "risk": 0.38},
            "priority_score": 62,
        },
    }.get(horizon)
    style_scope = {
        "短线": "短线口径侧重量价、动量与5/20日结构，信号变化较快。",
        "波段": "波段口径侧重20日趋势、量价确认与回撤风险。",
        "中长线": "中长线仅按60日趋势与回撤做技术面观察，不等同于长期投资价值判断。",
    }[horizon]
    items = []

    for snapshot in snapshots:
        q = snapshot["quote"]
        sig = snapshot.get("tech") or {}
        framework = _rule_stock_ai(q, sig)
        dimension_map = {item["key"]: item["score"] for item in framework.get("dimensions", [])}
        trend = dimension_map.get("trend", 50)
        momentum = dimension_map.get("momentum", 50)
        volume = dimension_map.get("volume", 50)
        risk = dimension_map.get("risk", 50)
        weights = style["weights"]
        score = (
            trend * weights["trend"]
            + momentum * weights["momentum"]
            + volume * weights["volume"]
            + (100 - risk) * weights["risk"]
        )

        # 周期专属结构修正：短线关注即时量价，中长线更看重60日趋势与回撤。
        if horizon == "短线":
            day_change = q.get("change_pct") or 0
            live_volume_ratio = q.get("volume_ratio") or 0
            if live_volume_ratio >= 1.2:
                score += 4 if day_change >= 0 else -5
            if abs(day_change) >= 7:
                score -= 5
        elif horizon == "中长线":
            chg60 = sig.get("chg60")
            ma60 = sig.get("ma60")
            if ma60:
                score += 7 if q["price"] >= ma60 else -9
            if chg60 is not None:
                score += max(-7, min(7, chg60 * 0.18))
            if abs(sig.get("max_drawdown60") or 0) >= 25:
                score -= 6

        position = positions.get(q["code"])
        holding_amount = position.get("amount", 0) if position else 0
        holding_weight = holding_amount / total * 100 if total else 0
        lot_size = _minimum_buy_shares(q["code"])
        lot_amount = round(q["price"] * lot_size, 2)
        lot_weight = lot_amount / total * 100 if total else None
        allocation_blocked = False
        allocation_caution = False
        allocation_status = "unknown"

        if position and holding_weight > risk_cap:
            score -= min(10, 2 + (holding_weight - risk_cap) * 0.20)
            allocation_caution = True
            allocation_status = "holding_concentrated"
            allocation_note = (
                f"已持仓占初始资金 {holding_weight:.1f}%，高于 {risk_cap}% 柔性参考线；"
                "不影响技术排序，但不宜仅因排名靠前继续集中"
            )
        elif not total:
            allocation_status = "unknown"
            allocation_note = f"{lot_size} 股约需 {lot_amount:,.0f} 元；未配置初始资金，暂不判断仓位适配"
        elif lot_amount > available and not position:
            score -= 22
            allocation_blocked = True
            allocation_status = "unaffordable"
            allocation_note = f"最低 {lot_size} 股约需 {lot_amount:,.0f} 元，高于可用资金 {available:,.0f} 元"
        elif lot_weight is not None and lot_weight > risk_cap and not position:
            score -= min(10, 2 + (lot_weight - risk_cap) * 0.18)
            allocation_caution = True
            allocation_status = "concentrated"
            allocation_note = (
                f"最低 {lot_size} 股约需 {lot_amount:,.0f} 元，占初始资金 {lot_weight:.1f}%；"
                f"高于 {risk_cap}% 柔性参考线，但资金可执行"
            )
        elif position:
            allocation_status = "holding_fit"
            allocation_note = f"已持仓占初始资金 {holding_weight:.1f}%，处于 {risk_cap}% 柔性参考线内"
        else:
            allocation_status = "fit"
            allocation_note = f"最低 {lot_size} 股约需 {lot_amount:,.0f} 元，占初始资金 {lot_weight:.1f}%"

        score = _clamp_score(score)
        strengths = framework.get("bull_points") or []
        weaknesses = framework.get("bear_points") or []
        if horizon == "短线":
            vol_ratio = sig.get("vol_ratio")
            reason = (
                f"短线量能为20日均量的 {vol_ratio:.2f} 倍，动量评分 {momentum}"
                if vol_ratio is not None else f"短线动量评分 {momentum}，量能数据暂不完整"
            )
        elif horizon == "中长线":
            ma60 = sig.get("ma60")
            chg60 = sig.get("chg60")
            if ma60 and chg60 is not None:
                reason = f"现价位于60日均线 {ma60:.2f} {'上方' if q['price'] >= ma60 else '下方'}，近60日 {chg60:+.2f}%"
            else:
                reason = "中长线技术数据不足，暂以20日趋势和回撤风险辅助观察"
        else:
            reason = strengths[0] if strengths else "当前缺少明确的趋势确认信号"
        risk_text = weaknesses[0] if weaknesses else "主要不确定性来自量能与市场环境"
        if allocation_blocked:
            risk_text = allocation_note

        support = framework.get("support") or q["low"] or q["price"]
        resistance = framework.get("resistance") or q["high"] or q["price"]
        if horizon == "短线":
            trigger = f"放量突破 {resistance:.2f}，或回踩 {support:.2f} 后快速收回"
            invalidation = f"跌破 {support:.2f} 且不能快速收回，或放量冲高回落"
        elif horizon == "中长线":
            ma60 = sig.get("ma60") or sig.get("ma20") or support
            if q["price"] >= ma60:
                trigger = f"回踩60日均线 {ma60:.2f} 不破，并保持20/60日趋势稳定"
            else:
                trigger = f"先重新站稳60日均线 {ma60:.2f}，再观察20日趋势是否改善"
            invalidation = f"收盘有效跌破 {support:.2f}，或60日趋势继续转弱"
        elif sig.get("above_ma20"):
            trigger = f"回踩 {support:.2f} 附近企稳，或放量突破 {resistance:.2f} 后确认"
            invalidation = f"收盘有效跌破 {support:.2f}，或突破 {resistance:.2f} 后放量回落"
        else:
            trigger = f"先重新站上 {sig.get('ma20') or resistance:.2f}，并观察量能是否同步改善"
            invalidation = f"收盘有效跌破 {support:.2f}，或突破 {resistance:.2f} 后放量回落"

        long_term_zone = _long_term_zone(q, sig, support)
        if allocation_blocked:
            execution_note = "当前只作技术观察；可用资金不足最低申报数量，暂不具备实际买入条件。"
        elif not total:
            execution_note = "先配置初始资金，再结合最低申报数量判断实际占比。"
        elif position:
            execution_note = (
                f"当前已有仓位；{allocation_note}。如需调整，应先核对交易账本与长期观察区。"
            )
        elif allocation_caution:
            execution_note = (
                f"可执行最低 {lot_size} 股，但单笔占比 {lot_weight:.1f}% 偏高；"
                "比例仅作集中度提醒，不否决技术机会。"
            )
        else:
            execution_note = f"可执行最低 {lot_size} 股，预计占初始资金 {lot_weight:.1f}%，仍需预留交易费用。"

        items.append({
            "code": q["code"], "name": q["name"], "price": q["price"],
            "change_pct": q["change_pct"], "score": score,
            "label": "继续观察", "tone": "watch",
            "reason": reason, "risk": risk_text, "trigger": trigger,
            "invalidation": invalidation,
            "support": support, "resistance": resistance,
            "allocation_blocked": allocation_blocked,
            "allocation_caution": allocation_caution,
            "allocation_status": allocation_status,
            "allocation_note": allocation_note,
            "allocation_reference_pct": risk_cap,
            "minimum_shares": lot_size, "minimum_lot_value": lot_amount,
            "minimum_lot_weight": round(lot_weight, 1) if lot_weight is not None else None,
            "execution_note": execution_note,
            "long_term_zone": long_term_zone,
            "holding": bool(position), "holding_weight": round(holding_weight, 1),
            "horizon": horizon, "horizon_label": style["label"],
            "style_scope": style_scope,
            "dimensions": framework.get("dimensions") or [],
        })

    items.sort(key=lambda item: (-item["score"], item["code"]))
    for index, item in enumerate(items):
        if item["allocation_blocked"] or item["score"] < 43:
            item["label"], item["tone"] = "暂时回避", "risk"
        elif index < 3 and item["score"] >= style["priority_score"]:
            item["label"], item["tone"] = "优先关注", "priority"
        else:
            item["label"], item["tone"] = "继续观察", "watch"
        item["rank"] = index + 1
    return items


def _ai_watchlist_analysis(items, safe_profile):
    """模型只在可信计算结果上做比较与表述，不允许编造代码、价格或仓位。"""
    compact_items = [{
        "code": item["code"], "name": item["name"], "price": item["price"],
        "change_pct": item["change_pct"], "rule_score": item["score"],
        "rule_label": item["label"], "allocation_blocked": item["allocation_blocked"],
        "allocation_caution": item["allocation_caution"],
        "allocation_status": item["allocation_status"],
        "allocation_note": item["allocation_note"],
        "minimum_shares": item["minimum_shares"],
        "minimum_lot_value": item["minimum_lot_value"],
        "minimum_lot_weight": item["minimum_lot_weight"],
        "execution_note": item["execution_note"],
        "long_term_zone": item["long_term_zone"],
        "reason": item["reason"],
        "risk": item["risk"], "trigger": item["trigger"],
        "invalidation": item["invalidation"], "horizon": item["horizon"],
    } for item in items]
    context = {
        "investor": {
            "initial_capital": safe_profile.get("total_capital"),
            "available_cash": safe_profile.get("available"),
            "risk_level": safe_profile.get("risk_level"),
            "horizon": safe_profile.get("horizon"),
        },
        "candidates": compact_items,
    }
    prompt = (
        "你是 A 股自选股组合研究助手。只在给出的候选股内比较，不得引入其他股票。"
        "综合规则评分、资金适配、趋势和风险重新排序，并为每只股票输出 code、label、reason、risk、trigger、invalidation。"
        "必须严格按 investor.horizon 使用对应口径：短线重动量与量能，波段重20日趋势与回撤，"
        "中长线重60日趋势与回撤；中长线数据不含完整基本面，不得表述为长期投资价值。"
        "资金比例是柔性集中度参考，不是机械淘汰条件：allocation_caution=true 仍可按技术条件进入优先关注；"
        "只有 allocation_blocked=true（可用资金不足最低申报数量）时不得标为优先关注。"
        "long_term_zone 是程序计算的中长线技术观察区，只能用于说明等待、确认与失效条件，不得改写数字或包装成确定买点。"
        "label 只能是优先关注/继续观察/暂时回避。"
        "reason/risk/trigger/invalidation 各不超过 45 字，必须使用已有数字，不得编造财报、新闻或目标价。"
        "优先关注表示研究优先级，不是确定性买入指令。只输出 JSON 数组。\n\n可信上下文："
        + json.dumps(context, ensure_ascii=False)
    )
    raw = _call_deepseek([{"role": "user", "content": prompt}], timeout=50, max_tokens=1800)
    if not raw:
        return None
    try:
        text = raw.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            return None
        by_code = {item["code"]: item for item in items}
        allowed_labels = {"优先关注", "继续观察", "暂时回避"}
        output = []
        for ai_item in parsed:
            code = str(ai_item.get("code") or "") if isinstance(ai_item, dict) else ""
            base = by_code.pop(code, None)
            if not base:
                continue
            label = str(ai_item.get("label") or "").strip()
            if label not in allowed_labels or (base["allocation_blocked"] and label == "优先关注"):
                label = base["label"]
            base = {**base, "label": label}
            base["tone"] = "priority" if label == "优先关注" else "risk" if label == "暂时回避" else "watch"
            for key in ("reason", "risk", "trigger", "invalidation"):
                value = str(ai_item.get(key) or "").strip()
                if value:
                    base[key] = value[:70]
            output.append(base)
        output.extend(by_code.values())
        if not output:
            return None
        for index, item in enumerate(output):
            item["rank"] = index + 1
        return output
    except Exception:
        return None


def get_watchlist_analysis(codes, profile=None):
    """自选股范围内优选：最多 10 只，一次批量取数、一次模型调用。"""
    snapshots = _watchlist_research_snapshots(tuple(codes[:10]))
    if not snapshots:
        return None
    safe_profile = _safe_profile(profile, "")
    rule_items = _watchlist_rule_items(snapshots, safe_profile)
    ai_items = _ai_watchlist_analysis(rule_items, safe_profile)
    items = ai_items or rule_items
    priority_count = sum(1 for item in items if item["label"] == "优先关注")
    blocked_count = sum(1 for item in items if item["allocation_blocked"])
    caution_count = sum(1 for item in items if item.get("allocation_caution"))
    horizon = safe_profile.get("horizon") or "波段"
    horizon_label = {"短线": "短线", "波段": "波段（中线）", "中长线": "中长线技术面"}[horizon]
    style_scope = {
        "短线": "短线口径侧重量价、动量与5/20日结构，信号变化较快。",
        "波段": "波段口径侧重20日趋势、量价确认与回撤风险。",
        "中长线": "中长线仅按60日趋势与回撤做技术面观察，不等同于长期投资价值判断。",
    }[horizon]
    summary = (
        f"按{horizon_label}口径比较 {len(items)} 只自选股，{priority_count} 只进入优先关注，"
        f"{blocked_count} 只因最低申报金额暂不可执行，{caution_count} 只触发集中度柔性提醒。"
    )
    return {
        "generated_at": time.strftime("%m-%d %H:%M"),
        "source": "deepseek" if ai_items else "rule",
        "scope_count": len(items),
        "profile_ready": bool(safe_profile.get("total_capital")),
        "horizon": horizon,
        "horizon_label": horizon_label,
        "style_scope": style_scope,
        "summary": summary,
        "items": items,
        "scope": (
            "仅比较本次锁定的自选股；使用实时行情、前复权日 K、技术指标与资金账本。"
            "仓位比例是柔性集中度参考，只有可用资金不足最低申报数量才视为不可执行；"
            "长期区间仅为技术观察参考，不含完整财报、公告、新闻、行业景气和全市场横向筛选。"
        ),
    }

def _safe_watchlist_analysis(value):
    """清洗客户端回传的优选快照，限制字段与长度后再放入模型上下文。"""
    raw = value if isinstance(value, dict) else {}
    raw_horizon = str(raw.get("horizon") or "波段")[:8]
    horizon = {"中线": "波段", "长线": "中长线"}.get(raw_horizon, raw_horizon)
    if horizon not in {"短线", "波段", "中长线"}:
        horizon = "波段"
    horizon_label = {"短线": "短线", "波段": "波段（中线）", "中长线": "中长线技术面"}[horizon]
    items = []
    seen = set()
    for item in (raw.get("items") or [])[:10]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip()
        if not (code.isdigit() and len(code) == 6) or code in seen:
            continue
        seen.add(code)
        label = str(item.get("label") or "继续观察").strip()
        if label not in {"优先关注", "继续观察", "暂时回避"}:
            label = "继续观察"
        raw_zone = item.get("long_term_zone") if isinstance(item.get("long_term_zone"), dict) else {}
        zone_lower = round(max(0, _num(raw_zone.get("lower")) or 0), 2)
        zone_upper = round(max(zone_lower, _num(raw_zone.get("upper")) or 0), 2)
        long_term_zone = {
            "label": _clean(raw_zone.get("label"))[:24],
            "lower": zone_lower,
            "upper": zone_upper,
            "basis": _clean(raw_zone.get("basis"))[:160],
            "confirmation": _clean(raw_zone.get("confirmation"))[:220],
            "invalidation": _clean(raw_zone.get("invalidation"))[:180],
            "note": _clean(raw_zone.get("note"))[:140],
            "scope": _clean(raw_zone.get("scope"))[:220],
        }
        items.append({
            "rank": len(items) + 1,
            "code": code,
            "name": _clean(item.get("name"))[:16],
            "price": round(max(0, _num(item.get("price")) or 0), 2),
            "change_pct": round(_num(item.get("change_pct")) or 0, 2),
            "score": _clamp_score(_num(item.get("score")) or 0),
            "label": label,
            "reason": _clean(item.get("reason"))[:100],
            "risk": _clean(item.get("risk"))[:100],
            "trigger": _clean(item.get("trigger"))[:120],
            "invalidation": _clean(item.get("invalidation"))[:120],
            "allocation_note": _clean(item.get("allocation_note"))[:120],
            "allocation_blocked": bool(item.get("allocation_blocked")),
            "allocation_caution": bool(item.get("allocation_caution")),
            "allocation_status": _clean(item.get("allocation_status"))[:24],
            "allocation_reference_pct": round(max(0, _num(item.get("allocation_reference_pct")) or 0), 1),
            "holding": bool(item.get("holding")),
            "holding_weight": round(max(0, _num(item.get("holding_weight")) or 0), 1),
            "minimum_shares": max(0, int(_num(item.get("minimum_shares")) or 0)),
            "minimum_lot_value": round(max(0, _num(item.get("minimum_lot_value")) or 0), 2),
            "minimum_lot_weight": round(max(0, _num(item.get("minimum_lot_weight")) or 0), 1),
            "execution_note": _clean(item.get("execution_note"))[:220],
            "long_term_zone": long_term_zone,
            "horizon": horizon,
            "horizon_label": horizon_label,
        })
    return {
        "generated_at": str(raw.get("generated_at") or "")[:20],
        "source": "deepseek" if raw.get("source") == "deepseek" else "rule",
        "summary": _clean(raw.get("summary"))[:180],
        "scope": _clean(raw.get("scope"))[:300],
        "horizon": horizon,
        "horizon_label": horizon_label,
        "style_scope": _clean(raw.get("style_scope"))[:180],
        "items": items,
    }


def _rule_watchlist_chat(question, analysis, safe_profile):
    """模型不可用时，仍基于优选快照回答排序、仓位与单股追问。"""
    items = analysis.get("items") or []
    if not items:
        return "这段优选快照没有可用股票，请先重新运行自选股智能优选。"
    q = str(question or "").lower()
    target = next((item for item in items if item["code"] in q or item["name"] in q), None)
    priority = [item for item in items if item["label"] == "优先关注"]
    blocked = [item for item in items if item["allocation_blocked"]]
    horizon_label = analysis.get("horizon_label") or "波段（中线）"

    if target:
        zone = target.get("long_term_zone") or {}
        zone_text = (
            f"长期技术观察区：{zone.get('lower'):.2f}–{zone.get('upper'):.2f}；"
            f"确认条件：{zone.get('confirmation')}"
            if zone.get("lower") and zone.get("upper") else "长期技术观察区数据暂不完整。"
        )
        return "\n\n".join([
            f"结论：按{horizon_label}口径，{target['name']}在本次 {len(items)} 只自选股中排第 {target['rank']}，当前结论为“{target['label']}”。",
            f"主要依据：{target['reason']}；资金适配：{target['allocation_note']}。",
            f"执行参考：{target.get('execution_note') or target['allocation_note']}。",
            f"{zone_text}。失效与风险：{target['risk']}；{target['invalidation']}。",
        ])

    if any(word in q for word in ("仓位", "资金", "配置", "买多少", "怎么买")):
        total = safe_profile.get("total_capital") or 0
        available = safe_profile.get("available") or 0
        base = f"结论：当前初始资金 {total:,.0f} 元、可用资金 {available:,.0f} 元，"
        if blocked:
            names = "、".join(item["name"] for item in blocked[:4])
            base += f"{names}的可用资金不足最低申报数量，当前不可执行。"
        else:
            base += "本次候选均满足最低申报金额；超过风险比例只提示集中度，不会机械淘汰。"
        details = "；".join(f"{item['name']}：{item['allocation_note']}" for item in items[:4])
        return base + "\n\n" + details + "。"

    top = items[0]
    priority_text = "、".join(item["name"] for item in priority[:3]) or "暂无股票"
    return (
        f"结论：按{horizon_label}口径，{priority_text}进入优先关注；综合排序第一是{top['name']}，但这表示研究优先级，不是直接买入指令。\n\n"
        f"{top['name']}的主要依据是：{top['reason']}。资金适配：{top['allocation_note']}。\n\n"
        f"下一步应等待：{top['trigger']}。若出现“{top['invalidation']}”，则本次观察逻辑需要重新评估。"
    )


def get_watchlist_chat(question, analysis=None, messages=None, profile=None):
    """围绕固定的自选股优选快照连续问答，不扩展到范围外股票。"""
    safe_analysis = _safe_watchlist_analysis(analysis)
    if not safe_analysis["items"]:
        return None
    safe_profile = _safe_profile(profile, "")
    context = {
        "analysis_snapshot": safe_analysis,
        "investor": safe_profile,
        "constraints": {
            "universe_is_locked": True,
            "maximum_candidates": 10,
            "outside_stock_recommendation_forbidden": True,
        },
    }
    system = (
        "你是 FinForge 的自选股优选追问助手。必须只围绕 analysis_snapshot 中的股票回答，"
        "不得引入或推荐范围外股票，也不得修改快照中的价格、排名、资金约束和技术条件。"
        "第一句话直接回答用户问题；随后说明比较依据、资金适配、主要风险和失效条件。"
        "如果用户问哪只更值得关注，可以给出明确的范围内相对结论，但必须说明这是研究优先级而非确定性买入指令。"
        "所有结论必须沿用 analysis_snapshot.horizon_label 的周期口径，不得混用短线、波段和中长线逻辑。"
        "若为中长线技术面口径，必须说明当前不含完整财报、行业景气与估值分位，不能下长期价值判断。"
        "仓位参考比例是柔性集中度提醒，不得把 allocation_caution 说成绝对不能买；"
        "只有 allocation_blocked=true 才代表可用资金不足最低申报数量。"
        "用户询问长期位置时，必须引用 long_term_zone 的区间、确认条件和失效条件，说明这是技术观察区而非确定买点。"
        "涉及买入数量时遵守上下文中的最低股数和资金约束；未持仓不得使用减仓或继续持有措辞。"
        "若问题需要财报、公告、新闻或全市场数据，明确说明当前快照不包含这些资料。"
        "回答使用简洁中文，控制在 450 字内。以下是可信上下文：\n"
        + json.dumps(context, ensure_ascii=False)
    )
    history = []
    for item in (messages if isinstance(messages, list) else [])[-10:]:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()[:1400]
        if content:
            history.append({"role": item["role"], "content": content})
    user_question = str(question or "").strip()[:1000]
    raw = _call_deepseek(
        [{"role": "system", "content": system}, *history, {"role": "user", "content": user_question}],
        timeout=50,
        max_tokens=1100,
    )
    answer = raw.strip()[:3000] if raw else _rule_watchlist_chat(user_question, safe_analysis, safe_profile)
    return {
        "message": answer,
        "source": "deepseek" if raw else "rule",
        "generated_at": time.strftime("%H:%M"),
        "context": {
            "scope_count": len(safe_analysis["items"]),
            "profile_ready": bool(safe_profile.get("total_capital")),
            "snapshot_at": safe_analysis.get("generated_at"),
        },
    }


# ---------------- AI 设置(DeepSeek 模型) ----------------
SETTINGS_FILE = os.environ.get(
    "FINFORGE_SETTINGS_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.json"),
)

def _default_settings():
    return {
        "enabled": False,
        "api_key": "",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    }

def load_settings():
    cfg = _default_settings()
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        for k in cfg:
            if k in data:
                cfg[k] = data[k]
    except Exception:
        pass
    return cfg

def save_settings(updates):
    """只更新传入字段;api_key 为空字符串时保持原值(避免误清)。"""
    cur = load_settings()
    for k in ("enabled", "base_url", "model"):
        if k in updates and updates[k] is not None:
            cur[k] = updates[k]
    key = str(updates.get("api_key") or "").strip()
    if key:
        cur["api_key"] = key
    os.makedirs(os.path.dirname(os.path.abspath(SETTINGS_FILE)), exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur

# 金融场景内置模型参数(不开放给用户配置):
# temperature=0.5 偏保守稳定,避免行情解读过于发散;max_tokens=700 足够 2-3 条短文洞察
_FIN_MODEL_PARAMS = {"temperature": 0.5, "max_tokens": 700}

def _fetch_models(cfg=None):
    """获取 DeepSeek 可用模型列表。返回 (ok, models, message)"""
    c = cfg or load_settings()
    key = str(c.get("api_key") or "").strip()
    if not key:
        return False, [], "未配置 API Key,请先填写并保存"
    base = (c.get("base_url") or "https://api.deepseek.com").rstrip("/")
    try:
        r = requests.get(
            f"{base}/models",
            headers={"Authorization": f"Bearer {key}"},
            timeout=10,
        )
        if r.status_code == 200:
            models = [str(m.get("id")) for m in r.json().get("data", []) if m.get("id")]
            return True, models, f"获取到 {len(models)} 个模型"
        return False, [], f"连接失败 HTTP {r.status_code}: {r.text[:100]}"
    except Exception as e:
        return False, [], f"连接失败: {type(e).__name__}: {str(e)[:80]}"

def list_models():
    """用已保存配置获取模型列表(设置页下拉数据源)"""
    ok, models, msg = _fetch_models()
    return {"ok": ok, "models": models, "message": msg}

def test_deepseek(cfg=None):
    """用传入配置(未保存)或已存配置测试 DeepSeek 连接。返回 (ok, message)"""
    c = cfg or load_settings()
    if not c.get("api_key"):
        return False, "未配置 API Key"
    ok, models, msg = _fetch_models(c)
    if ok:
        return True, f"连接成功,可用模型: {', '.join(models) or '未知'}"
    return False, msg

def _call_deepseek(messages, timeout=30, max_tokens=None):
    """调用 DeepSeek 对话接口(OpenAI 兼容)。失败返回 None。"""
    cfg = load_settings()
    if not cfg.get("enabled") or not cfg.get("api_key"):
        return None
    base = (cfg.get("base_url") or "https://api.deepseek.com").rstrip("/")
    try:
        r = requests.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg['api_key']}",
                "Content-Type": "application/json",
            },
            json={
                "model": cfg.get("model") or "deepseek-chat",
                "messages": messages,
                **({**_FIN_MODEL_PARAMS, **({"max_tokens": max_tokens} if max_tokens else {})}),
            },
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception:
        return None

def _market_snapshot():
    """汇总当前市场数据,作为 AI 生成洞察的上下文。
    逐项容错:某一路数据源失败只标注缺失,不影响其他数据,避免整体快照失效。"""
    lines = []

    def _safe(label, fn, formatter):
        try:
            v = fn()
            if v:
                s = formatter(v)
                if s:
                    lines.append(s)
                    return
        except Exception:
            pass
        lines.append(f"{label}: 数据缺失")

    _safe("指数", get_indices, lambda idx:
        "指数: " + "; ".join(f"{i['name']} {i['value']} ({i['change']:+.2f}%)" for i in idx))

    _safe("涨跌家数", get_breadth, lambda b:
        f"涨跌家数: 上涨 {b['up']} / 下跌 {b['down']} / 平盘 {b['flat']}, "
        f"涨停 {b['limitUp']} / 跌停 {b['limitDown']}, 两市成交 {b['turnover']} 亿")

    _safe("板块", get_sectors, lambda sec:
        "板块涨幅前5: " + "; ".join(f"{s['name']} {s['change']:+.2f}%" for s in sec[:5]))

    def _flow(flow):
        today = flow.get("today", [])
        if not today:
            return None
        return ("行业资金净流入: " + "; ".join(f"{t['name']} {t['inflow']:+.1f}亿" for t in today[:4])
                + f"; 全市场主力净流入合计: {flow.get('main', 0):+.1f} 亿")

    _safe("资金流向", get_capital_flow, _flow)

    if len(lines) <= 1:
        return "行情数据暂不可用"
    return "\n".join(lines)

def _ai_insights():
    """尝试用 DeepSeek 生成洞察;失败返回 None(调用方降级规则引擎)。"""
    prompt = (
        "你是 A 股市场分析助手。基于以下实时行情快照,生成 2-3 条简短、有价值的中文洞察,"
        "覆盖资金异动、热点聚焦、风险提示等方向。每条洞察必须包含 tag、text、tone(up/down) 三个字段,"
        'text 不超过 60 字,尽量引用具体板块和数字。只输出 JSON 数组,不要输出其他文字,格式:'
        '[{"tag": "资金异动", "text": "...", "tone": "up"}]\n\n'
        "注意:若快照中某项标注'数据缺失',请基于已有的其他数据生成洞察,不要编造缺失项的数据,"
        "也不要用'数据不可用、无法监测'之类的话术敷衍。\n\n"
        f"行情快照:\n{_market_snapshot()}"
    )
    raw = _call_deepseek([{"role": "user", "content": prompt}])
    if not raw:
        return None
    try:
        text = raw.strip()
        if "```" in text:  # 去掉可能的 markdown 代码块
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        arr = json.loads(text)
        if not isinstance(arr, list):
            return None
        out = []
        for it in arr[:3]:
            t = str(it.get("text", "")).strip()
            if not t:
                continue
            out.append({
                "tag": str(it.get("tag", "AI 洞察"))[:12],
                "text": t,
                "tone": "up" if it.get("tone") == "up" else "down",
            })
        return out or None
    except Exception:
        return None

# ---------------- 市场关注方向(不生成个股推荐) ----------------
def _ai_recommendations():
    """让 DeepSeek 基于行情快照提炼市场观察方向。失败返回 None。"""
    prompt = (
        "你是 A 股市场研究助手。基于以下实时行情快照,提炼今日值得观察的 2-3 个板块或市场方向。"
        "现有数据不足以支持个股推荐,严禁输出股票名称、股票代码、买入建议或收益预测。"
        "每个方向只包含三个字段:name(板块/方向名,≤8字)、reason(观察依据,≤50字,引用具体盘面数字)、"
        "risk(风险提示,≤30字)。只输出 JSON 数组,不要输出其他文字,格式:"
        '[{"name": "半导体", "reason": "...", "risk": "..."}]\n\n'
        f"行情快照:\n{_market_snapshot()}"
    )
    raw = _call_deepseek([{"role": "user", "content": prompt}])
    if not raw:
        return None
    try:
        text = raw.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        arr = json.loads(text)
        if not isinstance(arr, list):
            return None
        out = []
        for it in arr[:3]:
            name = str(it.get("name", "")).strip()
            if not name:
                continue
            out.append({
                "name": name[:12],
                "reason": str(it.get("reason", "")).strip()[:60],
                "risk": str(it.get("risk", "")).strip()[:40],
            })
        return out or None
    except Exception:
        return None

def _rule_recommendations():
    """降级：只展示涨幅靠前的板块观察方向，不外推具体股票。"""
    out = []
    try:
        for s in get_sectors()[:3]:
            out.append({
                "name": s["name"],
                "reason": f"板块今日涨幅 {s['change']:+.2f}%，活跃度居市场前列",
                "risk": "仅反映当日强弱，警惕追高与轮动",
            })
    except Exception:
        pass
    return out

@cached(ttl=90)
def get_recommendations():
    ai = _ai_recommendations()
    if ai:
        return ai
    return _rule_recommendations()

# ---------------- AI 洞察(优先 DeepSeek,失败降级规则引擎) ----------------
@cached(ttl=90)
def get_insights():
    ai = _ai_insights()
    if ai:
        return ai
    return _rule_insights()

def _rule_insights():
    out = []
    try:
        sec = get_sectors()
        if sec:
            top = sec[0]
            out.append({
                "tag": "资金异动",
                "text": f"「{top['name']}」板块领涨 {top['change']:+.2f}%,领涨股 {top['leader']}",
                "tone": "up",
            })
    except Exception:
        pass
    try:
        flow = get_capital_flow()
        neg = [t for t in flow.get("today", []) if t["inflow"] < 0]
        if neg:
            worst = min(neg, key=lambda t: t["inflow"])
            out.append({
                "tag": "风险提示",
                "text": f"「{worst['name']}」板块净流出 {abs(worst['inflow']):.1f} 亿,注意回调风险",
                "tone": "down",
            })
    except Exception:
        pass
    return out

# ---------------- 市场情绪(由涨跌家数推导) ----------------
def get_sentiment():
    try:
        b = get_breadth()
    except Exception:
        return None
    total = max(b["up"] + b["down"] + b["flat"], 1)
    raw = 50 + (b["limitUp"] - b["limitDown"]) * 0.5 + (b["up"] - b["down"]) / total * 16
    score = max(5, min(95, round(raw)))
    if score >= 65:
        level = "偏乐观"
    elif score >= 55:
        level = "中性偏多"
    elif score >= 45:
        level = "中性"
    elif score >= 35:
        level = "中性偏空"
    else:
        level = "偏谨慎"
    up_pct = (b["up"] - b["limitUp"]) / total * 100
    down_pct = (b["down"] - b["limitDown"]) / total * 100
    breakdown = [
        {"name": "涨停", "ratio": round(b["limitUp"] / total * 100, 1), "color": "#ff3b30"},
        {"name": "上涨", "ratio": round(up_pct, 1), "color": "#ff6b5e"},
        {"name": "平盘", "ratio": round(b["flat"] / total * 100, 1), "color": "#8e8e93"},
        {"name": "下跌", "ratio": round(down_pct, 1), "color": "#34c759"},
        {"name": "跌停", "ratio": round(b["limitDown"] / total * 100, 1), "color": "#30b158"},
    ]
    return {
        "score": score,
        "level": level,
        "fear": 100 - score,
        "greed": score,
        "breakdown": breakdown,
    }
