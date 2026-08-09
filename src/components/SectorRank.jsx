import { getSectors, useLiveData, REFRESH_MS } from '../api.js'

export default function SectorRank({ onOpenStock }) {
  const { data: sectors } = useLiveData(getSectors, [], REFRESH_MS)
  if (!Array.isArray(sectors) || !sectors.length) return null
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.change)))
  const sorted = [...sectors].sort((a, b) => b.change - a.change)

  return (
    <div className="card" style={{ ['--d']: '420ms' }}>
      <div className="card-title">
        <h2>板块排行</h2>
        <span className="sub">今日涨幅榜</span>
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
          {sorted.map((s, i) => {
            const up = s.change >= 0
            const w = Math.min((Math.abs(s.change) / maxAbs) * 100, 100)
            return (
              <tr key={s.name}>
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
