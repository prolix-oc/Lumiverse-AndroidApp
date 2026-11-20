#!/usr/bin/env bun
/** Disposable hosted fixture; never clears app/account storage. */
import assert from 'node:assert/strict'
import { join } from 'node:path'

const serial = process.argv[process.argv.indexOf('--serial') + 1]
if (!serial?.startsWith('emulator-')) throw new Error('Select a disposable emulator with --serial emulator-PORT')
const baseline = process.argv.includes('--baseline')
const adb = join(process.env.ANDROID_HOME || join(process.env.HOME!, 'Library/Android/sdk'), 'platform-tools/adb')
async function command(...args: string[]) {
  const child = Bun.spawn([adb, '-s', serial!, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code) throw new Error(error || out)
  return out.trim()
}

const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/sw.js') return new Response(`
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event => {
      if (event.request.mode === 'navigate') event.respondWith(new Response(
        '<!doctype html><div id="root"></div><script type="module" src="/missing-old-bundle.js"></script>',
        { headers: { 'Content-Type': 'text/html' } }));
    });`, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } })
  if (path === '/missing-old-bundle.js') return new Response('Removed old bundle', { status: 404 })
  return new Response(`<!doctype html><title>Startup recovery fixture</title><div id="root">${path === '/broken' ? '' : '<main>Current APK frontend</main>'}</div>`,
    { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } })
} })

let socket: WebSocket | undefined
let debuggerPort: string | undefined
let original: string | undefined
let id = 0
const pending = new Map<number, (message: any) => void>()
async function cdp(method: string, params: object = {}) {
  const requestId = ++id
  const result = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)) }, 15000)
    pending.set(requestId, message => {
      clearTimeout(timer)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
  })
  socket!.send(JSON.stringify({ id: requestId, method, params }))
  return result
}
async function evaluate(expression: string) {
  const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails))
  return reply.result.value
}
async function wait(expression: string, milliseconds = 40000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    try { if (await evaluate(expression)) return } catch { /* Navigations replace execution contexts. */ }
    await Bun.sleep(250)
  }
  throw new Error(`Timed out: ${expression}`)
}

try {
  await command('reverse', `tcp:${server.port}`, `tcp:${server.port}`)
  const pid = (await command('shell', 'pidof', 'chat.lumiverse.prototype')).split(' ')[0]
  debuggerPort = await command('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  const pages = await (await fetch(`http://127.0.0.1:${debuggerPort}/json`)).json() as any[]
  socket = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(new Error('WebView debugger unavailable')) })
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data))
    const reply = pending.get(message.id)
    if (reply) { pending.delete(message.id); reply(message) }
  }
  original = await evaluate('location.href')
  const origin = `http://127.0.0.1:${server.port}`
  await cdp('Page.navigate', { url: origin })
  await wait("!!document.querySelector('main')")
  await Bun.sleep(250)
  await evaluate(`(async () => {
    localStorage.setItem('startup-probe', 'preserved'); document.cookie = 'startup-probe=preserved;path=/';
    for (const name of ['workbox-precache-v2-' + location.origin + '/', 'avatar-cache', 'extension-assets']) await caches.open(name);
    await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  })()`)
  await wait('!!navigator.serviceWorker.controller')
  await cdp('Page.navigate', { url: origin })
  if (baseline) {
    await wait("!!document.getElementById('root') && !document.getElementById('root').firstElementChild")
    console.log(JSON.stringify({ baselineStaleWorkerBlank: true }))
  } else {
    await wait("!!document.querySelector('main') && !navigator.serviceWorker.controller")
    const state = await evaluate(`(async () => ({ workers: (await navigator.serviceWorker.getRegistrations()).length,
      caches: (await caches.keys()).sort(), storage: localStorage.getItem('startup-probe'),
      cookie: document.cookie.includes('startup-probe=preserved'), local: window.__LUMIVERSE_ANDROID_LOCAL__ }))()`)
    assert.deepEqual(state, { workers: 0, caches: ['avatar-cache', 'extension-assets'], storage: 'preserved', cookie: true, local: true })
    await cdp('Page.navigate', { url: `${origin}/broken` })
    await wait("!!document.querySelector('#lumiverse-startup-recovery button')")
    console.log(JSON.stringify({ staleWorkerRecovered: true, accountStoragePreserved: true, blankStartupRecovery: true }, null, 2))
  }
} finally {
  if (original) await cdp('Page.navigate', { url: original }).catch(() => {})
  socket?.close()
  if (debuggerPort) await command('forward', '--remove', `tcp:${debuggerPort}`).catch(() => {})
  await command('reverse', '--remove', `tcp:${server.port}`).catch(() => {})
  server.stop(true)
}
