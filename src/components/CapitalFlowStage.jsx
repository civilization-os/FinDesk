import { getCapitalFlow, useLiveData, REFRESH_MS } from '../api.js'
import { IconTrend } from './icons.jsx'
import { CapitalFlowStageSkeleton } from './MarketLoading.jsx'

const fmt = (v, d = 1) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d })
const CHART_W = 680
const CHART_H = 140
const CHART_PAD = 14

// 市场页 · 资金流向终端：当日净额 + 20日脉冲 + 行业强度排行。
export default function CapitalFlowStage() {
  const { data, loading } = useLiveData(getCapitalFlow, null, REFRESH_MS)

  if (loading && !data) return <CapitalFlowStageSkeleton />
  if (!data) return <CapitalFlowStageSkeleton />
  const { main = 0, retail = 0, history = [], today = [] } = data
  if (!today.length) return <CapitalFlowStageSkeleton />

  const inflow = main >= 0
  const inflowList = today.filter((t) => t.inflow > 0).slice(0, 3)
  const outflowList = today.filter((t) => t.inflow < 0).slice(0, 3)
  const totalIn = today.reduce((sum, item) => sum + Math.max(0, item.inflow), 0)
  const totalOut = today.reduce((sum, item) => sum + Math.abs(Math.min(0, item.inflow)), 0)
  const maxRankAbs = Math.max(...today.map((item) => Math.abs(item.inflow)), 1)
  const recentFive = history.slice(-5).reduce((sum, value) => sum + value, 0)
  const positiveDays = history.filter((value) => value >= 0).length
  const strength = Math.abs(main) >= 200 ? '强' : Math.abs(main) >= 80 ? '中等' : '温和'

  return (
    <div className="card flow-stage" style={{ ['--d']: '120ms' }}>
      <div className="card-title">
        <div>
          <span className="flow-stage-eyebrow">CAPITAL PULSE</span>
          <h2>资金流向</h2>
        </div>
        <span className="sub">主力净额 · 近20个交易日</span>
      </div>

      <div className="flow-terminal">
        <section className={`flow-hero ${inflow ? 'inflow' : 'outflow'}`}>
          <div className="flow-hero-top">
            <span>今日主力净额</span>
            <span className={`flow-direction ${inflow ? 'up' : 'down'}`}>
              <IconTrend dir={inflow ? 'up' : 'down'} size={12} />
              {strength}{inflow ? '流入' : '流出'}
            </span>
          </div>
          <div className={`hero-value num ${inflow ? 'up' : 'down'}`} key={main}>
            <small>¥</small>{inflow ? '+' : '−'}{fmt(Math.abs(main))}<em>亿</em>
          </div>
          <p>行业资金净额合计反映当日资金方向，不代表未来涨跌。</p>
          <div className="flow-hero-ledger">
            <div><span>行业流入</span><b className="num up">+{fmt(totalIn)} 亿</b></div>
            <div><span>行业流出</span><b className="num down">−{fmt(totalOut)} 亿</b></div>
            <div><span>散户净额</span><b className={`num ${retail >= 0 ? 'up' : 'down'}`}>{retail >= 0 ? '+' : '−'}{fmt(Math.abs(retail))} 亿</b></div>
          </div>
        </section>

        <FlowHistory history={history} positiveDays={positiveDays} recentFive={recentFive} />
      </div>

      <div className="flow-rank-cols">
        <FlowRankList title="流入强度" tone="in" rows={inflowList} total={totalIn} maxAbs={maxRankAbs} />
        <FlowRankList title="流出强度" tone="out" rows={outflowList} total={totalOut} maxAbs={maxRankAbs} />
      </div>
    </div>
  )
}

function FlowHistory({ history, positiveDays, recentFive }) {
  const maxAbs = Math.max(...history.map((value) => Math.abs(value)), 1)
  const center = CHART_H / 2
  const scale = (center - CHART_PAD) / maxAbs
  const slot = CHART_W / Math.max(history.length, 1)
  const barWidth = Math.max(4, slot * 0.54)
  return (
    <section className="flow-history-panel">
      <div className="flow-history-head">
        <div><span>近20日资金脉冲</span><b>{positiveDays} 日流入 · {history.length - positiveDays} 日流出</b></div>
        <div className={recentFive >= 0 ? 'up' : 'down'}><span>近5日合计</span><b className="num">{recentFive >= 0 ? '+' : '−'}{fmt(Math.abs(recentFive))} 亿</b></div>
      </div>
      {history.length ? (
        <>
          <svg className="flow-history-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label="近20个交易日主力资金净流入柱状图">
            <rect x="0" y="0" width={CHART_W} height={center} className="flow-zone-up" />
            <rect x="0" y={center} width={CHART_W} height={center} className="flow-zone-down" />
            <line x1="0" x2={CHART_W} y1={center / 2} y2={center / 2} className="flow-grid-line" />
            <line x1="0" x2={CHART_W} y1={center} y2={center} className="flow-zero-line" />
            <line x1="0" x2={CHART_W} y1={center + center / 2} y2={center + center / 2} className="flow-grid-line" />
            {history.map((value, index) => {
              const height = Math.max(2, Math.abs(value) * scale)
              const x = index * slot + (slot - barWidth) / 2
              const y = value >= 0 ? center - height : center
              return <rect key={`${index}-${value}`} x={x} y={y} width={barWidth} height={height} rx={barWidth / 2} className={`flow-history-bar ${value >= 0 ? 'up-bar' : 'down-bar'} ${index === history.length - 1 ? 'latest' : ''}`} />
            })}
          </svg>
          <div className="flow-history-axis"><span>20日前</span><span>10日前</span><span>今日</span></div>
        </>
      ) : <div className="flow-history-empty">暂无历史资金数据</div>}
    </section>
  )
}

function FlowRankList({ title, tone, rows, total, maxAbs }) {
  return (
    <div className="flow-rank-col">
      <div className={`flow-rank-head ${tone}`}>
        <div><span className="flow-rank-dot" /><b>{title}</b><small>TOP 3 INDUSTRIES</small></div>
        <strong className="num">{tone === 'in' ? '+' : '−'}{fmt(total)} 亿</strong>
      </div>
      {rows.map((r, index) => (
        <div className="flow-rank-row" key={r.name}>
          <span className="flow-rank-index">0{index + 1}</span>
          <span className="fname">{r.name}</span>
          <span className="flow-rank-track"><i style={{ ['--flow-width']: `${Math.max(4, Math.abs(r.inflow) / maxAbs * 100)}%` }} /></span>
          <span className={`fval num ${r.inflow >= 0 ? 'up' : 'down'}`} key={r.inflow}>
            {r.inflow >= 0 ? '+' : '−'}{fmt(Math.abs(r.inflow))} 亿
          </span>
        </div>
      ))}
      {!rows.length && <div className="flow-rank-empty">—</div>}
    </div>
  )
}
