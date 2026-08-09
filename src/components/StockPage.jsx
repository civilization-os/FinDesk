import { useEffect, useRef, useState } from 'react'
import { getWatchlist, getHotStocks, searchStocks, useLiveData, REFRESH_MS } from '../api.js'
import Sparkline from './Sparkline.jsx'

const fmt = (v) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 股票页:全市场搜索 + 热门股票 + 我的自选
export default function StockPage({ search, codes, onRemoveStock, onOpenStock, onToggleStock }) {
  const key = Array.isArray(codes) ? codes.join(',') : ''
  const { data: list } = useLiveData(() => getWatchlist(codes), [], REFRESH_MS, [key])
  const { data: hot } = useLiveData(getHotStocks, [], REFRESH_MS)
  const stocks = Array.isArray(list) ? list : []
  const hotList = Array.isArray(hot) ? hot : []

  const kw = (search || '').trim().toLowerCase()
  const filtered = kw
    ? stocks.filter((s) => s.name.toLowerCase().includes(kw) || String(s.code).includes(kw))
    : stocks

  return (
    <div className="stock-page">
      <div className="card" style={{ padding: 12 }}>
        <div className="card-title" style={{ padding: '8px 8px 6px' }}>
          <h2>我的自选</h2>
          <span className="sub">
            {kw ? `「${search}」匹配 ${filtered.length} 只` : `${stocks.length} 只 · 从下方搜索或热门股添加`}
          </span>
        </div>
        {!codes.length && (
          <div className="chart-empty" style={{ padding: 30 }}>
            自选为空 —— 在搜索结果 / 热门股 / 个股详情页添加
          </div>
        )}
        {codes.length > 0 && !filtered.length && (
          <div className="chart-empty" style={{ padding: 30 }}>没有匹配「{search}」的自选股</div>
        )}
        {filtered.map((w) => {
          const up = w.change >= 0
          return (
            <div className="watch-item" key={w.code} onClick={() => onOpenStock(w.code)}>
              <div className="watch-info">
                <div className="wname">
                  {w.name}
                  <span className="wcode">{w.code}</span>
                </div>
                <div className="wsub">点击查看详情</div>
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

      <MarketSearch onOpenStock={onOpenStock} onToggleStock={onToggleStock} watched={codes} />
      <HotStocks list={hotList} onOpenStock={onOpenStock} onToggleStock={onToggleStock} watched={codes} />
    </div>
  )
}

// 全市场搜索(带 300ms 防抖)
function MarketSearch({ onOpenStock, onToggleStock, watched }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null) // null=未搜索
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    const t = (q || '').trim()
    clearTimeout(timer.current)
    if (t.length < 2) { setResults(null); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      const r = await searchStocks(t)
      setResults(r)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer.current)
  }, [q])

  return (
    <div className="card" style={{ padding: 16, ['--d']: '0ms' }}>
      <div className="card-title">
        <h2>全市场搜索</h2>
        <span className="sub">输入 2 字以上,匹配全部 A 股</span>
      </div>
      <div className="search stock-search">
        <span className="search-icon" style={{ top: '50%' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg></span>
        <input
          type="search"
          placeholder="输入股票名称或 6 位代码,如 茅台 / 600519"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="全市场搜索"
        />
      </div>

      {loading && <div className="chart-empty" style={{ padding: '16px 0 4px' }}>搜索中…(首次需加载全市场快照,约 20 秒)</div>}
      {!loading && q.trim().length >= 2 && results !== null && results.length === 0 && (
        <div className="chart-empty" style={{ padding: '16px 0 4px' }}>未找到「{q}」,试试输入代码</div>
      )}
      {results && results.length > 0 && (
        <div className="search-results">
          {results.map((r) => {
            const inWatch = watched.includes(r.code)
            return (
              <div className="search-result-row" key={r.code} onClick={() => onOpenStock(r.code)}>
                <span className="sname">{r.name}</span>
                <span className="wcode">{r.code}</span>
                <button
                  className={`mini-add ${inWatch ? 'on' : ''}`}
                  title={inWatch ? '已加入自选' : '加入自选'}
                  onClick={(e) => { e.stopPropagation(); onToggleStock?.(r.code) }}
                >
                  {inWatch ? '✓ 已自选' : '+ 自选'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 热门股票(30 只行业龙头)
function HotStocks({ list, onOpenStock, onToggleStock, watched }) {
  if (!list.length) return null
  return (
    <div className="card" style={{ padding: 12, ['--d']: '60ms' }}>
      <div className="card-title" style={{ padding: '8px 8px 6px' }}>
        <h2>热门股票</h2>
        <span className="sub">{list.length} 只行业龙头 · 点击查看详情,可加自选</span>
      </div>
      <div className="hot-grid">
        {list.map((h) => {
          const up = h.change >= 0
          const inWatch = watched.includes(h.code)
          return (
            <div className="hot-card" key={h.code} onClick={() => onOpenStock(h.code)}>
              <button
                className={`mini-add ${inWatch ? 'on' : ''}`}
                title={inWatch ? '已加入自选' : '加入自选'}
                onClick={(e) => { e.stopPropagation(); onToggleStock?.(h.code) }}
              >
                {inWatch ? '✓' : '+'}
              </button>
              <div className="hc-name">
                {h.name}
                <span className="wcode">{h.code}</span>
              </div>
              <div className={`hc-price num ${up ? 'up' : 'down'}`}>{fmt(h.price)}</div>
              <div className={`hc-change num ${up ? 'up' : 'down'}`}>
                {up ? '+' : ''}{h.change.toFixed(2)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
