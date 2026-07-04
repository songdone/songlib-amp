import fs from 'node:fs'
import vm from 'node:vm'

const scriptPath = process.argv[2]
if (!scriptPath) throw new Error('missing source path')

let inited = null
let requestHandler = null
const EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' }
const moduleObject = { exports: {} }
const lx = {
  EVENT_NAMES,
  version: '2.0.0',
  env: 'desktop',
  currentScriptInfo: { rawScript: fs.readFileSync(scriptPath, 'utf8') },
  request(url, options, callback) {
    queueMicrotask(() => callback(new Error('network disabled during format inspection'), null, null))
    return () => {}
  },
  async on(name, handler) {
    if (name === EVENT_NAMES.request) requestHandler = handler
  },
  async send(name, data) {
    if (name === EVENT_NAMES.inited) inited = data
  },
  utils: {
    crypto: { md5() { return '' }, randomBytes(size) { return Buffer.alloc(size) } },
    buffer: { from(...args) { return Buffer.from(...args) }, bufToString(buf, format) { return Buffer.from(buf).toString(format) } },
    zlib: { inflate: async value => value, deflate: async value => value },
  },
}

const sandbox = {
  lx, module: moduleObject, exports: moduleObject.exports,
  console: { log() {}, warn() {}, error() {}, debug() {}, info() {} },
  Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout,
  setInterval, clearInterval, atob: value => Buffer.from(value, 'base64').toString('binary'),
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
}
const baseline = new Set(Object.keys(sandbox))
const context = vm.createContext(sandbox, { name: 'songlib-source-inspector', codeGeneration: { strings: true, wasm: false } })
vm.runInContext('globalThis.window=globalThis;globalThis.self=globalThis;', context)

let code = fs.readFileSync(scriptPath, 'utf8')
let esmDefault = false
if (/\bexport\s+default\b/.test(code)) {
  code = code.replace(/\bexport\s+default\b/, 'globalThis.__songlibDefault =')
  esmDefault = true
}
let loadError = null
try {
  new vm.Script(code, { filename: 'user-source.js' }).runInContext(context, { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 80))
} catch (error) {
  loadError = String(error?.message || error)
}

const globals = Object.keys(sandbox).filter(key => !baseline.has(key) && !['window', 'self'].includes(key))
const exported = esmDefault ? sandbox.__songlibDefault : moduleObject.exports
const hasExport = exported != null && (typeof exported === 'function' || (typeof exported === 'object' && Object.keys(exported).length))
const candidate = hasExport ? exported : globals.map(key => sandbox[key]).find(value => value && (typeof value === 'object' || typeof value === 'function'))
const keys = candidate && typeof candidate === 'object' ? Object.keys(candidate).slice(0, 100) : []
const methodNames = new Set()
const collect = value => {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
  for (const key of Object.keys(value).slice(0, 100)) if (typeof value[key] === 'function') methodNames.add(key)
}
collect(candidate)
if (Array.isArray(candidate)) candidate.slice(0, 20).forEach(collect)
const hasAny = names => names.some(name => methodNames.has(name))
const sources = inited?.sources && typeof inited.sources === 'object' ? inited.sources : {}
const lxResolve = Boolean(requestHandler) && Object.values(sources).some(info => Array.isArray(info?.actions) && info.actions.includes('musicUrl'))
const methods = {
  search: hasAny(['search', 'searchMusic', 'query', 'searchSong']),
  resolve: lxResolve || hasAny(['resolve', 'getMusicUrl', 'musicUrl', 'getUrl', 'url']),
  lyric: Object.values(sources).some(info => info?.actions?.includes?.('lyric')) || hasAny(['getLyric', 'lyric']),
  cover: Object.values(sources).some(info => info?.actions?.includes?.('pic')) || hasAny(['getCover', 'getPic', 'pic']),
  album: hasAny(['getAlbum', 'album']), playlist: hasAny(['getPlaylist', 'playlist']), chart: hasAny(['getChart', 'chart']),
}
let detectedFormat = 'unknown'
if (inited && requestHandler) detectedFormat = 'lx-event'
else if (esmDefault) detectedFormat = 'esm-default'
else if (hasExport) detectedFormat = 'commonjs'
else if (globals.length) detectedFormat = 'global-iife'
const compatibility = detectedFormat === 'lx-event' && methods.resolve ? 'full' : (methods.search || methods.resolve ? 'partial' : 'none')

process.stdout.write(JSON.stringify({
  ok: compatibility !== 'none' && !loadError,
  detected_format: detectedFormat,
  export_type: Array.isArray(candidate) ? 'array' : typeof candidate,
  top_level_keys: detectedFormat === 'lx-event' ? ['lx.EVENT_NAMES', 'lx.on', 'lx.send', 'lx.request'] : keys,
  global_keys: globals.slice(0, 100), methods, compatibility, source_info: inited,
  catalog_search_adapter: detectedFormat === 'lx-event', load_error: loadError,
}))
