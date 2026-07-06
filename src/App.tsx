import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Download,
  Edit3,
  FileText,
  Languages,
  LogOut,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import './styles.css'
import { apiBaseUrl, appBaseUrl, hasSupabaseConfig, supabase } from './lib/supabase'
import { demoAllowlist, demoReadings, demoTags } from './lib/demoData'
import { getInitialLanguage, languageOptions, messages } from './lib/i18n'
import type { AllowlistEntry, LanguageCode, TagReading, TemperatureTag } from './types'

const internalDomains = ['miaomiaoce.com', 'zenmeasure.com', 'zenmeasure.space']
const timeRanges = ['1h', '6h', '24h', '7d', '30d']

function formatTemperature(value: number) {
  return `${value.toFixed(1)} °C`
}

function isInternalEmail(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  return internalDomains.includes(domain)
}

function readingForTag(tag: TemperatureTag, readings: TagReading[]) {
  const byTag = readings.filter((reading) => reading.tagId === tag.id)
  if (byTag.length) return byTag
  return demoReadings.map((reading, index) => ({
    ...reading,
    id: `${tag.id}-${index}`,
    tagId: tag.id,
    temperature: Number((tag.latestTemperature + Math.sin(index / 4) * 0.35).toFixed(1)),
  }))
}

export default function App() {
  const [language, setLanguage] = useState<LanguageCode>(getInitialLanguage)
  const t = messages[language]
  const [sessionEmail, setSessionEmail] = useState('')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [tags, setTags] = useState<TemperatureTag[]>(demoTags)
  const [readings, setReadings] = useState<TagReading[]>(demoReadings)
  const [allowlist] = useState<AllowlistEntry[]>(demoAllowlist)
  const [query, setQuery] = useState('7F12')
  const [selectedTagId, setSelectedTagId] = useState(() => window.localStorage.getItem('zenmeasure-recent-tag') ?? demoTags[0].id)
  const [nicknameDraft, setNicknameDraft] = useState(demoTags[0].nickname)
  const [range, setRange] = useState('24h')
  const [activeView, setActiveView] = useState<'table' | 'chart' | 'report' | 'config'>('table')
  const [clockMs] = useState(() => Date.now())

  useEffect(() => {
    window.localStorage.setItem('zenmeasure-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language
  }, [language])

  useEffect(() => {
    async function hydrateSession() {
      if (!hasSupabaseConfig) return
      const { data } = await supabase.auth.getSession()
      setSessionEmail(data.session?.user.email ?? '')
      supabase.auth.onAuthStateChange((_event, session) => {
        setSessionEmail(session?.user.email ?? '')
      })
    }
    void hydrateSession()
  }, [])

  useEffect(() => {
    async function loadData() {
      if (!hasSupabaseConfig || !sessionEmail) return
      const { data: tagRows } = await supabase
        .from('tags')
        .select('id, tag_code, short_code, nickname, customer_name, site_name, status, latest_temperature, battery_percent, rssi, last_seen_at, high_limit, low_limit')
        .order('last_seen_at', { ascending: false })
        .limit(100)
      if (tagRows?.length) {
        setTags(
          tagRows.map((row) => ({
            id: row.id,
            tagCode: row.tag_code,
            shortCode: row.short_code,
            nickname: row.nickname ?? row.tag_code,
            customer: row.customer_name ?? '',
            site: row.site_name ?? '',
            status: row.status ?? 'normal',
            latestTemperature: Number(row.latest_temperature ?? 0),
            battery: Number(row.battery_percent ?? 0),
            rssi: Number(row.rssi ?? 0),
            lastSeenAt: row.last_seen_at,
            highLimit: Number(row.high_limit ?? 8),
            lowLimit: Number(row.low_limit ?? -2),
          })),
        )
      }
    }
    void loadData()
  }, [sessionEmail])

  useEffect(() => {
    async function loadReadings() {
      if (!hasSupabaseConfig || !sessionEmail || !selectedTagId) return
      const { data } = await supabase
        .from('tag_readings')
        .select('id, tag_id, recorded_at, temperature_c, humidity_percent, battery_percent, rssi')
        .eq('tag_id', selectedTagId)
        .order('recorded_at', { ascending: false })
        .limit(500)
      if (data?.length) {
        setReadings(
          data.map((row) => ({
            id: row.id,
            tagId: row.tag_id,
            recordedAt: row.recorded_at,
            temperature: Number(row.temperature_c),
            humidity: row.humidity_percent,
            battery: row.battery_percent,
            rssi: row.rssi,
          })),
        )
      }
    }
    void loadReadings()
  }, [selectedTagId, sessionEmail])

  const selectedTag = tags.find((tag) => tag.id === selectedTagId) ?? tags[0]
  const selectedReadings = useMemo(() => readingForTag(selectedTag, readings), [readings, selectedTag])
  const chartData = useMemo(
    () =>
      [...selectedReadings]
        .reverse()
        .slice(-80)
        .map((reading) => ({
          time: new Date(reading.recordedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }),
          temperature: reading.temperature,
        })),
    [language, selectedReadings],
  )
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return tags.slice(0, 5)
    return tags
      .filter((tag) =>
        [tag.shortCode, tag.tagCode, tag.nickname, tag.customer, tag.site].some((value) =>
          value.toLowerCase().includes(normalized),
        ),
      )
      .slice(0, 8)
  }, [query, tags])

  function selectTag(tag: TemperatureTag) {
    setSelectedTagId(tag.id)
    setNicknameDraft(tag.nickname)
    window.localStorage.setItem('zenmeasure-recent-tag', tag.id)
  }

  async function sendMagicLink() {
    setNotice('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail.includes('@')) return
    try {
      if (apiBaseUrl) {
        const result = await fetch(`${apiBaseUrl}/api/auth/check-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail }),
        })
        if (!result.ok) throw new Error('Email is not allowlisted.')
      } else if (!isInternalEmail(normalizedEmail) && hasSupabaseConfig) {
        throw new Error('External customer emails require the Worker allowlist precheck.')
      }
      if (hasSupabaseConfig) {
        const { error } = await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: { emailRedirectTo: appBaseUrl, shouldCreateUser: true },
        })
        if (error) throw error
      }
      setNotice(t.sendSuccess)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to send Magic Link.')
    }
  }

  async function signOut() {
    if (hasSupabaseConfig) await supabase.auth.signOut()
    setSessionEmail('')
  }

  function saveNickname() {
    setTags((current) => current.map((tag) => (tag.id === selectedTag.id ? { ...tag, nickname: nicknameDraft } : tag)))
    if (hasSupabaseConfig) {
      void supabase.from('tags').update({ nickname: nicknameDraft }).eq('id', selectedTag.id)
    }
  }

  function exportPdf() {
    const report = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
    if (!report) return
    const rows = selectedReadings
      .slice(0, 60)
      .map(
        (reading) => `<tr>
          <td>${escapeHtml(new Date(reading.recordedAt).toLocaleString(language))}</td>
          <td>${escapeHtml(formatTemperature(reading.temperature))}</td>
          <td>${escapeHtml(`${reading.rssi ?? ''} dBm`)}</td>
          <td>${escapeHtml(`${reading.battery ?? ''}%`)}</td>
        </tr>`,
      )
      .join('')

    report.document.write(`<!doctype html>
      <html>
        <head>
          <title>${escapeHtml(selectedTag.tagCode)} ZenMeasure Report</title>
          <style>
            body { font-family: Arial, sans-serif; color: #17221d; margin: 40px; }
            header { border-bottom: 3px solid #0f7a62; padding-bottom: 18px; margin-bottom: 26px; }
            h1 { color: #0f7a62; margin: 0; font-size: 30px; }
            h2 { margin: 6px 0 0; font-size: 16px; color: #45645a; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 22px 0; }
            .metric { border: 1px solid #dfe8e4; border-radius: 7px; padding: 12px; }
            .metric span { display: block; color: #64736d; font-size: 12px; margin-bottom: 6px; }
            .metric strong { font-size: 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { text-align: left; background: #0f7a62; color: white; padding: 9px; }
            td { border-bottom: 1px solid #dfe8e4; padding: 8px 9px; }
            footer { margin-top: 28px; color: #64736d; font-size: 11px; }
            @media print { body { margin: 18mm; } button { display: none; } }
          </style>
        </head>
        <body>
          <header>
            <h1>ZenMeasure</h1>
            <h2>Wireless Temperature Tag Report</h2>
          </header>
          <h2>${escapeHtml(selectedTag.tagCode)} / ${escapeHtml(selectedTag.nickname)}</h2>
          <p>${escapeHtml(selectedTag.customer)} / ${escapeHtml(selectedTag.site)}</p>
          <section class="summary">
            <div class="metric"><span>${escapeHtml(t.temperature)}</span><strong>${escapeHtml(formatTemperature(selectedTag.latestTemperature))}</strong></div>
            <div class="metric"><span>${escapeHtml(t.highLimit)}</span><strong>${selectedTag.highLimit} °C</strong></div>
            <div class="metric"><span>${escapeHtml(t.lowLimit)}</span><strong>${selectedTag.lowLimit} °C</strong></div>
            <div class="metric"><span>${escapeHtml(t.battery)}</span><strong>${selectedTag.battery}%</strong></div>
          </section>
          <table>
            <thead><tr><th>${escapeHtml(t.time)}</th><th>${escapeHtml(t.temperature)}</th><th>${escapeHtml(t.rssi)}</th><th>${escapeHtml(t.battery)}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <footer>ZenMeasure / 秒秒测 · ${new Date().toLocaleString(language)}</footer>
          <script>window.onload = () => setTimeout(() => window.print(), 200)</script>
        </body>
      </html>`)
    report.document.close()
  }

  const needsLogin = hasSupabaseConfig && !sessionEmail

  if (needsLogin) {
    return (
      <main className="login-shell">
        <div className="language-switch compact">
          <Languages size={16} />
          <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>
            {languageOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.native}
              </option>
            ))}
          </select>
        </div>
        <section className="login-panel">
          <div className="brand">
            <strong>ZenMeasure</strong>
            <span>秒秒测</span>
          </div>
          <h1>{t.loginTitle}</h1>
          <p>{t.allowedDomains}</p>
          <label className="field">
            <span>{t.email}</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.emailPlaceholder} />
          </label>
          <button className="primary-button" type="button" onClick={sendMagicLink}>
            <ShieldCheck size={18} />
            {t.loginCta}
          </button>
          {notice && <p className="notice">{notice}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="top-actions">
        <div className="language-switch">
          <Languages size={16} />
          <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>
            {languageOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.native}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="ghost-button" onClick={() => setActiveView('config')}>
          <Settings size={17} />
          {t.admin}
        </button>
        {sessionEmail && (
          <button type="button" className="ghost-button" onClick={signOut}>
            <LogOut size={17} />
            {t.signOut}
          </button>
        )}
      </header>

      <section className="search-hero">
        <div className="brand large">
          <strong>ZenMeasure</strong>
          <span>秒秒测</span>
        </div>
        <p>{t.appSubtitle}</p>
        <div className="search-box">
          <Search size={24} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.dashboardHint} />
        </div>
        <div className="match-panel">
          <div className="table-head">
            <span>{t.tagId}</span>
            <span>{t.temperature}</span>
            <span>{t.lastSeen}</span>
            <span>{t.customerSite}</span>
          </div>
          {matches.map((tag) => (
            <button key={tag.id} type="button" className="match-row" onClick={() => selectTag(tag)}>
              <span>
                <strong>{tag.tagCode}</strong>
                <small>({tag.shortCode})</small>
              </span>
              <strong className={clsx('temp', tag.status)}>{formatTemperature(tag.latestTemperature)}</strong>
              <span>{Math.max(1, Math.round((clockMs - new Date(tag.lastSeenAt).getTime()) / 60000))} {t.minutesAgo}</span>
              <span>{tag.customer} / {tag.site}</span>
              <ChevronRight size={17} />
            </button>
          ))}
          <button type="button" className="text-button">
            <Search size={15} />
            {t.searchAll} “{query}”
          </button>
        </div>
      </section>

      <section className="recent-band" aria-label={t.recent}>
        <div className="section-title">{t.recent}</div>
        <div className="recent-list">
          {tags.slice(0, 5).map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={clsx('recent-chip', selectedTag.id === tag.id && 'selected')}
              onClick={() => selectTag(tag)}
            >
              <span className={clsx('status-dot', tag.status)} />
              <strong>{tag.shortCode}</strong>
              <span>{tag.nickname}</span>
              <b>{formatTemperature(tag.latestTemperature)}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="detail-surface">
        <div className="detail-header">
          <div>
            <div className="tag-title">
              <span className={clsx('status-dot', selectedTag.status)} />
              <strong>{selectedTag.shortCode}</strong>
              <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} placeholder={t.nicknamePlaceholder} />
              <button type="button" className="icon-button" onClick={saveNickname} title={t.nickname}>
                <Edit3 size={16} />
              </button>
            </div>
            <p>{selectedTag.customer} / {selectedTag.site} · {selectedTag.tagCode}</p>
          </div>
          <div className="toolbar">
            <div className="range-control" aria-label={t.timeRange}>
              {timeRanges.map((item) => (
                <button key={item} type="button" className={item === range ? 'active' : ''} onClick={() => setRange(item)}>
                  {item}
                </button>
              ))}
              <button type="button" title={t.timeRange}>
                <CalendarDays size={16} />
              </button>
            </div>
            <button type="button" className="secondary-button" onClick={exportPdf}>
              <Download size={17} />
              {t.exportPdf}
            </button>
            <button type="button" className="icon-button" title="More">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>

        <div className="mobile-tabs">
          {(['table', 'chart', 'report', 'config'] as const).map((view) => (
            <button key={view} type="button" className={activeView === view ? 'active' : ''} onClick={() => setActiveView(view)}>
              {t[view]}
            </button>
          ))}
        </div>

        <div className="metric-row">
          <Metric label={t.temperature} value={formatTemperature(selectedTag.latestTemperature)} tone={selectedTag.status} />
          <Metric label={t.lastSeen} value={`${Math.max(1, Math.round((clockMs - new Date(selectedTag.lastSeenAt).getTime()) / 60000))} ${t.minutesAgo}`} />
          <Metric label={t.battery} value={`${selectedTag.battery}%`} />
          <Metric label={t.rssi} value={`${selectedTag.rssi} dBm`} />
        </div>

        <div className="detail-grid">
          <section className={clsx('records-pane', activeView !== 'table' && 'mobile-hidden')}>
            <RecordsTable readings={selectedReadings} language={language} labels={t} />
          </section>
          <section className={clsx('chart-pane', activeView !== 'chart' && 'mobile-hidden')}>
            <h2>{t.chartTitle}</h2>
            <TemperatureChart
              data={chartData}
              highLimit={selectedTag.highLimit}
              lowLimit={selectedTag.lowLimit}
              highLabel={t.highLimit}
              lowLabel={t.lowLimit}
            />
          </section>
          <section className={clsx('report-pane', activeView !== 'report' && 'desktop-hidden')}>
            <FileText size={26} />
            <h2>{t.report}</h2>
            <p>{t.pdfNote}</p>
            <button type="button" className="secondary-button" onClick={exportPdf}>
              <Download size={17} />
              {t.exportPdf}
            </button>
          </section>
          <section className={clsx('config-pane', activeView !== 'config' && 'desktop-hidden')}>
            <h2>{t.settingsTitle}</h2>
            <p>{t.whitelistHint}</p>
            {allowlist.map((entry) => (
              <div className="allow-row" key={entry.id}>
                <CheckCircle2 size={17} />
                <span>{entry.email}</span>
                <b>{entry.role}</b>
                <small>{entry.tags.join(', ')}</small>
              </div>
            ))}
          </section>
        </div>
      </section>
    </main>
  )
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function TemperatureChart({
  data,
  highLimit,
  lowLimit,
  highLabel,
  lowLabel,
}: {
  data: Array<{ time: string; temperature: number }>
  highLimit: number
  lowLimit: number
  highLabel: string
  lowLabel: string
}) {
  const width = 760
  const height = 320
  const padding = { top: 26, right: 28, bottom: 42, left: 44 }
  const values = data.map((item) => item.temperature)
  const min = Math.min(lowLimit - 3, ...values)
  const max = Math.max(highLimit + 3, ...values)
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const x = (index: number) => padding.left + (plotWidth * index) / Math.max(data.length - 1, 1)
  const y = (value: number) => padding.top + ((max - value) / Math.max(max - min, 1)) * plotHeight
  const points = data.map((item, index) => `${x(index)},${y(item.temperature)}`).join(' ')
  const fillPoints = `${padding.left},${padding.top + plotHeight} ${points} ${padding.left + plotWidth},${padding.top + plotHeight}`
  const ticks = [max, (max + min) / 2, min]
  const bottomLabels = data.filter((_, index) => index % Math.max(1, Math.floor(data.length / 5)) === 0).slice(0, 6)

  return (
    <svg className="temperature-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Temperature trend chart">
      <defs>
        <linearGradient id="temperatureArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0f7a62" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#0f7a62" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={padding.left} x2={padding.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#e7eeeb" />
          <text x={8} y={y(tick) + 4} fontSize="12" fill="#6b7b74">
            {tick.toFixed(0)}
          </text>
        </g>
      ))}
      <line x1={padding.left} x2={padding.left + plotWidth} y1={y(highLimit)} y2={y(highLimit)} stroke="#d84d4d" strokeDasharray="5 5" />
      <line x1={padding.left} x2={padding.left + plotWidth} y1={y(lowLimit)} y2={y(lowLimit)} stroke="#3578e5" strokeDasharray="5 5" />
      <text x={padding.left + plotWidth - 78} y={y(highLimit) - 7} fontSize="12" fill="#d84d4d">
        {highLabel} {highLimit}°C
      </text>
      <text x={padding.left + plotWidth - 78} y={y(lowLimit) + 18} fontSize="12" fill="#3578e5">
        {lowLabel} {lowLimit}°C
      </text>
      <polygon points={fillPoints} fill="url(#temperatureArea)" />
      <polyline points={points} fill="none" stroke="#0f7a62" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {bottomLabels.map((item, index) => (
        <text key={`${item.time}-${index}`} x={x(data.indexOf(item)) - 12} y={height - 14} fontSize="12" fill="#52615b">
          {item.time}
        </text>
      ))}
    </svg>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: TemperatureTag['status'] }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

function RecordsTable({
  readings,
  language,
  labels,
}: {
  readings: TagReading[]
  language: LanguageCode
  labels: Record<string, string>
}) {
  return (
    <div className="records-table">
      <div className="record-row head">
        <span>{labels.time}</span>
        <span>{labels.temperature}</span>
        <span>{labels.rssi}</span>
        <span>{labels.battery}</span>
      </div>
      {readings.slice(0, 12).map((reading) => (
        <div className="record-row" key={reading.id}>
          <span>{new Date(reading.recordedAt).toLocaleString(language)}</span>
          <strong>{formatTemperature(reading.temperature)}</strong>
          <span>{reading.rssi ?? '-'} dBm</span>
          <span>{reading.battery ?? '-'}%</span>
        </div>
      ))}
      <div className="pagination">1-50 / 2880 · 1 2 3 ... 58</div>
    </div>
  )
}
