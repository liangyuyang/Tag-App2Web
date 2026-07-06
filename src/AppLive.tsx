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
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import './styles.css'
import { apiBaseUrl, appBaseUrl, hasSupabaseConfig, supabase } from './lib/supabase'
import { getInitialLanguage, languageOptions, messages } from './lib/i18nLive'
import type { AllowlistEntry, LanguageCode, TagReading, TemperatureTag } from './types'

const internalDomains = ['miaomiaoce.com', 'zenmeasure.com', 'zenmeasure.space']
const timeRanges = ['1h', '6h', '24h', '7d', '30d']
const appVersion = 'v1.02_2026.07.06'

function formatTemperature(value: number) {
  return `${value.toFixed(1)} °C`
}

function formatBattery(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : `${value}%`
}

function formatSignal(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : `${value} dBm`
}

function displayTagName(tag: TemperatureTag) {
  return tag.nickname.trim() || tag.notes.trim() || tag.tagCode
}

function tagMeta(tag: TemperatureTag) {
  return [tag.customer, tag.site, tag.tagCode].filter(Boolean).join(' / ')
}

function pdfText(language: LanguageCode) {
  if (language === 'zh') {
    return {
      title: '无线温度标签报告',
      tag: '标签',
      notes: '备注',
      temperature: '温度',
      highLimit: '高温阈值',
      lowLimit: '低温阈值',
      battery: '电池电量',
      time: '时间',
      rssi: '信号强度',
    }
  }
  return {
    title: 'Wireless Temperature Tag Report',
    tag: 'Tag',
    notes: 'Notes',
    temperature: 'Temperature',
    highLimit: 'High limit',
    lowLimit: 'Low limit',
    battery: 'Battery',
    time: 'Time',
    rssi: 'Signal',
  }
}

function emailDomain(email: string) {
  return email.trim().toLowerCase().split('@')[1] ?? ''
}

function isInternalEmail(email: string) {
  return internalDomains.includes(emailDomain(email))
}

function relativeTime(value: string, language: LanguageCode) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '-'
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (diffMinutes < 60) return rtf.format(-diffMinutes, 'minute')
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 48) return rtf.format(-diffHours, 'hour')
  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 60) return rtf.format(-diffDays, 'day')
  return new Date(value).toLocaleDateString(language)
}

function mapTag(row: Record<string, unknown>): TemperatureTag {
  return {
    id: String(row.id),
    tagCode: String(row.tag_code ?? ''),
    shortCode: String(row.short_code ?? String(row.tag_code ?? '').slice(-4)),
    nickname: String(row.nickname ?? ''),
    notes: String(row.notes ?? ''),
    customer: String(row.customer_name ?? ''),
    site: String(row.site_name ?? ''),
    status: (row.status as TemperatureTag['status']) ?? 'normal',
    latestTemperature: Number(row.latest_temperature ?? 0),
    battery: row.battery_percent === null ? null : Number(row.battery_percent ?? 0),
    rssi: Number(row.rssi ?? 0),
    lastSeenAt: String(row.last_seen_at ?? new Date().toISOString()),
    firstSeenAt: row.first_seen_at ? String(row.first_seen_at) : null,
    readingCount: Number(row.reading_count ?? 0),
    highLimit: Number(row.high_limit ?? 8),
    lowLimit: Number(row.low_limit ?? -2),
  }
}

function mapReading(row: Record<string, unknown>): TagReading {
  return {
    id: String(row.id),
    tagId: String(row.tag_id),
    recordedAt: String(row.recorded_at),
    temperature: Number(row.temperature_c),
    humidity: row.humidity_percent === null ? null : Number(row.humidity_percent ?? 0),
    battery: row.battery_percent === null ? null : Number(row.battery_percent ?? 0),
    rssi: row.rssi === null ? null : Number(row.rssi ?? 0),
  }
}

