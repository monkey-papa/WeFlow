import { parentPort, workerData } from 'worker_threads'
import { runWeliveExport, type WeliveExportEvent } from './services/weliveBridge'

interface ExportWorkerConfig {
  mode?: 'sessions' | 'single' | 'contacts'
  sessionIds?: string[]
  sessionId?: string
  outputDir?: string
  outputPath?: string
  options?: any
  taskId?: string
  dbPath?: string
  sessionDbPath?: string
  decryptKey?: string
  myWxid?: string
  accountDir?: string
  imageXorKey?: unknown
  imageAesKey?: string
  resourcesPath?: string
  userDataPath?: string
  cachePath?: string
  emojiCacheDir?: string
  logEnabled?: boolean
  isPackaged?: boolean
  welivePath?: string
  weliveArgsPrefix?: string[]
}

const config = workerData as ExportWorkerConfig
const controlState = {
  pauseRequested: false,
  stopRequested: false
}

const CREATED_PATH_FLUSH_INTERVAL_MS = 200
const CREATED_PATH_BATCH_LIMIT = 256
const PROGRESS_POST_INTERVAL_MS = 180
let queuedCreatedFiles: string[] = []
let queuedCreatedDirs: string[] = []
let createdPathFlushTimer: ReturnType<typeof setTimeout> | null = null
let pendingProgress: any = null
let progressPostTimer: ReturnType<typeof setTimeout> | null = null
let lastProgressPostedAt = 0

function flushCreatedPaths() {
  if (createdPathFlushTimer) {
    clearTimeout(createdPathFlushTimer)
    createdPathFlushTimer = null
  }
  const filePaths = queuedCreatedFiles
  const dirPaths = queuedCreatedDirs
  queuedCreatedFiles = []
  queuedCreatedDirs = []
  if (!parentPort) return
  if (filePaths.length > 0) {
    parentPort.postMessage({ type: 'export:createdFiles', filePaths })
  }
  if (dirPaths.length > 0) {
    parentPort.postMessage({ type: 'export:createdDirs', dirPaths })
  }
}

function scheduleCreatedPathFlush() {
  if (createdPathFlushTimer) return
  createdPathFlushTimer = setTimeout(flushCreatedPaths, CREATED_PATH_FLUSH_INTERVAL_MS)
}

function queueCreatedFile(filePath: string) {
  const normalized = String(filePath || '').trim()
  if (!normalized) return
  queuedCreatedFiles.push(normalized)
  if (queuedCreatedFiles.length + queuedCreatedDirs.length >= CREATED_PATH_BATCH_LIMIT) {
    flushCreatedPaths()
  } else {
    scheduleCreatedPathFlush()
  }
}

function queueCreatedDir(dirPath: string) {
  const normalized = String(dirPath || '').trim()
  if (!normalized) return
  queuedCreatedDirs.push(normalized)
  if (queuedCreatedFiles.length + queuedCreatedDirs.length >= CREATED_PATH_BATCH_LIMIT) {
    flushCreatedPaths()
  } else {
    scheduleCreatedPathFlush()
  }
}

function flushProgress() {
  if (!pendingProgress) return
  if (progressPostTimer) {
    clearTimeout(progressPostTimer)
    progressPostTimer = null
  }
  parentPort?.postMessage({
    type: 'export:progress',
    data: pendingProgress
  })
  pendingProgress = null
  lastProgressPostedAt = Date.now()
}

function queueProgress(progress: any) {
  pendingProgress = progress
  if (progress?.phase === 'complete') {
    flushProgress()
    return
  }

  const now = Date.now()
  const elapsed = now - lastProgressPostedAt
  if (elapsed >= PROGRESS_POST_INTERVAL_MS) {
    flushProgress()
    return
  }

  if (progressPostTimer) return
  progressPostTimer = setTimeout(flushProgress, PROGRESS_POST_INTERVAL_MS - elapsed)
}

parentPort?.on('message', (message: any) => {
  if (!message || typeof message.type !== 'string') return
  if (message.type === 'export:pause') {
    controlState.pauseRequested = true
    return
  }
  if (message.type === 'export:resume') {
    controlState.pauseRequested = false
    return
  }
  if (message.type === 'export:cancel') {
    controlState.stopRequested = true
    controlState.pauseRequested = false
  }
})

