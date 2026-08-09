import { useEffect, useMemo, useRef, useState } from 'react'
import { getStock, getStockAI } from '../api.js'
import { loadProfile } from '../profile.js'
import { IconTrend } from './icons.jsx'
import StockChat from './StockChat.jsx'

const fmt = (v, d = 2) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d })

// 个股详情弹层:实时报价 + 分时图 + 日K蜡烛图 + 基本信息,支持加入/移出自选
export default function StockDetail({ code, watched, onToggleWatch, onClose }) {
  const [state, setState] = useState({ data: null, error: null })
  const [aiState, setAiState] = useState({ data: null, error: false })
  const [view, setView] = useState('minute')
  const [chatOpen, setChatOpen] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const modalRef = useRef(null)

  useEffect(() => {
    let alive = true
    setState({ data: null, error: null })
    setView('minute')
    const load = () =>
      getStock(code).then(({ data, live }) => {
        if (!alive) return
        if (live && data) setState({ data, error: null })
        else setState((prev) => (prev.data ? prev : { data: null, error: '加载失败,请稍后重试' }))
      })
    load()
    // 弹窗停留期间每 15s 静默刷新报价;失败时保留上一次数据不闪错
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [code, requestVersion])

  // AI 与行情并行开始请求，避免详情渲染后再串行等待分析结果。
  useEffect(() => {
    let alive = true
    setAiState({ data: null, error: false })
    getStockAI(code, loadProfile()).then(({ data, live }) => {
      if (!alive) return
      setAiState(live && data ? { data, error: false } : { data: null, error: true })
    })
    return () => { alive = false }
  }, [code, requestVersion])

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modalRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [onClose])

  const { data, error } = state

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        ref={modalRef}
        className={`modal-card ${chatOpen ? 'chat-visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="个股详情"
        tabIndex={-1}
      >
        {error ? (
          <div className="detail-state">
            <button className="modal-close modal-close-floating" onClick={onClose} aria-label="关闭">×</button>
            <div className="detail-state-mark">!</div>
            <div>
              <span className="eyebrow">QUOTE UNAVAILABLE · {code}</span>
              <h2>行情暂时没有回应</h2>
              <p>{error}</p>
              <button className="modal-retry" onClick={() => setRequestVersion((v) => v + 1)}>重新连接</button>
            </div>
          </div>
        ) : !data ? (
          <div className="detail-state detail-loading">
            <button className="modal-close modal-close-floating" onClick={onClose} aria-label="关闭">×</button>
            <span className="spinner" />
            <div>
              <span className="eyebrow">CONNECTING · {code}</span>
              <h2>正在建立行情连接</h2>
              <p>同步报价、图表与智能分析…</p>
            </div>
          </div>
        ) : (
          <StockBody
            data={data}
            view={view}
            setView={setView}
            watched={watched}
            onToggleWatch={onToggleWatch}
            onClose={onClose}
            aiState={aiState}
            chatOpen={chatOpen}
            onOpenChat={() => setChatOpen(true)}
          />
        )}
      </div>
      {chatOpen && data?.quote && (
        <StockChat code={data.quote.code} name={data.quote.name} onClose={() => setChatOpen(false)} />
      )}
    </div>
  )
}

function StockBody({ data, view, setView, watched, onToggleWatch, onClose, aiState, chatOpen, onOpenChat }) {
  const { quote, minute, kline = [], kline_week = [], kline_month = [] } = data
  const up = quote.change_pct >= 0
  const klineData = view === 'week' ? kline_week : view === 'month' ? kline_month : kline
  const daySpan = quote.high - quote.low
  const rangePosition = daySpan > 0 ? Math.max(0, Math.min(100, ((quote.price - quote.low) / daySpan) * 100)) : 50
  const exchange = quote.code?.startsWith('6') ? 'SH' : quote.code?.startsWith('8') || quote.code?.startsWith('4') ? 'BJ' : 'SZ'
  return (
    <>
      <div className="modal-head">
        <div className="stock-identity">
          <span className="exchange-mark">{exchange}</span>
          <div>
          <h2 className="modal-title">
            {quote.name}
            <span className="wcode">{quote.code}</span>
          </h2>
          <div className="modal-sub"><span className="live-pulse" /> 腾讯行情 · 实时同步</div>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className={`chat-open-btn ${chatOpen ? 'active' : ''}`} aria-pressed={chatOpen} onClick={onOpenChat}>{chatOpen ? '✦ 对话中' : '✦ 问 AI'}</button>
          <button
            type="button"
            className={`watch-add ${watched ? 'watched' : ''}`}
            aria-pressed={watched}
            onClick={() => onToggleWatch?.(quote.code)}
          >
            {watched ? '✓ 已自选' : '+ 加入自选'}
          </button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
      </div>

      <section className={`quote-overview ${up ? 'positive' : 'negative'}`}>
        <div className="quote-primary">
          <span className="quote-label">LAST PRICE</span>
          <span className={`mq-price num ${up ? 'up' : 'down'}`}>{fmt(quote.price)}</span>
          <span className={`pill ${up ? 'up' : 'down'}`}>
            <IconTrend dir={up ? 'up' : 'down'} size={12} />
            {up ? '+' : ''}{fmt(quote.change_pct)}% <i /> {up ? '+' : ''}{fmt(quote.change)}
          </span>
        </div>
        <div className="day-range">
          <div className="range-head">
            <span>日内价格区间</span>
            <strong className="num">振幅 {quote.amplitude ? fmt(quote.amplitude) : '—'}%</strong>
          </div>
          <div className="range-values"><span className="num">{fmt(quote.low)}</span><span className="num">{fmt(quote.high)}</span></div>
          <div className="range-track"><span className="range-marker" style={{ left: `${rangePosition}%` }} /></div>
          <div className="range-caption"><span>最低</span><span>当前价位</span><span>最高</span></div>
        </div>
        <div className="quote-quick">
          <InfoItem k="今开" v={fmt(quote.open)} />
          <InfoItem k="昨收" v={fmt(quote.prev_close)} />
          <InfoItem k="成交额" v={`${fmt(quote.amount, 0)} 亿`} />
        </div>
      </section>

      <div className="trade-workspace">
        <section className="chart-panel" aria-label="行情图表">
          <div className="chart-toolbar">
            <div className="modal-tabs" role="tablist" aria-label="图表周期">
              {[['minute', '分时'], ['day', '日 K'], ['week', '周 K'], ['month', '月 K']].map(([key, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  key={key}
                  className={`tab ${view === key ? 'active' : ''}`}
                  onClick={() => setView(key)}
                >{label}</button>
              ))}
            </div>
            <span className="chart-source">{view === 'minute' ? '实时分时 · 均价线' : '前复权 · MA5 / MA10'}</span>
          </div>
          <div className="modal-chart">
            {view === 'minute' ? <MinuteChart minute={minute} up={up} /> : <KlineChart kline={klineData} />}
          </div>
        </section>

        <aside className="metric-panel" aria-label="关键指标">
          <div className="metric-heading"><h3>关键指标</h3><span>FUNDAMENTALS</span></div>
          <div className="modal-info">
            <InfoItem k="最高" v={fmt(quote.high)} up />
            <InfoItem k="最低" v={fmt(quote.low)} down />
            <InfoItem k="换手率" v={quote.turnover_rate ? `${fmt(quote.turnover_rate)}%` : '—'} />
            <InfoItem k="量比" v={quote.volume_ratio ? fmt(quote.volume_ratio) : '—'} />
            <InfoItem k="市盈率" v={quote.pe ? fmt(quote.pe) : '—'} />
            <InfoItem k="市净率" v={quote.pb ? fmt(quote.pb) : '—'} />
            <InfoItem k="总市值" v={quote.total_mv ? `${fmt(quote.total_mv, 0)} 亿` : '—'} />
            <InfoItem k="流通市值" v={quote.circ_mv ? `${fmt(quote.circ_mv, 0)} 亿` : '—'} />
            <InfoItem k="52 周区间" v={quote.high_52w ? `${fmt(quote.low_52w)} ~ ${fmt(quote.high_52w)}` : '—'} />
            <InfoItem k="涨跌停" v={quote.limit_up ? `${fmt(quote.limit_down)} / ${fmt(quote.limit_up)}` : '—'} />
          </div>
        </aside>
      </div>

      <AiAdvice state={aiState} />
    </>
  )
}

// 个股 AI 建议(DeepSeek 生成,失败降级规则模板)
function AiAdvice({ state }) {
  const data = state.data
  const confidence = Math.max(0, Math.min(100, Number(data?.confidence) || 0))
  const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : []
  const bullPoints = Array.isArray(data?.bull_points) ? data.bull_points : []
  const bearPoints = Array.isArray(data?.bear_points) ? data.bear_points : []
  return (
    <div className="ai-advice">
      <div className="ai-advice-head">
        <span className="ai-advice-icon">✦</span>
        AI 投资建议
        <span className="ai-advice-tag">{data?.source === 'deepseek' ? 'DeepSeek 分析' : '量化规则'}</span>
        {data?.horizon ? <span className="ai-advice-tag horizon">{data.horizon}</span> : null}
      </div>
      {state.error ? (
        <p className="ai-advice-empty">AI 投资建议暂不可用，请确认行情后端已连接。</p>
      ) : !state.data ? (
        <div className="ai-advice-loading">
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          <span>正在综合实时行情与技术指标…</span>
        </div>
      ) : (
        <>
          <div className={`ai-verdict ${data.signal || 'neutral'}`}>
            <div className="verdict-action">
              <span>操作倾向 · AI ACTION</span>
              <strong>{data.action || '谨慎观望'}</strong>
              <em>{data.horizon || '短中线'}视角</em>
            </div>
            <div className="verdict-confidence">
              <div className="confidence-head"><span>综合置信度</span><b className="num">{confidence}%</b></div>
              <div className="confidence-track"><i style={{ width: `${confidence}%` }} /></div>
              <small>基于趋势、量价与技术指标</small>
            </div>
            <div className="verdict-levels">
              <div><span>参考支撑</span><b className="num down">{data.support ? fmt(data.support) : '—'}</b></div>
              <div><span>参考压力</span><b className="num up">{data.resistance ? fmt(data.resistance) : '—'}</b></div>
            </div>
          </div>
          {dimensions.length > 0 && (
            <section className="ai-diagnostics" aria-labelledby="diagnostics-title">
              <div className="ai-section-head">
                <h4 id="diagnostics-title">多维诊断</h4>
                <span>分数用于横向理解当前状态，不代表预期收益</span>
              </div>
              <div className="factor-grid">
                {dimensions.map((factor) => (
                  <div className={`factor-card ${factor.tone || ''}`} key={factor.key}>
                    <div className="factor-head"><span>{factor.label}</span><b className="num">{factor.score}</b></div>
                    <div className="factor-track"><i style={{ width: `${Math.max(0, Math.min(100, factor.score))}%` }} /></div>
                    <p>{factor.note}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="ai-evidence-grid">
            <section className="evidence-card bull">
              <div className="evidence-title"><span>↗</span><h4>支持因素</h4></div>
              <ul>{bullPoints.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>
            </section>
            <section className="evidence-card bear">
              <div className="evidence-title"><span>↘</span><h4>风险因素</h4></div>
              <ul>{bearPoints.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>
            </section>
          </div>
          <div className="ai-advice-body">
            <p className="ai-advice-row"><b>概览</b>{state.data.summary}</p>
            <p className="ai-advice-row"><b>策略</b>{state.data.advice}</p>
            <p className="ai-advice-row risk"><b>风险</b>{state.data.risk}</p>
          </div>
          {data.plan && (
            <section className="ai-plan">
              <div className="ai-section-head"><h4>条件化行动方案</h4><span>按状态执行，不提供确定性收益判断</span></div>
              <div className="plan-row"><span>已有仓位</span><p>{data.plan.holding}</p></div>
              <div className="plan-row"><span>尚未持仓</span><p>{data.plan.watching}</p></div>
              <div className="plan-row invalid"><span>失效条件</span><p>{data.plan.invalidation}</p></div>
            </section>
          )}
          {data.valuation && (
            <div className="valuation-note">
              <span>估值快照</span>
              <b className="num">PE {data.valuation.pe || '—'} · PB {data.valuation.pb || '—'}</b>
              <p>{data.valuation.note}</p>
            </div>
          )}
          <div className="ai-scope-note">
            {data.style_scope ? <p><b>周期口径</b>{data.style_scope}</p> : null}
            <p><b>数据边界</b>{data.scope}</p>
            <p><b>适当性说明</b>{data.suitability}</p>
          </div>
          <div className="ai-advice-foot">
            <span>{state.data.generated_at ? `生成于 ${state.data.generated_at}` : ''}</span>
            <span>AI 建议仅供研究参考，不构成任何投资承诺或收益保证</span>
          </div>
        </>
      )}
    </div>
  )
}

function InfoItem({ k, v, up, down }) {
  return (
    <div className="info-item">
      <span className="k">{k}</span>
      <span className={`v num ${up ? 'up' : ''} ${down ? 'down' : ''}`}>{v}</span>
    </div>
  )
}

// ---------- 分时图(含交互十字光标 + 昨收标线) ----------
function fmtTime(t) {
  const s = String(t || '')
  return s.length >= 4 ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : s
}

function MinuteChart({ minute, up }) {
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null) // {idx, px, w, vx, vy}
  if (!minute || !minute.prices || minute.prices.length < 2) {
    return <div className="chart-empty">暂无分时数据</div>
  }
  const { prices, volumes, times = [], avg_prices = [] } = minute
  const W = 660, H = 240, PAD = 6, VOL_H = 34
  const min = Math.min(...prices), max = Math.max(...prices)
  const span = max - min || 1
  const X = (i) => PAD + (i / (prices.length - 1)) * (W - PAD * 2)
  const Y = (p) => H - PAD - VOL_H - 4 - ((p - min) / span) * (H - PAD * 2 - VOL_H - 8)
  const line = prices.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`
  const avgLine = avg_prices.length === prices.length
    ? avg_prices.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')
    : ''
  const vmax = Math.max(...volumes) || 1
  const gid = up ? 'gradUp' : 'gradDown'
  const base = prices[0]

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const w = rect.width
    const vx = ((e.clientX - rect.left) / w) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    const step = (W - PAD * 2) / (prices.length - 1)
    const idx = Math.max(0, Math.min(prices.length - 1, Math.round((vx - PAD) / step)))
    setHover({ idx, px: e.clientX - rect.left, w, vx, vy })
  }

  const h = hover ? prices[hover.idx] : null
  const hChg = h != null && base ? ((h - base) / base) * 100 : 0

  return (
    <div className="chart-box" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="当日分时走势">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: up ? 'var(--up)' : 'var(--down)', stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: up ? 'var(--up)' : 'var(--down)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={PAD} x2={W - PAD} y1={(H - VOL_H - 4) * r} y2={(H - VOL_H - 4) * r} stroke="var(--separator)" strokeDasharray="3 4" strokeWidth={1} />
        ))}
        {/* 昨收标线 + 标签 */}
        <line x1={PAD} x2={W - PAD} y1={Y(base)} y2={Y(base)} stroke="var(--separator-strong)" strokeWidth={1} strokeDasharray="4 4" />
        <g fontSize={10} fill="var(--text-tertiary)">
          <text x={W - 4} y={Y(base) - 5} textAnchor="end">昨收 {base.toFixed(2)}</text>
        </g>
        {/* 成交量 */}
        {volumes.map((v, i) => (
          <rect key={i} x={X(i) - 3} y={H - VOL_H + (1 - v / vmax) * VOL_H} width={6} height={(v / vmax) * VOL_H} rx={1} className={up ? 'bar-up' : 'bar-down'} opacity={0.3} />
        ))}
        <polygon points={area} fill={`url(#${gid})`} />
        <polyline points={line} fill="none" className={up ? 'chart-up' : 'chart-down'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* 分时均价线(累计成交额/累计成交量)+ 图例 */}
        {avgLine && (
          <g>
            <polyline points={avgLine} fill="none" stroke="#ffb02e" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
            <line x1={PAD} y1={10} x2={PAD + 16} y2={10} stroke="#ffb02e" strokeWidth={2} />
            <text x={PAD + 20} y={14} fontSize={10.5} fill="var(--text-tertiary)">均价</text>
          </g>
        )}
        <circle cx={X(prices.length - 1)} cy={Y(prices[prices.length - 1])} r={3.5} className={up ? 'chart-up' : 'chart-down'} fill="var(--card)" strokeWidth={2.5} />
        {/* 悬停十字光标 */}
        {hover && h != null && (
          <g>
            <line x1={hover.vx} x2={hover.vx} y1={PAD} y2={H - PAD} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <line x1={PAD} x2={W - PAD} y1={hover.vy} y2={hover.vy} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <circle cx={X(hover.idx)} cy={Y(h)} r={3.5} className={up ? 'chart-up' : 'chart-down'} fill="var(--card)" strokeWidth={2.5} />
          </g>
        )}
        {/* 横纵坐标读数 */}
        {hover && (() => {
          const plotTop = H - PAD - VOL_H - 4
          const plotHt = H - PAD * 2 - VOL_H - 8
          const priceAtY = (vy) => min + ((plotTop - vy) / plotHt) * span
          const py = Math.max(PAD, Math.min(plotTop, hover.vy))
          const px = Math.max(PAD, Math.min(W - PAD, hover.vx))
          return (
            <g>
              {/* Y 轴:当前价格 */}
              <rect x={W - 48} y={py - 9} width={44} height={16} rx={4} fill="var(--card)" stroke="var(--separator-strong)" />
              <text x={W - 26} y={py + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-primary)">
                {priceAtY(py).toFixed(2)}
              </text>
              {/* X 轴:当前时间 */}
              <rect x={px - 30} y={H - 17} width={60} height={15} rx={4} fill="var(--card)" stroke="var(--separator-strong)" />
              <text x={px} y={H - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-secondary)">
                {fmtTime(times[hover.idx])}
              </text>
            </g>
          )
        })()}
      </svg>
      {hover && h != null && (
        <div
          className="chart-tip"
          style={{ left: Math.max(86, Math.min(hover.px, (hover.w || 400) - 86)), top: 8 }}
        >
          <b>{fmtTime(times[hover.idx])}</b>
          <div className="tip-row"><span className="k">价格</span><span className={`v num ${hChg >= 0 ? 'up' : 'down'}`}>{h.toFixed(2)}</span></div>
          <div className="tip-row"><span className="k">涨跌</span><span className={`v num ${hChg >= 0 ? 'up' : 'down'}`}>{hChg >= 0 ? '+' : ''}{hChg.toFixed(2)}%</span></div>
          {avg_prices.length === prices.length && (
            <div className="tip-row"><span className="k">均价</span><span className="v num">{avg_prices[hover.idx].toFixed(2)}</span></div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- K线蜡烛图(交互十字光标 + 最新价标线 + MA5/MA10) ----------
function KlineChart({ kline }) {
  const bars = useMemo(() => (Array.isArray(kline) ? kline : []), [kline])
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null) // {idx, px, w, vx, vy}
  if (bars.length < 2) return <div className="chart-empty">暂无K线数据</div>

  const W = 660, H = 240, PAD = 6, VOL_H = 34
  const plotH = H - VOL_H - 12
  const min = Math.min(...bars.map((b) => b.low))
  const max = Math.max(...bars.map((b) => b.high))
  const span = max - min || 1
  const bw = W / bars.length
  const y = (p) => PAD + (1 - (p - min) / span) * (plotH - PAD * 2) + PAD
  const x = (i) => i * bw + bw / 2
  const vmax = Math.max(...bars.map((b) => b.volume)) || 1

  const ma = (n) => {
    const arr = bars.map((_, i) => {
      if (i < n - 1) return null
      let s = 0
      for (let j = i - n + 1; j <= i; j++) s += bars[j].close
      return s / n
    })
    return arr
  }
  const ma5 = ma(5), ma10 = ma(10)
  const maLine = (arr) => {
    let pts = ''
    arr.forEach((v, i) => { if (v !== null) pts += `${x(i).toFixed(1)},${y(v).toFixed(1)} ` })
    return pts.trim()
  }

  const lastClose = bars[bars.length - 1].close

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const w = rect.width
    const vx = ((e.clientX - rect.left) / w) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    const idx = Math.max(0, Math.min(bars.length - 1, Math.floor(vx / bw)))
    setHover({ idx, px: e.clientX - rect.left, w, vx, vy })
  }

  const hb = hover ? bars[hover.idx] : null
  const hPrev = hover && hover.idx > 0 ? bars[hover.idx - 1].close : hb ? hb.open : null
  const hChg = hb && hPrev ? ((hb.close - hPrev) / hPrev) * 100 : 0

  return (
    <div className="chart-box" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="K线图">
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={PAD} x2={W - PAD} y1={plotH * r} y2={plotH * r} stroke="var(--separator)" strokeDasharray="3 4" strokeWidth={1} />
        ))}
        {/* 最新收盘价参考线；具体价格通过悬停十字光标查看，避免遮挡末端 K 线 */}
        <line x1={PAD} x2={W - PAD} y1={y(lastClose)} y2={y(lastClose)} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
        {/* 蜡烛 */}
        {bars.map((b, i) => {
          const up = b.close >= b.open
          const cls = up ? 'bar-up' : 'bar-down'
          const yOpen = y(b.open), yClose = y(b.close)
          const bodyH = Math.max(Math.abs(yClose - yOpen), 1.2)
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} className={cls} strokeWidth={1} />
              <rect x={x(i) - Math.max(bw * 0.32, 1)} y={Math.min(yOpen, yClose)} width={Math.max(bw * 0.64, 2)} height={bodyH} rx={0.8} className={cls} />
            </g>
          )
        })}
        {/* MA5 / MA10 */}
        <polyline points={maLine(ma5)} fill="none" stroke="#0071e3" strokeWidth={1.6} strokeLinejoin="round" />
        <polyline points={maLine(ma10)} fill="none" stroke="#ff9f0a" strokeWidth={1.6} strokeLinejoin="round" />
        {/* 量能 */}
        {bars.map((b, i) => (
          <rect key={`v${i}`} x={x(i) - Math.max(bw * 0.28, 1)} y={H - VOL_H + (1 - b.volume / vmax) * VOL_H} width={Math.max(bw * 0.56, 2)} height={(b.volume / vmax) * VOL_H} rx={0.8} className={b.close >= b.open ? 'bar-up' : 'bar-down'} opacity={0.4} />
        ))}
        {/* 图例(带最新值) */}
        <g fontSize={10.5} fill="var(--text-tertiary)">
          <text x={PAD + 4} y={14}>MA5</text>
          <line x1={PAD + 30} y1={10} x2={PAD + 52} y2={10} stroke="#0071e3" strokeWidth={2} />
          <text x={PAD + 56} y={14} fontWeight={700} fill="#0071e3">{ma5[ma5.length - 1] ? ma5[ma5.length - 1].toFixed(2) : ''}</text>
          <text x={PAD + 128} y={14}>MA10</text>
          <line x1={PAD + 158} y1={10} x2={PAD + 180} y2={10} stroke="#ff9f0a" strokeWidth={2} />
          <text x={PAD + 184} y={14} fontWeight={700} fill="#ff9f0a">{ma10[ma10.length - 1] ? ma10[ma10.length - 1].toFixed(2) : ''}</text>
        </g>
        {/* 悬停十字光标 */}
        {hover && hb && (
          <g>
            <line x1={x(hover.idx)} x2={x(hover.idx)} y1={PAD} y2={H - PAD} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <line x1={PAD} x2={W - PAD} y1={hover.vy} y2={hover.vy} stroke="var(--text-tertiary)" strokeWidth={1} strokeDasharray="3 3" opacity={0.65} />
            <rect x={hover.idx * bw} y={PAD} width={bw} height={plotH - PAD} fill="var(--accent)" opacity={0.06} />
          </g>
        )}
        {/* 横纵坐标读数 */}
        {hover && (() => {
          const plotHt = plotH - PAD * 2
          const priceAtY = (vy) => max - ((vy - PAD * 2) / plotHt) * span
          const py = Math.max(PAD, Math.min(plotH, hover.vy))
          const px = Math.max(PAD, Math.min(W - PAD, hover.vx))
          return (
            <g>
              {/* Y 轴:当前价格 */}
              <rect x={W - 48} y={py - 9} width={44} height={16} rx={4} fill="var(--card)" stroke="var(--separator-strong)" />
              <text x={W - 26} y={py + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-primary)">
                {priceAtY(py).toFixed(2)}
              </text>
              {/* X 轴:当前日期 */}
              <rect x={px - 36} y={H - 17} width={72} height={15} rx={4} fill="var(--card)" stroke="var(--separator-strong)" />
              <text x={px} y={H - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--text-secondary)">
                {hb.date}
              </text>
            </g>
          )
        })()}
      </svg>
      {hover && hb && (
        <div
          className="chart-tip"
          style={{ left: Math.max(96, Math.min(hover.px, (hover.w || 400) - 96)), top: 8 }}
        >
          <b>{hb.date}</b>
          <div className="tip-row"><span className="k">开</span><span className="v num">{hb.open.toFixed(2)}</span><span className="k">高</span><span className="v num up">{hb.high.toFixed(2)}</span></div>
          <div className="tip-row"><span className="k">收</span><span className="v num">{hb.close.toFixed(2)}</span><span className="k">低</span><span className="v num down">{hb.low.toFixed(2)}</span></div>
          <div className="tip-row"><span className="k">涨跌</span><span className={`v num ${hChg >= 0 ? 'up' : 'down'}`}>{hChg >= 0 ? '+' : ''}{hChg.toFixed(2)}%</span>
            <span className="k">量</span><span className="v num">{(hb.volume / 10000).toFixed(1)}万</span></div>
          <div className="tip-row ma">
            <span style={{ color: '#0071e3' }}>MA5 {ma5[hover.idx] ? ma5[hover.idx].toFixed(2) : '—'}</span>
            <span style={{ color: '#ff9f0a' }}>MA10 {ma10[hover.idx] ? ma10[hover.idx].toFixed(2) : '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
