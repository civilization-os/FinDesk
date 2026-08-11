import { useEffect, useMemo, useRef, useState } from 'react'
import { askWatchlistAI } from '../api.js'
import { loadProfile, summarizeProfile } from '../profile.js'
import {
  createWatchChatMessage,
  createWatchChatThread,
  loadWatchChatThreads,
  saveWatchChatThreads,
} from '../watchChatStore.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const timeLabel = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function WatchlistChat({ result, onClose }) {
  const initialThreads = useMemo(loadWatchChatThreads, [])
  const [threads, setThreads] = useState(initialThreads)
  const [activeId, setActiveId] = useState(() => initialThreads.find((thread) => thread.analysis.generated_at === result.generated_at)?.id || null)
  const [profile, setProfile] = useState(loadProfile)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const messageEndRef = useRef(null)
  const inputRef = useRef(null)
  const requestRef = useRef(null)

  const activeThread = threads.find((thread) => thread.id === activeId) || null
  const analysis = activeThread?.analysis || result
  const messages = activeThread?.messages || []
  const items = Array.isArray(analysis?.items) ? analysis.items : []
  const profileSummary = useMemo(() => summarizeProfile(profile), [profile])
  const priorityCount = items.filter((item) => item.label === '优先关注').length
  const blockedCount = items.filter((item) => item.allocation_blocked).length
  const cautionCount = items.filter((item) => item.allocation_caution && !item.allocation_blocked).length

  useEffect(() => {
    const handleProfile = (event) => setProfile(event.detail || loadProfile())
    window.addEventListener('ff-profile-updated', handleProfile)
    return () => window.removeEventListener('ff-profile-updated', handleProfile)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end', behavior: messages.length > 1 ? 'smooth' : 'auto' })
  }, [messages.length, busy])

  useEffect(() => () => requestRef.current?.abort(), [])

  const commitThreads = (updater) => {
    setThreads((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return saveWatchChatThreads(next)
    })
  }

  const stopGeneration = () => {
    if (!requestRef.current) return
    requestRef.current.abort()
    requestRef.current = null
    setBusy(false)
    setInterrupted(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const startNew = () => {
    stopGeneration()
    setActiveId(null)
    setHistoryOpen(false)
    setInput('')
    setInterrupted(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const confirmDelete = () => {
    const id = pendingDelete
    if (!id) return
    commitThreads((current) => current.filter((thread) => thread.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setInterrupted(false)
    }
    setPendingDelete(null)
  }

  const send = async (preset) => {
    const question = String(preset || input).trim()
    if (!question || busy || !items.length) return
    setInput('')
    setBusy(true)
    setInterrupted(false)
    const controller = new AbortController()
    requestRef.current = controller

    let thread = activeThread || createWatchChatThread(result)
    const userMessage = createWatchChatMessage('user', question)
    thread = {
      ...thread,
      title: thread.messages.length ? thread.title : question.slice(0, 22),
      updatedAt: new Date().toISOString(),
      messages: [...thread.messages, userMessage],
    }
    setActiveId(thread.id)
    commitThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)])

    try {
      const response = await askWatchlistAI({
        question,
        analysis: thread.analysis,
        messages: thread.messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
        profile: loadProfile(),
      }, { signal: controller.signal })
      if (controller.signal.aborted || response.aborted) return
      const content = response.ok ? response.message : `暂时无法完成追问：${response.message}`
      const reply = createWatchChatMessage('assistant', content, response.source)
      commitThreads((current) => current.map((item) => item.id === thread.id
        ? { ...item, updatedAt: new Date().toISOString(), messages: [...item.messages, reply] }
        : item))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setBusy(false)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
  }

  const closeChat = () => {
    stopGeneration()
    onClose?.()
  }

  const topNames = items.slice(0, 3).map((item) => item.name).join('、')
  const quickPrompts = [
    '为什么这样排序？',
    '结合我的资金，优先看哪只？',
    '哪只更接近长期技术观察区？',
    blockedCount ? '哪些股票当前资金买不起？' : cautionCount ? '集中度偏高时如何取舍？' : '这批股票最大的共同风险是什么？',
  ]

  return (
    <div className="watch-chat-layer">
      <button className="watch-chat-scrim" type="button" aria-label="关闭优选追问" onClick={closeChat} />
      <aside className="watchlist-chat" role="dialog" aria-modal="true" aria-label="自选股优选追问">
        <header className="stock-chat-head">
          <div className="chat-orb" aria-hidden="true">AI</div>
          <div className="stock-chat-title">
            <strong>优选追问</strong>
            <span>{items.length} 只锁定范围 · 快照 {analysis.generated_at || '当前'}</span>
          </div>
          <button className={`chat-icon-btn ${historyOpen ? 'active' : ''}`} type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="追问历史" title="追问历史">☷</button>
          <button className="chat-icon-btn" type="button" onClick={startNew} aria-label="新建追问" title="新建追问">＋</button>
          <button className="chat-icon-btn" type="button" onClick={closeChat} aria-label="关闭追问">×</button>
        </header>

        <div className="chat-context-strip">
          <span className="ready">分析范围 {items.length}/10</span>
          <span className="ready">{analysis.horizon_label || '波段（中线）'}口径</span>
          <span>{priorityCount} 只优先关注</span>
          {cautionCount ? <span>{cautionCount} 只集中度提醒</span> : null}
          <span className={profileSummary.totalCapital ? 'ready' : ''}>{profileSummary.totalCapital ? `可用 ¥${profileSummary.cash.toLocaleString('zh-CN')}` : '未设置初始资金'}</span>
        </div>

        {historyOpen ? (
          <div className="chat-history-panel">
            <div className="chat-history-head"><b>优选追问历史</b><span>{threads.length} 条</span></div>
            <div className="chat-history-list">
              {threads.map((thread) => (
                <div className={`chat-history-item ${thread.id === activeId ? 'active' : ''}`} key={thread.id}>
                  <button type="button" onClick={() => { stopGeneration(); setInterrupted(false); setActiveId(thread.id); setHistoryOpen(false) }}>
                    <b>{thread.title}</b>
                    <span>{timeLabel(thread.updatedAt)} · {thread.analysis.items.length} 只 · {thread.messages.length} 条消息</span>
                  </button>
                  <button className="history-delete" type="button" aria-label={`删除追问 ${thread.title}`} onClick={() => setPendingDelete(thread.id)}>×</button>
                </div>
              ))}
              {!threads.length ? <div className="chat-history-empty">还没有优选追问历史</div> : null}
            </div>
          </div>
        ) : null}

        <div className="chat-messages" aria-live="polite">
          {!messages.length ? (
            <div className="chat-welcome watch-chat-welcome">
              <span className="eyebrow">LOCKED-UNIVERSE DIALOGUE</span>
              <h3>排序只是起点，继续把问题问深。</h3>
              <p>我会围绕 {topNames || '本次自选股'} 的本次排序、资金适配与失效条件回答，不会推荐范围外股票。</p>
            </div>
          ) : null}
          {messages.map((message) => (
            <div className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-message-meta"><span>{message.role === 'user' ? '你' : 'FinForge AI'}</span><time>{timeLabel(message.time)}</time></div>
              <p>{message.content}</p>
              {message.role === 'assistant' ? <small>{message.source === 'deepseek' ? 'DeepSeek · 绑定本次优选快照' : '量化规则 · 绑定本次优选快照'}</small> : null}
            </div>
          ))}
          {busy ? <div className="chat-thinking"><span /><span /><span /><em>正在结合排序与资金档案回答 · 可随时停止</em></div> : null}
          {interrupted && !busy ? <div className="chat-interrupted"><i />已停止生成，可继续追问</div> : null}
          <div ref={messageEndRef} />
        </div>

        {!messages.length ? (
          <div className="chat-prompts">
            {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}
          </div>
        ) : null}

        <div className="chat-composer">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            maxLength={1000}
            placeholder="继续问排序、仓位、风险或观察条件…"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button
            type="button"
            className={busy ? 'stop-generation' : ''}
            disabled={!busy && !input.trim()}
            onClick={busy ? stopGeneration : () => send()}
            aria-label={busy ? '停止生成' : '发送追问'}
            title={busy ? '停止生成' : '发送追问'}
          >{busy ? <span aria-hidden="true" /> : '↑'}</button>
          <small>Enter 发送 · Shift + Enter 换行</small>
        </div>
        <p className="chat-disclaimer">回答只基于本次锁定范围与资金档案，不扩展推荐其他股票；历史保存在服务端。</p>
      </aside>

      <ConfirmDialog
        open={!!pendingDelete}
        eyebrow="DELETE RESEARCH THREAD"
        title="删除这段优选追问？"
        description="这段对话及其绑定的优选快照将从服务端永久删除，删除后无法恢复。"
        confirmText="删除追问"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
