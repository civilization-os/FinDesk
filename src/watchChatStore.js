const CHAT_KEY = 'ff-watchlist-chat-v1'
const MAX_THREADS = 30
const MAX_MESSAGES = 36

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

function normalizeMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null
  const content = String(message.content || '').trim().slice(0, 5000)
  if (!content) return null
  return {
    id: String(message.id || makeId()),
    role: message.role,
    content,
    time: String(message.time || new Date().toISOString()),
    source: message.source === 'deepseek' ? 'deepseek' : undefined,
  }
}

function normalizeAnalysis(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 10).filter((item) => /^\d{6}$/.test(String(item?.code || ''))).map((item) => ({
        code: String(item.code),
        name: String(item.name || '').slice(0, 20),
        rank: Number(item.rank) || 0,
        price: Number(item.price) || 0,
        change_pct: Number(item.change_pct) || 0,
        score: Number(item.score) || 0,
        label: String(item.label || '继续观察').slice(0, 8),
        reason: String(item.reason || '').slice(0, 160),
        risk: String(item.risk || '').slice(0, 160),
        trigger: String(item.trigger || '').slice(0, 180),
        invalidation: String(item.invalidation || '').slice(0, 180),
        allocation_note: String(item.allocation_note || '').slice(0, 180),
        allocation_blocked: !!item.allocation_blocked,
        holding: !!item.holding,
        holding_weight: Number(item.holding_weight) || 0,
        minimum_shares: Number(item.minimum_shares) || 0,
        minimum_lot_value: Number(item.minimum_lot_value) || 0,
        horizon: String(item.horizon || raw.horizon || '波段').slice(0, 8),
        horizon_label: String(item.horizon_label || raw.horizon_label || '波段（中线）').slice(0, 16),
      }))
    : []
  return {
    generated_at: String(raw.generated_at || '').slice(0, 20),
    source: raw.source === 'deepseek' ? 'deepseek' : 'rule',
    summary: String(raw.summary || '').slice(0, 240),
    scope: String(raw.scope || '').slice(0, 360),
    horizon: String(raw.horizon || '波段').slice(0, 8),
    horizon_label: String(raw.horizon_label || '波段（中线）').slice(0, 16),
    style_scope: String(raw.style_scope || '').slice(0, 240),
    items,
  }
}

function normalizeThread(thread) {
  if (!thread || typeof thread !== 'object') return null
  const analysis = normalizeAnalysis(thread.analysis)
  if (!analysis.items.length) return null
  return {
    id: String(thread.id || makeId()),
    title: String(thread.title || '新追问').slice(0, 36),
    createdAt: String(thread.createdAt || new Date().toISOString()),
    updatedAt: String(thread.updatedAt || new Date().toISOString()),
    analysis,
    messages: Array.isArray(thread.messages)
      ? thread.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES)
      : [],
  }
}

export function loadWatchChatThreads() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]')
    return Array.isArray(stored) ? stored.slice(0, MAX_THREADS).map(normalizeThread).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveWatchChatThreads(threads) {
  const safe = Array.isArray(threads) ? threads.slice(0, MAX_THREADS).map(normalizeThread).filter(Boolean) : []
  localStorage.setItem(CHAT_KEY, JSON.stringify(safe))
  return safe
}

export function createWatchChatThread(analysis) {
  const now = new Date().toISOString()
  return { id: makeId(), title: '新追问', createdAt: now, updatedAt: now, analysis: normalizeAnalysis(analysis), messages: [] }
}

export function createWatchChatMessage(role, content, source) {
  return normalizeMessage({ id: makeId(), role, content, source, time: new Date().toISOString() })
}
