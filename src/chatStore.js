import { getUserDataSection, saveUserDataSection } from './userData.js'

const MAX_THREADS = 40

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

function normalizeMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null
  const content = String(message.content || '').trim().slice(0, 4000)
  if (!content) return null
  return {
    id: String(message.id || makeId()),
    role: message.role,
    content,
    time: String(message.time || new Date().toISOString()),
    source: message.source === 'deepseek' ? 'deepseek' : undefined,
  }
}

export function loadChatThreads() {
  const value = getUserDataSection('stockChats')
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_THREADS).map((thread) => ({
    id: String(thread.id || makeId()),
    code: /^\d{6}$/.test(String(thread.code || '')) ? String(thread.code) : '',
    name: String(thread.name || '').slice(0, 20),
    title: String(thread.title || '新对话').slice(0, 32),
    createdAt: String(thread.createdAt || new Date().toISOString()),
    updatedAt: String(thread.updatedAt || new Date().toISOString()),
    messages: Array.isArray(thread.messages) ? thread.messages.map(normalizeMessage).filter(Boolean).slice(-30) : [],
  })).filter((thread) => thread.code)
}

export function saveChatThreads(threads) {
  const safe = Array.isArray(threads) ? threads.slice(0, MAX_THREADS) : []
  void saveUserDataSection('stockChats', safe).catch(() => {})
  return safe
}

export function createChatThread(code, name = '') {
  const now = new Date().toISOString()
  return { id: makeId(), code, name, title: '新对话', createdAt: now, updatedAt: now, messages: [] }
}

export function createChatMessage(role, content, source) {
  return normalizeMessage({ id: makeId(), role, content, source, time: new Date().toISOString() })
}
