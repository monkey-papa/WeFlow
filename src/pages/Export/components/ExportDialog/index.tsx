import React, { memo, useState, useEffect } from 'react'
import {
  X,
  FileText,
  Image as ImageIcon,
  Video,
  Mic,
  FileBox,
  Smile,
  Calendar,
  Settings,
  HardDrive,
  ExternalLink,
  FolderOpen
} from 'lucide-react'
import { ExportDateRangeDialog } from '../../../../components/Export/ExportDateRangeDialog'
import {
  getExportDateRangeLabel,
  resolveExportDateRangeConfig,
  serializeExportDateRangeConfig,
  type ExportDefaultDateRangeConfig
} from '../../../../utils/exportDateRange'
import type { ExportDialogState, ExportOptions, TextExportFormat } from '../../types'
import { formatOptions, MAX_EXPORT_FILE_SIZE_MB_LIMIT } from '../../constants'
import { formatPathBrief } from '../../utils/format'
import './ExportDialog.scss'

interface ExportDialogProps {
  dialogState: ExportDialogState
  onClose: () => void
  options: ExportOptions
  onOptionsChange: (patch: Partial<ExportOptions>) => void
  exportPath: string
  onSelectPath: () => void
  rawDateRangeConfig: ExportDefaultDateRangeConfig | string | null
  onDateRangeConfigChange: (config: ExportDefaultDateRangeConfig | string | null) => void
  onConfirm: (finalOptions: ExportOptions) => void
  onAutomationCreate: (finalOptions: ExportOptions) => void
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  dialogState,
  onClose,
  options,
  onOptionsChange,
  exportPath,
  onSelectPath,
  rawDateRangeConfig,
  onDateRangeConfigChange,
  onConfirm,
  onAutomationCreate
}) => {
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false)

  const currentSelection = React.useMemo(() => {
    return resolveExportDateRangeConfig(rawDateRangeConfig)
  }, [rawDateRangeConfig])

  const dateRangeLabel = React.useMemo(() => {
    return getExportDateRangeLabel(currentSelection)
  }, [currentSelection])

  if (!dialogState.open) return null

  // Local state for UI toggles that might not strictly map 1:1 to config immediately
  // But we'll just use the global options for now
  const { intent, scope, sessionNames, title } = dialogState
  const isAutomation = intent === 'automation-create'

  const handleFormatSelect = (format: TextExportFormat) => {
    onOptionsChange({ format })
  }

  const handleConfirm = () => {
    if (isAutomation) {
      onAutomationCreate(options)
    } else {
      onConfirm(options)
    }
  }

  return (
    <div className="export-dialog-overlay">
      <div className="export-dialog-container">
        {/* Header */}
        <div className="dialog-header">
          <div className="title-area">
            <h2 className="title">{title}</h2>
            <div className="subtitle">
              {scope === 'single'
                ? `准备导出包含 ${sessionNames[0]} 的会话内容`
                : `已选择 ${sessionNames.length} 个会话`}
              {isAutomation && ' (自动化任务模板配置)'}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="dialog-body">
          {/* Export Path */}
          <div className="config-section">
            <div className="section-title">
              <HardDrive size={16} /> 导出配置
            </div>
            
            <div className="config-row-group">
              <div className="config-row">
                <span className="row-label">时间范围</span>
                <button 
                  className="row-value-btn"
                  onClick={() => setIsDateRangeOpen(true)}
                >
                  <Calendar size={14} className="icon" />
                  <span className="text">{dateRangeLabel}</span>
                  <span className="arrow">&gt;</span>
                </button>
              </div>

              <div className="config-row">
                <span className="row-label">保存路径</span>
                <div className="export-path-row">
                  <div className="path-display-group">
                    <button 
                      className="path-display-btn" 
                      onClick={onSelectPath}
                      title={exportPath}
                    >
                      <FolderOpen size={16} />
                      <span className="path-text">
                        {exportPath ? formatPathBrief(exportPath, 46) : '请选择导出目录...'}
                      </span>
                    </button>
                    {exportPath && (
                      <button 
                        className="open-folder-btn" 
                        title="在文件管理器中打开"
                        onClick={() => window.electronAPI.shell.openPath(exportPath)}
                      >
                        <ExternalLink size={16} />
                      </button>
                    )}
                  </div>
                  <button className="change-path-btn" onClick={onSelectPath}>
                    更改
                  </button>
                </div>
              </div>
            </div>
            
            {!exportPath && <div className="error-text">请先选择一个保存路径</div>}
          </div>

          {/* Format Selection */}
          <div className="config-section">
            <div className="section-title">
              <FileText size={16} /> 导出格式
            </div>
            <div className="format-grid">
              {formatOptions.map(fmt => (
                <button
                  key={fmt.value}
                  className={`format-card ${options.format === fmt.value ? 'active' : ''}`}
                  onClick={() => handleFormatSelect(fmt.value)}
                >
                  <div className="format-name">{fmt.label}</div>
                  <div className="format-desc">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Media Configuration */}
          <div className="config-section">
            <div className="section-title">
              <HardDrive size={16} /> 媒体与文件附件
            </div>
            <div className="media-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportImages}
                  onChange={e => onOptionsChange({ exportImages: e.target.checked })}
                />
                <ImageIcon size={16} /> 导出图片
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportVideos}
                  onChange={e => onOptionsChange({ exportVideos: e.target.checked })}
                />
                <Video size={16} /> 导出视频
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportVoices}
                  onChange={e => onOptionsChange({ exportVoices: e.target.checked })}
                />
                <Mic size={16} /> 导出语音
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportFiles}
                  onChange={e => onOptionsChange({ exportFiles: e.target.checked })}
                />
                <FileBox size={16} /> 导出文件
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportEmojis}
                  onChange={e => onOptionsChange({ exportEmojis: e.target.checked })}
                />
                <Smile size={16} /> 导出表情包
              </label>
            </div>

            {(options.exportVideos || options.exportFiles) && (
              <div className="file-size-limit">
                <span>最大文件限制 (MB):</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_EXPORT_FILE_SIZE_MB_LIMIT}
                  value={options.maxFileSizeMb}
                  onChange={e => onOptionsChange({ maxFileSizeMb: Number(e.target.value) })}
                />
              </div>
            )}
          </div>

          {/* Advanced Options */}
          <div className="config-section">
            <div className="section-title">
              <Settings size={16} /> 高级选项
            </div>
            <div className="advanced-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportAvatars}
                  onChange={e => onOptionsChange({ exportAvatars: e.target.checked })}
                />
                包含联系人头像
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={options.exportVoiceAsText}
                  onChange={e => onOptionsChange({ exportVoiceAsText: e.target.checked })}
                />
                语音转文字 (若已转换)
              </label>

              <div className="path-style-control">
                <span>媒体路径:</span>
                <div className="path-style-segmented" title="控制 TXT/JSON/Excel/CSV 中写入的媒体相对路径分隔符">
                  {[
                    { value: 'auto', label: '当前系统' },
                    { value: 'posix', label: 'macOS/Linux' },
                    { value: 'windows', label: 'Windows' }
                  ].map(item => (
                    <button
                      key={item.value}
                      type="button"
                      className={options.exportPathStyle === item.value ? 'active' : ''}
                      onClick={() => onOptionsChange({ exportPathStyle: item.value as ExportOptions['exportPathStyle'] })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="concurrency-control">
                <span>导出并发数:</span>
                <select
                  value={options.exportConcurrency}
                  onChange={e => onOptionsChange({ exportConcurrency: Number(e.target.value) })}
                >
                  <option value={1}>1 (最稳定)</option>
                  <option value={3}>3 (推荐)</option>
                  <option value={5}>5 (较快)</option>
                  <option value={10}>10 (最快, 易卡顿)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="dialog-footer">
          <button className="cancel-btn" onClick={onClose}>取消</button>
          <button 
            className="confirm-btn" 
            onClick={handleConfirm}
            disabled={!exportPath}
          >
            {isAutomation ? '创建自动化任务' : '开始导出'}
          </button>
        </div>
      </div>

      <ExportDateRangeDialog
        open={isDateRangeOpen}
        value={currentSelection}
        onClose={() => setIsDateRangeOpen(false)}
        onConfirm={(nextSelection) => {
          onDateRangeConfigChange(serializeExportDateRangeConfig(nextSelection))
          setIsDateRangeOpen(false)
        }}
      />
    </div>
  )
}

export default memo(ExportDialog)