process.env.WEFLOW_WORKER = '1'
if (config.resourcesPath) {
  process.env.WCDB_RESOURCES_PATH = config.resourcesPath
}
if (config.userDataPath) {
  process.env.WEFLOW_USER_DATA_PATH = config.userDataPath
  process.env.WEFLOW_CONFIG_CWD = config.userDataPath
}
process.env.WEFLOW_PROJECT_NAME = process.env.WEFLOW_PROJECT_NAME || 'WeFlow'

const shouldUseWeliveEngine = () => {
  if (config.mode === 'contacts') return false
  const explicit = String(config.options?.exportEngine || config.options?.engine || '').trim().toLowerCase()
  if (explicit === 'welive') return true
  if (explicit === 'legacy') return false
  const env = String(process.env.WEFLOW_EXPORT_ENGINE || '').trim().toLowerCase()
  if (env === 'legacy') return false
  return true
}

const normalizeImageXorKey = (value: unknown): string | number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  return text ? text : undefined
}

const resolveEmojiCacheDir = () => {
  const path = require('path') as typeof import('path')
  const explicit = String(config.emojiCacheDir || '').trim()
  if (explicit) return explicit
  const configured = String(config.cachePath || '').trim()
  if (configured) return path.join(configured, 'Emojis')
  const userDataPath = String(config.userDataPath || '').trim()
  if (userDataPath) return path.join(userDataPath, 'Emojis')
  return undefined
}

const resolveWeliveSessionDb = () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const explicit = String(config.sessionDbPath || '').trim()
  if (explicit && fs.existsSync(explicit) && fs.statSync(explicit).isFile()) return explicit

  const dbPath = String(config.dbPath || '').trim()
  if (dbPath && fs.existsSync(dbPath) && fs.statSync(dbPath).isFile()) return dbPath

  const accountDir = String(config.accountDir || '').trim()
  const candidates = [
    accountDir ? path.join(accountDir, 'db_storage', 'session', 'session.db') : '',
    accountDir ? path.join(accountDir, 'db_storage', 'session.db') : '',
    dbPath ? path.join(dbPath, 'db_storage', 'session', 'session.db') : '',
    dbPath ? path.join(dbPath, 'db_storage', 'session.db') : ''
  ].filter(Boolean)

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  }) || dbPath
}

const mapWeliveEventToProgress = (event: WeliveExportEvent): any | null => {
  if (event.type !== 'progress' && event.type !== 'ready') return null
  const total = Math.max(0, Number((event as any).total || 0))
  const current = Math.max(0, Number((event as any).current || 0))
  const backendPhase = event.type === 'ready' ? 'ready' : String((event as any).phase || '')
  const exportedMessages = Math.max(0, Number((event as any).exported_messages ?? 0))
  const estimatedTotalMessages = Math.max(0, Number((event as any).estimated_total_messages ?? 0))
  const phaseProgress = Math.max(0, Number((event as any).phase_progress ?? exportedMessages))
  const phaseTotal = Math.max(0, Number((event as any).phase_total ?? estimatedTotalMessages))
  const sessionRatio = phaseTotal > 0
    ? Math.max(0, Math.min(0.98, phaseProgress / phaseTotal))
    : 0
  const displayCurrent = backendPhase === 'complete'
    ? current
    : current + sessionRatio
  const phase = backendPhase === 'formatting'
    ? 'writing'
    : backendPhase === 'complete'
      ? 'complete'
      : backendPhase === 'ready' || backendPhase === 'loading' || backendPhase === 'initializing' || backendPhase === 'opening_account' || backendPhase === 'counting'
        ? 'preparing'
        : backendPhase === 'parsing' || backendPhase === 'parsed'
          ? 'exporting-media'
          : 'exporting'
  const fallbackLabel = event.type === 'ready'
    ? 'WeLive 导出引擎已启动'
    : phase === 'writing'
      ? 'WeLive 正在写入导出格式'
      : phase === 'preparing'
        ? 'WeLive 正在准备导出'
        : phase === 'exporting-media'
          ? 'WeLive 正在解析消息与媒体'
          : 'WeLive 正在读取消息'

  return {
    current: Number(displayCurrent.toFixed(3)),
    total,
    currentSession: String((event as any).session_id || ''),
    currentSessionId: String((event as any).session_id || ''),
    phase,
    phaseProgress,
    phaseTotal,
    collectedMessages: exportedMessages,
    exportedMessages,
    estimatedTotalMessages,
    phaseLabel: String((event as any).label || '').trim() || fallbackLabel
  }
}

