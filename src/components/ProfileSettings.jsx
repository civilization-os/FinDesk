import { useMemo, useState } from 'react'
import { DEFAULT_PROFILE, calculateStampDuty, derivePositions, loadProfile, saveProfile, summarizeProfile } from '../profile.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const money = (value, digits = 0) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const localDateTime = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}
const makeId = () => globalThis.crypto?.randomUUID?.() || `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`
const emptyTrade = () => ({ tradeAt: localDateTime(), side: 'buy', code: '', name: '', price: '', quantity: '' })
const percentage = (value) => Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 3 })

function loadEditableProfile() {
  const profile = loadProfile()
  if (profile.transactions.length || !profile.positions.length) return profile
  const migrated = profile.positions.flatMap((position) => {
    const price = Number(position.costPrice || 0)
    const quantity = Number(position.quantity || (price ? Math.floor(position.amount / price) : 0))
    if (!price || !quantity) return []
    return [{ id: makeId(), tradeAt: profile.updatedAt?.slice(0, 19) || localDateTime(), createdAt: profile.updatedAt || new Date().toISOString(), side: 'buy', code: position.code, name: position.name, price, quantity, amount: price * quantity, stampDuty: 0 }]
  })
  return migrated.length ? { ...profile, transactions: migrated, positions: derivePositions(migrated) } : profile
}

