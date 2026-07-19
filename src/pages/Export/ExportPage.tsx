/**
 * ExportPage — Main page container
 *
 * This is the top-level component for the refactored Export page.
 * It composes sub-components and hooks, keeping itself lean (<300 lines target).
 */

import { memo, useEffect, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import ExportTopBar from './components/ExportTopBar'
import SessionTable from './components/SessionTable'
import ExportDialog from './components/ExportDialog'
import TaskCenter from './components/TaskCenter'
import { ExportDefaultsSettingsForm, type ExportDefaultsSettingsPatch } from '../../components/Export/ExportDefaultsSettingsForm'
import { X } from 'lucide-react'
import SessionDetail from './components/SessionDetail'

import { useContactsLoader } from './hooks/useContactsLoader'
import { useExportSessions } from './hooks/useExportSessions'
import { useExportConfig } from './hooks/useExportConfig'
import { useExportDialog } from './hooks/useExportDialog'
import { useExportTasks } from './hooks/useExportTasks'
import { useBackgroundTasks } from './hooks/useBackgroundTasks'
import { useSessionMetrics } from './hooks/useSessionMetrics'
import { useAutomationRunner, useAutomationStore } from './hooks/useAutomation'
import { AutomationModal } from './components/Automation/AutomationModal'
import { AutomationTaskForm } from './components/Automation/AutomationTaskForm'

import type { SessionRow } from './types'
import { getSelectionScopeFromRows, resolveScopeDisplayNames } from './utils/session'
import './ExportPage.scss'

function ExportPage() {
  const location = useLocation()
  const isExportRoute = location.pathname === '/export'

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isAutomationModalOpen, setIsAutomationModalOpen] = useState(false)
  const [draftAutomationPayload, setDraftAutomationPayload] = useState<any>(null)

  const { 
    options, 
    updateOptions,
    exportPath,
    setExportPath,
    writeLayout,
    setWriteLayout,
    rawDateRangeConfig,
    setRawDateRangeConfig
  } = useExportConfig()

  // ── 2. Load contacts and sessions ──
  const {
    contactMap,
    avatarEntries,
    isLoading: isContactsLoading,
    loadContacts,
    abort: abortContacts
  } = useContactsLoader()

  // ── 3. Metrics ──
  const { metricsMap, fetchMetrics } = useSessionMetrics()

  const {
    filteredSessions,
    isLoading: isSessionsLoading,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    loadSessions,
    sortConfig,
    setSortConfig
  } = useExportSessions(contactMap, 'private', metricsMap)

  // Initial load
  useEffect(() => {
    if (!isExportRoute) return
    loadContacts('all')
    loadSessions()
    return () => abortContacts()
  }, [isExportRoute, loadContacts, loadSessions, abortContacts])

  // Use filteredSessions directly (hook already handles tab + search filtering)
  const displayedSessions = filteredSessions



  useEffect(() => {
    if (displayedSessions.length > 0) {
      // Fetch metrics for displayed sessions (in chunks if needed, here we just pass all)
      fetchMetrics(displayedSessions.map(s => s.username))
    }
  }, [displayedSessions, fetchMetrics])

  // ── 4. Manage Tasks ──
  const {
    tasks: exportTasks,
    startTask,
    cancelTask: cancelExportTask,
    clearCompletedTasks: clearCompletedExportTasks
  } = useExportTasks()

  const { enqueueAutomationTask } = useAutomationRunner(startTask)
  const { addTask } = useAutomationStore()

  const {
    allTasks: backgroundTasks,
    pauseTask: pauseBgTask,
    resumeTask: resumeBgTask,
    cancelTask: cancelBgTask
  } = useBackgroundTasks()

  // ── 4. Dialog & Exports ──
  const { dialogState, openDialog, closeDialog } = useExportDialog()

  const handleExportDefaultsChanged = useCallback((patch: ExportDefaultsSettingsPatch) => {
    updateOptions({
      ...(patch.format ? { defaultFormat: patch.format as any } : {}),
      ...(patch.avatars !== undefined ? { exportAvatars: patch.avatars } : {}),
    })
  }, [updateOptions])

  const handleExportSelected = useCallback(() => {
    const selectedRows = displayedSessions.filter(s => selectedSessionIds.has(s.username))
    if (selectedRows.length === 0) return

    const scope = getSelectionScopeFromRows(selectedRows)
    const sessionNames = resolveScopeDisplayNames(selectedRows, options.displayNamePreference)
    
    openDialog({
      scope,
      intent: 'manual',
      sessionIds: selectedRows.map(s => s.username),
      sessionNames,
      title: '批量导出'
    })
  }, [displayedSessions, selectedSessionIds, options.displayNamePreference, openDialog])

  const handleAutomationExportFromSelection = useCallback(() => {
    const selectedRows = displayedSessions.filter(s => selectedSessionIds.has(s.username))
    if (selectedRows.length === 0) return

    const scope = getSelectionScopeFromRows(selectedRows)
    const sessionNames = resolveScopeDisplayNames(selectedRows, options.displayNamePreference)
    
    // B-plan: skip ExportDialog, go directly to AutomationTaskForm
    setDraftAutomationPayload({
      sessionIds: selectedRows.map(s => s.username),
      sessionNames,
      scope,
      options
    })
  }, [displayedSessions, selectedSessionIds, options])

  const handleSingleExport = useCallback((sessionId: string) => {
    const sessionRow = displayedSessions.find(s => s.username === sessionId)
    if (!sessionRow) return
    setSelectedSessionIds(new Set([sessionId]))
    
    const scope = getSelectionScopeFromRows([sessionRow])
    const sessionNames = resolveScopeDisplayNames([sessionRow], options.displayNamePreference)

    openDialog({
      scope,
      intent: 'manual',
      sessionIds: [sessionId],
      sessionNames,
      title: '导出联系人/群聊'
    })
  }, [displayedSessions, options.displayNamePreference, openDialog])

  const handleConfirmExport = useCallback((finalOptions: any) => {
    startTask({
      sessionIds: dialogState.sessionIds,
      sessionNames: dialogState.sessionNames,
      scope: dialogState.scope,
      source: dialogState.intent === 'automation-create' ? 'automation' : 'manual',
      outputDir: exportPath,
      options: finalOptions
    })
    closeDialog()
  }, [dialogState, exportPath, startTask, closeDialog])

  const handleAutomationSave = useCallback((task: any) => {
    void addTask(task)
    setDraftAutomationPayload(null)
  }, [addTask])

  return (
    <div className="export-v2-page">
      <ExportTopBar 
        exportPath={exportPath}
        writeLayout={writeLayout}
        onSelectPath={() => void window.electronAPI.dialog.openFile({ properties: ['openDirectory'] }).then(res => !res.canceled && res.filePaths[0] && setExportPath(res.filePaths[0]))}
        onWriteLayoutChange={setWriteLayout}
        onGlobalSettingsClick={() => setIsSettingsModalOpen(true)}
      />

      <div className="export-v2-body">
        <section className="export-v2-session-panel">
          <SessionTable
            sessions={displayedSessions}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            selectedSessionIds={selectedSessionIds}
            onSelectionChange={setSelectedSessionIds}
            isLoading={isSessionsLoading || isContactsLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortConfig={sortConfig}
            onSortChange={setSortConfig}
            metricsMap={metricsMap}
            onSingleExport={handleSingleExport}
            onBatchExport={handleExportSelected}
            onAutomationExport={handleAutomationExportFromSelection}
          />
        </section>

        {(exportTasks.length > 0 || backgroundTasks.filter(t => t.sourcePage === 'export').length > 0) && (
          <section className="export-v2-task-panel">
            <TaskCenter
              exportTasks={exportTasks}
              onCancelExportTask={cancelExportTask}
              onClearCompletedExportTasks={clearCompletedExportTasks}
              backgroundTasks={backgroundTasks.filter(t => t.sourcePage === 'export')}
              onPauseBackgroundTask={pauseBgTask}
              onResumeBackgroundTask={resumeBgTask}
              onCancelBackgroundTask={cancelBgTask}
            />
          </section>
        )}
      </div>

      <ExportDialog
        dialogState={dialogState}
        onClose={closeDialog}
        options={options}
        onOptionsChange={updateOptions}
        exportPath={exportPath}
        onSelectPath={() => void window.electronAPI.dialog.openFile({ properties: ['openDirectory'] }).then(res => !res.canceled && res.filePaths[0] && setExportPath(res.filePaths[0]))}
        rawDateRangeConfig={rawDateRangeConfig}
        onDateRangeConfigChange={setRawDateRangeConfig}
        onConfirm={handleConfirmExport}
        onAutomationCreate={handleConfirmExport}
      />

      {isSettingsModalOpen && (
        <div 
          className="export-defaults-modal-overlay"
          onClick={() => setIsSettingsModalOpen(false)}
        >
          <div 
            className="export-defaults-modal"
            role="dialog"
            onClick={e => e.stopPropagation()}
          >
            <div className="export-defaults-modal-header">
              <h3>全局配置</h3>
              <button className="close-icon-btn" onClick={() => setIsSettingsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="export-defaults-modal-body">
              <ExportDefaultsSettingsForm layout="split" onDefaultsChanged={handleExportDefaultsChanged} />
            </div>
            <div className="export-defaults-modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                type="button" 
                className="secondary-btn"
                onClick={() => {
                  setIsSettingsModalOpen(false)
                  setIsAutomationModalOpen(true)
                }}
              >
                管理自动化任务
              </button>
              <button 
                type="button" 
                className="secondary-btn"
                onClick={() => setIsSettingsModalOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {isAutomationModalOpen && (
        <AutomationModal onClose={() => setIsAutomationModalOpen(false)} />
      )}

      {draftAutomationPayload && (
        <AutomationTaskForm
          basePayload={draftAutomationPayload}
          onSave={handleAutomationSave}
          onCancel={() => setDraftAutomationPayload(null)}
        />
      )}
    </div>
  )
}

export default memo(ExportPage)
