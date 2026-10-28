import { expect, test } from 'bun:test'
import { androidListener } from '../android/hosting'

test('remote listening requires a native opt-in and a nonprivileged valid port', () => {
  expect(androidListener({ PORT: '7860', LUMIVERSE_HOST: '0.0.0.0' })).toEqual({ hostname: '127.0.0.1' })
  for (const port of ['1024', '7860', '65535'])
    expect(androidListener({ LUMIVERSE_ANDROID_LISTEN_PORT: port })).toEqual({ hostname: '0.0.0.0', port: Number(port) })
  for (const port of ['', '0', '80', '1023', '65536', '-7860', '7860.5', ' 7860', '7860x'])
    expect(() => androidListener({ LUMIVERSE_ANDROID_LISTEN_PORT: port })).toThrow('between 1024 and 65535')
})

test('the saved local origin stays loopback-only and cannot enable LAN hosting', () => {
  expect(androidListener({ LUMIVERSE_ANDROID_LOCAL_PORT: '28760', LUMIVERSE_HOST: '0.0.0.0' }))
    .toEqual({ hostname: '127.0.0.1', port: 28760 })
  expect(androidListener({ LUMIVERSE_ANDROID_LOCAL_PORT: '28760', LUMIVERSE_ANDROID_LISTEN_PORT: '7860' }))
    .toEqual({ hostname: '0.0.0.0', port: 7860 })
  for (const port of ['', '80', '0', '65536', ' 28760', 'no'])
    expect(() => androidListener({ LUMIVERSE_ANDROID_LOCAL_PORT: port })).toThrow('saved local server port')
})
