import { useEffect, useMemo, useRef, useState } from 'react'
import {
  analyzeWatchlist,
  getInsights,
  getRecommendations,
  getSettings,
  getWatchlist,
  REFRESH_MS,
  useLiveData,
} from '../api.js'
import { loadProfile, summarizeProfile } from '../profile.js'
import { IconAlert, IconBolt } from './icons.jsx'
import WatchlistChat from './WatchlistChat.jsx'

const ICONS = { up: IconBolt, down: IconAlert }
const LOCK_KEY = 'ff-ai-watch-locks-v1'
const MAX_ANALYSIS = 10

function readLockedCodes(watchCodes) {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCK_KEY) || '[]')
    const valid = Array.isArray(stored)
      ? stored.filter((code) => watchCodes.includes(code)).slice(0, MAX_ANALYSIS)
      : []
    if (watchCodes.length > MAX_ANALYSIS && !valid.length) return watchCodes.slice(0, MAX_ANALYSIS)
    return valid
  } catch {
    return watchCodes.length > MAX_ANALYSIS ? watchCodes.slice(0, MAX_ANALYSIS) : []
  }
}

function AnalysisUniverse({ codes, quotes, lockedCodes, onToggle }) {
  const quoteMap = useMemo(() => new Map(quotes.map((item) => [item.code, item])), [quotes])
  const lockedSet = useMemo(() => new Set(lockedCodes), [lockedCodes])
  const needsLock = codes.length > MAX_ANALYSIS
  const ordered = useMemo(() => {
    if (!needsLock) return codes
    return [...codes].sort((a, b) => Number(lockedSet.has(b)) - Number(lockedSet.has(a)))
  }, [codes, lockedSet, needsLock])

  if (!codes.length) {
    return (
      <div className="analysis-universe-empty">
        <span>＋</span>
        <div><b>自选股还是空的</b><small>先在股票详情中加入自选，再回到这里做范围内优选。</small></div>
      </div>
    )
  }

  return (
    <div className="analysis-universe" aria-label="自选股分析范围">
      {ordered.map((code) => {
        const quote = quoteMap.get(code)
        const locked = !needsLock || lockedSet.has(code)
        return (
          <button
            className={`analysis-stock-chip ${locked ? 'locked' : ''} ${needsLock ? '' : 'automatic'}`}
            type="button"
            key={code}
            onClick={() => needsLock && onToggle(code)}
            aria-pressed={locked}
            title={needsLock ? (locked ? '从锁定分析池移出' : '锁定到分析池') : '自选不超过 10 只，已自动纳入'}
          >
            <span className="analysis-lock-mark" aria-hidden="true">{locked ? '●' : '○'}</span>
            <span className="analysis-chip-copy">
              <b>{quote?.name || code}</b>
              <small>{code}{quote ? ` · ${quote.price?.toFixed?.(2) || quote.price}` : ''}</small>
            </span>
            <span className={`analysis-chip-change ${(quote?.change || 0) >= 0 ? 'up' : 'down'}`}>
              {quote ? `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%` : '—'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function getAnalysisFeatureTags(item, horizonLabel) {
  const dimensions = new Map((item.dimensions || []).map((dimension) => [dimension.key, Number(dimension.score)]))
  const allocationMatch = String(item.allocation_note || '').match(/占初始资金\s*([\d.]+)%/)
  const allocationPct = allocationMatch?.[1]
  const trend = dimensions.get('trend')
  const momentum = dimensions.get('momentum')
  const volume = dimensions.get('volume')
  const risk = dimensions.get('risk')

  const tags = [{ label: horizonLabel, tone: 'horizon' }, {
    label: item.allocation_blocked
      ? (allocationPct ? `仓位超限 ${allocationPct}%` : '资金受限')
      : (allocationPct ? `仓位 ${allocationPct}%` : '资金适配'),
    tone: item.allocation_blocked ? 'risk' : 'fit',
  }]

  if (Number.isFinite(trend)) {
    tags.push(trend >= 65
      ? { label: '趋势偏强', tone: 'positive' }
      : trend <= 40
        ? { label: '趋势偏弱', tone: 'risk' }
        : { label: '趋势中性', tone: 'neutral' })
  }
  if (Number.isFinite(momentum)) {
    tags.push(momentum >= 70
      ? { label: '动量偏强', tone: 'positive' }
      : momentum <= 35
        ? { label: '动量偏弱', tone: 'risk' }
        : { label: '动量中性', tone: 'neutral' })
  }
  if (Number.isFinite(volume)) {
    tags.push(volume >= 60
      ? { label: '量能活跃', tone: 'positive' }
      : volume <= 40
        ? { label: '量能偏弱', tone: 'caution' }
        : { label: '量能平稳', tone: 'neutral' })
  }
  if (Number.isFinite(risk)) {
    tags.push(risk >= 70
      ? { label: '高波动', tone: 'risk' }
      : risk <= 35
        ? { label: '低波动', tone: 'fit' }
        : { label: '中等波动', tone: 'caution' })
  }
  if (item.holding) tags.unshift({ label: '已有持仓', tone: 'holding' })
  return tags
}

function AnalysisResults({ result, onOpenStock, onOpenChat }) {
  const items = Array.isArray(result?.items) ? result.items : []
  if (!items.length) return null
  const lead = items[0]
  const priorityItems = items.filter((item) => item.label === '优先关注')
  const blockedItems = items.filter((item) => item.allocation_blocked)
  const eligibleCount = items.length - blockedItems.length
  const hasPriority = priorityItems.length > 0
  const horizonLabel = result.horizon_label || '波段（中线）'
  const focusTitle = hasPriority
    ? `${priorityItems.map((item) => item.name).slice(0, 3).join('、')}进入优先关注`
    : '当前没有满足条件的优先标的'
  const focusCopy = hasPriority
    ? `按${horizonLabel}口径，范围内相对领先的是 ${lead.name}，匹配度 ${lead.score}；先验证关注条件，再考虑资金配置。`
    : `按${horizonLabel}口径，相对领先的是 ${lead.name}，匹配度 ${lead.score}，但结论仍为“${lead.label}”；当前更适合等待信号，而不是从低分项中勉强选择。`
  return (
    <section className="analysis-results" aria-live="polite">
      <div className="analysis-results-toolbar">
        <div className="analysis-results-source">
          <span className="eyebrow">RANGE-BOUND SELECTION</span>
          <span className="analysis-horizon-badge">{horizonLabel}口径</span>
          <small>{result.source === 'deepseek' ? 'DeepSeek 综合研判' : '量化规则研判'} · {result.generated_at}</small>
        </div>
        <div className="analysis-result-actions">
          <button type="button" onClick={onOpenChat}>继续追问 <b>↗</b></button>
        </div>
      </div>

      <div className={`analysis-focus-brief ${hasPriority ? 'has-priority' : 'no-priority'}`}>
        <div className="analysis-focus-decision">
          <span className="analysis-decision-kicker">本次结论</span>
          <h3>{focusTitle}</h3>
          <p>{focusCopy}</p>
          {result.style_scope ? <small className="analysis-style-scope">{result.style_scope}</small> : null}
          <div className="analysis-next-signal">
            <span>首要观察条件</span>
            <b>{lead.name}</b>
            <p>{lead.trigger}</p>
          </div>
        </div>
        <div className="analysis-focus-metrics">
          <div className="lead-metric">
            <span>相对领先</span>
            <strong>{lead.name}</strong>
            <small>匹配度 <b>{lead.score}</b> · {lead.label}</small>
          </div>
          <div>
            <span>资金可适配</span>
            <strong>{eligibleCount}<small> / {items.length}</small></strong>
            <small>未触发硬性仓位约束</small>
          </div>
          <div className={blockedItems.length ? 'risk-metric' : ''}>
            <span>资金受限</span>
            <strong>{blockedItems.length}<small> 只</small></strong>
            <small>{blockedItems.length ? blockedItems.slice(0, 3).map((item) => item.name).join('、') : '当前没有硬性约束'}</small>
          </div>
        </div>
      </div>

      <div className="analysis-ranking-title">
        <div><b>完整排序</b><span>按{horizonLabel}研究优先级从高到低</span></div>
        <small>{result.summary}</small>
      </div>

      <div className="analysis-ranking">
        {items.map((item, index) => {
          const featureTags = getAnalysisFeatureTags(item, horizonLabel)
          return (
          <article className={`analysis-rank-row ${item.tone} ${index === 0 ? 'lead' : ''} ${item.allocation_blocked ? 'constrained' : ''}`} key={item.code}>
            <div className="analysis-rank-number">{String(item.rank).padStart(2, '0')}</div>
            <div className="analysis-security">
              <b>{item.name}</b>
              <span>{item.code} · <em className={item.change_pct >= 0 ? 'up' : 'down'}>{item.change_pct >= 0 ? '+' : ''}{item.change_pct.toFixed(2)}%</em></span>
              <button type="button" onClick={() => onOpenStock?.(item.code)}>查看详情 →</button>
            </div>
            <div className="analysis-verdict">
              <div className="analysis-verdict-head">
                <span className={`analysis-label ${item.tone}`}>{item.label}</span>
                <span className="analysis-score">
                  <span>匹配度</span><b>{item.score}</b>
                  <i aria-hidden="true"><em style={{ ['--score']: `${item.score}%` }} /></i>
                </span>
              </div>
              <div className="analysis-feature-tags" aria-label={`${item.name} 特征标签`}>
                {featureTags.map((tag) => <span className={tag.tone} key={tag.label}>{tag.label}</span>)}
              </div>
              <p>{item.reason}</p>
              <small className={item.allocation_blocked ? 'blocked' : ''}>
                {item.allocation_blocked ? '资金限制 · ' : '资金适配 · '}{item.allocation_note}
              </small>
            </div>
            <div className="analysis-conditions">
              <div><span>关注条件</span><p>{item.trigger}</p></div>
              <div><span>风险 / 失效</span><p>{item.risk}；{item.invalidation}</p></div>
            </div>
          </article>
          )
        })}
      </div>
      <p className="analysis-scope">{result.scope}</p>
    </section>
  )
}

// AI 分析页：先在用户自选范围内做组合优选，再补充全市场盘面观察。
export default function AIPage({ watchCodes = [], onOpenStock }) {
  const watchKey = watchCodes.join(',')
  const { data: insights } = useLiveData(getInsights, [], REFRESH_MS)
  const { data: settings } = useLiveData(getSettings, { enabled: false }, 0)
  const { data: recs } = useLiveData(getRecommendations, [], REFRESH_MS)
  const { data: watchQuotes } = useLiveData(() => getWatchlist(watchCodes), [], REFRESH_MS, [watchKey])
  const [lockedCodes, setLockedCodes] = useState(() => readLockedCodes(watchCodes))
  const [profile, setProfile] = useState(loadProfile)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const requestRef = useRef(null)
  const previousCountRef = useRef(watchCodes.length)

  const needsLock = watchCodes.length > MAX_ANALYSIS
  const analysisCodes = needsLock
    ? lockedCodes.filter((code) => watchCodes.includes(code)).slice(0, MAX_ANALYSIS)
    : watchCodes.slice(0, MAX_ANALYSIS)
  const profileSummary = summarizeProfile(profile)
  const list = Array.isArray(insights) ? insights : []
  const recList = Array.isArray(recs) ? recs : []
  const quoteList = Array.isArray(watchQuotes) ? watchQuotes : []
  const aiEnabled = !!settings?.enabled
  const resultOutdated = !!result?.horizon && result.horizon !== profileSummary.horizon

  useEffect(() => {
    setLockedCodes((current) => {
      const valid = current.filter((code) => watchCodes.includes(code)).slice(0, MAX_ANALYSIS)
      if (watchCodes.length > MAX_ANALYSIS && previousCountRef.current <= MAX_ANALYSIS && !valid.length) {
        return watchCodes.slice(0, MAX_ANALYSIS)
      }
      return valid
    })
    previousCountRef.current = watchCodes.length
  }, [watchKey, watchCodes])

  useEffect(() => {
    localStorage.setItem(LOCK_KEY, JSON.stringify(lockedCodes))
  }, [lockedCodes])

  useEffect(() => {
    const handleProfile = (event) => setProfile(event.detail || loadProfile())
    window.addEventListener('ff-profile-updated', handleProfile)
    return () => window.removeEventListener('ff-profile-updated', handleProfile)
  }, [])

  useEffect(() => () => requestRef.current?.abort(), [])

  const toggleLock = (code) => {
    setMessage('')
    setLockedCodes((current) => {
      if (current.includes(code)) return current.filter((item) => item !== code)
      if (current.length >= MAX_ANALYSIS) {
        setMessage('分析池最多锁定 10 只，请先取消一只再添加。')
        return current
      }
      return [...current, code]
    })
  }

  const runAnalysis = async () => {
    if (loading) {
      requestRef.current?.abort()
      return
    }
    if (!analysisCodes.length) {
      setMessage(needsLock ? '请至少锁定 1 只自选股。' : '请先添加自选股。')
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setChatOpen(false)
    setMessage('')
    const response = await analyzeWatchlist(analysisCodes, loadProfile(), { signal: controller.signal })
    if (response.ok) {
      setResult(response.data)
    } else if (response.aborted) {
      setMessage('已停止本次分析，之前的结果仍然保留。')
    } else {
      setMessage(response.message || '分析失败，请稍后重试。')
    }
    if (requestRef.current === controller) requestRef.current = null
    setLoading(false)
  }

  return (
    <div className="ai-page">
      <div className="ai-engine">
        <span className={`pill ${aiEnabled ? 'up' : 'flat'}`}>
          <span className={`dot ${aiEnabled ? 'live' : 'demo'}`} />
          {aiEnabled ? `DeepSeek 模型 · ${settings.model || ''}` : '量化规则引擎 · AI 模型未启用'}
        </span>
        <span className="sub">{profileSummary.totalCapital > 0 ? `资金档案已接入 · 可用 ¥${profileSummary.cash.toLocaleString('zh-CN')} · ${profileSummary.horizon}口径` : `未设置初始资金 · ${profileSummary.horizon}口径`}</span>
      </div>

      <div className="card watch-analysis-card" style={{ ['--d']: '0ms' }}>
        <div className="analysis-hero">
          <div>
            <span className="eyebrow">LOCKED UNIVERSE · MAX 10</span>
            <h2>自选股智能优选</h2>
            <p>只在你的自选范围内比较。超过 10 只时，锁定最关心的标的组成固定分析池。</p>
          </div>
          <div className="analysis-actions">
            <div className="analysis-counter">
              <strong>{analysisCodes.length}</strong><span>/ {MAX_ANALYSIS}</span>
              <small>{needsLock ? '已锁定' : '自动纳入'}</small>
            </div>
            <button
              className={`analysis-run ${loading ? 'stopping' : ''}`}
              type="button"
              onClick={runAnalysis}
              disabled={!loading && !analysisCodes.length}
            >
              {loading ? <><i /> 停止分析</> : <>开始优选 <span>→</span></>}
            </button>
          </div>
        </div>

        <div className="analysis-mode-note">
          <span>{needsLock ? '锁定模式' : '自动模式'}</span>
          {needsLock
            ? `你有 ${watchCodes.length} 只自选股，当前仅分析已锁定的 ${analysisCodes.length} 只。点击下方股票可调整范围。`
            : `你有 ${watchCodes.length} 只自选股，系统会全部纳入本次比较。`} 当前按 {profileSummary.horizon} 周期研判。
        </div>

        <AnalysisUniverse
          codes={watchCodes}
          quotes={quoteList}
          lockedCodes={lockedCodes}
          onToggle={toggleLock}
        />
        {message ? <div className="analysis-message">{message}</div> : null}
        {resultOutdated ? <div className="analysis-message stale">主要周期已切换为“{profileSummary.horizon}”，请重新运行优选以更新排序和建议。</div> : null}
        {loading ? (
          <div className="analysis-progress">
            <span className="analysis-progress-line" />
            <div><b>正在建立横向比较</b><small>批量读取行情、250 日 K 线、资金约束与风险条件…</small></div>
          </div>
        ) : null}
        <AnalysisResults result={result} onOpenStock={onOpenStock} onOpenChat={() => setChatOpen(true)} />
      </div>

      {recList.length > 0 ? (
        <div className="card" style={{ ['--d']: '60ms' }}>
          <div className="card-title">
            <h2>市场关注方向</h2>
            <span className="sub">作为自选股比较的市场背景，不直接外推个股</span>
          </div>
          <div className="rec-grid">
            {recList.map((item, index) => (
              <div className="rec-card" key={item.name + index}>
                <div className="rec-head">
                  <span className="rec-rank" aria-hidden="true">◎</span>
                  <b className="rec-name">{item.name}</b>
                  <span className="rec-badge">板块观察</span>
                </div>
                {item.reason ? <p className="rec-reason">{item.reason}</p> : null}
                {item.risk ? <p className="rec-risk">⚠ {item.risk}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ ['--d']: '120ms' }}>
        <div className="card-title">
          <h2>盘面洞察</h2>
          <span className="sub">{aiEnabled ? `由 ${settings.model || 'DeepSeek'} 生成` : '内置规则引擎'}</span>
        </div>
        <div className="ai-list">
          {list.map((insight, index) => {
            const Icon = ICONS[insight.tone] || IconBolt
            return (
              <div className="ai-row" key={`${insight.tag}-${index}`}>
                <span className={`sparkline-dot ${insight.tone}`}><Icon size={15} /></span>
                <span className={`tag ${insight.tone}`}>{insight.tag}</span>
                <p>{insight.text}</p>
                <span className="ai-time">实时</span>
              </div>
            )
          })}
          {!list.length ? <div className="chart-empty" style={{ padding: 30 }}>暂无洞察，稍后刷新</div> : null}
        </div>
        <p className="ai-note">优选结果是锁定范围内的相对研究优先级，不代表全市场最佳标的，也不构成确定性买卖指令。</p>
      </div>
      {chatOpen && result ? <WatchlistChat result={result} onClose={() => setChatOpen(false)} /> : null}
    </div>
  )
}
