import mqtt from 'mqtt'
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadEnvFile('.env.ingest')

const required = ['MQTT_URL', 'MQTT_USERNAME', 'MQTT_PASSWORD', 'MQTT_TOPIC', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
const missing = required.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function normalizeTagCode(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

function readNumber(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key]
    if (value === null || value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function parsePayload(topic, buffer) {
  const text = buffer.toString('utf8').trim()
  let payload = {}
  try {
    payload = JSON.parse(text)
  } catch {
    payload = Object.fromEntries(
      text
        .split(/[,\s]+/)
        .map((pair) => pair.split(/[=:]/))
        .filter((pair) => pair.length === 2),
    )
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => parsePayloadObject(topic, item))
  }

  return [parsePayloadObject(topic, payload)]
}

function parsePayloadObject(topic, payload) {
  const topicParts = topic.split('/').filter(Boolean)
  const tagCode = normalizeTagCode(
    payload.tag_code ??
      payload.tagCode ??
      payload.tag_id ??
      payload.tagId ??
      payload.mac ??
      payload.device ??
      payload.device_id ??
      topicParts.at(-1),
  )
  const temperature = readNumber(payload, ['temperature_c', 'temperature', 'temp_c', 'temp', 't'])
  const humidity = readNumber(payload, ['humidity_percent', 'humidity', 'hum', 'rh'])
  const battery = readNumber(payload, ['battery_percent', 'battery', 'bat', 'power'])
  const rssi = readNumber(payload, ['rssi', 'signal'])
  const recordedAt = new Date(payload.recorded_at ?? payload.timestamp ?? payload.time ?? Date.now())
  const overTempStatus = String(payload.overTempStatus ?? payload.over_temp_status ?? payload.status ?? '').toUpperCase()
  const status = overTempStatus === 'HIGH' || overTempStatus === 'LOW' || overTempStatus === 'WARNING' ? 'warning' : 'normal'

  return {
    tagCode: tagCode ? `TAG-${tagCode.slice(-6)}` : '',
    temperature,
    humidity,
    battery,
    rssi,
    status,
    recordedAt: Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt,
    rawPayload: payload,
  }
}

async function upsertReading(topic, packet) {
  const readings = parsePayload(topic, packet)
  let saved = 0
  let skipped = 0

  for (const parsed of readings) {
    if (!parsed.tagCode || parsed.temperature === null) {
      skipped += 1
      continue
    }

    const { data: tag, error: tagError } = await supabase
      .from('tags')
      .upsert(
        {
          tag_code: parsed.tagCode,
          status: parsed.status,
          latest_temperature: parsed.temperature,
          latest_humidity: parsed.humidity,
          battery_percent: parsed.battery,
          rssi: parsed.rssi,
          last_seen_at: parsed.recordedAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tag_code' },
      )
      .select('id')
      .single()

    if (tagError) throw new Error(tagError.message)

    const { error: readingError } = await supabase.from('tag_readings').upsert(
      {
        tag_id: tag.id,
        recorded_at: parsed.recordedAt.toISOString(),
        temperature_c: parsed.temperature,
        humidity_percent: parsed.humidity,
        battery_percent: parsed.battery,
        rssi: parsed.rssi,
        mqtt_topic: topic,
        raw_payload: parsed.rawPayload,
      },
      { onConflict: 'tag_id,recorded_at' },
    )

    if (readingError) throw new Error(readingError.message)
    const { count, error: countError } = await supabase
      .from('tag_readings')
      .select('id', { count: 'exact', head: true })
      .eq('tag_id', tag.id)
    if (countError) throw new Error(countError.message)

    const { data: firstReading, error: firstError } = await supabase
      .from('tag_readings')
      .select('recorded_at')
      .eq('tag_id', tag.id)
      .order('recorded_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstError) throw new Error(firstError.message)

    const { error: statsError } = await supabase
      .from('tags')
      .update({
        reading_count: count ?? 0,
        first_seen_at: firstReading?.recorded_at ?? parsed.recordedAt.toISOString(),
      })
      .eq('id', tag.id)
    if (statsError) throw new Error(statsError.message)

    saved += 1
  }

  console.log(`${new Date().toISOString()} ${topic} saved=${saved} skipped=${skipped}`)
}

const client = mqtt.connect(process.env.MQTT_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  reconnectPeriod: 5000,
  clean: true,
})

client.on('connect', () => {
  console.log(`Connected to MQTT. Subscribing ${process.env.MQTT_TOPIC}`)
  client.subscribe(process.env.MQTT_TOPIC, { qos: 0 }, (error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
})

client.on('message', (topic, packet) => {
  upsertReading(topic, packet).catch((error) => console.error(error))
})

client.on('error', (error) => console.error(error))
