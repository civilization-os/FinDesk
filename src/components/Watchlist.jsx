import { getWatchlist, useLiveData, REFRESH_MS } from '../api.js'
import Sparkline from './Sparkline.jsx'

const fmt = (v) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 首页自选股卡:由用户管理(可删除),点击进详情
export default function Watchlist({ codes, onRemoveStock, onOpenStock }) {
  const key = Array.isArray(codes) ? codes.join(',') : ''
  const { data: watchlist } = useLiveData(() => getWatchlist(codes), [], REFRESH_MS, [key])
  const list = Array.isArray(watchlist) ? watchlist : []
  if (!codes || !codes.length) {
    return (
      <div className="card" style={{ ['--d']: '480ms', padding: 12 }}>
        <div className="card-title" style={{ padding: '8px 8px 6px' }}>
          <h2>自选股</h2>
          <span className="sub">0 只</span>
        </div>
        <div className="chart-empty" style={{ padding: 34 }}>
          自选为空 —— 在任意个股详情页点「加入自选」
        </div>
      </div>
    )
  }
  return (
    <div className="card" style={{ ['--d']: '480ms', padding: 12 }}>
      <div className="card-title" style={{ padding: '8px 8px 6px' }}>
        <h2>自选股</h2>
        <span className="sub">{list.length} 只 · 实时 · 点击查看详情</span>
      </div>
      {list.map((w) => {
        const up = w.change >= 0
        return (
          <div className="watch-item" key={w.code} onClick={() => onOpenStock?.(w.code)}>
            <div className="watch-info">
              <div className="wname">
                {w.name}
                <span className="wcode">{w.code}</span>
              </div>
              <div className="wsub">今日 {fmt(w.price)}</div>
            </div>
            <Sparkline
              className="watch-spark"
              data={w.spark}
              width={88}
              height={34}
              strokeClass={up ? 'chart-up' : 'chart-down'}
            />
            <div className="watch-price">
              <div className={`wp num ${up ? 'up' : 'down'}`}>{fmt(w.price)}</div>
              <div className={`wc num ${up ? 'up' : 'down'}`}>
                {up ? '+' : ''}{w.change.toFixed(2)}%
              </div>
            </div>
            <button
              className="watch-remove"
              aria-label={`移出自选 ${w.name}`}
              title="移出自选"
              onClick={(e) => { e.stopPropagation(); onRemoveStock?.(w.code) }}
            >×</button>
          </div>
        )
      })}
    </div>
  )
}
