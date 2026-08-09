import { useEffect, useMemo, useState } from 'react'
import { getWatchlist, REFRESH_MS, useLiveData } from '../api.js'
import { loadProfile, summarizeProfile } from '../profile.js'

const money = (value, digits = 0) => Number(value || 0).toLocaleString('zh-CN', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
})

const tradeDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function getPositionState(ratio, cash) {
  if (cash < 0) return { label: '资金缺口', tone: 'danger', note: '请核对初始资金或交易流水' }
  if (ratio === 0) return { label: '空仓', tone: 'empty', note: '现金充足，尚未形成持仓' }
  if (ratio < 30) return { label: '轻仓', tone: 'light', note: '保留了较多现金缓冲' }
  if (ratio < 70) return { label: '均衡', tone: 'balanced', note: '现金与持仓相对均衡' }
  return { label: '高仓位', tone: 'warning', note: '新增交易前先检查集中度' }
}

export default function AccountStatus({ onManage }) {
  const [profile, setProfile] = useState(loadProfile)
  const summary = useMemo(() => summarizeProfile(profile), [profile])
  const positionCodes = useMemo(() => summary.positions.map((item) => item.code), [summary.positions])
  const positionKey = positionCodes.join(',')
  const { data: quoteData } = useLiveData(
    () => getWatchlist(positionCodes),
    [],
    REFRESH_MS,
    [positionKey],
  )
  const quotes = Array.isArray(quoteData) ? quoteData : []

  useEffect(() => {
    const handleProfile = (event) => setProfile(event.detail || loadProfile())
    window.addEventListener('ff-profile-updated', handleProfile)
    return () => window.removeEventListener('ff-profile-updated', handleProfile)
  }, [])

  const account = useMemo(() => {
    const quoteMap = new Map(quotes.map((item) => [item.code, item]))
    let valuedPositions = 0
    const marketValue = summary.positions.reduce((total, position) => {
      const price = Number(quoteMap.get(position.code)?.price)
      if (price > 0) valuedPositions += 1
      return total + (price > 0 ? price * position.quantity : position.amount)
    }, 0)
    const equity = summary.cash + marketValue
    const utilization = equity > 0 ? marketValue / equity * 100 : summary.investedPct
    const latestTrade = [...summary.transactions].sort((a, b) => (
      String(b.tradeAt).localeCompare(String(a.tradeAt))
      || String(b.createdAt).localeCompare(String(a.createdAt))
    ))[0] || null
    return {
      equity,
      marketValue,
      unrealized: marketValue - summary.invested,
      utilization: Math.max(0, utilization),
      latestTrade,
      fullyValued: summary.positions.length === valuedPositions,
    }
  }, [quotes, summary])

  if (!summary.totalCapital) {
    return (
      <section className="account-status account-status-empty" aria-labelledby="account-status-title">
        <div className="account-empty-mark" aria-hidden="true"><span /></div>
        <div>
          <span className="eyebrow">PERSONAL CAPITAL LEDGER</span>
          <h2 id="account-status-title">建立你的账户状态</h2>
          <p>设置初始资金并记录交易后，这里会汇总现金、持仓、仓位和最近交易。</p>
        </div>
        <button type="button" onClick={onManage}>去设置账户 <span>→</span></button>
      </section>
    )
  }

  const positionState = getPositionState(account.utilization, summary.cash)
  const latest = account.latestTrade
  return (
    <section className="account-status" aria-labelledby="account-status-title">
      <div className="account-primary">
        <div className="account-title-row">
          <div>
            <span className="eyebrow">ACCOUNT STATUS · 服务端账本</span>
            <h2 id="account-status-title">账户总览</h2>
          </div>
          <button type="button" onClick={onManage}>管理账户 <span>↗</span></button>
        </div>
        <div className="account-equity">
          <span>估算总资产</span>
          <strong className="num"><small>¥</small>{money(account.equity, 2)}</strong>
          <em>{summary.positions.length ? (account.fullyValued ? '按最新行情估算' : '部分持仓暂按成本估算') : '当前为可用资金'}</em>
        </div>
      </div>

      <div className="account-metrics" aria-label="账户资金指标">
        <div><span>可用资金</span><strong className={`num ${summary.cash < 0 ? 'down-value' : ''}`}>¥{money(summary.cash)}</strong></div>
        <div><span>持仓市值</span><strong className="num">¥{money(account.marketValue)}</strong></div>
        <div><span>浮动盈亏</span><strong className={`num ${account.unrealized > 0 ? 'profit' : account.unrealized < 0 ? 'loss' : ''}`}>{account.unrealized >= 0 ? '+' : ''}¥{money(account.unrealized)}</strong></div>
        <div><span>累计印花税</span><strong className="num">¥{money(summary.stampDuty, 2)}</strong></div>
      </div>

      <div className="account-side">
        <div className="account-position-head">
          <div><span>仓位状态</span><strong className={positionState.tone}>{positionState.label}</strong></div>
          <b className="num">{Math.min(account.utilization, 999).toFixed(1)}%</b>
        </div>
        <div className="account-position-track" aria-label={`仓位 ${account.utilization.toFixed(1)}%`}>
          <i style={{ ['--position']: `${Math.min(100, account.utilization)}%` }} />
        </div>
        <p>{positionState.note} · {summary.positions.length} 只持仓</p>
        <div className="account-trade">
          <span>最近交易</span>
          {latest ? (
            <div>
              <b className={latest.side === 'buy' ? 'buy' : 'sell'}>{latest.side === 'buy' ? '买入' : '卖出'}</b>
              <strong>{latest.name || latest.code}</strong>
              <em>{tradeDate(latest.tradeAt)} · {money(latest.quantity)} 股 · ¥{money(latest.amount)}</em>
            </div>
          ) : <small>暂无交易流水</small>}
        </div>
        <div className="account-profile-tags">
          <span>{summary.riskLevel}风险</span><span>{summary.horizon}周期</span><span>{summary.transactions.length} 笔交易</span>
        </div>
      </div>
    </section>
  )
}
