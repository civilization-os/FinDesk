import { getIndices, useLiveData, REFRESH_MS } from '../api.js'
import { IconTrend } from './icons.jsx'

function fmt(v, digits = 2) {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default function IndexCards({ onOpen }) {
  const { data: indices } = useLiveData(getIndices, [], REFRESH_MS)
  if (!Array.isArray(indices) || !indices.length) return null
  return (
    <div className="grid grid-4" style={{ marginBottom: 16 }}>
      {indices.map((idx, i) => {
        const up = idx.change >= 0
        return (
          <div className="card index-card" style={{ ['--d']: `${i * 60}ms` }} key={idx.code} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen?.()}>
            <div className="name">
              {idx.name}
              <span className={`pill ${up ? 'up' : 'down'}`}>
                <IconTrend dir={up ? 'up' : 'down'} size={11} />
                {up ? '+' : ''}{idx.change.toFixed(2)}%
              </span>
            </div>
            <div className="value num">{fmt(idx.value)}</div>
            <div className={`delta num ${up ? 'up' : 'down'}`}>
              <span>{up ? '+' : ''}{fmt(idx.points)}</span>
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                今开 {fmt(idx.value - idx.points)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
