function Line({ width = '100%', height = 10 }) {
  return <span className="skeleton-line" style={{ width, height }} />
}

function MetricGroup() {
  return (
    <div className="skeleton-metrics">
      {[0, 1, 2].map((item) => (
        <div className="skeleton-metric" key={item}>
          <Line width="64%" height={9} />
          <Line width="48%" height={27} />
        </div>
      ))}
    </div>
  )
}

function TableRows({ count = 4 }) {
  return (
    <div className="skeleton-table-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-table-row" key={index}>
          <Line width="24%" />
          <Line width="13%" />
          <Line width="11%" />
          <Line width="16%" />
        </div>
      ))}
    </div>
  )
}

export function CapitalFlowStageSkeleton({ compact = false }) {
  if (compact) {
    return (
      <div className="card loading-shimmer capital-flow-compact-skeleton" aria-busy="true" aria-label="正在加载资金流向">
        <div className="skeleton-card-head"><Line width="92px" height={16} /><Line width="180px" /></div>
        <div className="skeleton-compact-flow">
          <div><MetricGroup /><div className="skeleton-chart-bars">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ height: `${28 + ((i * 17) % 58)}%` }} />)}</div></div>
          <TableRows count={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="card flow-stage loading-shimmer flow-stage-skeleton" aria-busy="true" aria-label="正在加载资金流向">
      <div className="skeleton-card-head"><div><Line width="72px" height={7} /><Line width="96px" height={18} /></div><Line width="190px" /></div>
      <div className="skeleton-flow-terminal">
        <div className="skeleton-flow-hero"><Line width="42%" /><Line width="58%" height={46} /><Line width="82%" /><MetricGroup /></div>
        <div className="skeleton-flow-chart"><div className="skeleton-chart-head"><Line width="34%" /><Line width="22%" /></div><div className="skeleton-chart-bars">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ height: `${22 + ((i * 19) % 68)}%` }} />)}</div></div>
      </div>
      <div className="skeleton-flow-ranks"><TableRows count={3} /><TableRows count={3} /></div>
    </div>
  )
}

export default function MarketPageSkeleton() {
  return (
    <div className="market-page market-page-skeleton" aria-busy="true" aria-label="正在加载市场全景">
      <div className="market-loading-status" role="status">
        <span className="market-loading-orbit"><i /></span>
        <div><strong>正在同步市场快照</strong><span>指数、宽度、资金与板块并行加载</span></div>
      </div>
      <div className="market-top skeleton-page-gap">
        <div className="card loading-shimmer skeleton-breadth-card">
          <div className="skeleton-card-head"><Line width="88px" height={17} /><Line width="112px" /></div>
          <MetricGroup />
          <Line width="100%" height={9} />
          <MetricGroup />
        </div>
        <div className="card loading-shimmer skeleton-index-card">
          <div className="skeleton-card-head"><Line width="88px" height={17} /><Line width="94px" /></div>
          <TableRows count={4} />
        </div>
      </div>
      <div className="skeleton-page-gap"><CapitalFlowStageSkeleton /></div>
      <div className="board-grid">
        {[0, 1].map((item) => <div className="card loading-shimmer skeleton-board-card" key={item}><div className="skeleton-card-head"><Line width="94px" height={17} /><Line width="70px" /></div><TableRows count={5} /></div>)}
      </div>
    </div>
  )
}