export default function AppLive() {
  const [language, setLanguage] = useState<LanguageCode>(getInitialLanguage)
  const t = messages[language]
  const [sessionEmail, setSessionEmail] = useState('')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [tags, setTags] = useState<TemperatureTag[]>([])
  const [readings, setReadings] = useState<TagReading[]>([])
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([])
  const [query, setQuery] = useState('')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [highLimitDraft, setHighLimitDraft] = useState('8')
  const [lowLimitDraft, setLowLimitDraft] = useState('-2')
  const [range, setRange] = useState('24h')
  const [activeView, setActiveView] = useState<'table' | 'chart' | 'report' | 'config'>('table')
  const [loading, setLoading] = useState(false)
  const [savingTag, setSavingTag] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  const isInternal = isInternalEmail(sessionEmail)
  const selectedTag = tags.find((tag) => tag.id === selectedTagId) ?? tags[0] ?? null
  const selectedReadings = useMemo(() => readings.filter((reading) => reading.tagId === selectedTag?.id), [readings, selectedTag])
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const source = normalized
      ? tags.filter((tag) =>
          [tag.shortCode, tag.tagCode, tag.nickname, tag.notes, tag.customer, tag.site].some((value) =>
            value.toLowerCase().includes(normalized),
          ),
        )
      : tags
    return source.slice(0, normalized ? 10 : 6)
  }, [query, tags])

  useEffect(() => {
    window.localStorage.setItem('zenmeasure-language', language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language
  }, [language])

  function hydrateDrafts(tag: TemperatureTag) {
    setNicknameDraft(tag.nickname)
    setNotesDraft(tag.notes)
    setHighLimitDraft(String(tag.highLimit))
    setLowLimitDraft(String(tag.lowLimit))
  }

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
    async function loadTags() {
      if (!hasSupabaseConfig || !sessionEmail) return
      setLoading(true)
      const { data, error } = await supabase
        .from('tags')
        .select(
          'id, tag_code, short_code, nickname, notes, customer_name, site_name, status, latest_temperature, battery_percent, rssi, last_seen_at, first_seen_at, reading_count, high_limit, low_limit',
        )
        .order('last_seen_at', { ascending: false })
        .limit(200)
      setLoading(false)
      if (error) {
        setNotice(error.message)
        return
      }
      const mapped = (data ?? []).map((row) => mapTag(row as Record<string, unknown>))
      setTags(mapped)
      const saved = window.localStorage.getItem('zenmeasure-recent-tag')
      const next = mapped.find((tag) => tag.id === saved) ?? mapped[0]
      if (next) {
        setSelectedTagId(next.id)
        hydrateDrafts(next)
      }
    }
    void loadTags()
  }, [sessionEmail])

  useEffect(() => {
    async function loadReadings() {
      if (!hasSupabaseConfig || !sessionEmail || !selectedTagId) return
      const { data, error } = await supabase
        .from('tag_readings')
        .select('id, tag_id, recorded_at, temperature_c, humidity_percent, battery_percent, rssi')
        .eq('tag_id', selectedTagId)
        .order('recorded_at', { ascending: false })
        .limit(500)
      if (error) {
        setNotice(error.message)
        return
      }
      setReadings((current) => [
        ...current.filter((reading) => reading.tagId !== selectedTagId),
        ...(data ?? []).map((row) => mapReading(row as Record<string, unknown>)),
      ])
    }
    void loadReadings()
  }, [selectedTagId, sessionEmail])

  useEffect(() => {
    async function loadAllowlist() {
      if (!hasSupabaseConfig || !sessionEmail || !isInternal) return
      const { data } = await supabase
        .from('customer_email_allowlist')
        .select('id, email, role, active')
        .order('created_at', { ascending: false })
      setAllowlist(
        (data ?? []).map((row) => ({
          id: String(row.id),
          email: String(row.email),
          role: row.role === 'admin' ? 'admin' : 'viewer',
          tags: [],
          active: Boolean(row.active),
        })),
      )
    }
    void loadAllowlist()
  }, [isInternal, sessionEmail])

  function selectTag(tag: TemperatureTag) {
    setSelectedTagId(tag.id)
    hydrateDrafts(tag)
    setSaveOk(false)
    setActiveView('table')
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
      } else if (!isInternalEmail(normalizedEmail)) {
        throw new Error('External customer emails require the Worker allowlist precheck.')
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: appBaseUrl, shouldCreateUser: true },
      })
      if (error) throw error
      setNotice(t.sendSuccess)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to send Magic Link.')
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSessionEmail('')
  }

  async function saveTagSettings() {
    if (!selectedTag) return
    setSavingTag(true)
    setSaveOk(false)
    setNotice('')
    const highLimit = Number(highLimitDraft)
    const lowLimit = Number(lowLimitDraft)
    if (!Number.isFinite(highLimit) || !Number.isFinite(lowLimit)) {
      setSavingTag(false)
      setNotice('阈值必须是数字。')
      return
    }
    if (lowLimit >= highLimit) {
      setSavingTag(false)
      setNotice('低温阈值必须低于高温阈值。')
      return
    }
    const patch = {
      nickname: nicknameDraft,
      notes: notesDraft,
      high_limit: highLimit,
      low_limit: lowLimit,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('tags').update(patch).eq('id', selectedTag.id)
    if (error) {
      setSavingTag(false)
      setNotice(error.message)
      return
    }
    setTags((current) =>
      current.map((tag) =>
        tag.id === selectedTag.id ? { ...tag, nickname: nicknameDraft, notes: notesDraft, highLimit, lowLimit } : tag,
      ),
    )
    setSavingTag(false)
    setSaveOk(true)
    setNotice('已保存标签备注和阈值。')
    window.setTimeout(() => setSaveOk(false), 2200)
  }

  function exportPdf() {
    if (!selectedTag) return
    const labels = pdfText(language)
    const name = displayTagName(selectedTag)
    const meta = tagMeta(selectedTag)
    const rows = selectedReadings
      .slice(0, 80)
      .map(
        (reading) => `<tr><td>${escapeHtml(new Date(reading.recordedAt).toLocaleString(language))}</td><td>${escapeHtml(formatTemperature(reading.temperature))}</td><td>${escapeHtml(formatSignal(reading.rssi))}</td><td>${escapeHtml(formatBattery(reading.battery))}</td></tr>`,
      )
      .join('')
    const html = `<!doctype html><html lang="${language === 'zh' ? 'zh-CN' : language}"><head><meta charset="UTF-8" /><title>${escapeHtml(selectedTag.tagCode)} ZenMeasure Report</title><style>
      body{font-family:"Microsoft YaHei","Noto Sans CJK SC","PingFang SC",Arial,sans-serif;color:#17221d;margin:40px}header{border-bottom:3px solid #0f7a62;padding-bottom:18px;margin-bottom:26px}
      h1{color:#0f7a62;margin:0;font-size:30px}h2{margin:6px 0 0;font-size:16px;color:#45645a}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.metric{border:1px solid #dfe8e4;border-radius:7px;padding:12px}
      .metric span{display:block;color:#64736d;font-size:12px;margin-bottom:6px}.metric strong{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}
      th{text-align:left;background:#0f7a62;color:white;padding:9px}td{border-bottom:1px solid #dfe8e4;padding:8px 9px}footer{margin-top:28px;color:#64736d;font-size:11px}
      @media print{body{margin:18mm}button{display:none}}</style></head><body>
      <header><h1>ZenMeasure</h1><h2>${escapeHtml(labels.title)}</h2></header>
      <h2>${escapeHtml(labels.tag)}: ${escapeHtml(selectedTag.tagCode)}${name !== selectedTag.tagCode ? ` / ${escapeHtml(name)}` : ''}</h2>${meta ? `<p>${escapeHtml(meta)}</p>` : ''}
      <section class="summary"><div class="metric"><span>${escapeHtml(labels.temperature)}</span><strong>${escapeHtml(formatTemperature(selectedTag.latestTemperature))}</strong></div>
      <div class="metric"><span>${escapeHtml(labels.highLimit)}</span><strong>${selectedTag.highLimit} °C</strong></div><div class="metric"><span>${escapeHtml(labels.lowLimit)}</span><strong>${selectedTag.lowLimit} °C</strong></div>
      <div class="metric"><span>${escapeHtml(labels.battery)}</span><strong>${escapeHtml(formatBattery(selectedTag.battery))}</strong></div></section>
      ${selectedTag.notes ? `<p><strong>${escapeHtml(labels.notes)}:</strong> ${escapeHtml(selectedTag.notes)}</p>` : ''}
      <table><thead><tr><th>${escapeHtml(labels.time)}</th><th>${escapeHtml(labels.temperature)}</th><th>${escapeHtml(labels.rssi)}</th><th>${escapeHtml(labels.battery)}</th></tr></thead><tbody>${rows}</tbody></table>
      <footer>ZenMeasure / 秒秒测 · ${new Date().toLocaleString(language)}</footer><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`
    const url = URL.createObjectURL(new Blob([`\uFEFF${html}`], { type: 'text/html;charset=utf-8' }))
    const report = window.open(url, '_blank', 'width=900,height=1100')
    if (!report) {
      setNotice('浏览器阻止了弹出窗口，请允许本站弹窗后再导出。')
      URL.revokeObjectURL(url)
      return
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  if (!hasSupabaseConfig) {
    return <SetupNotice language={language} setLanguage={setLanguage} message={t.noConfig} />
  }

  if (!sessionEmail) {
    return (
      <main className="login-shell">
        <LanguageSwitch language={language} setLanguage={setLanguage} compact />
        <section className="login-panel">
          <BrandLogo />
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
        <BrandLogo />
        <div className="top-actions-right">
          <span className="version-pill">{appVersion}</span>
          <LanguageSwitch language={language} setLanguage={setLanguage} />
          {isInternal && (
            <button type="button" className="ghost-button" onClick={() => setActiveView('config')}>
              <Settings size={17} />
              {t.admin}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={signOut}>
            <LogOut size={17} />
            {t.signOut}
          </button>
        </div>
      </header>

      {notice && <div className="app-notice">{notice}</div>}

      <section className="search-hero compact-hero">
        <p>{t.appSubtitle}</p>
        <div className="search-box">
          <Search size={21} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder={t.dashboardHint}
          />
          {query && (
            <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="清空搜索">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="match-panel">
          <div className="table-head-wrap">
            <div className="table-head">
              <span>{t.tagId}</span>
              <span>备注</span>
              <span>{t.temperature}</span>
              <span>{t.lastSeen}</span>
              <span>数据量</span>
              <span>开始时间</span>
            </div>
            {!query.trim() && <span className="list-note">只显示最后更新的6个标签</span>}
          </div>
          {matches.map((tag) => (
            <button key={tag.id} type="button" className="match-row" onClick={() => selectTag(tag)}>
              <span>
                <strong>{tag.tagCode}</strong>
                <small>({tag.shortCode})</small>
              </span>
              <span>{tag.notes || tag.nickname || '-'}</span>
              <strong className={clsx('temp', tag.status)}>{formatTemperature(tag.latestTemperature)}</strong>
              <span>{relativeTime(tag.lastSeenAt, language)}</span>
              <span>{tag.readingCount}</span>
              <span>{tag.firstSeenAt ? new Date(tag.firstSeenAt).toLocaleString(language) : '-'}</span>
              <ChevronRight size={16} />
            </button>
          ))}
          {matches.length === 0 && <div className="empty-state">{loading ? 'Loading...' : t.emptyTags}</div>}
          {query && matches.length > 0 && (
            <button type="button" className="text-button">
              <Search size={14} />
              {t.searchAll} "{query}"
            </button>
          )}
        </div>
      </section>

      {selectedTag ? (
        <TagDetail
          activeView={activeView}
          allowlist={allowlist}
          exportPdf={exportPdf}
          highLimitDraft={highLimitDraft}
          isInternal={isInternal}
          language={language}
          lowLimitDraft={lowLimitDraft}
          nicknameDraft={nicknameDraft}
          notesDraft={notesDraft}
          range={range}
          readings={selectedReadings}
          relativeLastSeen={relativeTime(selectedTag.lastSeenAt, language)}
          saveTagSettings={saveTagSettings}
          saveOk={saveOk}
          savingTag={savingTag}
          selectedTag={selectedTag}
          setActiveView={setActiveView}
          setHighLimitDraft={setHighLimitDraft}
          setLowLimitDraft={setLowLimitDraft}
          setNicknameDraft={setNicknameDraft}
          setNotesDraft={setNotesDraft}
          setRange={setRange}
          t={t}
        />
      ) : (
        <section className="detail-surface empty-state">{t.emptyTags}</section>
      )}
    </main>
  )
}

function BrandLogo() {
  return (
    <div className="brand-logo" aria-label="秒秒测 ZenMeasure">
      <img src="/zenmeasure-logo-2024.png" alt="秒秒测 ZenMeasure" />
    </div>
  )
}

function LanguageSwitch({
  language,
  setLanguage,
  compact,
}: {
  language: LanguageCode
  setLanguage: (language: LanguageCode) => void
  compact?: boolean
}) {
  return (
    <div className={clsx('language-switch', compact && 'compact')}>
      <Languages size={16} />
      <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageCode)}>
        {languageOptions.map((option) => (
          <option key={option.code} value={option.code}>
            {option.native}
          </option>
        ))}
      </select>
    </div>
  )
}

function SetupNotice({ language, setLanguage, message }: { language: LanguageCode; setLanguage: (language: LanguageCode) => void; message: string }) {
  return (
    <main className="login-shell">
      <LanguageSwitch language={language} setLanguage={setLanguage} compact />
      <section className="login-panel">
        <BrandLogo />
        <h1>ZenMeasure</h1>
        <p>{message}</p>
      </section>
    </main>
  )
}

function TagDetail({
  activeView,
  allowlist,
  exportPdf,
  highLimitDraft,
  isInternal,
  language,
  lowLimitDraft,
  nicknameDraft,
  notesDraft,
  range,
  readings,
  relativeLastSeen,
  saveTagSettings,
  saveOk,
  savingTag,
  selectedTag,
  setActiveView,
  setHighLimitDraft,
  setLowLimitDraft,
  setNicknameDraft,
  setNotesDraft,
  setRange,
  t,
}: {
  activeView: 'table' | 'chart' | 'report' | 'config'
  allowlist: AllowlistEntry[]
  exportPdf: () => void
  highLimitDraft: string
  isInternal: boolean
  language: LanguageCode
  lowLimitDraft: string
  nicknameDraft: string
  notesDraft: string
  range: string
  readings: TagReading[]
  relativeLastSeen: string
  saveTagSettings: () => void
  saveOk: boolean
  savingTag: boolean
  selectedTag: TemperatureTag
  setActiveView: (view: 'table' | 'chart' | 'report' | 'config') => void
  setHighLimitDraft: (value: string) => void
  setLowLimitDraft: (value: string) => void
  setNicknameDraft: (value: string) => void
  setNotesDraft: (value: string) => void
  setRange: (range: string) => void
  t: Record<string, string>
}) {
  const chartData = [...readings]
    .reverse()
    .slice(-80)
    .map((reading) => ({
      time: new Date(reading.recordedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }),
      temperature: reading.temperature,
    }))

  const tabs: Array<'table' | 'chart' | 'report' | 'config'> = isInternal ? ['table', 'chart', 'report', 'config'] : ['table', 'chart', 'report']

  return (
    <section className="detail-surface">
      <div className="detail-header">
        <div>
          <div className="tag-title">
            <span className={clsx('status-dot', selectedTag.status)} />
            <strong>{selectedTag.shortCode}</strong>
            <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} placeholder={t.nicknamePlaceholder} />
            <button type="button" className="icon-button note-button" onClick={saveTagSettings} title="写备注" aria-label="写备注">
              {saveOk ? <CheckCircle2 size={16} /> : <Edit3 size={15} />}
            </button>
          </div>
          {tagMeta(selectedTag) && <p>{tagMeta(selectedTag)}</p>}
        </div>
        <div className="toolbar">
          <div className="range-control" aria-label={t.timeRange}>
            {timeRanges.map((item) => (
              <button key={item} type="button" className={item === range ? 'active' : ''} onClick={() => setRange(item)}>
                {item}
              </button>
            ))}
            <button type="button" title={t.timeRange}>
              <CalendarDays size={15} />
            </button>
          </div>
          <button type="button" className="secondary-button" onClick={exportPdf}>
            <Download size={16} />
            {t.exportPdf}
          </button>
          <button type="button" className="icon-button" title="More">
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>

      <div className="mobile-tabs">
        {tabs.map((view) => (
          <button key={view} type="button" className={activeView === view ? 'active' : ''} onClick={() => setActiveView(view)}>
            {t[view]}
          </button>
        ))}
      </div>

      <div className="metric-row">
        <Metric label={t.temperature} value={formatTemperature(selectedTag.latestTemperature)} tone={selectedTag.status} />
        <Metric label={t.lastSeen} value={relativeLastSeen} />
        <Metric label={t.battery} value={formatBattery(selectedTag.battery)} />
        <Metric label={t.rssi} value={formatSignal(selectedTag.rssi)} />
      </div>

      {activeView === 'config' && isInternal ? (
        <section className="config-pane full-pane">
          <h2>{t.settingsTitle}</h2>
          <p>{t.whitelistHint}</p>
          {allowlist.map((entry) => (
            <div className="allow-row" key={entry.id}>
              <CheckCircle2 size={16} />
              <span>{entry.email}</span>
              <b>{entry.role}</b>
              <small>{entry.active ? 'active' : 'inactive'}</small>
            </div>
          ))}
        </section>
      ) : (
        <div className="detail-grid">
          <section className={clsx('records-pane', activeView !== 'table' && 'mobile-hidden')}>
            <div className="tag-settings">
              <label>
                <span>备注</span>
                <input value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="例如：京NED666的车厘子" />
              </label>
              <label>
                <span>{t.lowLimit}</span>
                <input inputMode="decimal" value={lowLimitDraft} onChange={(event) => setLowLimitDraft(event.target.value)} />
              </label>
              <label>
                <span>{t.highLimit}</span>
                <input inputMode="decimal" value={highLimitDraft} onChange={(event) => setHighLimitDraft(event.target.value)} />
              </label>
              <button type="button" className="secondary-button" onClick={saveTagSettings}>
                {savingTag ? '保存中' : saveOk ? '✓ 已保存' : '保存'}
              </button>
            </div>
            <RecordsTable readings={readings} language={language} labels={t} />
          </section>
          <section className={clsx('chart-pane', activeView !== 'chart' && 'mobile-hidden')}>
            <h2>{t.chartTitle}</h2>
            <TemperatureChart data={chartData} highLimit={selectedTag.highLimit} lowLimit={selectedTag.lowLimit} highLabel={t.highLimit} lowLabel={t.lowLimit} emptyLabel={t.emptyReadings} />
          </section>
          <section className={clsx('report-pane', activeView !== 'report' && 'desktop-hidden')}>
            <FileText size={24} />
            <h2>{t.report}</h2>
            <p>{t.pdfNote}</p>
            <button type="button" className="secondary-button" onClick={exportPdf}>
              <Download size={16} />
              {t.exportPdf}
            </button>
          </section>
        </div>
      )}
    </section>
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

function RecordsTable({ readings, language, labels }: { readings: TagReading[]; language: LanguageCode; labels: Record<string, string> }) {
  if (readings.length === 0) return <div className="empty-state">{labels.emptyReadings}</div>
  return (
    <div className="records-table">
      <div className="record-row head">
        <span>{labels.time}</span>
        <span>{labels.temperature}</span>
        <span>{labels.rssi}</span>
        <span>{labels.battery}</span>
      </div>
      {readings.slice(0, 16).map((reading) => (
        <div className="record-row" key={reading.id}>
          <span>{new Date(reading.recordedAt).toLocaleString(language)}</span>
          <strong>{formatTemperature(reading.temperature)}</strong>
          <span>{formatSignal(reading.rssi)}</span>
          <span>{formatBattery(reading.battery)}</span>
        </div>
      ))}
      <div className="pagination">1-{Math.min(readings.length, 16)} / {readings.length}</div>
    </div>
  )
}

function TemperatureChart({
  data,
  highLimit,
  lowLimit,
  highLabel,
  lowLabel,
  emptyLabel,
}: {
  data: Array<{ time: string; temperature: number }>
  highLimit: number
  lowLimit: number
  highLabel: string
  lowLabel: string
  emptyLabel: string
}) {
  if (data.length === 0) return <div className="empty-state chart-empty">{emptyLabel}</div>
  const width = 760
  const height = 284
  const padding = { top: 20, right: 26, bottom: 34, left: 38 }
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
          <stop offset="0%" stopColor="#0f7a62" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0f7a62" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={padding.left} x2={padding.left + plotWidth} y1={y(tick)} y2={y(tick)} stroke="#e7eeeb" />
          <text x={8} y={y(tick) + 4} fontSize="11" fill="#6b7b74">
            {tick.toFixed(0)}
          </text>
        </g>
      ))}
      <line x1={padding.left} x2={padding.left + plotWidth} y1={y(highLimit)} y2={y(highLimit)} stroke="#d84d4d" strokeDasharray="5 5" />
      <line x1={padding.left} x2={padding.left + plotWidth} y1={y(lowLimit)} y2={y(lowLimit)} stroke="#3578e5" strokeDasharray="5 5" />
      <text x={padding.left + plotWidth - 82} y={y(highLimit) - 6} fontSize="11" fill="#d84d4d">
        {highLabel} {highLimit}°C
      </text>
      <text x={padding.left + plotWidth - 82} y={y(lowLimit) + 16} fontSize="11" fill="#3578e5">
        {lowLabel} {lowLimit}°C
      </text>
      <polygon points={fillPoints} fill="url(#temperatureArea)" />
      <polyline points={points} fill="none" stroke="#0f7a62" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {bottomLabels.map((item, index) => (
        <text key={`${item.time}-${index}`} x={x(data.indexOf(item)) - 10} y={height - 11} fontSize="10" fill="#52615b">
          {item.time}
        </text>
      ))}
    </svg>
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


