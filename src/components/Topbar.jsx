import { IconSearch, IconBell, IconCalendar, IconSun, IconMoon, IconMenu } from './icons.jsx'

const PAGES = {
  home: ['首页', '把握今日行情脉搏'],
  market: ['市场', '全景行情与资金动向'],
  stocks: ['股票', '自选与个股追踪'],
  sectors: ['板块', '行业轮动与热点'],
  strategy: ['策略', '回测与信号组合'],
  ai: ['AI 分析', '智能解读与预警'],
  settings: ['设置', 'AI 模型与偏好'],
}

function today() {
  const d = new Date()
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${wd}`
}

export default function Topbar({ page, theme, onToggleTheme, onMenu, live, search, onSearchChange, onSearchSubmit, onNotify }) {
  const [title, desc] = PAGES[page] || PAGES.home
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="打开导航菜单">
        <IconMenu size={18} />
      </button>
      <div className="page-title">
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>

      <div className="search">
        <span className="search-icon"><IconSearch size={16} /></span>
        <input
          type="search"
          placeholder="搜索自选股代码、名称,输入 6 位代码回车看详情"
          aria-label="搜索"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit?.(search)}
        />
        {search && (
          <button className="search-clear" onClick={() => onSearchChange('')} aria-label="清空">×</button>
        )}
      </div>

      <div className="topbar-right">
        <span className="live-badge" title={live ? '数据来自 akshare 实时行情' : '未连接后端,显示内置演示数据'}>
          <span className={`dot ${live ? 'live' : 'demo'}`} />
          {live === null ? '连接中…' : live ? '实时行情' : '演示数据'}
        </span>
        <span className="date-chip">
          <IconCalendar size={14} />
          {today()}
        </span>
        <button className="icon-btn" onClick={onToggleTheme} aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}>
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
        <button className="icon-btn" onClick={onNotify} aria-label="通知">
          <IconBell size={17} />
        </button>
        <div className="avatar" title="FinForge 工作台" aria-label="FinForge 工作台">F</div>
      </div>
    </header>
  )
}
