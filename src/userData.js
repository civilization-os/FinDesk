const LEGACY_KEYS = {
  profile: 'ff-invest-profile-v1',
  watchlist: 'ff-watch',
  stockChats: 'ff-stock-chat-v1',
  watchlistChats: 'ff-watchlist-chat-v1',
  aiWatchLocks: 'ff-ai-watch-locks-v1',
  alerts: 'ff-alert',
}

const DEFAULT_DATA = Object.freeze({
  version: 1,
  profile: {},
  watchlist: [],
  stockChats: [],
  watchlistChats: [],
  aiWatchLocks: [],
  alerts: { enabled: false, intervalMin: 30 },
})

let cache = { ...DEFAULT_DATA }
let hydratePromise = null
const writeQueues = new Map()

const parseLegacy = (key) => {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

const legacySnapshot = () => Object.fromEntries(
  Object.entries(LEGACY_KEYS)
    .map(([section, key]) => [section, parseLegacy(key)])
    .filter(([, value]) => value !== undefined),
)

const clearLegacy = () => {
  for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key)
}

async function request(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

export function hydrateUserData() {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    const legacy = legacySnapshot()
    try {
      const payload = await request('/api/user-data')
      if (!payload.initialized && Object.keys(legacy).length) {
        const migrated = await request('/api/user-data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...DEFAULT_DATA, ...legacy }),
        })
        cache = { ...DEFAULT_DATA, ...migrated.data }
      } else {
        cache = { ...DEFAULT_DATA, ...(payload.data || {}) }
      }
      clearLegacy()
      return { ok: true, data: cache }
    } catch {
      // 后端暂不可用时只在内存中使用旧数据，不删除，待下次启动继续迁移。
      cache = { ...DEFAULT_DATA, ...legacy }
      return { ok: false, data: cache }
    }
  })()
  return hydratePromise
}

export function getUserDataSection(section) {
  return cache[section]
}

export function saveUserDataSection(section, value) {
  cache = { ...cache, [section]: value }
  const previous = writeQueues.get(section) || Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(() => request(`/api/user-data/${encodeURIComponent(section)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }))
  writeQueues.set(section, next)
  return next.then((payload) => payload.data)
}

