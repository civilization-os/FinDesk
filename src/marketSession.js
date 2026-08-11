import { useEffect, useState } from 'react'

const SHANGHAI_PARTS = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function clockParts(date = new Date()) {
  const values = Object.fromEntries(
    SHANGHAI_PARTS.formatToParts(date)
      .filter((item) => item.type !== 'literal')
      .map((item) => [item.type, Number(item.value)]),
  )
  const weekday = new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay()
  return { ...values, weekday, minutes: values.hour * 60 + values.minute }
}

function nextWeekdayOffset(weekday) {
  if (weekday === 5) return 3
  if (weekday === 6) return 2
  return 1
}

export function getAStockSession(date = new Date()) {
  const clock = clockParts(date)
  const tradingDay = clock.weekday >= 1 && clock.weekday <= 5
  const at = clock.minutes
  let phase = 'closed'
  let label = '盘后复盘'
  let isTrading = false
  let nextDelay = 30 * 60 * 1000
  let refreshLabel = '行情已静止'

  if (!tradingDay) {
    phase = 'weekend'
    label = '周末休市'
    const days = clock.weekday === 6 ? 2 : 1
    nextDelay = ((days * 24 * 60) + (9 * 60 + 15) - at) * 60000
  } else if (at < 9 * 60 + 15) {
    phase = 'pre_open'
    label = '盘前准备'
    nextDelay = (9 * 60 + 15 - at) * 60000
    refreshLabel = '等待竞价'
  } else if (at < 9 * 60 + 30) {
    phase = 'auction'
    label = '集合竞价'
    nextDelay = 30000
    refreshLabel = '30 秒刷新'
  } else if (at < 11 * 60 + 30) {
    phase = 'morning'
    label = '上午盘中'
    isTrading = true
    nextDelay = 15000
    refreshLabel = '15 秒刷新'
  } else if (at < 13 * 60) {
    phase = 'lunch'
    label = '午间休市'
    nextDelay = (13 * 60 - at) * 60000
    refreshLabel = '13:00 恢复'
  } else if (at < 15 * 60) {
    phase = 'afternoon'
    label = '下午盘中'
    isTrading = true
    nextDelay = 15000
    refreshLabel = '15 秒刷新'
  } else {
    const days = nextWeekdayOffset(clock.weekday)
    nextDelay = ((days * 24 * 60) + (9 * 60 + 15) - at) * 60000
  }

  return {
    phase,
    label,
    isTrading,
    time: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
    refreshLabel,
    nextDelay: Math.max(1000, nextDelay),
    calendarNote: '按沪深市场常规时段判断，节假日以行情源为准',
  }
}

export function startMarketPolling(load, baseInterval = 15000) {
  let stopped = false
  let timer = null
  let running = false

  const schedule = () => {
    if (stopped) return
    const session = getAStockSession()
    const delay = session.isTrading ? baseInterval : Math.max(baseInterval, session.nextDelay)
    timer = window.setTimeout(run, delay)
  }

  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      await load()
    } finally {
      running = false
      schedule()
    }
  }

  const wake = () => {
    if (document.visibilityState !== 'visible') return
    window.clearTimeout(timer)
    void run()
  }

  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  void run()

  return () => {
    stopped = true
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', wake)
    window.removeEventListener('focus', wake)
  }
}

export function useMarketSession() {
  const [session, setSession] = useState(getAStockSession)
  useEffect(() => {
    const update = () => setSession(getAStockSession())
    const id = window.setInterval(update, 30000)
    return () => window.clearInterval(id)
  }, [])
  return session
}
