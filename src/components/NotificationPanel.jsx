import { getInsights, useLiveData, REFRESH_MS } from '../api.js'
import { IconBolt, IconAlert } from './icons.jsx'

const ICONS = { up: IconBolt, down: IconAlert }

// 通知面板:AI 洞察提醒
export default function NotificationPanel({ onClose }) {
  const { data: insights } = useLiveData(getInsights, [], REFRESH_MS)
  const list = Array.isArray(insights) ? insights : []

  return (
    <div className="notify-mask" onClick={onClose}>
      <div className="notify-panel" onClick={(e) => e.stopPropagation()}>
        <div className="notify-head">
          <h3>通知</h3>
          <span className="sub">{list.length} 条 AI 提醒</span>
          <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="notify-list">
          {list.map((ins, i) => {
            const Icon = ICONS[ins.tone] || IconBolt
            return (
              <div className="notify-item" key={i}>
                <span className={`sparkline-dot ${ins.tone}`}><Icon size={13} /></span>
                <div>
                  <div className="notify-tag">{ins.tag}</div>
                  <p>{ins.text}</p>
                </div>
              </div>
            )
          })}
          {!list.length && <div className="chart-empty" style={{ padding: 30 }}>暂无新通知</div>}
        </div>
      </div>
    </div>
  )
}