async function runWeliveEngine() {
  const path = require('path') as typeof import('path')
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const { exportService } = await import('./services/export')
  const { wcdbService } = await import('./services/wcdbService')
  const {
    buildSessionExportBaseName,
    normalizeFileNamingMode,
    reserveUniqueOutputPath
  } = await import('./services/export/utils/fileNaming')
  const sessionIds = config.mode === 'single'
    ? [String(config.sessionId || '').trim()].filter(Boolean)
    : (Array.isArray(config.sessionIds) ? config.sessionIds : []).map((id) => String(id || '').trim()).filter(Boolean)
  const outputDir = String(config.outputDir || (config.outputPath ? path.dirname(config.outputPath) : '') || '').trim()
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'weflow-welive-raw-'))

  exportService.setRuntimeConfig({
    dbPath: config.dbPath,
    decryptKey: config.decryptKey,
    myWxid: config.myWxid,
    accountDir: config.accountDir,
    imageXorKey: config.imageXorKey,
    imageAesKey: config.imageAesKey,
    resourcesPath: config.resourcesPath,
    appPath: config.resourcesPath ? path.dirname(config.resourcesPath) : __dirname,
    isPackaged: config.isPackaged
  })
  wcdbService.setPaths(String(config.resourcesPath || ''), String(config.userDataPath || ''))
  wcdbService.setLogEnabled(config.logEnabled === true)

  const options = config.options || { format: 'json' }
  const normalizedOptions = exportService.context.normalizeExportOptionsForRun(options)
  const effectiveOptions = exportService.context.isMediaContentBatchExport(normalizedOptions)
    ? { ...normalizedOptions, exportVoiceAsText: false }
    : normalizedOptions
  await exportService.context.ensureConnected().catch(() => null)
  const exportMediaEnabled = effectiveOptions.exportMedia === true &&
    Boolean(effectiveOptions.exportImages || effectiveOptions.exportVoices || effectiveOptions.exportVideos || effectiveOptions.exportEmojis || effectiveOptions.exportFiles)
  const writeLayout = exportService.context.resolveExportWriteLayout(effectiveOptions)
  const exportBaseDir = writeLayout === 'A'
    ? path.join(outputDir, 'texts')
    : outputDir
  const sessionLayout = exportMediaEnabled
    ? (effectiveOptions.sessionLayout ?? 'per-session')
    : 'shared'
  const reservedOutputPaths = new Set<string>()
  const rawExportsDir = path.join(rawRoot, 'exports')

  const getFormatExtension = (format: string) => {
    if (format === 'chatlab-jsonl') return '.jsonl'
    if (format === 'excel') return '.xlsx'
    if (format === 'txt') return '.txt'
    if (format === 'weclone') return '.csv'
    if (format === 'html') return '.html'
    return '.json'
  }
  const resolveFinalOutputPath = async (sessionId: string) => {
    if (config.mode === 'single' && String(config.outputPath || '').trim()) {
      return String(config.outputPath || '').trim()
    }
    const sessionInfo = await exportService.context.getContactInfo(sessionId)
    const safeName = buildSessionExportBaseName(sessionId, sessionInfo.displayName || sessionId, effectiveOptions)
    const sessionNameWithTypePrefix = effectiveOptions.sessionNameWithTypePrefix !== false
    const sessionTypePrefix = sessionNameWithTypePrefix ? await exportService.context.getSessionFilePrefix(sessionId) : ''
    const fileNameWithPrefix = `${sessionTypePrefix}${safeName}`
    const useSessionFolder = sessionLayout === 'per-session'
    const sessionDirName = sessionNameWithTypePrefix ? `${sessionTypePrefix}${safeName}` : safeName
    const sessionDir = useSessionFolder ? path.join(exportBaseDir, sessionDirName) : exportBaseDir
    const preferredOutputPath = path.join(sessionDir, `${fileNameWithPrefix}${getFormatExtension(String(effectiveOptions.format || 'json'))}`)
    return normalizeFileNamingMode(effectiveOptions.fileNamingMode) === 'date-range'
      ? reserveUniqueOutputPath(preferredOutputPath, reservedOutputPaths)
      : preferredOutputPath
  }

  const finalOutputPaths: Record<string, string> = {}
  const mediaDirs: Record<string, string | undefined> = {}
  for (const sessionId of sessionIds) {
    const finalOutputPath = await resolveFinalOutputPath(sessionId)
    finalOutputPaths[sessionId] = finalOutputPath
    const mediaLayout = exportService.context.getMediaLayout(finalOutputPath, effectiveOptions)
    mediaDirs[sessionId] = mediaLayout.exportMediaEnabled
      ? path.resolve(path.join(mediaLayout.mediaRootDir, mediaLayout.mediaRelativePrefix))
      : undefined
  }

  const rawSessionOutputPaths: Record<string, string> = {}
  const failedSessionIds: string[] = []
  const failedSessionErrors: Record<string, string> = {}

  for (let index = 0; index < sessionIds.length; index++) {
    const sessionId = sessionIds[index]
    const result = await runWeliveExport({
      resourcesPath: String(config.resourcesPath || ''),
      appPath: config.resourcesPath ? path.dirname(config.resourcesPath) : __dirname,
      welivePath: config.welivePath,
      weliveArgsPrefix: Array.isArray(config.weliveArgsPrefix) ? config.weliveArgsPrefix : undefined,
      request: {
        account: {
          sessionDb: resolveWeliveSessionDb(),
          dbKey: String(config.decryptKey || '').trim(),
          myWxid: String(config.myWxid || '').trim() || undefined,
          accountDir: String(config.accountDir || '').trim() || undefined,
          imageXorKey: normalizeImageXorKey(config.imageXorKey),
          imageAesKey: String(config.imageAesKey || '').trim() || undefined
        },
        sessionIds: [sessionId],
        outputDir,
        exportsDir: rawExportsDir,
        mediaDir: mediaDirs[sessionId],
        emojiCacheDir: resolveEmojiCacheDir(),
        format: 'raw-jsonl',
        parseContent: true,
        preserveMessageContent: true,
        compactRaw: true,
        sanitize: config.options?.sanitize === true,
        batchSize: Number(config.options?.batchSize || 20_000),
        ascending: config.options?.ascending !== false,
        options: effectiveOptions
      },
      onEvent: (event) => {
        const createdPath = String((event as any).path || '').trim()
        const isTempWelivePath = createdPath && path.resolve(createdPath).startsWith(path.resolve(rawRoot))
        if (event.type === 'created_file' && createdPath && !isTempWelivePath) queueCreatedFile(createdPath)
        if (event.type === 'created_dir' && createdPath && !isTempWelivePath) queueCreatedDir(createdPath)
        const backendPhase = event.type === 'ready' ? 'ready' : String((event as any).phase || '')
        const normalizedEvent = (event.type === 'progress' || event.type === 'ready')
          ? {
              ...(event as any),
              total: sessionIds.length,
              current: backendPhase === 'complete' ? index + 1 : index,
              session_id: String((event as any).session_id || sessionId)
            }
          : event
        const progress = mapWeliveEventToProgress(normalizedEvent as WeliveExportEvent)
        if (progress) queueProgress(progress)
      }
    })

    if (!result.success) {
      failedSessionIds.push(sessionId)
      failedSessionErrors[sessionId] = String(result.failedSessionErrors?.[sessionId] || result.error || 'WeLive export failed')
      continue
    }
    rawSessionOutputPaths[sessionId] = String(result.rawSessionOutputPaths?.[sessionId] || result.sessionOutputPaths?.[sessionId] || '')
  }

  if (failedSessionIds.length > 0) {
    fs.rmSync(rawRoot, { recursive: true, force: true })
    return {
      success: false,
      successCount: sessionIds.length - failedSessionIds.length,
      failCount: failedSessionIds.length,
      failedSessionIds,
      failedSessionErrors,
      sessionOutputPaths: finalOutputPaths,
      error: failedSessionIds.map((id) => `${id}: ${failedSessionErrors[id]}`).join('; ')
    }
  }

  exportService.setWeliveRawExportPaths(rawSessionOutputPaths)

  const taskControl = config.taskId
    ? {
        shouldPause: () => controlState.pauseRequested,
        shouldStop: () => controlState.stopRequested,
        recordCreatedFile: queueCreatedFile,
        recordCreatedDir: queueCreatedDir
      }
    : undefined

  try {
    if (config.mode === 'single') {
      const sessionId = String(config.sessionId || '').trim()
      const outputPath = String(config.outputPath || '').trim()
      const options = config.options || { format: 'chatlab' }
      const format = String(options.format || 'chatlab')
      if (format === 'json' || format === 'arkme-json') {
        return await exportService.orchestrator.exportSessionToDetailedJson(sessionId, outputPath, options, queueProgress, taskControl)
      }
      if (format === 'excel') {
        return await exportService.orchestrator.exportSessionToExcel(sessionId, outputPath, options, queueProgress, taskControl)
      }
      if (format === 'txt') {
        return await exportService.orchestrator.exportSessionToTxt(sessionId, outputPath, options, queueProgress, taskControl)
      }
      if (format === 'weclone') {
        return await exportService.orchestrator.exportSessionToWeCloneCsv(sessionId, outputPath, options, queueProgress, taskControl)
      }
      if (format === 'html') {
        return await exportService.orchestrator.exportSessionToHtml(sessionId, outputPath, options, queueProgress, taskControl)
      }
      return await exportService.orchestrator.exportSessionToChatLab(sessionId, outputPath, options, queueProgress, taskControl)
    }

    return await exportService.exportSessions(
      sessionIds,
      outputDir,
      config.options || { format: 'json' },
      queueProgress,
      taskControl
    )
  } finally {
    exportService.clearWeliveRawExportPaths()
    fs.rmSync(rawRoot, { recursive: true, force: true })
  }
}

