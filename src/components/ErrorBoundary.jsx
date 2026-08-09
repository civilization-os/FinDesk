import { Component } from 'react'

// 错误边界:任一数据卡片出错时只降级该卡片,不拖垮整个 Dashboard
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[FinForge] 组件渲染错误:', error, info)
  }

  render() {
    if (this.state.error) {
      const name = this.props.children?.type?.name || '组件'
      return (
        <div className="card" style={{ padding: 16, borderColor: 'var(--separator-strong)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tag down" style={{ flexShrink: 0 }}>渲染错误</span>
            <b style={{ fontSize: 13, flexShrink: 0 }}>{name}</b>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(this.state.error.message || this.state.error)}
            </p>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 10, border: 'none', background: 'var(--accent-soft)', color: 'var(--accent)',
              padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
