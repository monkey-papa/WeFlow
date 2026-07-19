import { spawn } from 'child_process'
import { chmodSync, existsSync } from 'fs'
import * as path from 'path'

export type WeliveExportEvent =
  | { type: 'ready'; total?: number; output_dir?: string; exports_dir?: string; media_dir?: string }
  | {
      type: 'progress'
      phase?: string
      current?: number
      total?: number
      session_id?: string
      label?: string
      exported_messages?: number
      estimated_total_messages?: number
      phase_progress?: number
      phase_total?: number
    }
  | { type: 'created_file'; path?: string; session_id?: string }
  | { type: 'created_dir'; path?: string }
  | { type: 'session_error'; session_id?: string; error?: string }
  | {
      type: 'result'
      success?: boolean
      success_count?: number
      fail_count?: number
      failed_sessions?: Array<{ session_id?: string; error?: string }>
      session_output_paths?: Record<string, string>
      elapsed_ms?: number
    }
  | { type: string; [key: string]: unknown }

export interface WeliveExportRequest {
  account: {
    sessionDb: string
    dbKey: string
    myWxid?: string
    accountDir?: string
    imageXorKey?: string | number
    imageAesKey?: string
  }
  sessionIds: string[]
  outputDir: string
  exportsDir?: string
  mediaDir?: string
  emojiCacheDir?: string
  formattedDir?: string
  format?: string
  preferredOutputPath?: string
  parseContent?: boolean
  preserveMessageContent?: boolean
  sanitize?: boolean
  batchSize?: number
  ascending?: boolean
  options?: Record<string, unknown>
}

export interface RunWeliveExportOptions {
  request: WeliveExportRequest
  resourcesPath: string
  appPath?: string
  welivePath?: string
  weliveArgsPrefix?: string[]
  signal?: AbortSignal
  onEvent?: (event: WeliveExportEvent) => void
}

export interface WeliveExportResult {
  success: boolean
  successCount: number
  failCount: number
  failedSessionIds: string[]
  failedSessionErrors: Record<string, string>
  sessionOutputPaths: Record<string, string>
  rawSessionOutputPaths: Record<string, string>
  rawResult?: WeliveExportEvent
  stderr?: string
  error?: string
}

const platformDir = () => {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

const archDir = () => {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

const executableName = () => process.platform === 'win32' ? 'welive.exe' : 'welive'

export function resolveWeliveExecutable(resourcesPath: string, appPath?: string): string | null {
  const platform = platformDir()
  const arch = archDir()
  const candidates = [
    path.join(resourcesPath, 'welive', platform, arch, executableName()),
    appPath ? path.join(appPath, 'resources', 'welive', platform, arch, executableName()) : '',
    process.platform === 'darwin' ? path.join(resourcesPath, 'welive', platform, 'universal', executableName()) : '',
    process.platform === 'darwin' && appPath ? path.join(appPath, 'resources', 'welive', platform, 'universal', executableName()) : '',
    appPath ? path.join(appPath, 'WeLive', 'target', 'release', executableName()) : '',
    appPath ? path.join(appPath, 'WeLive', 'target', 'debug', executableName()) : ''
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate)) || null
}

export async function runWeliveExport(options: RunWeliveExportOptions): Promise<WeliveExportResult> {
  const exe = options.welivePath || resolveWeliveExecutable(options.resourcesPath, options.appPath)
  if (!exe) {
    return {
      success: false,
      successCount: 0,
      failCount: options.request.sessionIds.length,
      failedSessionIds: options.request.sessionIds,
      failedSessionErrors: Object.fromEntries(options.request.sessionIds.map((id) => [id, '未找到 WeLive 导出引擎'])),
      sessionOutputPaths: {},
      rawSessionOutputPaths: {},
      error: '未找到 WeLive 导出引擎'
    }
  }
  if (process.platform !== 'win32') {
    try {
      chmodSync(exe, 0o755)
    } catch {
      // Best-effort; spawn will report a clearer EACCES if chmod is not allowed.
    }
  }

  return await new Promise<WeliveExportResult>((resolve) => {
    const child = spawn(exe, [...(options.weliveArgsPrefix || []), 'weflow-export'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdoutBuffer = ''
    let stderr = ''
    let settled = false
    let rawResult: WeliveExportEvent | undefined
    const failedSessionErrors: Record<string, string> = {}
    const sessionOutputPaths: Record<string, string> = {}
    const rawSessionOutputPaths: Record<string, string> = {}

    const finish = (result: WeliveExportResult) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      resolve({ ...result, stderr: stderr.trim() || undefined })
    }

    const abort = () => {
      if (child.killed) return
      child.kill()
    }

    options.signal?.addEventListener('abort', abort)

    const handleEvent = (event: WeliveExportEvent) => {
      options.onEvent?.(event)
      if (event.type === 'session_error') {
        const sessionId = String(event.session_id || '').trim()
        if (sessionId) failedSessionErrors[sessionId] = String(event.error || 'WeLive 会话导出失败')
      }
      if (event.type === 'created_file' && event.session_id && event.path) {
        sessionOutputPaths[String(event.session_id)] = String(event.path)
      }
      if (event.type === 'result') {
        rawResult = event
        const outputMap = event.session_output_paths && typeof event.session_output_paths === 'object'
          ? event.session_output_paths as Record<string, string>
          : {}
        const rawOutputMap = (event as any).raw_session_output_paths && typeof (event as any).raw_session_output_paths === 'object'
          ? (event as any).raw_session_output_paths as Record<string, string>
          : {}
        for (const [sessionId, outputPath] of Object.entries(outputMap)) {
          sessionOutputPaths[sessionId] = String(outputPath)
        }
        for (const [sessionId, outputPath] of Object.entries(rawOutputMap)) {
          rawSessionOutputPaths[sessionId] = String(outputPath)
        }
        if (Array.isArray(event.failed_sessions)) {
          for (const item of event.failed_sessions) {
            const sessionId = String(item?.session_id || '').trim()
            if (sessionId) failedSessionErrors[sessionId] = String(item?.error || 'WeLive 会话导出失败')
          }
        }
      }
    }

    const drainStdout = () => {
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim()
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        if (line) {
          try {
            handleEvent(JSON.parse(line) as WeliveExportEvent)
          } catch (error) {
            stderr += `\n[welive-bridge] 无法解析事件: ${line}`
          }
        }
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    }

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      drainStdout()
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish({
        success: false,
        successCount: 0,
        failCount: options.request.sessionIds.length,
        failedSessionIds: options.request.sessionIds,
        failedSessionErrors: Object.fromEntries(options.request.sessionIds.map((id) => [id, error.message])),
        sessionOutputPaths,
        rawSessionOutputPaths,
        rawResult,
        error: error.message
      })
    })

    child.on('exit', (code) => {
      drainStdout()
      const failedSessionIds = Object.keys(failedSessionErrors)
      const success = code === 0 && rawResult?.type === 'result' && rawResult.success !== false
      finish({
        success,
        successCount: Number((rawResult as any)?.success_count ?? Object.keys(sessionOutputPaths).length),
        failCount: Number((rawResult as any)?.fail_count ?? failedSessionIds.length),
        failedSessionIds,
        failedSessionErrors,
        sessionOutputPaths,
        rawSessionOutputPaths,
        rawResult,
        error: success ? undefined : stderr.trim() || `WeLive 导出引擎退出码: ${code}`
      })
    })

    child.stdin.end(JSON.stringify(options.request))
  })
}