async function run() {
  if (shouldUseWeliveEngine()) {
    const result = await runWeliveEngine()
    flushProgress()
    flushCreatedPaths()
    parentPort?.postMessage({
      type: 'export:result',
      data: result
    })
    return
  }

  const [{ wcdbService }, { exportService }] = await Promise.all([
    import('./services/wcdbService'),
    import('./services/export')
  ])

  wcdbService.setPaths(config.resourcesPath || '', config.userDataPath || '')
  wcdbService.setLogEnabled(config.logEnabled === true)
  exportService.setRuntimeConfig({
    dbPath: config.dbPath,
    decryptKey: config.decryptKey,
    myWxid: config.myWxid,
    imageXorKey: config.imageXorKey,
    imageAesKey: config.imageAesKey,
    resourcesPath: config.resourcesPath,
    appPath: config.resourcesPath ? require('path').dirname(config.resourcesPath) : __dirname,
    isPackaged: config.isPackaged
  })

  const onProgress = (progress: any) => queueProgress(progress)

  const taskControl = config.taskId
    ? {
        shouldPause: () => controlState.pauseRequested,
        shouldStop: () => controlState.stopRequested,
        recordCreatedFile: queueCreatedFile,
        recordCreatedDir: queueCreatedDir
      }
    : undefined

  let result: any
  if (config.mode === 'contacts') {
    const [{ contactExportService }, { chatService }] = await Promise.all([
      import('./services/contactExportService'),
      import('./services/chatService')
    ])
    chatService.setRuntimeConfig({
      dbPath: config.dbPath,
      decryptKey: config.decryptKey,
      myWxid: config.myWxid,
      resourcesPath: config.resourcesPath,
      appPath: config.resourcesPath ? require('path').dirname(config.resourcesPath) : __dirname,
      isPackaged: config.isPackaged
    })
    result = await contactExportService.exportContacts(
      String(config.outputDir || ''),
      config.options || {}
    )
  } else if (config.mode === 'single') {
    result = await exportService.exportSessionToChatLab(
      String(config.sessionId || '').trim(),
      String(config.outputPath || '').trim(),
      config.options || { format: 'chatlab' },
      onProgress,
      taskControl
    )
  } else {
    result = await exportService.exportSessions(
      Array.isArray(config.sessionIds) ? config.sessionIds : [],
      String(config.outputDir || ''),
      config.options || { format: 'json' },
      onProgress,
      taskControl
    )
  }

  flushProgress()
  flushCreatedPaths()

  parentPort?.postMessage({
    type: 'export:result',
    data: result
  })
}

run().catch((error) => {
  flushProgress()
  flushCreatedPaths()
  parentPort?.postMessage({
    type: 'export:error',
    error: String(error)
  })
})
