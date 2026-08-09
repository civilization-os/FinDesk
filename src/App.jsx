import { useState, useEffect, useCallback, useRef } from 'react'
import { getHealth, getInsights } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import MarketPage from './components/MarketPage.jsx'
import StockPage from './components/StockPage.jsx'
import SectorPage from './components/SectorPage.jsx'
import AIPage from './components/AIPage.jsx'
import StrategyPage from './components/StrategyPage.jsx'
import SettingsPage from './components/SettingsPage.jsx'
import StockDetail from './components/StockDetail.jsx'
import NotificationPanel from './components/NotificationPanel.jsx'
import IndexCards from './components/IndexCards.jsx'
import InsightStrip from './components/InsightStrip.jsx'
import MarketStatus from './components/MarketStatus.jsx'
import SentimentCard from './components/SentimentCard.jsx'
import CapitalFlow from './components/CapitalFlow.jsx'
import SectorRank from './components/SectorRank.jsx'
import Watchlist from './components/Watchlist.jsx'
import AccountStatus from './components/AccountStatus.jsx'
import { getUserDataSection, saveUserDataSection } from './userData.js'

function loadWatchCodes() {
  const stored = getUserDataSection('watchlist')
  return Array.isArray(stored)
    ? [...new Set(stored.filter((code) => typeof code === 'string' && /^\d{6}$/.test(code)))]
    : []
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ff-theme') || 'light')
  const [page, setPage] = useState('home')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [live, setLive] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedStock, setSelectedStock] = useState(null)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [watchCodes, setWatchCodes] = useState(loadWatchCodes)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ff-theme', theme)
  }, [theme])

  useEffect(() => {
    void saveUserDataSection('watchlist', watchCodes).catch(() => {})
  }, [watchCodes])

  useEffect(() => {
    let alive = true
    const check = () => getHealth().then((ok) => { if (alive) setLive(ok) })
    check()
    const id = setInterval(check, 30000) // 每 30s 探测后端,更新「实时/演示」徽章
    return () => { alive = false; clearInterval(id) }
  }, [])

  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  // 盘中周期提示:按设置周期拉取最新洞察,自动弹面板 + 系统通知
  useEffect(() => {
    const cfg = { enabled: false, intervalMin: 30, ...(getUserDataSection('alerts') || {}) }
    if (!cfg.enabled) return

    const fire = async () => {
      if (!aliveRef.current) return
      const { data } = await getInsights()
      if (aliveRef.current && Array.isArray(data) && data.length) {
        setNotifyOpen(true)
        if ('Notification' in window && Notification.permission === 'granted') {
          const t = data[0]
          const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          try {
            new Notification(`FinForge 盘中提示 · ${time}`, { body: `${t.tag}: ${t.text}` })
          } catch { /* 系统通知失败忽略 */ }
        }
      }
    }
    const id = setInterval(fire, cfg.intervalMin * 60000)
    return () => clearInterval(id)
  }, [])

  const openStock = useCallback((code) => setSelectedStock(code), [])
  const closeStock = useCallback(() => setSelectedStock(null), [])
  const gotoMarket = useCallback(() => { setPage('market'); setMobileOpen(false) }, [])
  const gotoSettings = useCallback(() => { setPage('settings'); setMobileOpen(false) }, [])

  const toggleStock = useCallback((code) => {
    setWatchCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }, [])
  const removeStock = useCallback((code) => {
    setWatchCodes((prev) => prev.filter((c) => c !== code))
  }, [])

  // 搜索框回车:6 位数字代码直接打开个股详情
  const onSearchSubmit = useCallback((kw) => {
    const t = kw.trim()
    if (/^\d{6}$/.test(t)) openStock(t)
  }, [openStock])

  const marketSession = (() => {
    const now = new Date()
    const minutes = now.getHours() * 60 + now.getMinutes()
    const tradingDay = now.getDay() > 0 && now.getDay() < 6
    if (!tradingDay) return '周末休市'
    if (minutes < 9 * 60 + 15) return '盘前准备'
    if (minutes <= 15 * 60) return '交易时段'
    return '盘后复盘'
  })()

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar
        active={page}
        onNavigate={setPage}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <button className="sidebar-scrim" type="button" aria-label="关闭导航菜单" onClick={() => setMobileOpen(false)} />
      )}

      <main className="main">
        <Topbar
          page={page}
          theme={theme}
          live={live}
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={onSearchSubmit}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onMenu={() => setMobileOpen(true)}
          onNotify={() => setNotifyOpen(true)}
        />

        <div className="content">
          <ErrorBoundary>
            {page === 'market' && <MarketPage onOpenStock={openStock} />}
            {page === 'stocks' && (
              <StockPage
                search={search}
                codes={watchCodes}
                onRemoveStock={removeStock}
                onOpenStock={openStock}
                onToggleStock={toggleStock}
              />
            )}
            {page === 'sectors' && <SectorPage onOpenStock={openStock} />}
            {page === 'ai' && <AIPage watchCodes={watchCodes} onOpenStock={openStock} />}
            {page === 'settings' && <SettingsPage />}
            {page === 'strategy' && <StrategyPage />}
            {page === 'home' && (
              <div className="dashboard-home">
                <section className="dashboard-intro" aria-labelledby="brief-title">
                  <div className="brief-copy">
                    <span className="eyebrow">DAILY MARKET BRIEF · A 股</span>
                    <h2 id="brief-title">把市场噪音，整理成清晰信号。</h2>
                    <p>指数、情绪、资金与智能洞察，在同一张工作台同步更新。</p>
                  </div>
                  <div className="brief-actions">
                    <div className="session-stamp">
                      <span className="session-dot" />
                      <span>当前状态</span>
                      <strong>{marketSession}</strong>
                    </div>
                    <button className="market-entry" type="button" onClick={gotoMarket}>
                      市场全景 <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </section>
                <AccountStatus onManage={gotoSettings} />
                <IndexCards onOpen={gotoMarket} />
                <InsightStrip />
                <div className="status-layout" style={{ marginBottom: 16 }}>
                  <MarketStatus />
                  <SentimentCard />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <CapitalFlow />
                </div>
                <div className="grid grid-2">
                  <SectorRank onOpenStock={openStock} />
                  <Watchlist codes={watchCodes} onRemoveStock={removeStock} onOpenStock={openStock} />
                </div>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </main>

      {selectedStock && (
        <StockDetail
          code={selectedStock}
          watched={watchCodes.includes(selectedStock)}
          onToggleWatch={toggleStock}
          onClose={closeStock}
        />
      )}
      {notifyOpen && <NotificationPanel onClose={() => setNotifyOpen(false)} />}
    </div>
  )
}
