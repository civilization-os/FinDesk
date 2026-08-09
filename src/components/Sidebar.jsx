import {
  IconHome, IconMarket, IconStock, IconSector, IconStrategy, IconAI, IconCollapse, IconSettings,
} from './icons.jsx'

const NAV = [
  { id: 'home', label: '首页', icon: IconHome },
  { id: 'market', label: '市场', icon: IconMarket },
  { id: 'stocks', label: '股票', icon: IconStock },
  { id: 'sectors', label: '板块', icon: IconSector },
  { id: 'strategy', label: '策略', icon: IconStrategy },
  { id: 'ai', label: 'AI 分析', icon: IconAI, badge: 'NEW' },
  { id: 'settings', label: '设置', icon: IconSettings },
]

export default function Sidebar({ active, onNavigate, collapsed, onToggle, mobileOpen, onClose }) {
  return (
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <IconMarket size={18} />
        </div>
        <div className="brand-name">
          Fin<span>Forge</span>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        <div className="nav-label">总览</div>
        {NAV.slice(0, 2).map((n) => (
          <NavButton key={n.id} item={n} active={active === n.id} onNavigate={onNavigate} onClose={onClose} />
        ))}
        <div className="nav-label">行情</div>
        {NAV.slice(2, 5).map((n) => (
          <NavButton key={n.id} item={n} active={active === n.id} onNavigate={onNavigate} onClose={onClose} />
        ))}
        <div className="nav-label">智能</div>
        {NAV.slice(5).map((n) => (
          <NavButton key={n.id} item={n} active={active === n.id} onNavigate={onNavigate} onClose={onClose} />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="collapse-btn" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>
          <IconCollapse size={16} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s ease' }} />
          <span>收起导航</span>
        </button>
      </div>
    </aside>
  )
}

function NavButton({ item, active, onNavigate, onClose }) {
  const Icon = item.icon
  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={() => { onNavigate(item.id); onClose?.() }}
    >
      <Icon size={19} />
      <span>
        {item.label}
        {item.badge && <em className="nav-badge">{item.badge}</em>}
      </span>
    </button>
  )
}
