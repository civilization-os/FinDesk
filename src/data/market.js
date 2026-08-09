// 演示用模拟数据(A 股语境,红涨绿跌)。接入真实行情时替换此处即可。
// 单位:金额为人民币;涨跌幅为百分比。

export const indices = [
  { code: '000001', name: '上证指数', value: 3248.55, change: 0.62, points: 20.11 },
  { code: '399001', name: '深证成指', value: 10482.35, change: 0.94, points: 97.62 },
  { code: '399006', name: '创业板指', value: 2167.89, change: -0.28, points: -6.08 },
  { code: '000688', name: '科创50', value: 1012.47, change: 1.31, points: 13.08 },
]

export const breadth = {
  up: 3124,
  down: 1743,
  flat: 186,
  limitUp: 64,
  limitDown: 12,
  turnover: 12487, // 亿元
  northbound: 38.6, // 亿元 净流入
}

// 大盘状态卡:全天走势(归一化点位 0-100)
export const marketCurve = {
  points: [46, 48, 47, 50, 52, 54, 53, 56, 58, 57, 60, 63, 62, 65, 64, 66, 68, 67, 69, 70],
  open: 46,
  high: 70,
  low: 44,
  volume: [12, 15, 18, 14, 22, 26, 20, 24, 30, 27, 33, 38, 31, 35, 41, 36, 40, 44, 39, 42],
  labels: ['09:30', '10:30', '11:30', '13:30', '14:30', '15:00'],
}

export const sentiment = {
  score: 68, // 0-100
  level: '偏乐观',
  fear: 32,
  greed: 71,
  breakdown: [
    { name: '涨停', ratio: 8.2, color: '#ff3b30' },
    { name: '上涨', ratio: 54.6, color: '#ff6b5e' },
    { name: '平盘', ratio: 3.2, color: '#8e8e93' },
    { name: '下跌', ratio: 30.4, color: '#34c759' },
    { name: '跌停', ratio: 3.6, color: '#30b158' },
  ],
}

// 资金流向:主力净流入(亿元),近 20 个交易日
export const capitalFlow = {
  main: 186.4, // 主力净流入
  retail: -92.7, // 散户净流出
  northbound: 38.6,
  history: [
    42, -18, 65, -30, 22, 88, -12, 55, -40, 18,
    76, -25, 33, 90, -8, 61, -15, 47, 102, 58,
  ],
  today: [
    { name: '半导体', inflow: 42.6, color: '#0071e3' },
    { name: '新能源', inflow: 31.2, color: '#5856d6' },
    { name: '医药', inflow: 18.9, color: '#64d2ff' },
    { name: '白酒', inflow: -12.4, color: '#34c759' },
    { name: '银行', inflow: -24.8, color: '#34c759' },
  ],
}

export const sectors = [
  { name: '半导体', change: 4.82, leader: '中芯国际' },
  { name: 'AI 算力', change: 3.97, leader: '浪潮信息' },
  { name: '新能源车', change: 2.64, leader: '比亚迪' },
  { name: '机器人', change: 1.85, leader: '汇川技术' },
  { name: '军工', change: -0.72, leader: '中航沈飞' },
  { name: '银行', change: -1.36, leader: '招商银行' },
  { name: '煤炭', change: -2.18, leader: '中国神华' },
]

export const watchlist = [
  { code: '600519', name: '贵州茅台', price: 1486.20, change: 1.24, spark: [40, 42, 41, 45, 44, 47, 46, 49, 51, 50, 53, 55] },
  { code: '300750', name: '宁德时代', price: 226.85, change: 2.61, spark: [38, 40, 39, 44, 43, 42, 46, 49, 47, 52, 54, 58] },
  { code: '688981', name: '中芯国际', price: 92.40, change: 4.82, spark: [30, 34, 33, 38, 41, 39, 45, 48, 46, 52, 56, 62] },
  { code: '601318', name: '中国平安', price: 48.15, change: -0.94, spark: [55, 53, 54, 50, 51, 48, 49, 46, 47, 44, 45, 43] },
  { code: '000858', name: '五粮液', price: 132.70, change: -0.32, spark: [48, 49, 47, 46, 48, 45, 44, 46, 43, 44, 42, 43] },
]

