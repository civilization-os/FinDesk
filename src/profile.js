const PROFILE_KEY = 'ff-invest-profile-v1'

export const DEFAULT_PROFILE = Object.freeze({
  version: 2,
  totalCapital: 0,
  stampDutyRate: 0.05,
  riskLevel: '稳健',
  horizon: '波段',
  transactions: [],
  positions: [],
  updatedAt: '',
})

const numberOrZero = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export function calculateStampDuty(side, amount, ratePercent = DEFAULT_PROFILE.stampDutyRate) {
  if (side !== 'sell') return 0
  return roundMoney(numberOrZero(amount) * numberOrZero(ratePercent) / 100)
}

function normalizeTransaction(item, stampDutyRate) {
  if (!item || typeof item !== 'object') return null
  const code = String(item.code || '').trim()
  const price = numberOrZero(item.price)
  const quantity = Math.floor(numberOrZero(item.quantity))
  if (!/^\d{6}$/.test(code) || price <= 0 || quantity <= 0) return null
  const side = item.side === 'sell' ? 'sell' : 'buy'
  const amount = roundMoney(price * quantity)
  const tradeAt = String(item.tradeAt || item.tradeDate || '').slice(0, 19)
  return {
    id: String(item.id || `${code}-${tradeAt}-${Math.random().toString(16).slice(2)}`),
    tradeAt,
    createdAt: String(item.createdAt || item.tradeAt || new Date().toISOString()),
    side,
    code,
    name: String(item.name || '').trim().slice(0, 16),
    price,
    quantity,
    amount,
    stampDuty: item.stampDuty == null
      ? calculateStampDuty(side, amount, stampDutyRate)
      : roundMoney(numberOrZero(item.stampDuty)),
  }
}

export function derivePositions(transactions) {
  const ledger = new Map()
  const ordered = [...transactions].sort((a, b) => {
    const byTradeTime = String(a.tradeAt).localeCompare(String(b.tradeAt))
    return byTradeTime || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  })
  for (const trade of ordered) {
    const current = ledger.get(trade.code) || { code: trade.code, name: trade.name, shares: 0, cost: 0 }
    if (trade.name) current.name = trade.name
    if (trade.side === 'buy') {
      current.shares += trade.quantity
      current.cost += trade.amount
    } else if (current.shares > 0) {
      const sold = Math.min(trade.quantity, current.shares)
      const averageCost = current.cost / current.shares
      current.shares -= sold
      current.cost = Math.max(0, current.cost - averageCost * sold)
    }
    if (current.shares < 0.0001) {
      current.shares = 0
      current.cost = 0
    }
    ledger.set(trade.code, current)
  }
  return [...ledger.values()]
    .filter((item) => item.shares > 0)
    .map((item) => ({
      id: item.code,
      code: item.code,
      name: item.name,
      quantity: item.shares,
      amount: roundMoney(item.cost),
      costPrice: roundMoney(item.cost / item.shares),
    }))
}

function normalizeLegacyPositions(raw) {
  return Array.isArray(raw.positions)
    ? raw.positions
        .filter((item) => item && /^\d{6}$/.test(String(item.code || '').trim()))
        .slice(0, 50)
        .map((item) => ({
          id: String(item.id || item.code),
          code: String(item.code).trim(),
          name: String(item.name || '').trim().slice(0, 16),
          quantity: Math.floor(numberOrZero(item.quantity)),
          amount: numberOrZero(item.amount),
          costPrice: numberOrZero(item.costPrice),
        }))
    : []
}

export function normalizeProfile(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const stampDutyRate = raw.stampDutyRate == null
    ? DEFAULT_PROFILE.stampDutyRate
    : Math.min(5, numberOrZero(raw.stampDutyRate))
  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions.map((item) => normalizeTransaction(item, stampDutyRate)).filter(Boolean).slice(0, 300)
    : []
  const positions = transactions.length ? derivePositions(transactions) : normalizeLegacyPositions(raw)

  return {
    version: 2,
    totalCapital: numberOrZero(raw.totalCapital),
    stampDutyRate,
    riskLevel: ['保守', '稳健', '进取'].includes(raw.riskLevel) ? raw.riskLevel : '稳健',
    horizon: ['短线', '波段', '中长线'].includes(raw.horizon) ? raw.horizon : '波段',
    transactions,
    positions,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

export function loadProfile() {
  try {
    const stored = localStorage.getItem(PROFILE_KEY)
    return stored ? normalizeProfile(JSON.parse(stored)) : { ...DEFAULT_PROFILE, transactions: [], positions: [] }
  } catch {
    return { ...DEFAULT_PROFILE, transactions: [], positions: [] }
  }
}

export function saveProfile(profile) {
  const next = normalizeProfile({ ...profile, updatedAt: new Date().toISOString() })
  next.updatedAt = new Date().toISOString()
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('ff-profile-updated', { detail: next }))
  return next
}

export function summarizeProfile(profile) {
  const normalized = normalizeProfile(profile)
  const invested = normalized.positions.reduce((sum, item) => sum + item.amount, 0)
  const bought = normalized.transactions.filter((item) => item.side === 'buy').reduce((sum, item) => sum + item.amount, 0)
  const sold = normalized.transactions.filter((item) => item.side === 'sell').reduce((sum, item) => sum + item.amount, 0)
  const stampDuty = normalized.transactions.reduce((sum, item) => sum + item.stampDuty, 0)
  const cash = normalized.transactions.length
    ? normalized.totalCapital - bought + sold - stampDuty
    : normalized.totalCapital - invested
  const investedPct = normalized.totalCapital > 0 ? invested / normalized.totalCapital * 100 : 0
  return { ...normalized, invested, bought, sold, stampDuty: roundMoney(stampDuty), cash: roundMoney(cash), investedPct }
}

export function getPosition(profile, code) {
  return normalizeProfile(profile).positions.find((item) => item.code === code) || null
}
