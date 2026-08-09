// SF Symbols 风格的线性图标集(24x24 viewBox,stroke 描边)
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const IconHome = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </svg>
)

export const IconMarket = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M3 17l5.5-5.5 3.5 3.5L20 7" />
    <path d="M15 7h5v5" />
    <path d="M3 21h18" />
  </svg>
)

export const IconStock = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M8 4v16M12 4v16M16 4v16" />
    <path d="M6.5 8h3M10.5 13h3M14.5 7h3" />
  </svg>
)

export const IconSector = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
)

export const IconStrategy = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
  </svg>
)

export const IconAI = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3z" />
    <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    <path d="M5.5 15l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z" />
  </svg>
)

export const IconSearch = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
)

export const IconMenu = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const IconBell = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10.3 20a2 2 0 0 0 3.4 0" />
  </svg>
)

export const IconCalendar = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
  </svg>
)

export const IconSun = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </svg>
)

export const IconMoon = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
  </svg>
)

export const IconCollapse = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M14 6l-6 6 6 6" />
    <path d="M19 6l-6 6 6 6" />
  </svg>
)

export const IconBolt = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M13 2.5 4.5 13.5H11l-1 8L18.5 10.5H12l1-8z" />
  </svg>
)

export const IconAlert = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <path d="M12 3.5 2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.2" r="0.4" fill="currentColor" />
  </svg>
)

export const IconTrend = ({ dir, size = 14, ...p }) => (
  <svg {...base} width={size} height={size} {...p}>
    {dir === 'up' ? (
      <>
        <path d="M4 16l5.5-5.5 3 3L20 6.5" />
        <path d="M15 6.5h5v5" />
      </>
    ) : (
      <>
        <path d="M4 8l5.5 5.5 3-3L20 17.5" />
        <path d="M15 17.5h5v-5" />
      </>
    )}
  </svg>
)

export const IconSettings = (p) => (
  <svg {...base} width={p.size || 18} height={p.size || 18} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.6h-4l-.4 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5z" />
  </svg>
)
