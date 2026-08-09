import { getCapitalFlow, useLiveData, REFRESH_MS } from '../api.js'
import { CapitalFlowStageSkeleton } from './MarketLoading.jsx'

const W = 560
const H = 96
const PAD = 4

export default function CapitalFlow() {
  const { data: capitalFlow, loading } = useLiveData(getCapitalFlow, null, REFRESH_MS)
  if (loading && !capitalFlow) return <CapitalFlowStageSkeleton compact />
  if (!capitalFlow) return <CapitalFlowStageSkeleton compact />
  const { main, retail, northbound, history = [], today = [] } = capitalFlow
  if (!history.length || !today.length) return <CapitalFlowStageSkeleton compact />

  // 柱状图坐标:以零线为基线,正值向上(红)、负值向下(绿)
  const min = Math.min(...history, 0)
  const max = Math.max(...history, 0)
  const span = max - min || 1
  const Y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const y0 = Y(0)
  const bw = W / history.length
  const maxAbs = Math.max(...today.map((t) => Math.abs(t.inflow)))

  return (
    <div className="card" style={{ ['--d']: '360ms' }}>
      <div className="card-title">
        <h2>资金流向</h2>
        <span className="sub">近 20 个交易日 · 主力净流入(亿元)</span>
      </div>

      <div className="flow-layout">
        <div>
          <div className="flow-summary">
            <div className="item">
              <div className="k">主力净流入</div>
              <div className="v num" style={{ color: 'var(--up)' }}>
                +{main.toFixed(1)} 亿
              </div>
            </div>
            <div className="item">
              <div className="k">北向资金</div>
              <div className="v num" style={{ color: 'var(--up)' }}>
                +{northbound.toFixed(1)} 亿
              </div>
            </div>
            <div className="item">
              <div className="k">散户净流出</div>
              <div className="v num" style={{ color: 'var(--down)' }}>
                {retail.toFixed(1)} 亿
              </div>
            </div>
          </div>

          <svg className="flow-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="近20日主力资金流向柱状图">
            {/* 零线 */}
            <line x1={PAD} x2={W - PAD} y1={y0} y2={y0} stroke="var(--separator-strong)" strokeWidth={1.5} />
            {history.map((v, i) => {
              const x = i * bw + bw * 0.25
              const yv = Y(v)
              return (
                <rect
                  key={i}
                  x={x}
                  y={Math.min(yv, y0)}
                  width={bw * 0.5}
                  height={Math.max(Math.abs(yv - y0), 1.5)}
                  rx={2}
                  className={v >= 0 ? 'bar-up' : 'bar-down'}
                  opacity={0.82}
                />
              )
            })}
          </svg>
          <div className="flow-legend">
            <span><i className="bar-up" style={{ borderRadius: 2 }} />净流入</span>
            <span><i className="bar-down" style={{ borderRadius: 2 }} />净流出</span>
            <span style={{ marginLeft: 'auto' }}>单位:亿元</span>
          </div>
        </div>

        <div>
          <div className="card-title" style={{ marginBottom: 8 }}>
            <h2 style={{ fontSize: 13.5 }}>今日主力净流入排行</h2>
          </div>
          <div className="flow-list">
            {today.map((t) => {
              const inflow = t.inflow >= 0
              const w = Math.min((Math.abs(t.inflow) / maxAbs) * 100, 100)
              return (
                <div className="flow-row" key={t.name}>
                  <span className="dot" style={{ background: inflow ? 'var(--up)' : 'var(--down)' }} />
                  <span className="fname">{t.name}</span>
                  <span className="bar-track">
                    <span
                      className="bar-fill"
                      style={{ width: `${w}%`, background: inflow ? 'var(--up)' : 'var(--down)', opacity: 0.85 }}
                    />
                  </span>
                  <span className={`fval num ${inflow ? 'up' : 'down'}`}>
                    {inflow ? '+' : ''}{t.inflow.toFixed(1)} 亿
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
