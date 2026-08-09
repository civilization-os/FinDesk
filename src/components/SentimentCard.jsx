import { getSentiment, useLiveData, REFRESH_MS } from '../api.js'

export default function SentimentCard() {
  const { data: sentiment } = useLiveData(getSentiment, null, REFRESH_MS)
  if (!sentiment) return null
  const { score, level, fear, greed, breakdown = [] } = sentiment
  if (!breakdown.length) return null
  // 情绪环按分数阈值着色:乐观(红)/ 中性(蓝)/ 谨慎(绿),A 股红涨习惯
  const colorVar = score >= 70 ? 'var(--up)' : score >= 45 ? 'var(--accent)' : 'var(--down)'

  return (
    <div className="card" style={{ ['--d']: '300ms' }}>
      <div className="card-title">
        <h2>市场情绪</h2>
        <span className="sub">涨跌分布 · 占全市场比例</span>
      </div>

      <div className="gauge-wrap">
        <div className="gauge-col">
          <div className="gauge">
            <svg viewBox="0 0 260 134" width="140" height="140" role="img" aria-label={`市场情绪 ${score} 分`}>
              {/* 刻度线(每 30°) */}
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const ang = Math.PI * (1 - i / 6)
                const x1 = 130 + 44 * Math.cos(ang)
                const y1 = 128 - 44 * Math.sin(ang)
                const x2 = 130 + 51 * Math.cos(ang)
                const y2 = 128 - 51 * Math.sin(ang)
                return (
                  <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="var(--separator-strong)" strokeWidth={1.5} strokeLinecap="round" />
                )
              })}
              {/* 背景弧 */}
              <path
                d="M 72 128 A 58 58 0 0 1 188 128"
                fill="none" className="gauge-arc-bg" strokeWidth={14} strokeLinecap="round"
              />
              {/* 发光层 */}
              <path
                d="M 72 128 A 58 58 0 0 1 188 128"
                fill="none" pathLength={100} strokeWidth={22} strokeLinecap="round"
                strokeDasharray={`${score} 100`} opacity={0.16}
                style={{ stroke: colorVar, transition: 'stroke 0.6s ease' }}
              />
              {/* 前景弧(按分数阈值着色) */}
              <path
                d="M 72 128 A 58 58 0 0 1 188 128"
                fill="none" pathLength={100} strokeWidth={13} strokeLinecap="round"
                strokeDasharray={`${score} 100`}
                style={{
                  stroke: colorVar,
                  transition: 'stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.6s ease',
                }}
              />
            </svg>
            <div className="gauge-center">
              <span className="gauge-score num">{score}</span>
              <span className="gauge-badge" style={{ background: `color-mix(in srgb, ${colorVar} 15%, transparent)`, color: colorVar }}>
                {level}
              </span>
            </div>
          </div>

          {/* 恐惧 / 贪婪 滑轨 */}
          <div className="fg-bar">
            <div className="fg-track">
              <span className="fg-marker" style={{ left: `${score}%` }} />
            </div>
            <div className="fg-labels">
              <span className="fg-fear">恐惧 {fear}</span>
              <span className="fg-greed">贪婪 {greed}</span>
            </div>
          </div>
        </div>

        <div className="sentiment-dist">
          {/* 总分布条:各段按占比拼接,合计 100% */}
          <div className="dist-bar total" title="涨跌分布,合计 100%">
            {breakdown.map((b) => (
              <span
                key={b.name}
                style={{
                  width: `${Math.max(b.ratio, 0.8)}%`,
                  minWidth: 2,
                  background: `var(--${b.color === '#ff3b30' || b.color === '#ff6b5e' ? 'up' : b.color === '#8e8e93' ? 'flat' : 'down'})`,
                }}
              />
            ))}
          </div>
          {/* 图例:每段占比 */}
          <div className="dist-legend">
            {breakdown.map((b) => (
              <div className="dist-legend-item" key={b.name}>
                <i style={{ background: `var(--${b.color === '#ff3b30' || b.color === '#ff6b5e' ? 'up' : b.color === '#8e8e93' ? 'flat' : 'down'})` }} />
                <span>{b.name}</span>
                <b className="num">{b.ratio.toFixed(1)}%</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
