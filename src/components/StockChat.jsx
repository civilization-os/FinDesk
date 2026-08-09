import { useEffect, useMemo, useRef, useState } from 'react'
import { askStockAI } from '../api.js'
import { createChatMessage, createChatThread, loadChatThreads, saveChatThreads } from '../chatStore.js'
import { getPosition, loadProfile, summarizeProfile } from '../profile.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const timeLabel = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function StockChat({ code, name, onClose }) {
  const [threads, setThreads] = useState(loadChatThreads)
  const [activeId, setActiveId] = useState(() => loadChatThreads().find((thread) => thread.code === code)?.id || null)
  const [profile, setProfile] = useState(loadProfile)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const messageEndRef = useRef(null)
  const inputRef = useRef(null)
  const requestRef = useRef(null)

  const stockThreads = useMemo(() => threads.filter((thread) => thread.code === code), [threads, code])
  const activeThread = threads.find((thread) => thread.id === activeId && thread.code === code) || null
  const profileSummary = useMemo(() => summarizeProfile(profile), [profile])
  const position = useMemo(() => getPosition(profile, code), [profile, code])
  const messages = activeThread?.messages || []

  useEffect(() => {
    const handleProfile = (event) => setProfile(event.detail || loadProfile())
    window.addEventListener('ff-profile-updated', handleProfile)
    return () => window.removeEventListener('ff-profile-updated', handleProfile)
  }, [])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end', behavior: messages.length > 1 ? 'smooth' : 'auto' })
  }, [messages.length, busy])

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => () => {
    requestRef.current?.abort()
    requestRef.current = null
  }, [])

  const commitThreads = (updater) => {
    setThreads((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      saveChatThreads(next)
      return next
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

  const deleteThread = (id) => {
    if (pendingDelete !== id) {
      setPendingDelete(id)
      return
    }
    commitThreads((current) => current.filter((thread) => thread.id !== id))
    if (activeId === id) setActiveId(null)
    setPendingDelete(null)
  }

  const send = async (preset) => {
    const question = String(preset || input).trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)
    setInterrupted(false)
    const controller = new AbortController()
    requestRef.current = controller

    let thread = activeThread || createChatThread(code, name)
    const userMessage = createChatMessage('user', question)
    thread = {
      ...thread,
      title: thread.messages.length ? thread.title : question.slice(0, 18),
      updatedAt: new Date().toISOString(),
      messages: [...thread.messages, userMessage],
    }
    setActiveId(thread.id)
    commitThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)])

    try {
      const result = await askStockAI(code, {
        question,
        messages: thread.messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
        profile: loadProfile(),
      }, { signal: controller.signal })
      if (controller.signal.aborted || result.aborted) return
      const reply = createChatMessage('assistant', result.message, result.source)
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

  const quickPrompts = position?.amount
    ? ['当前仓位是否过重？', '结合成本价，我该关注哪些风险？', '如果跌破支撑位，仓位怎么评估？']
    : ['这只股票适合我的资金配置吗？', '如果考虑买入，需要等待什么条件？', '当前主要风险是什么？']

  return (
    <aside className="stock-chat" aria-label={`${name} AI 持仓对话`} onClick={(event) => event.stopPropagation()}>
      <header className="stock-chat-head">
        <div className="chat-orb" aria-hidden="true">AI</div>
        <div className="stock-chat-title">
          <strong>持仓对话</strong>
          <span>{name} · {code}</span>
        </div>
        <button className={`chat-icon-btn ${historyOpen ? 'active' : ''}`} type="button" onClick={() => setHistoryOpen((value) => !value)} aria-label="对话历史" title="对话历史">☷</button>
        <button className="chat-icon-btn" type="button" onClick={startNew} aria-label="新建对话" title="新建对话">＋</button>
        <button className="chat-icon-btn" type="button" onClick={onClose} aria-label="关闭对话">×</button>
      </header>

      <div className="chat-context-strip">
        <span className={profileSummary.totalCapital ? 'ready' : ''}>{profileSummary.totalCapital ? `初始资金 ¥${profileSummary.totalCapital.toLocaleString('zh-CN')}` : '未设置初始资金'}</span>
        <span>{position?.amount ? `本股 ${profileSummary.totalCapital ? (Number(position.amount) / profileSummary.totalCapital * 100).toFixed(1) : '—'}%` : '本股未配置'}</span>
        <span>{profileSummary.riskLevel} · {profileSummary.horizon}</span>
      </div>

      {historyOpen && (
        <div className="chat-history-panel">
          <div className="chat-history-head"><b>对话历史</b><span>{stockThreads.length} 条</span></div>
          <div className="chat-history-list">
            {stockThreads.map((thread) => (
              <div className={`chat-history-item ${thread.id === activeId ? 'active' : ''}`} key={thread.id}>
                <button type="button" onClick={() => { stopGeneration(); setInterrupted(false); setActiveId(thread.id); setHistoryOpen(false) }}>
                  <b>{thread.title}</b><span>{timeLabel(thread.updatedAt)} · {thread.messages.length} 条消息</span>
                </button>
                <button className="history-delete" type="button" aria-label={`删除对话 ${thread.title}`} onClick={() => deleteThread(thread.id)}>×</button>
              </div>
            ))}
            {!stockThreads.length && <div className="chat-history-empty">这只股票还没有对话历史</div>}
          </div>
        </div>
      )}

      <div className="chat-messages" aria-live="polite">
        {!messages.length && (
          <div className="chat-welcome">
            <span className="eyebrow">POSITION-AWARE RESEARCH</span>
            <h3>问得越具体，仓位建议越有用。</h3>
            <p>{profileSummary.totalCapital
              ? `我会结合你的初始资金、${profileSummary.investedPct.toFixed(1)}% 资金使用率、当前持仓与 ${name} 行情回答。`
              : '先去设置页补充初始资金和交易流水，我就能判断资金使用率与单股集中度。'}</p>
          </div>
        )}
        {messages.map((message) => (
          <div className={`chat-message ${message.role}`} key={message.id}>
            <div className="chat-message-meta"><span>{message.role === 'user' ? '你' : 'FinForge AI'}</span><time>{timeLabel(message.time)}</time></div>
            <p>{message.content}</p>
            {message.role === 'assistant' && <small>{message.source === 'deepseek' ? 'DeepSeek · 结合当前档案' : '量化规则 · 模型未启用或暂不可用'}</small>}
          </div>
        ))}
        {busy && <div className="chat-thinking"><span /><span /><span /><em>正在结合仓位与行情分析 · 可随时停止</em></div>}
        {interrupted && !busy && <div className="chat-interrupted"><i />已停止生成，可继续追问</div>}
        <div ref={messageEndRef} />
      </div>

      {!messages.length && (
        <div className="chat-prompts">
          {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => send(prompt)}>{prompt}</button>)}
        </div>
      )}

      <div className="chat-composer">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          maxLength={1000}
          placeholder={`问问 ${name} 的仓位、成本或风险…`}
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
          aria-label={busy ? '停止生成' : '发送问题'}
          title={busy ? '停止生成' : '发送问题'}
        >{busy ? <span aria-hidden="true" /> : '↑'}</button>
        <small>Enter 发送 · Shift + Enter 换行</small>
      </div>
      <p className="chat-disclaimer">AI 回答仅作研究参考，不构成确定性买卖指令；资金档案仅用于生成当前回答。</p>
      <ConfirmDialog
        open={!!pendingDelete}
        eyebrow="DELETE CONVERSATION"
        title="删除这段对话？"
        description="这段持仓分析历史将从服务端永久删除，删除后无法恢复。"
        confirmText="删除对话"
        onConfirm={() => deleteThread(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  )
}
