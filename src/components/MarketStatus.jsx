import { getMarketStatus, useLiveData, REFRESH_MS } from '../api.js'

const W = 520
const H = 150
const PAD = 6

export default function MarketStatus() {
  const { data } = useLiveData(getMarketStatus, null, REFRESH_MS)
  if (!data) return null
  const { curve = {}, breadth = {} } = data
  const { points = [], volume = [], high = 0, low = 0, open = 0, labels = [] } = curve
  if (!points.length) return null
  const up = points[points.length - 1] >= points[0]

  const X = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const Y = (v) => H - PAD - (v / 100) * (H - PAD * 2)

  const linePts = points.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const areaPts = `${PAD},${H - PAD} ${linePts} ${W - PAD},${H - PAD}`
  const gid = up ? 'gradUp' : 'gradDown'

  const maxVol = Math.max(...volume)

  return (
    <div className="card" style={{ ['--d']: '240ms' }}>
      <div className="card-title">
        <h2>大盘状态</h2>
        <span className="sub">上证指数 · 分时</span>
      </div>

      <div className="breadth-row">
        <span className="breadth-item">上涨 <b className="up num">{breadth.up}</b></span>
        <span className="breadth-item">下跌 <b className="down num">{breadth.down}</b></span>
        <span className="breadth-item">平盘 <b className="num">{breadth.flat}</b></span>
        <span className="breadth-item">涨停 <b className="up num">{breadth.limitUp}</b></span>
        <span className="breadth-item">跌停 <b className="down num">{breadth.limitDown}</b></span>
        <span className="breadth-item">成交 <b className="num">{breadth.turnover.toLocaleString('zh-CN')} 亿</b></span>
      </div>

      <div className="curve-wrap">
        <svg className="curve-chart" viewBox={`0 0 ${W} ${H + 40}`} role="img" aria-label="上证指数全天走势">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: up ? 'var(--up)' : 'var(--down)', stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: up ? 'var(--up)' : 'var(--down)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {/* 网格线 */}
          {[0.25, 0.5, 0.75].map((r) => (
            <line key={r} x1={PAD} x2={W - PAD} y1={H * r} y2={H * r} stroke="var(--separator)" strokeDasharray="3 4" strokeWidth={1} />
          ))}
          {/* 成交量(底部) */}
          {volume.map((v, i) => (
            <rect
              key={i}
              x={X(i) - 5}
              y={H + 6 + (1 - v / maxVol) * 30}
              width={10}
              height={(v / maxVol) * 30}
              rx={2}
              className={up ? 'bar-up' : 'bar-down'}
              opacity={0.35}
            />
          ))}
          {/* 面积 + 折线 */}
          <polygon points={areaPts} fill={`url(#${gid})`} />
          <polyline
            points={linePts}
            fill="none"
            className={up ? 'chart-up' : 'chart-down'}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* 当前点位端点 */}
          <circle
            cx={X(points.length - 1)} cy={Y(points[points.length - 1])} r={4}
            className={up ? 'chart-up' : 'chart-down'}
            fill="var(--card)"
            strokeWidth={2.5}
          />
        </svg>
        <div className="curve-axis">
          {labels.map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>

      <div className="chart-stats">
        <div className="chart-stat">
          <div className="k">开盘</div>
          <div className="v num">{open.toFixed(0)}</div>
        </div>
        <div className="chart-stat">
          <div className="k">最高</div>
          <div className={`v num up`}>{high.toFixed(0)}</div>
        </div>
        <div className="chart-stat">
          <div className="k">最低</div>
          <div className={`v num down`}>{low.toFixed(0)}</div>
        </div>
      </div>
    </div>
  )
}
