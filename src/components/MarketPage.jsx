import { getMarket, useLiveData, REFRESH_MS } from '../api.js'
import CapitalFlowStage from './CapitalFlowStage.jsx'
import MarketPageSkeleton from './MarketLoading.jsx'

const fmt = (v, d = 2) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d })

export default function MarketPage({ onOpenStock }) {
  const { data, loading } = useLiveData(getMarket, null, REFRESH_MS)
  if (loading && !data) return <MarketPageSkeleton />
  if (!data) return <MarketPageSkeleton />
  const { indices = [], breadth = {}, sectors = {} } = data
  const { top = [], bottom = [] } = sectors
  if (!indices.length) return <MarketPageSkeleton />

  const total = Math.max(breadth.up + breadth.down + breadth.flat, 1)

  return (
    <div className="market-page">
      <div className="market-top" style={{ marginBottom: 16 }}>
        <BreadthCard breadth={breadth} total={total} />
        <IndexTable indices={indices} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <CapitalFlowStage />
      </div>
      <div className="board-grid">
        <BoardCard title="板块涨幅榜" tone="up" rows={top} onOpenStock={onOpenStock} />
        <BoardCard title="板块跌幅榜" tone="down" rows={bottom} onOpenStock={onOpenStock} />
      </div>
    </div>
  )
}

function BreadthCard({ breadth, total }) {
  const upPct = (breadth.up / total) * 100
  const downPct = (breadth.down / total) * 100
  const flatPct = (breadth.flat / total) * 100
  return (
    <div className="card" style={{ ['--d']: '0ms' }}>
      <div className="card-title">
        <h2>市场宽度</h2>
        <span className="sub">全市场涨跌分布</span>
      </div>
      <div className="breadth-bigs">
        <div>
          <div className="bb-value up num">{breadth.up}</div>
          <div className="bb-label">上涨</div>
        </div>
        <div>
          <div className="bb-value flat num">{breadth.flat}</div>
          <div className="bb-label">平盘</div>
        </div>
        <div>
          <div className="bb-value down num">{breadth.down}</div>
          <div className="bb-label">下跌</div>
        </div>
      </div>

      <div className="dist-bar" style={{ margin: '16px 0 10px' }}>
        <span style={{ width: `${upPct}%`, background: 'var(--up)' }} />
        <span style={{ width: `${flatPct}%`, background: 'var(--flat)' }} />
        <span style={{ width: `${downPct}%`, background: 'var(--down)' }} />
      </div>

      <div className="breadth-meta">
        <div className="meta-item">
          <span className="k">涨停</span>
          <span className="v up num">{breadth.limitUp}</span>
        </div>
        <div className="meta-item">
          <span className="k">跌停</span>
          <span className="v down num">{breadth.limitDown}</span>
        </div>
        <div className="meta-item">
          <span className="k">两市成交</span>
          <span className="v num">{fmt(breadth.turnover, 0)} 亿</span>
        </div>
      </div>
    </div>
  )
}

function IndexTable({ indices }) {
  return (
    <div className="card" style={{ ['--d']: '80ms', padding: 12 }}>
      <div className="card-title" style={{ padding: '8px 8px 6px' }}>
        <h2>指数全景</h2>
        <span className="sub">{indices.length} 个市场指数</span>
      </div>
      <table className="sector-table index-table">
        <thead>
          <tr>
            <th>指数</th>
            <th style={{ textAlign: 'right' }}>最新价</th>
            <th style={{ textAlign: 'right' }}>涨跌额</th>
            <th style={{ textAlign: 'right' }}>涨跌幅</th>
            <th style={{ textAlign: 'right' }}>成交额</th>
          </tr>
        </thead>
        <tbody>
          {indices.map((idx) => {
            const up = idx.change >= 0
            return (
              <tr key={idx.code} className="index-row">
                <td>
                  <div className="iname">
                    {idx.name}
                    <span className="wcode">{idx.code}</span>
                  </div>
                </td>
                <td className="ivalue num">{fmt(idx.value)}</td>
                <td className={`num ${up ? 'up' : 'down'}`} style={{ textAlign: 'right' }}>
                  {up ? '+' : ''}{fmt(idx.points)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className={`pill ${up ? 'up' : 'down'}`} style={{ minWidth: 64, justifyContent: 'center' }}>
                    {up ? '+' : ''}{fmt(idx.change)}%
                  </span>
                </td>
                <td className="inamount num" style={{ textAlign: 'right' }}>{fmt(idx.amount, 0)} 亿</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BoardCard({ title, tone, rows, onOpenStock }) {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.change)), 1)
  return (
    <div className="card" style={{ ['--d']: `${tone === 'up' ? 160 : 240}ms`, padding: 12 }}>
      <div className="card-title" style={{ padding: '8px 8px 6px' }}>
        <h2>{title}</h2>
        <span className="sub">行业板块</span>
      </div>
      <table className="sector-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th>板块</th>
            <th>领涨股</th>
            <th style={{ textAlign: 'right' }}>涨跌幅</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const up = s.change >= 0
            const w = Math.min((Math.abs(s.change) / maxAbs) * 100, 100)
            return (
              <tr key={s.name} className="index-row">
                <td className="rank num">{i + 1}</td>
                <td className="sname">{s.name}</td>
                <td className="leader">
                  <button
                    className="leader-link"
                    disabled={!s.leaderCode}
                    onClick={() => s.leaderCode && onOpenStock?.(s.leaderCode)}
                  >
                    {s.leader}
                  </button>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                    <span className="sector-bar-track">
                      <span
                        className="sector-bar-fill"
                        style={{
                          width: `${w}%`,
                          background: up ? 'var(--up)' : 'var(--down)',
                          opacity: 0.8,
                          display: 'block',
                          float: up ? 'right' : 'left',
                        }}
                      />
                    </span>
                    <span className={`change num ${up ? 'up' : 'down'}`} style={{ width: 64 }}>
                      {up ? '+' : ''}{s.change.toFixed(2)}%
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
