// 数据获取层:优先请求 FastAPI 后端(/api),失败或超时自动回退到模拟数据。
// 后端接口结构与 data/market.js 保持一致,组件几乎无需改动。
import { useEffect, useState } from 'react'
import * as fallback from './data/market.js'
import { startMarketPolling } from './marketSession.js'

const API_BASE = '/api'

async function fetchJSON(url, timeout = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${API_BASE}${url}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// 统一包装:返回 { data, live }。live=true 表示拿到后端真实数据。
// 后端返回 {ok: true, data: ...},成功时必须解包出 data 本体。
async function withFallback(url, fallbackVal, timeout) {
  try {
    const d = await fetchJSON(url, timeout)
    if (d && d.ok === true && d.data !== undefined) return { data: d.data, live: true }
    return { data: fallbackVal, live: false }
  } catch {
    return { data: fallbackVal, live: false }
  }
}

export const getIndices = () => withFallback('/indices', fallback.indices)
export const getMarketStatus = () => withFallback('/market-status', {
  curve: fallback.marketCurve,
  breadth: fallback.breadth,
})
export const getSentiment = () => withFallback('/sentiment', fallback.sentiment)
export const getCapitalFlow = () => withFallback('/capital-flow', fallback.capitalFlow)
export const getSectors = () => withFallback('/sectors', fallback.sectors)
export const getWatchlist = (codes) => {
  const selected = Array.isArray(codes) ? codes.filter((code) => /^\d{6}$/.test(code)) : []
  // 空自选不访问后端，也绝不使用演示列表回填。
  if (!selected.length) return Promise.resolve({ data: [], live: false })
  const selectedSet = new Set(selected)
  const offlineSelected = fallback.watchlist.filter((stock) => selectedSet.has(stock.code))
  return withFallback(`/watchlist?codes=${selected.join(',')}`, offlineSelected)
}
export const getInsights = () => withFallback('/insights', fallback.aiInsights)
export const getRecommendations = () => withFallback('/recommendations', fallback.recommendations)
export async function analyzeWatchlist(codes, profile, { signal } = {}) {
  const selected = Array.isArray(codes)
    ? [...new Set(codes.filter((code) => /^\d{6}$/.test(code)))].slice(0, 10)
    : []
  if (!selected.length) return { ok: false, message: '请先选择自选股' }
  try {
    const res = await fetch('/api/watchlist/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: selected, profile }),
      signal,
    })
    const payload = await res.json()
    if (!res.ok || !payload?.ok || !payload.data) {
      throw new Error(payload?.error || `HTTP ${res.status}`)
    }
    return { ok: true, data: payload.data }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, aborted: true, message: '' }
    return { ok: false, message: error?.message || '分析服务暂时不可用，请稍后重试' }
  }
}
export async function askWatchlistAI(body, { signal } = {}) {
  try {
    const res = await fetch('/api/watchlist/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    const payload = await res.json()
    if (!res.ok || !payload?.ok || !payload.data?.message) {
      throw new Error(payload?.error || `HTTP ${res.status}`)
    }
    return { ok: true, ...payload.data }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, aborted: true, message: '' }
    return { ok: false, message: error?.message || '追问服务暂时不可用，请稍后重试' }
  }
}
export const getMarket = () => withFallback('/market', {
  indices: fallback.market.indices,
  breadth: fallback.breadth,
  sectors: fallback.market.sectors,
})
export const getSectorsAll = () => withFallback('/sectors-all', fallback.sectors)
export const getStock = (code) => withFallback(`/stock/${code}`, null, 15000)
export async function getStockAI(code, profile) {
  try {
    const res = await fetch(`/api/stock/${code}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    })
    const payload = await res.json()
    return payload?.ok && payload.data ? { data: payload.data, live: true } : { data: null, live: false }
  } catch {
    return { data: null, live: false }
  }
}
export async function askStockAI(code, body, { signal } = {}) {
  try {
    const res = await fetch(`/api/stock/${code}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    if (!payload?.ok || !payload.data?.message) throw new Error('empty response')
    return { ok: true, ...payload.data }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, aborted: true, message: '' }
    return { ok: false, message: '暂时无法连接分析服务，请稍后重试。' }
  }
}
export const getHotStocks = () => withFallback('/hot-stocks', fallback.hotStocks)
// 全市场搜索:名称/代码,返回前 15 条;快照缓存于后端
export const searchStocks = (q) =>
  fetchJSON(`/search?q=${encodeURIComponent(q)}`, 25000)
    .then((d) => (d && d.ok ? d.data : []))
    .catch(() => [])

// ---- AI 设置(DeepSeek) ----
export const getSettings = () => withFallback('/settings', {
  enabled: false, model: 'deepseek-chat', base_url: 'https://api.deepseek.com', hasKey: false,
})
export async function saveSettings(body) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    return { ok: !!d.ok }
  } catch {
    return { ok: false }
  }
}
export async function testSettings(body) {
  try {
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    const info = d.data || {}
    return { ok: !!info.ok, message: info.message || '', models: Array.isArray(info.models) ? info.models : [] }
  } catch {
    return { ok: false, message: '请求失败,请检查后端服务', models: [] }
  }
}
// 用已保存的配置获取 DeepSeek 真实模型列表
export const getModels = () =>
  fetchJSON('/settings/models', 10000)
    .then((d) => (d && d.data && d.data.ok ? d.data.models : []))
    .catch(() => [])
export const getHealth = () => fetchJSON('/health', 3000).then(() => true).catch(() => false)

// Dashboard 统一刷新周期(ms):指数每 15s 更新,其余由后端缓存节流
export const REFRESH_MS = 15000

// 通用 hook:先用模拟数据渲染首屏,后端数据到达后平滑替换。
// intervalMs > 0 时开启轮询(如 15000 = 每 15s 刷新);请求失败时保留上一次成功数据,不闪回。
// deps 变化(如自选代码列表)时重新拉取。
export function useLiveData(getter, fallbackData, intervalMs = 0, deps = []) {
  const [state, setState] = useState({ data: fallbackData, live: false, loading: true, error: false })
  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.resolve()
        .then(getter)
        .then(({ data, live }) => {
          if (!alive) return
          // 首次离线访问也要展示 getter 提供的演示数据；仅在已经拿到
          // 实时数据后发生瞬时请求失败时保留上一份成功快照，避免界面闪回。
          setState((prev) => (
            prev.live && !live
              ? { ...prev, loading: false, error: false }
              : { data, live, loading: false, error: false }
          ))
        })
        .catch(() => {
          if (!alive) return
          setState((prev) => ({ ...prev, loading: false, error: true }))
        })
    if (intervalMs > 0) {
      const stopPolling = startMarketPolling(load, intervalMs)
      return () => { alive = false; stopPolling() }
    }
    load()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
