import { afterEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const script = readFileSync(new URL('../android/tauri/src-tauri/src/frontend-startup.js', import.meta.url), 'utf8')
const windows: JSDOM[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close() })

function fixture(options: { remote?: boolean; rendered?: boolean; guarded?: boolean; storageFails?: boolean; cacheFails?: boolean } = {}) {
  const origin = options.remote ? 'https://hosted.example' : 'http://127.0.0.1:7860'
  const dom = new JSDOM(`<div id="root">${options.rendered ? '<main>Home</main>' : ''}</div>`, { url: origin })
  windows.push(dom)
  const reload = mock(() => {})
  const unregister = mock(async () => true)
  const unrelated = mock(async () => true)
  const registrations = mock(async () => [
    { active: { scriptURL: `${origin}/sw.js` }, unregister },
    { active: { scriptURL: `${origin}/extensions/worker.js` }, unregister: unrelated },
  ])
  const storage = {
    getItem: mock(() => { if (options.storageFails) throw new Error('blocked'); return options.guarded ? String(Date.now()) : null }),
    setItem: mock(() => {}),
  }
  const cache = {
    keys: mock(async () => { if (options.cacheFails) throw new Error('cache blocked'); return [`workbox-precache-v2-${origin}/`, 'avatar-cache', 'extension-assets'] }),
    delete: mock(async (_: string) => true),
  }
  const timers: Array<() => void> = []
  Object.defineProperty(dom.window.document, 'readyState', { value: 'complete' })
  new Function('window', 'document', 'location', 'navigator', 'sessionStorage', 'caches', 'setTimeout', 'console', script)(
    dom.window, dom.window.document,
    { protocol: options.remote ? 'https:' : 'http:', hostname: options.remote ? 'hosted.example' : '127.0.0.1', origin, reload },
    { serviceWorker: { controller: { scriptURL: `${origin}/sw.js` }, getRegistrations: registrations } },
    storage, cache, (action: () => void) => timers.push(action), { warn: mock(() => {}) },
  )
  const settled = new Promise(resolve => setTimeout(resolve, 0))
  return { dom, reload, unregister, unrelated, registrations, cache, timers, settled }
}

test('local APK startup retires its worker and precache, preserving unrelated workers and storage', async () => {
  const page = fixture()
  await page.settled
  expect((page.dom.window as any).__LUMIVERSE_ANDROID_LOCAL__).toBe(true)
  expect(page.unregister).toHaveBeenCalledTimes(1)
  expect(page.unrelated).not.toHaveBeenCalled()
  expect(page.cache.delete.mock.calls).toEqual([['workbox-precache-v2-http://127.0.0.1:7860/']])
  expect(page.reload).toHaveBeenCalledTimes(1)
})

test('hosted connections retain their service worker and caches', async () => {
  const page = fixture({ remote: true })
  await page.settled
  expect((page.dom.window as any).__LUMIVERSE_ANDROID_LOCAL__).toBeUndefined()
  expect(page.registrations).not.toHaveBeenCalled()
  expect(page.cache.delete).not.toHaveBeenCalled()
})

test('recovery never loops or forces a reload when storage is unavailable', async () => {
  for (const options of [{ guarded: true }, { storageFails: true }, { cacheFails: true }]) {
    const page = fixture(options)
    await page.settled
    expect(page.reload).not.toHaveBeenCalled()
    page.timers.forEach(action => action())
    expect(page.dom.window.document.querySelector('[role=alert]')?.textContent).toContain('Reload interface')
    page.dom.window.document.querySelector('button')?.click()
    expect(page.reload).toHaveBeenCalledTimes(1)
  }
})

test('a blank application gets a usable reload screen; a rendered application and connection chooser do not', () => {
  const blank = fixture()
  blank.timers.forEach(action => action())
  blank.timers.forEach(action => action())
  expect(blank.dom.window.document.querySelectorAll('[role=alert]')).toHaveLength(1)
  const rendered = fixture({ rendered: true })
  rendered.timers.forEach(action => action())
  expect(rendered.dom.window.document.querySelector('[role=alert]')).toBeNull()
  const chooser = fixture()
  chooser.dom.window.document.getElementById('root')!.remove()
  chooser.timers.forEach(action => action())
  expect(chooser.dom.window.document.querySelector('[role=alert]')).toBeNull()
})