export const aiInsights = [
  { tag: '资金异动', text: '半导体板块主力净流入 42.6 亿,连续 3 日居首', tone: 'up' },
  { tag: '风险提示', text: '上证指数触及 3260 压力位,量能较昨日萎缩 8%', tone: 'down' },
]

export const market = {
  indices: [
    { code: '000001', name: '上证指数', value: 3248.55, change: 0.62, points: 20.11, amount: 5234.5 },
    { code: '399001', name: '深证成指', value: 10482.35, change: 0.94, points: 97.62, amount: 6871.2 },
    { code: '399006', name: '创业板指', value: 2167.89, change: -0.28, points: -6.08, amount: 3210.4 },
    { code: '000688', name: '科创50', value: 1012.47, change: 1.31, points: 13.08, amount: 892.6 },
    { code: '000300', name: '沪深300', value: 3864.21, change: 0.55, points: 21.14, amount: 3891.0 },
    { code: '000905', name: '中证500', value: 5892.33, change: 0.87, points: 50.78, amount: 2145.8 },
    { code: '000852', name: '中证1000', value: 6123.45, change: 1.12, points: 67.82, amount: 1876.3 },
    { code: '000016', name: '上证50', value: 2567.89, change: 0.21, points: 5.39, amount: 1120.7 },
    { code: '899050', name: '北证50', value: 982.34, change: -0.65, points: -6.43, amount: 189.2 },
    { code: 'HSI', name: '恒生指数', value: 19876.55, change: 1.08, points: 212.44, amount: 1320.5 },
  ],
  sectors: {
    top: [
      { name: '半导体', change: 4.82, leader: '中芯国际' },
      { name: 'AI 算力', change: 3.97, leader: '浪潮信息' },
      { name: '新能源车', change: 2.64, leader: '比亚迪' },
      { name: '机器人', change: 1.85, leader: '汇川技术' },
      { name: '军工', change: 1.32, leader: '中航沈飞' },
      { name: '消费电子', change: 1.08, leader: '立讯精密' },
      { name: '证券', change: 0.86, leader: '中信证券' },
      { name: '光伏', change: 0.54, leader: '隆基绿能' },
    ],
    bottom: [
      { name: '煤炭', change: -2.18, leader: '中国神华' },
      { name: '银行', change: -1.36, leader: '招商银行' },
      { name: '石油', change: -0.92, leader: '中国石油' },
      { name: '房地产', change: -0.64, leader: '万科A' },
      { name: '白酒', change: -0.48, leader: '贵州茅台' },
      { name: '钢铁', change: -0.31, leader: '宝钢股份' },
      { name: '家电', change: -0.18, leader: '美的集团' },
      { name: '医药', change: -0.12, leader: '恒瑞医药' },
    ],
  },
}

// 热门股票演示数据(后端不可用时回退)
export const hotStocks = [
  { code: '600519', name: '贵州茅台', price: 1486.20, change: 1.24 },
  { code: '300750', name: '宁德时代', price: 226.85, change: 2.61 },
  { code: '688981', name: '中芯国际', price: 92.40, change: 4.82 },
  { code: '601318', name: '中国平安', price: 48.15, change: -0.94 },
  { code: '000858', name: '五粮液', price: 132.70, change: -0.32 },
  { code: '600036', name: '招商银行', price: 36.42, change: 0.55 },
  { code: '000333', name: '美的集团', price: 63.20, change: 0.38 },
  { code: '600900', name: '长江电力', price: 27.85, change: -0.21 },
]

// 今日推荐演示数据(后端不可用时回退)
export const recommendations = [
  { name: '半导体', pick: '中芯国际 688981', code: '688981', reason: '板块资金净流入居首,产业景气度提升', risk: '高位波动加大,警惕获利回吐' },
  { name: '新能源车', pick: '比亚迪 002594', code: '002594', reason: '板块涨幅居前,主力资金积极介入', risk: '注意短线追高风险' },
]
