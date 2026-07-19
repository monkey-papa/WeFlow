import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ExportAutomationTask } from '../../../../types/exportAutomation'
import { useAutomationStore } from '../../hooks/useAutomation'
import { AutomationTaskList } from './AutomationTaskList'
import { AutomationTaskForm } from './AutomationTaskForm'
import './Automation.scss'

interface AutomationModalProps {
  onClose: () => void
}

export const AutomationModal: React.FC<AutomationModalProps> = ({ onClose }) => {
  const { tasks, updateTask, deleteTask } = useAutomationStore()
  const [editingTask, setEditingTask] = useState<ExportAutomationTask | null>(null)

  const handleToggleEnable = (task: ExportAutomationTask, enabled: boolean) => {
    void updateTask(task.id, prev => ({ ...prev, enabled, updatedAt: Date.now() }))
  }

  const handleRunNow = (_task: ExportAutomationTask) => {
    // Manual trigger is handled by the automation runner's evaluateSchedules
    // For now, just show a hint
    alert('手动触发功能需要自动化运行器的支持，任务将在下次调度周期中执行。')
  }

  const handleDelete = (task: ExportAutomationTask) => {
    void deleteTask(task.id)
  }

  const handleEditSave = (task: ExportAutomationTask) => {
    void updateTask(task.id, () => task)
    setEditingTask(null)
  }

  return createPortal(
    <>
      <div className="automation-modal-overlay" onClick={onClose}>
        <div className="automation-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="header-title">
              <h3>自动化导出</h3>
              <p>管理定时增量备份任务，仅在应用运行期间生效</p>
            </div>
            <div className="header-actions">
              <button className="close-icon-btn" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
          </div>
          
          <div className="modal-content">
            <AutomationTaskList 
              tasks={tasks}
              onEdit={setEditingTask}
              onDelete={handleDelete}
              onToggleEnable={handleToggleEnable}
              onRunNow={handleRunNow}
            />
          </div>
        </div>
      </div>

      {editingTask && (
        <AutomationTaskForm
          initialTask={editingTask}
          onSave={handleEditSave}
          onCancel={() => setEditingTask(null)}
        />
      )}
    </>,
    document.body
  )
}
