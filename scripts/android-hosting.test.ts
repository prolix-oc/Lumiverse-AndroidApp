import { expect, test } from 'bun:test'
import { androidListener } from '../android/hosting'

test('remote listening requires a native opt-in and a nonprivileged valid port', () => {
  expect(androidListener({ PORT: '7860', LUMIVERSE_HOST: '0.0.0.0' })).toEqual({ hostname: '127.0.0.1' })
  for (const port of ['1024', '7860', '65535'])
    expect(androidListener({ LUMIVERSE_ANDROID_LISTEN_PORT: port })).toEqual({ hostname: '0.0.0.0', port: Number(port) })
  for (const port of ['', '0', '80', '1023', '65536', '-7860', '7860.5', ' 7860', '7860x'])
    expect(() => androidListener({ LUMIVERSE_ANDROID_LISTEN_PORT: port })).toThrow('between 1024 and 65535')
})
