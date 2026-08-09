import { useEffect, useState } from 'react'
import { getSettings, saveSettings, testSettings, getModels } from '../api.js'
import ProfileSettings from './ProfileSettings.jsx'

const ALERT_KEY = 'ff-alert'

function loadAlertCfg() {
  try {
    const s = localStorage.getItem(ALERT_KEY)
    if (s) return { enabled: false, intervalMin: 30, ...JSON.parse(s) }
  } catch { /* ignore */ }
  return { enabled: false, intervalMin: 30 }
}

// 设置页:配置 DeepSeek 模型(真实模型列表来自 /models 接口),驱动 AI 分析;盘中周期提示
export default function SettingsPage() {
  const [cfg, setCfg] = useState({ enabled: false, model: '', base_url: 'https://api.deepseek.com', hasKey: false })
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {type: 'ok'|'err', text}
  const [alertCfg, setAlertCfg] = useState(loadAlertCfg)

  useEffect(() => {
    getSettings().then(({ data }) => {
      if (!data) return
      setCfg({ enabled: !!data.enabled, model: data.model || 'deepseek-chat', base_url: data.base_url, hasKey: !!data.hasKey })
      // 已配置 key 时自动拉取真实模型列表
      if (data.hasKey) refreshModels()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshModels = async () => {
    const list = await getModels()
    if (list.length) {
      setModels(list)
      setCfg((c) => ({ ...c, model: list.includes(c.model) ? c.model : list[0] }))
    }
  }

  const patch = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

  const doSave = async () => {
    setBusy(true); setMsg(null)
    const body = { enabled: cfg.enabled, model: cfg.model, base_url: cfg.base_url }
    if (apiKey.trim()) body.api_key = apiKey.trim() // 空则不覆盖原 key
    const r = await saveSettings(body)
    setBusy(false)
    setMsg(r.ok
      ? { type: 'ok', text: '已保存。' + (cfg.enabled ? 'AI 分析将使用 DeepSeek 生成洞察(约 90s 缓存)。' : 'AI 分析仍使用内置规则引擎。') }
      : { type: 'err', text: '保存失败,请检查后端服务' })
    if (r.ok) {
      if (apiKey.trim()) { setApiKey(''); setCfg((c) => ({ ...c, hasKey: true })) }
      refreshModels()
    }
  }

  const doTest = async () => {
    setBusy(true); setMsg(null)
    const body = { base_url: cfg.base_url, model: cfg.model }
    if (apiKey.trim()) body.api_key = apiKey.trim()
    const r = await testSettings(body)
    setBusy(false)
    if (r.ok) {
      setMsg({ type: 'ok', text: r.message })
      if (r.models.length) {
        setModels(r.models)
        setCfg((c) => ({ ...c, model: r.models.includes(c.model) ? c.model : r.models[0] }))
      }
    } else {
      setMsg({ type: 'err', text: r.message })
    }
  }

  const toggleAlert = () => {
    const next = !alertCfg.enabled
    if (next && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    const c = { enabled: next, intervalMin: alertCfg.intervalMin }
    setAlertCfg(c)
    localStorage.setItem(ALERT_KEY, JSON.stringify(c))
  }

  const setAlertInterval = (min) => {
    const c = { ...alertCfg, intervalMin: Number(min) }
    setAlertCfg(c)
    localStorage.setItem(ALERT_KEY, JSON.stringify(c))
  }

  return (
    <div className="settings-page">
      <ProfileSettings />

      <div className="card" style={{ ['--d']: '40ms' }}>
        <div className="card-title">
          <h2>AI 模型配置</h2>
          <span className="sub">DeepSeek · OpenAI 兼容接口</span>
        </div>

        <div className="set-row">
          <div className="set-label">
            <b>启用 AI 模型</b>
            <p>开启后,「AI 分析」的洞察由 DeepSeek 基于实时行情生成;关闭则使用内置规则引擎。</p>
          </div>
          <button
            className={`switch ${cfg.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={cfg.enabled}
            onClick={() => patch('enabled', !cfg.enabled)}
          >
            <span className="knob" />
          </button>
        </div>

        <div className="set-field">
          <label htmlFor="set-key">API Key</label>
          <input
            id="set-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={cfg.hasKey ? '••••••••(已配置,留空保持不变)' : 'sk-... 在 platform.deepseek.com 获取'}
          />
        </div>

        <div className="set-grid">
          <div className="set-field">
            <label htmlFor="set-url">Base URL</label>
            <input id="set-url" type="text" value={cfg.base_url} onChange={(e) => patch('base_url', e.target.value)} />
          </div>
          <div className="set-field">
            <label htmlFor="set-model">模型(真实列表)</label>
            <div className="set-select-row">
              <select
                id="set-model"
                className="set-select"
                value={cfg.model}
                disabled={!models.length}
                onChange={(e) => patch('model', e.target.value)}
              >
                {!models.length && <option value="">{cfg.hasKey ? '加载中…' : '保存 API Key 后自动获取'}</option>}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={refreshModels} title="重新获取模型列表">
                刷新
              </button>
            </div>
            <p className="set-hint">
              {models.length ? `来自 DeepSeek /models 接口,共 ${models.length} 个` : '由接口获取,不支持手填'}
            </p>
          </div>
        </div>

        {msg && (
          <div className={`set-msg ${msg.type}`}>{msg.text}</div>
        )}

        <div className="set-actions">
          <button className="btn-primary" disabled={busy} onClick={doSave}>
            {busy ? '处理中…' : '保存配置'}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={doTest}>
            测试连接
          </button>
        </div>
      </div>

      <div className="card" style={{ ['--d']: '80ms' }}>
        <div className="card-title">
          <h2>盘中周期提示</h2>
          <span className="sub">按周期自动推送最新盘面洞察</span>
        </div>
        <div className="set-row">
          <div className="set-label">
            <b>开启盘中提示</b>
            <p>每个周期自动拉取最新 AI 洞察并弹出通知面板;浏览器已授权时同时发送系统通知。</p>
          </div>
          <button
            className={`switch ${alertCfg.enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={alertCfg.enabled}
            onClick={toggleAlert}
          >
            <span className="knob" />
          </button>
        </div>
        <div className="set-field">
          <label htmlFor="set-alert-interval">提示周期</label>
          <select
            id="set-alert-interval"
            className="set-select"
            value={alertCfg.intervalMin}
            disabled={!alertCfg.enabled}
            onChange={(e) => setAlertInterval(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            <option value={15}>每 15 分钟</option>
            <option value={30}>每 30 分钟</option>
            <option value={60}>每 60 分钟</option>
          </select>
          <p className="set-hint">
            开启后会在所选周期弹窗提醒当前市场洞察;关闭页面不生效(需保持页面打开)。
          </p>
        </div>
      </div>

      <div className="card set-note" style={{ ['--d']: '140ms' }}>
        <h3>说明</h3>
        <ul>
          <li>模型列表实时取自 DeepSeek <code>/models</code> 接口,不可手填,保证可用性。</li>
          <li>API Key 仅保存在本地后端 <code>backend/settings.json</code>(已加入 .gitignore,不会进版本库),不会下发到浏览器。</li>
          <li>温度/长度等生成参数按金融场景内置(保守风格),不开放配置。</li>
          <li>「测试连接」用当前表单值试连并拉取模型列表,不会修改已保存配置。</li>
          <li>DeepSeek 调用失败或未启用时,AI 洞察自动降级为内置规则引擎,页面不会报错。</li>
        </ul>
      </div>
    </div>
  )
}
