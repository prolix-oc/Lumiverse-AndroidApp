import { afterEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const ui = new URL('../android/tauri/ui/', import.meta.url)
const html = readFileSync(new URL('index.html', ui), 'utf8')
const script = ['connection-history.js', 'connection.js'].map(file => readFileSync(new URL(file, ui), 'utf8')).join('\n')
const windows: JSDOM[] = []
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close() })

async function fixture(info: object, query = '?changeServer=1') {
  let reject!: (error: Error) => void
  let resolve!: () => void
  const connecting = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const invoke = mock((_: string, args: { action: string }) => args.action === 'info' ? Promise.resolve(info)
    : args.action === 'remote-access-info' ? Promise.resolve((info as { remoteAccess?: object }).remoteAccess || { enabled: false })
    : args.action === 'forget' ? Promise.resolve({ history: [] }) : connecting)
  const dom = new JSDOM(html, { url: `http://tauri.localhost/index.html${query}`, runScripts: 'outside-only', pretendToBeVisual: true })
  windows.push(dom)
  Object.assign(dom.window, { __TAURI_INTERNALS__: { invoke } })
  dom.window.eval(`(() => {${script}})()`)
  await flush()
  const element = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T
  const submit = () => element('connection-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }))
  return { dom, invoke, reject, resolve, element, submit }
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('history is collapsed, selection preserves scheme and port, and only Connect navigates', async () => {
  const page = await fixture({ mode: 'remote', server: 'https://current.example/', history: [{ server: 'http://lan.local:8000/' }, { server: 'https://old.example/' }] })
  expect(page.element<HTMLDetailsElement>('connection-history').open).toBe(false)
  const choices = page.dom.window.document.querySelectorAll<HTMLButtonElement>('.history-server')
  choices[0]!.click()
  expect(page.element<HTMLInputElement>('server').value).toBe('http://lan.local:8000/')
  expect(page.invoke).toHaveBeenCalledTimes(1)
  page.submit()
  expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: 'remote', server: 'http://lan.local:8000/' })
  expect(choices[1]!.disabled).toBe(true)
  expect(page.element<HTMLButtonElement>('local').disabled).toBe(true)
  page.reject(new Error('Unavailable'))
  await flush()
  expect(choices[1]!.disabled).toBe(false)
  expect(page.element('status').textContent).toBe('Unavailable')
})

test('history shortcut opens the list, and removal persists without changing the server', async () => {
  const page = await fixture({ server: 'https://current.example/', history: [{ server: 'https://old.example/' }] }, '?changeServer=1&history=1')
  expect(page.element<HTMLDetailsElement>('connection-history').open).toBe(true)
  page.dom.window.document.querySelector<HTMLButtonElement>('.history-remove')!.click()
  page.submit()
  expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: 'forget', server: 'https://old.example/' })
  await flush()
  expect(page.element<HTMLInputElement>('server').value).toBe('https://current.example/')
  expect(page.dom.window.document.querySelectorAll('.history-server')).toHaveLength(0)
  expect(page.element('history-empty').hidden).toBe(false)
})

test('startup still restores the remote or local mode, and empty history is usable', async () => {
  for (const mode of ['remote', 'local']) {
    const page = await fixture({ mode, server: 'https://saved.example/', history: [] }, '')
    expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: mode, server: 'https://saved.example/' })
    expect(page.element('history-empty').hidden).toBe(false)
  }
})

test('remote access starts only when toggled, shows live addresses, and can close the frontend', async () => {
  const info = { port: 8123, remoteAccess: { enabled: false, ready: false, port: 8123, urls: [] as string[] } }
  const page = await fixture(info)
  expect(page.invoke).toHaveBeenCalledTimes(1)
  page.element<HTMLInputElement>('remote-enabled').click()
  expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: 'remote-on', server: null, port: 8123 })
  expect(page.element<HTMLInputElement>('remote-enabled').disabled).toBe(true)
  info.remoteAccess = { enabled: true, ready: true, port: 8123, urls: ['http://192.168.1.50:8123'] }
  page.resolve()
  await flush(); await flush()
  expect(page.element('remote-status').textContent).toContain('http://192.168.1.50:8123')
  expect(page.element<HTMLInputElement>('remote-port').disabled).toBe(true)
  expect(page.element('close-frontend').hidden).toBe(false)
  page.element<HTMLButtonElement>('close-frontend').click()
  expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: 'close', server: null })
  page.element<HTMLInputElement>('remote-enabled').click()
  expect(page.invoke).toHaveBeenLastCalledWith('mobile_connection', { action: 'remote-off', server: null })
})

test('remote access rejects invalid ports before IPC and restores confirmed state after failure', async () => {
  const page = await fixture({ remoteAccess: { enabled: false } })
  for (const value of ['', '80', '65536', '7860.5']) {
    page.element<HTMLInputElement>('remote-port').value = value
    page.element<HTMLInputElement>('remote-enabled').click()
    expect(page.invoke).toHaveBeenCalledTimes(1)
    expect(page.element<HTMLInputElement>('remote-enabled').checked).toBe(false)
  }
  page.element<HTMLInputElement>('remote-port').value = '7860'
  page.element<HTMLInputElement>('remote-enabled').click()
  page.reject(new Error('Port 7860 is unavailable. Choose another port.'))
  await flush(); await flush()
  expect(page.element<HTMLInputElement>('remote-enabled').checked).toBe(false)
  expect(page.element<HTMLInputElement>('remote-port').disabled).toBe(false)
  expect(page.element('status').textContent).toContain('Port 7860 is unavailable')
})

const readyScript = readFileSync(new URL('../android/tauri/src-tauri/src/connection-ready.js', import.meta.url), 'utf8')
test('only a successfully loaded document acknowledges a connection for native history', () => {
  for (const responseStatus of [0, 200, 302, 401, 404, 500]) {
    const dom = new JSDOM('<!doctype html>', { url: 'https://server.example/', runScripts: 'outside-only' })
    windows.push(dom)
    const postMessage = mock(() => {})
    Object.assign(dom.window, { lumiverseConnectionHistory: { postMessage } })
    Object.assign(dom.window.performance, { getEntriesByType: () => [{ responseStatus }] })
    dom.window.eval(readyScript)
    expect(postMessage).not.toHaveBeenCalled()
    dom.window.dispatchEvent(new dom.window.Event('load'))
    expect(postMessage).toHaveBeenCalledTimes(responseStatus >= 200 && responseStatus < 400 ? 1 : 0)
  }
})
