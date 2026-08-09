"""FinForge 行情后端:FastAPI + akshare。
启动:backend/.venv/Scripts/uvicorn app:app --host 127.0.0.1 --port 8000
前端经 vite proxy 访问 /api/*;任何接口异常时返回 {"ok": false},前端自动回退演示数据。
"""
import time
import traceback

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import services

app = FastAPI(title="FinForge 行情服务", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_START = time.time()


@app.get("/health")
def health():
    return {"ok": True, "uptime": round(time.time() - _START, 1)}


# 前端经 /api 前缀访问,补一个同名路由
@app.get("/api/health")
def api_health():
    return health()


def _guard(fn, default):
    """统一容错:akshare 接口失败时返回 {ok: false} 而非 500。"""
    try:
        data = fn()
        if data in (None, [], {}):
            return {"ok": False}
        return {"ok": True, "data": data}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "akshare 接口暂不可用"}


@app.get("/api/indices")
def api_indices():
    return _guard(services.get_indices, [])


@app.get("/api/market-status")
def api_market_status():
    try:
        breadth = services.get_breadth()
        curve = services.get_curve()
        if breadth is None or curve is None:
            return {"ok": False}
        return {"ok": True, "data": {"curve": curve, "breadth": breadth}}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "akshare 接口暂不可用"}


@app.get("/api/sentiment")
def api_sentiment():
    return _guard(services.get_sentiment, None)


@app.get("/api/capital-flow")
def api_capital_flow():
    return _guard(services.get_capital_flow, None)


@app.get("/api/sectors")
def api_sectors():
    return _guard(services.get_sectors, [])


@app.get("/api/sectors-all")
def api_sectors_all():
    return _guard(services.get_sectors_all, [])


@app.get("/api/stock/{code}")
def api_stock(code: str):
    return _guard(lambda: services.get_stock(code), None)


@app.get("/api/stock/{code}/ai")
def api_stock_ai(code: str):
    """个股 AI 建议(DeepSeek 生成,失败降级规则)"""
    return _guard(lambda: services.get_stock_ai(code), None)


@app.post("/api/stock/{code}/ai")
def api_stock_ai_personalized(code: str, body: dict):
    """按用户主要周期生成个股技术面建议。"""
    return _guard(lambda: services.get_stock_ai(code, (body or {}).get("profile") or {}), None)


@app.post("/api/stock/{code}/chat")
def api_stock_chat(code: str, body: dict):
    """结合用户资金档案、当前持仓与个股行情进行连续问答。"""
    question = str((body or {}).get("question") or "").strip()
    if not question:
        return {"ok": False, "error": "问题不能为空"}
    return _guard(lambda: services.get_stock_chat(
        code,
        question,
        (body or {}).get("messages") or [],
        (body or {}).get("profile") or {},
    ), None)


@app.get("/api/watchlist")
def api_watchlist(codes: str = ""):
    """自选股行情。codes: 逗号分隔的 6 位代码;空参数返回空列表。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst:
        return {"ok": True, "data": []}
    return _guard(lambda: services.get_watchlist(lst), [])


@app.post("/api/watchlist/analyze")
def api_watchlist_analyze(body: dict):
    """在用户锁定的自选股范围内进行组合优选，单次最多 10 只。"""
    raw_codes = (body or {}).get("codes") or []
    codes = []
    for value in raw_codes if isinstance(raw_codes, list) else []:
        code = str(value or "").strip()
        if code.isdigit() and len(code) == 6 and code not in codes:
            codes.append(code)
    if not codes:
        return {"ok": False, "error": "请至少选择 1 只自选股"}
    if len(codes) > 10:
        return {"ok": False, "error": "单次最多分析 10 只自选股"}
    return _guard(lambda: services.get_watchlist_analysis(
        codes,
        (body or {}).get("profile") or {},
    ), None)


@app.post("/api/watchlist/chat")
def api_watchlist_chat(body: dict):
    """围绕一次自选股优选快照继续追问。"""
    question = str((body or {}).get("question") or "").strip()
    if not question:
        return {"ok": False, "error": "问题不能为空"}
    return _guard(lambda: services.get_watchlist_chat(
        question,
        (body or {}).get("analysis") or {},
        (body or {}).get("messages") or [],
        (body or {}).get("profile") or {},
    ), None)


@app.get("/api/hot-stocks")
def api_hot_stocks():
    """热门股票(30 只行业龙头,含实时行情)"""
    return _guard(services.get_hot_stocks, [])


@app.get("/api/search")
def api_search(q: str = ""):
    """全市场股票搜索:代码/名称,返回前 15 条"""
    return _guard(lambda: services.search_stocks(q), [])


@app.get("/api/insights")
def api_insights():
    return _guard(services.get_insights, [])


@app.get("/api/recommendations")
def api_recommendations():
    """今日推荐(DeepSeek 生成,失败降级规则引擎)"""
    return _guard(services.get_recommendations, [])


@app.get("/api/market")
def api_market():
    """市场页聚合:指数全景 + 涨跌分布 + 板块涨跌榜"""
    try:
        indices = services.get_all_indices()
        breadth = services.get_breadth()
        boards = services.get_sector_boards()
        if not indices or breadth is None or not boards.get("top"):
            return {"ok": False}
        return {"ok": True, "data": {
            "indices": indices,
            "breadth": breadth,
            "sectors": boards,
        }}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "akshare 接口暂不可用"}


@app.get("/api/settings")
def api_get_settings():
    """返回 AI 配置(不返回 API Key 明文,只返回是否已配置)"""
    cfg = services.load_settings()
    return {"ok": True, "data": {
        "enabled": bool(cfg.get("enabled")),
        "model": cfg.get("model", "deepseek-chat"),
        "base_url": cfg.get("base_url", "https://api.deepseek.com"),
        "hasKey": bool(cfg.get("api_key")),
    }}


@app.post("/api/settings")
def api_save_settings(body: dict):
    """保存 AI 配置。api_key 传空字符串表示保持原值。"""
    services.save_settings(body or {})
    return {"ok": True, "data": {"saved": True}}


@app.get("/api/settings/models")
def api_settings_models():
    """用已保存的配置获取 DeepSeek 真实模型列表。"""
    data = services.list_models()
    return {"ok": True, "data": data}


@app.post("/api/settings/test")
def api_test_settings(body: dict):
    """用传入配置测试 DeepSeek 连接(不保存)。"""
    ok, msg = services.test_deepseek(body or {})
    # 测试通过时顺带返回真实模型列表,前端可直接填充下拉
    models = []
    if ok:
        _, models, _ = services._fetch_models(body or {})
    return {"ok": True, "data": {"ok": ok, "message": msg, "models": models}}
