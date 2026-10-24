import { join } from 'node:path'
import { backendRoot } from './backend-project'
export { audioSmokeFixture } from './fixtures/audio-fixture'

/** Bundle the actual audio modules for a disposable page inside the native app. */
export async function nativeAudioSmokeBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'fixtures/native-audio-smoke.ts')],
    plugins: [{ name: 'shared-frontend', setup(build) {
      build.onResolve({ filter: /^\.\.\/\.\.\/frontend\// }, args => ({ path: Bun.resolveSync(join(backendRoot(), args.path.slice(6)), backendRoot()) }))
    } }],
    target: 'browser', format: 'iife',
    define: { 'import.meta.env.VITE_API_BASE': '""' },
    tsconfig: join(backendRoot(), 'frontend/tsconfig.json'),
  })
  if (!result.success) throw new AggregateError(result.logs, 'Could not bundle native audio smoke test')
  return result.outputs[0]!.text()
}

