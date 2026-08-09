import { getInsights, useLiveData, REFRESH_MS } from '../api.js'
import { IconBolt, IconAlert } from './icons.jsx'

const ICONS = { up: IconBolt, down: IconAlert }

// 首页 AI 洞察:合成一张卡片,多条洞察垂直排列
export default function InsightStrip() {
  const { data: aiInsights } = useLiveData(getInsights, [], REFRESH_MS)
  const list = Array.isArray(aiInsights) ? aiInsights : []
  if (!list.length) return null
  return (
    <div className="card insight-card" style={{ marginBottom: 16, ['--d']: '120ms' }}>
      <div className="card-title">
        <h2>AI 洞察</h2>
        <span className="sub">实时盘面 · 自动生成</span>
      </div>
      <div className="insight-list">
        {list.map((ins, i) => {
          const Icon = ICONS[ins.tone] || IconBolt
          return (
            <div className="insight-row" key={i}>
              <span className={`insight-ic ${ins.tone}`}><Icon size={14} /></span>
              <span className={`tag ${ins.tone}`}>{ins.tag}</span>
              <p>{ins.text}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
