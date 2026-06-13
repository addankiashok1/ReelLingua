import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const nextDir = path.join(root, '.next')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const rawArgs = process.argv.slice(2)

const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)

if (major < 20 || major >= 24) {
  console.warn('')
  console.warn('[dev-server] Warning: this project is most stable on Node 20 or 22 LTS.')
  console.warn(`[dev-server] Current Node: ${process.version}`)
  console.warn('[dev-server] If the dev UI keeps breaking, switch to Node 22 LTS for local development.')
  console.warn('')
}

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true })
  console.log('[dev-server] Cleared stale .next cache before starting dev server.')
}

function normalizeArgs(args) {
  const hasExplicitPortFlag = args.includes('-p') || args.includes('--port')

  if (hasExplicitPortFlag) {
    return args
  }

  if (args.length === 1 && /^\d+$/.test(args[0])) {
    return ['-p', args[0]]
  }

  const npmPort = process.env.npm_config_port
  if (npmPort && /^\d+$/.test(npmPort)) {
    return ['-p', npmPort, ...args]
  }

  return args
}

const args = normalizeArgs(rawArgs)

const child = spawn(
  process.execPath,
  [
    '--max-old-space-size=4096',
    nextBin,
    'dev',
    '--turbo',
    ...args,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
)

child.on('exit', code => {
  process.exit(code ?? 0)
})

child.on('error', error => {
  console.error('[dev-server] Failed to start Next dev server.')
  console.error(error)
  process.exit(1)
})
