import { useState } from 'react'
import { getSectorsAll, useLiveData, REFRESH_MS } from '../api.js'

const fmt = (v, d = 2) => (v ?? 0).toFixed(d)

// 板块页:全行业板块涨跌榜
export default function SectorPage({ onOpenStock }) {
  const { data } = useLiveData(getSectorsAll, [], REFRESH_MS)
  const [filter, setFilter] = useState('all') // all | up | down
  const rows = Array.isArray(data) ? data : []
  const shown = filter === 'all' ? rows : rows.filter((s) => (filter === 'up' ? s.change >= 0 : s.change < 0))
  const maxAbs = Math.max(...rows.map((s) => Math.abs(s.change)), 1)

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="card-title" style={{ padding: '8px 8px 6px' }}>
        <h2>行业板块</h2>
        <span className="sub">{rows.length} 个行业 · 点击领涨股查看详情</span>
        <div className="seg">
          {[['all', '全部'], ['up', '上涨'], ['down', '下跌']].map(([k, label]) => (
            <button key={k} className={`seg-btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <table className="sector-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th>
            <th>板块</th>
            <th>涨跌幅</th>
            <th>领涨股</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s, i) => {
            const up = s.change >= 0
            const w = Math.min((Math.abs(s.change) / maxAbs) * 100, 100)
            return (
              <tr key={s.name}>
                <td className="rank num">{i + 1}</td>
                <td className="sname">{s.name}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="sector-bar-track" style={{ width: 130 }}>
                      <span
                        className="sector-bar-fill"
                        style={{
                          width: `${w}%`, background: up ? 'var(--up)' : 'var(--down)',
                          opacity: 0.8, display: 'block', float: up ? 'right' : 'left',
                        }}
                      />
                    </span>
                    <span className={`change num ${up ? 'up' : 'down'}`} style={{ width: 62 }}>
                      {up ? '+' : ''}{fmt(s.change)}%
                    </span>
                  </div>
                </td>
                <td>
                  <button
                    className="leader-link"
                    disabled={!s.leaderCode}
                    onClick={() => s.leaderCode && onOpenStock(s.leaderCode)}
                    title={s.leaderCode ? `${s.leader} · ${s.leaderCode}` : ''}
                  >
                    {s.leader || '—'}
                  </button>
                </td>
              </tr>
            )
          })}
          {!shown.length && (
            <tr><td colSpan={4} className="chart-empty" style={{ padding: 30 }}>暂无数据</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