export default function ProfileSettings() {
  const [profile, setProfile] = useState(loadEditableProfile)
  const [draft, setDraft] = useState(emptyTrade)
  const [message, setMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingTrade, setPendingTrade] = useState(null)
  const summary = useMemo(() => summarizeProfile(profile), [profile])
  const draftAmount = Number(draft.price || 0) * Number(draft.quantity || 0)
  const draftStampDuty = calculateStampDuty(draft.side, draftAmount, profile.stampDutyRate)
  const currentPosition = summary.positions.find((item) => item.code === draft.code)
  const exceedsHolding = draft.side === 'sell' && Number(draft.quantity || 0) > Number(currentPosition?.quantity || 0)
  const draftReady = /^\d{6}$/.test(draft.code) && Number(draft.price) > 0 && Number(draft.quantity) > 0 && !!draft.tradeAt && !exceedsHolding
  const overAllocated = summary.totalCapital > 0 && summary.cash < 0
  const canSave = summary.totalCapital > 0 && !overAllocated

  const patchDraft = (key, value) => {
    setMessage('')
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const addTrade = () => {
    if (!draftReady) return
    const trade = {
      id: makeId(),
      tradeAt: draft.tradeAt,
      createdAt: new Date().toISOString(),
      side: draft.side,
      code: draft.code,
      name: draft.name.trim(),
      price: Number(draft.price),
      quantity: Math.floor(Number(draft.quantity)),
      amount: Math.round(draftAmount * 100) / 100,
      stampDuty: draftStampDuty,
    }
    setProfile((current) => ({ ...current, transactions: [trade, ...(current.transactions || [])] }))
    setDraft((current) => ({ ...emptyTrade(), tradeAt: current.tradeAt, side: current.side }))
    setMessage('交易已加入流水，保存投资档案后生效。')
  }

  const removeTrade = () => {
    setProfile((current) => ({ ...current, transactions: current.transactions.filter((item) => item.id !== pendingTrade) }))
    setPendingTrade(null)
    setMessage('交易记录已移除，保存后生效。')
  }

  const handleSave = () => {
    if (!canSave) return
    const saved = saveProfile(profile)
    setProfile(saved)
    setMessage('投资档案已保存，当前持仓、成本和税费已同步到 AI 对话。')
  }

  const clearProfile = () => {
    const cleared = saveProfile({ ...DEFAULT_PROFILE, transactions: [], positions: [] })
    setProfile(cleared)
    setConfirmClear(false)
    setMessage('投资档案已清空。')
  }

  const sortedTrades = [...(profile.transactions || [])].sort((a, b) => {
    const byTradeTime = String(b.tradeAt).localeCompare(String(a.tradeAt))
    return byTradeTime || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  })

  return (
    <section className="card profile-card" style={{ ['--d']: '0ms' }} aria-labelledby="profile-title">
      <div className="card-title profile-title-row">
        <div>
          <span className="eyebrow">INVESTOR PROFILE</span>
          <h2 id="profile-title">投资账户</h2>
        </div>
        <span className="profile-local-badge">仅保存在本机</span>
      </div>

      <div className="profile-ledger trade-summary">
        <div><span>初始资金</span><b className="num">¥ {money(summary.totalCapital)}</b></div>
        <div><span>持仓成本</span><b className="num">¥ {money(summary.invested)}</b></div>
        <div><span>{summary.cash < 0 ? '资金缺口' : '可用资金'}</span><b className={`num ${summary.cash < 0 ? 'up' : ''}`}>¥ {money(Math.abs(summary.cash))}</b></div>
        <div><span>持仓占比</span><b className="num">{summary.investedPct.toFixed(1)}%</b></div>
        <div><span>累计印花税</span><b className="num">¥ {money(summary.stampDuty, 2)}</b></div>
      </div>

      <div className="profile-fields">
        <div className="set-field">
          <label htmlFor="profile-total">初始资金（元）</label>
          <div className="money-input"><span>¥</span><input id="profile-total" type="number" min="0" step="1000" inputMode="decimal" value={profile.totalCapital || ''} onChange={(event) => setProfile((current) => ({ ...current, totalCapital: event.target.value }))} placeholder="例如 500000" /></div>
        </div>
        <div className="set-field">
          <label htmlFor="profile-risk">风险偏好</label>
          <select id="profile-risk" className="set-select" value={profile.riskLevel} onChange={(event) => setProfile((current) => ({ ...current, riskLevel: event.target.value }))}>
            <option>保守</option><option>稳健</option><option>进取</option>
          </select>
        </div>
        <div className="set-field">
          <label htmlFor="profile-horizon">主要周期</label>
          <select id="profile-horizon" className="set-select" value={profile.horizon} onChange={(event) => setProfile((current) => ({ ...current, horizon: event.target.value }))}>
            <option>短线</option><option>波段</option><option>中长线</option>
          </select>
        </div>
        <div className="set-field">
          <label htmlFor="profile-stamp-rate">卖出印花税率（%）</label>
          <div className="rate-input"><input id="profile-stamp-rate" type="number" min="0" max="5" step="0.01" inputMode="decimal" value={profile.stampDutyRate ?? ''} onChange={(event) => setProfile((current) => ({ ...current, stampDutyRate: event.target.value }))} aria-describedby="stamp-rate-hint" /><span>%</span></div>
        </div>
      </div>

      <div className="allocation-head trade-head">
        <div><h3>交易流水</h3><p>记录什么时候、买卖了什么、成交价与股数；持仓和成本由流水自动汇总。</p></div>
        <span className="tax-rule">印花税 · 买入 0 / 卖出 {percentage(profile.stampDutyRate)}%</span>
      </div>

      <div className="trade-entry" aria-label="添加交易记录">
        <div className="trade-field wide"><label htmlFor="trade-time">成交时间</label><input id="trade-time" type="datetime-local" step="1" value={draft.tradeAt} onChange={(event) => patchDraft('tradeAt', event.target.value)} /></div>
        <div className="trade-field side"><label htmlFor="trade-side">方向</label><select id="trade-side" value={draft.side} onChange={(event) => patchDraft('side', event.target.value)}><option value="buy">买入</option><option value="sell">卖出</option></select></div>
        <div className="trade-field"><label htmlFor="trade-code">股票代码</label><input id="trade-code" inputMode="numeric" maxLength={6} value={draft.code} onChange={(event) => patchDraft('code', event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="002148" /></div>
        <div className="trade-field"><label htmlFor="trade-name">股票名称</label><input id="trade-name" value={draft.name} onChange={(event) => patchDraft('name', event.target.value.slice(0, 16))} placeholder="可选" /></div>
        <div className="trade-field"><label htmlFor="trade-price">成交价</label><input id="trade-price" type="number" min="0" step="0.01" inputMode="decimal" value={draft.price} onChange={(event) => patchDraft('price', event.target.value)} placeholder="6.20" /></div>
        <div className="trade-field"><label htmlFor="trade-quantity">数量（股）</label><input id="trade-quantity" type="number" min="1" step="100" inputMode="numeric" value={draft.quantity} onChange={(event) => patchDraft('quantity', event.target.value)} placeholder="1000" /></div>
        <div className="trade-preview">
          <span><small>成交金额</small><b className="num">¥ {money(draftAmount, 2)}</b></span>
          <span><small>印花税</small><b className="num">¥ {money(draftStampDuty, 2)}</b></span>
          <button type="button" disabled={!draftReady} onClick={addTrade}>加入流水</button>
        </div>
      </div>
      {exceedsHolding && <p className="profile-warning">卖出数量超过当前持有的 {money(currentPosition?.quantity || 0)} 股。</p>}
      <p className="tax-hint" id="stamp-rate-hint">买入不计；卖出按成交金额 × {percentage(profile.stampDutyRate)}% 自动估算。修改税率只影响之后新加入的流水，历史税额保持不变；实际金额以券商交割单为准。</p>

      <div className="trade-list" role="table" aria-label="股票交易流水">
        <div className="trade-list-labels" role="row"><span>时间</span><span>交易</span><span>成交明细</span><span>成交金额</span><span>印花税</span><span /></div>
        {sortedTrades.map((trade) => (
          <div className="trade-row" role="row" key={trade.id}>
            <time>{trade.tradeAt?.slice(0, 10)}<small>{trade.tradeAt?.slice(11, 19)}</small></time>
            <div className="trade-security"><span className={`trade-side ${trade.side}`}>{trade.side === 'buy' ? '买入' : '卖出'}</span><b>{trade.name || trade.code}</b><small>{trade.name ? trade.code : ''}</small></div>
            <div className="trade-detail"><b className="num">{money(trade.quantity)} 股</b><small className="num">@ ¥ {money(trade.price, 2)}</small></div>
            <b className="trade-amount num">¥ {money(trade.amount, 2)}</b>
            <div className="trade-tax"><b className="num">¥ {money(trade.stampDuty, 2)}</b><small>{trade.side === 'sell' ? '卖方计税' : '买入免征'}</small></div>
            <button type="button" className="allocation-remove" aria-label={`删除 ${trade.code} 交易记录`} onClick={() => setPendingTrade(trade.id)}>×</button>
          </div>
        ))}
        {!sortedTrades.length && <div className="trade-empty"><span>↗</span><b>还没有交易记录</b><small>上方录入第一笔成交后，系统会自动生成当前持仓。</small></div>}
      </div>

      {overAllocated && <p className="profile-warning">交易流水造成资金缺口 ¥ {money(Math.abs(summary.cash))}，请核对初始资金或成交记录后保存。</p>}
      {message && <div className="set-msg ok">{message}</div>}

      <div className="profile-actions">
        <button className="btn-primary" type="button" disabled={!canSave} onClick={handleSave}>保存投资档案</button>
        {summary.totalCapital > 0 && <button className="btn-ghost profile-clear" type="button" onClick={() => setConfirmClear(true)}>清空档案</button>}
        <span>{summary.positions.length ? `当前汇总 ${summary.positions.length} 只持仓 · ${money(summary.positions.reduce((sum, item) => sum + item.quantity, 0))} 股` : '保存后，AI 对话会读取交易流水与当前持仓。'}</span>
      </div>

      <ConfirmDialog open={confirmClear} eyebrow="CLEAR INVESTOR PROFILE" title="清空投资档案？" description="初始资金、投资偏好和全部交易流水将被清除。这个操作无法撤销，但不会影响自选股。" confirmText="确认清空" onConfirm={clearProfile} onCancel={() => setConfirmClear(false)} />
      <ConfirmDialog open={!!pendingTrade} eyebrow="DELETE TRANSACTION" title="删除这笔交易？" description="删除后会重新计算可用资金、持仓数量、平均成本和累计印花税。" confirmText="删除记录" onConfirm={removeTrade} onCancel={() => setPendingTrade(null)} />
    </section>
  )
}
