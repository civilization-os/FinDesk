# FinForge · Apple Finance 风格财经仪表盘

[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](LICENSE)
[![Data: AKShare](https://img.shields.io/badge/Data%20Science-AKShare-green)](https://github.com/akfamily/akshare)

React 18 + Vite 前端 + FastAPI/akshare 行情后端。

> **开源研究工具，不构成投资建议。** 本项目按“原样”提供，不保证行情、分析、
> AI 输出或第三方接口的准确性与持续可用性。使用者自行核验数据并承担决策风险；
> 详见 [免责声明](DISCLAIMER.md)。

## Docker Compose（推荐）

需要 Docker 及 Compose v2。首次启动会构建前后端镜像：

```bash
docker compose up -d --build
docker compose ps
```

打开 <http://localhost:8080>。前端由非 root Nginx 提供，`/api/*` 在容器网络内
反向代理到 FastAPI；后端端口不会直接暴露到宿主机。停止服务：

```bash
docker compose down
```

默认监听 `0.0.0.0:8080`。复制 `.env.example` 为 `.env` 可调整监听地址、端口和时区；
例如只允许本机访问可设置 `FINFORGE_HOST=127.0.0.1`。AI 配置保存在命名卷
`finforge-data` 中，普通的 `docker compose down` 或容器重建不会删除；只有显式执行
`docker compose down -v` 才会一并删除该卷及其中配置。

## CI/CD

仓库内置 GitHub Actions：

- `CI`：在 Pull Request 及 `main/master` 推送时执行前端生产构建、Python 依赖检查、
  API 健康检查、Compose 校验，并分别构建 Web/API 容器。
- `Publish containers`：在默认分支、`v*.*.*` 版本标签或手动触发时，向 GitHub
  Container Registry 发布 `linux/amd64` 与 `linux/arm64` 镜像，同时附带 SBOM 和构建来源证明。
- Dependabot 每周检查 npm、pip、Docker 基础镜像与 GitHub Actions 更新。

镜像名称会根据仓库自动生成：

```text
ghcr.io/<owner>/<repository>-web:latest
ghcr.io/<owner>/<repository>-api:latest
```

发布使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需配置 Docker 密码。建议在仓库设置中将
`CI` 设为默认分支的必需状态检查，并启用“Require branches to be up to date”。

## 快速启动

### 1. 后端(akshare 行情服务,端口 8000)

```bash
cd backend
python -m venv .venv                      # 已创建可跳过
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app:app --host 127.0.0.1 --port 8000
```

### 2. 前端(端口 5173)

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

前端通过 vite proxy 把 `/api/*` 转发到后端;后端不可用时自动回退到内置演示数据,
顶栏徽章显示「实时行情 / 演示数据」。

## 数据源说明(重要)

本机网络环境实测:
- **东方财富(eastmoney)域名不可达** → 所有 `*_em` 接口不可用
- **新浪(vip.stock.finance.sina.com.cn)高频请求会触发 IP 风控**("拒绝访问…爬虫") → 不稳定

因此后端数据源选用:

| 数据 | 来源 | 方式 |
|---|---|---|
| 指数实时(上证/深成/创业板/科创50) | 腾讯 `qt.gtimg.cn` | 自实现解析 |
| 指数分时(大盘状态曲线) | 腾讯 `web.ifzq.gtimg.cn` minute | 自实现解析 |
| 指数/个股日线(自选股 sparkline、量能) | 腾讯 kline JSON | 自实现解析 |
| 涨跌家数/涨停跌停/成交额 | 乐咕乐股 `stock_market_activity_legu` | akshare |
| 板块排行(涨幅+领涨股) | 同花顺 `stock_board_industry_summary_ths` | akshare |
| 板块资金净流入(资金流向) | 同花顺同上(净流入列) | akshare |
| 市场情绪 | 由涨跌家数公式推导 | 计算 |

## 数据刷新与请求频率

- 前端统一 **每 15s 轮询** 一次(`REFRESH_MS`),页面停留期间持续更新
- 后端 **TTL 缓存节流**:指数 15s / 涨跌家数 30s / 分时 60s / 板块 60s / 资金流 60s / 自选股 60s,
  缓存有效期内直接返回内存数据,**不访问数据源**——前端刷新频率 ≠ 数据源请求频率
- 实际数据源请求:腾讯指数 15s 一次(4 代码单次批量)、乐咕 30s、同花顺 60s、腾讯分时/日线 60s,
  对三个数据源均远低于风控阈值
- 轮询失败时**保留上一次成功数据**,不会闪回演示数据;顶栏徽章由 30s 一次的健康检查独立更新

## AI 模型配置(DeepSeek)

「AI 分析」默认使用内置规则引擎;可在侧栏 **设置** 页配置 DeepSeek:

- API Key / Base URL / 模型名(`deepseek-chat`、`deepseek-reasoner` 等),支持「测试连接」
- Key 仅保存在本地 `backend/settings.json`(已 gitignore,不下发浏览器)
- 启用后,AI 洞察由 DeepSeek 基于实时行情快照生成(JSON 格式约束输出,90s 缓存)
- DeepSeek 调用失败或未启用时**自动降级**为规则引擎,页面不报错

## 已知限制

- **北向资金实时数据已停止披露**(2024-08 起),接口统一返回 0
- 「近 20 日资金流柱状图」为**上证指数量能 × 涨跌方向**的近似形态
  (腾讯无历史主力资金流接口),卡片副标题已注明口径
- 情绪分数为启发式公式,非官方指数
- 自选股代码由前端 `localStorage` 持久化，首次打开为空；后端只查询用户明确选择的代码

## 项目结构

```
src/
  api.js                  # 前端数据层:fetch + 超时 + 演示数据回退
  data/market.js          # 内置演示数据(fallback)
  components/             # 各数据卡片(SVG 图表零依赖)
backend/
  app.py                  # FastAPI 路由,统一容错
  services.py             # akshare/腾讯数据封装 + TTL 缓存
  requirements.txt
```

## 接口一览

```
GET /health
GET /api/indices          # 四大指数
GET /api/market-status    # { curve: 分时, breadth: 涨跌家数 }
GET /api/sentiment        # 市场情绪
GET /api/capital-flow     # 资金流向
GET /api/sectors          # 板块排行
GET /api/sectors-all      # 全行业板块(含领涨股代码)
GET /api/watchlist        # 自选股(支持 ?codes=600519,000858)
GET /api/stock/{code}     # 个股详情(报价+分时+日K)
GET /api/insights         # AI 洞察(DeepSeek 或规则引擎)
GET /api/market           # 市场页聚合
GET /api/settings         # AI 配置(不含 key 明文)
POST /api/settings        # 保存 AI 配置
POST /api/settings/test   # 测试 DeepSeek 连接
```

所有接口失败返回 `{"ok": false}`,前端自动回退演示数据。

## 开源许可与第三方说明

FinForge 自有代码采用 [MIT License](LICENSE) 发布，并适用独立的
[免责声明](DISCLAIMER.md)。MIT License 已包含无担保及作者责任限制条款。

项目使用 [AKShare](https://github.com/akfamily/akshare) 作为部分财经数据接口依赖。
AKShare 同样采用 MIT License，其原始版权和许可文本已保留在
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中。

请注意：开源软件许可证与行情数据授权是两件事。MIT 许可覆盖软件代码，
不代表腾讯、乐咕乐股、同花顺等底层数据源的数据可以被任意再分发或商用。
部署、公开发布或商业使用前，应另行核对相应数据源的服务条款和授权要求。
