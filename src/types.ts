export type LanguageCode = 'zh' | 'en' | 'ja' | 'de' | 'fr' | 'es'

export type TagStatus = 'normal' | 'warning' | 'offline'

export type TemperatureTag = {
  id: string
  tagCode: string
  shortCode: string
  nickname: string
  notes: string
  customer: string
  site: string
  status: TagStatus
  latestTemperature: number
  battery: number | null
  rssi: number
  lastSeenAt: string
  highLimit: number
  lowLimit: number
}

export type TagReading = {
  id: string
  tagId: string
  recordedAt: string
  temperature: number
  humidity?: number | null
  battery?: number | null
  rssi?: number | null
}

export type AllowlistEntry = {
  id: string
  email: string
  role: 'viewer' | 'admin'
  tags: string[]
  active: boolean
}
