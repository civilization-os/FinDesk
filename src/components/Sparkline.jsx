// 通用迷你走势图(SVG,无第三方依赖)
// mode: 'line' 折线 | 'area' 面积 | 'bar' 柱状
// 颜色传参:stroke/fill 为具体色值;若需主题色,传 strokeClass 或 fillClass(CSS class,如 'chart-up')
export default function Sparkline({
  data,
  mode = 'line',
  width = 90,
  height = 34,
  stroke,
  strokeClass,
  fill,
  fillClass,
  className,
}) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = mode === 'bar' ? 1 : 2

  const x = (i) => (i / (data.length - 1)) * (width - pad * 2) + pad
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2)

  if (mode === 'bar') {
    const bw = width / data.length
    return (
      <svg className={className} width={width} height={height} aria-hidden="true">
        {data.map((v, i) => (
          <rect
            key={i}
            x={i * bw + bw * 0.22}
            y={y(Math.max(v, 0))}
            width={bw * 0.56}
            height={Math.max(height - pad - y(Math.max(v, 0)), 1.5)}
            rx={1.5}
            className={fillClass}
          />
        ))}
      </svg>
    )
  }

  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className={className} width={width} height={height} aria-hidden="true">
      {mode === 'area' && (
        <polygon
          points={`${pad},${height - pad} ${pts} ${width - pad},${height - pad}`}
          className={fillClass}
          fill={fillClass ? undefined : fill}
        />
      )}
      <polyline
        points={pts}
        fill="none"
        className={strokeClass}
        stroke={strokeClass ? undefined : stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
