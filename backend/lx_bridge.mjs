import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import dns from 'node:dns/promises'
import net from 'node:net'

const [scriptPath] = process.argv.slice(2)
if (!scriptPath) throw new Error('missing source script path')

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const requestPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'))

let requestHandler = null
let sourceInfo = null
let initResolve
let initReject
const initPromise = new Promise((resolve, reject) => { initResolve = resolve; initReject = reject })

const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }
const allowProxyFakeIps = process.env.ALLOW_PROXY_FAKE_IPS === 'true'

const isPrivateAddress = address => {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9')
    || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('2001:db8:')
}

const isProxyFakeAddress = address => {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  if (!net.isIPv4(normalized)) return false
  const [a, b] = normalized.split('.').map(Number)
  return a === 198 && (b === 18 || b === 19)
}

const assertPublicUrl = async value => {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('source request only allows http/https')
  if (parsed.username || parsed.password) throw new Error('source request URL credentials are blocked')
  if (parsed.hostname.toLowerCase() === 'localhost' || parsed.hostname.toLowerCase().endsWith('.localhost')) {
    throw new Error('source request to localhost is blocked')
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true })
  const directIp = net.isIP(parsed.hostname.replace(/^\[|\]$/g, '')) !== 0
  const blocked = addresses.some(item => isPrivateAddress(item.address) && !(allowProxyFakeIps && !directIp && isProxyFakeAddress(item.address)))
  if (!addresses.length || blocked) {
    throw new Error(`source request to private or reserved network is blocked: ${parsed.hostname} -> ${addresses.map(item => item.address).join(',')}`)
  }
}

const safeFetch = async (url, options = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(Number(options.timeout) || 30000, 60000))
  try {
    const init = { method: (options.method || 'get').toUpperCase(), headers: options.headers || {}, signal: controller.signal }
    if (options.body != null) init.body = options.body
    if (options.form) {
      init.body = new URLSearchParams(options.form)
      init.headers = { 'content-type': 'application/x-www-form-urlencoded', ...init.headers }
    }
    if (options.formData) {
      const form = new FormData()
      for (const [key, value] of Object.entries(options.formData)) form.append(key, value)
      init.body = form
    }
    let current = String(url)
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicUrl(current)
      const response = await fetch(current, { ...init, redirect: 'manual' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error('source request redirect has no location')
        current = new URL(location, current).toString()
        continue
      }
      const declared = Number(response.headers.get('content-length') || 0)
      if (declared > 10 * 1024 * 1024) throw new Error('source request response is too large')
      const raw = Buffer.from(await response.arrayBuffer())
      if (raw.length > 10 * 1024 * 1024) throw new Error('source request response is too large')
      let body = raw.toString('utf8')
      try { body = JSON.parse(body) } catch {}
      return {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bytes: raw.length,
        raw,
        body,
      }
    }
    throw new Error('source request has too many redirects')
  } finally {
    clearTimeout(timer)
  }
}

const lx = {
  EVENT_NAMES,
  version: '2.0.0',
  env: 'desktop',
  currentScriptInfo: { rawScript: fs.readFileSync(scriptPath, 'utf8') },
  request(url, options, callback) {
    let cancelled = false
    safeFetch(url, options).then(response => {
      if (!cancelled) callback(null, response, response.body)
    }).catch(error => {
      if (!cancelled) callback(error, null, null)
    })
    return () => { cancelled = true }
  },
  async send(eventName, data) {
    if (eventName === EVENT_NAMES.inited) {
      sourceInfo = data
      initResolve(data)
      return
    }
    if (eventName === EVENT_NAMES.updateAlert) return
    throw new Error(`unsupported event: ${eventName}`)
  },
  async on(eventName, handler) {
    if (eventName !== EVENT_NAMES.request) throw new Error(`unsupported event: ${eventName}`)
    requestHandler = handler
  },
  utils: {
    crypto: {
      aesEncrypt(buffer, mode, key, iv) {
        const cipher = crypto.createCipheriv(mode, key, iv)
        return Buffer.concat([cipher.update(buffer), cipher.final()])
      },
      rsaEncrypt(buffer, key) {
        const padded = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
        return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, padded)
      },
      randomBytes(size) { return crypto.randomBytes(size) },
      md5(value) { return crypto.createHash('md5').update(value).digest('hex') },
    },
    buffer: {
      from(...args) { return Buffer.from(...args) },
      bufToString(buf, format) { return Buffer.from(buf, 'binary').toString(format) },
    },
    zlib: {
      inflate(buf) { return new Promise((resolve, reject) => zlib.inflate(buf, (err, data) => err ? reject(err) : resolve(data))) },
      deflate(data) { return new Promise((resolve, reject) => zlib.deflate(data, (err, buf) => err ? reject(err) : resolve(buf))) },
    },
  },
}

const sandbox = {
  lx,
  console: { log() {}, warn() {}, error() {}, debug() {}, info() {}, group() {}, groupEnd() {}, time() {}, timeEnd() {} },
  Buffer,
  URL,
  URLSearchParams,
  FormData,
  Blob,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  atob: value => Buffer.from(value, 'base64').toString('binary'),
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
}

const code = fs.readFileSync(scriptPath, 'utf8')
const context = vm.createContext(sandbox, { name: 'lx-source-sandbox', codeGeneration: { strings: true, wasm: false } })
vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context)
try {
  new vm.Script(code, { filename: 'user-source.js' }).runInContext(context, { timeout: 5000 })
} catch (error) {
  initReject(error)
}

await Promise.race([
  initPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('source initialization timeout')), 12000)),
])
if (requestPayload.action === '__init__') {
  process.stdout.write(JSON.stringify({ ok: true, sourceInfo, result: null }), () => process.exit(0))
  await new Promise(() => {})
}
if (!requestHandler) throw new Error('source did not register request handler')

const result = await Promise.race([
  Promise.resolve(requestHandler.call(lx, requestPayload)),
  new Promise((_, reject) => setTimeout(() => reject(new Error('source request timeout')), 45000)),
])
process.stdout.write(JSON.stringify({ ok: true, sourceInfo, result }), () => process.exit(0))
