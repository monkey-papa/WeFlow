import React, { memo, useRef, useCallback } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Search, Hash, Clock, MoreVertical, X, CheckSquare, Square } from 'lucide-react'
import type { SessionRow, ConversationTab, ContactsSortConfig } from '../../types'
import type { SessionContentMetric } from '../../hooks/useSessionMetrics'
import { conversationTabLabels, exportKindPriority } from '../../constants'
import { getAvatarLetter } from '../../utils/format'
import { formatLatestMessageTimeFromSeconds } from '../../utils/format'
import './SessionTable.scss'

interface SessionTableProps {
  sessions: SessionRow[]
  activeTab: ConversationTab
  searchQuery: string
  sortConfig: ContactsSortConfig
  selectedSessionIds: Set<string>
  onTabChange: (tab: ConversationTab) => void
  onSearchChange: (query: string) => void
  onSortChange: (config: ContactsSortConfig) => void
  onSelectionChange: (selectedIds: Set<string>) => void
  onSingleExport?: (sessionId: string) => void
  onBatchExport?: () => void
  onAutomationExport?: () => void
  isLoading?: boolean
  metricsMap?: Record<string, SessionContentMetric>
}

const SessionTable: React.FC<SessionTableProps> = ({
  sessions,
  activeTab,
  searchQuery,
  sortConfig,
  selectedSessionIds,
  onTabChange,
  onSearchChange,
  onSortChange,
  onSelectionChange,
  onSingleExport,
  onBatchExport,
  onAutomationExport,
  isLoading,
  metricsMap
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const handleSearchClear = () => onSearchChange('')

  const handleSortClick = (key: ContactsSortConfig['key']) => {
    if (sortConfig.key === key) {
      if (sortConfig.order === 'desc') {
        onSortChange({ key, order: 'asc' })
      } else {
        onSortChange({ key, order: 'desc' })
      }
    } else {
      onSortChange({ key, order: 'desc' })
    }
  }

  const handleSelectAll = () => {
    if (selectedSessionIds.size === sessions.length && sessions.length > 0) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(sessions.map(s => s.username)))
    }
  }

  const toggleSelection = useCallback((username: string) => {
    const next = new Set(selectedSessionIds)
    if (next.has(username)) {
      next.delete(username)
    } else {
      next.add(username)
    }
    onSelectionChange(next)
  }, [selectedSessionIds, onSelectionChange])

  // Tabs layout
  const tabs: ConversationTab[] = ['private', 'group', 'official', 'former_friend']

  return (
    <div className="session-table-container">
      {/* ─── Search & Tabs (Top Filter) ─────────────────────────────────────────── */}
      <div className="st-top-filter">
        <div className="st-tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {conversationTabLabels[tab]}
            </button>
          ))}
        </div>

        {selectedSessionIds.size > 0 && (
          <div className="st-selection-actions" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>已选 {selectedSessionIds.size} 项</span>
            {onBatchExport && (
              <button className="primary-btn" onClick={onBatchExport} style={{ height: '28px', padding: '0 16px', borderRadius: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>
                批量导出
              </button>
            )}
            {onAutomationExport && (
              <button className="secondary-btn" onClick={onAutomationExport} style={{ height: '28px', padding: '0 16px', borderRadius: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>
                创建自动化
              </button>
            )}
          </div>
        )}
        
        <div className="st-search" style={{ marginLeft: selectedSessionIds.size > 0 ? '0' : 'auto' }}>
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="搜索联系人、群组、微信号或备注..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={handleSearchClear}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Table Columns Header ─────────────────────────────────────── */}
      <div className="st-header-row">
        <div className="col-checkbox">
          <button className="checkbox-btn" onClick={handleSelectAll}>
            {selectedSessionIds.size === sessions.length && sessions.length > 0 ? (
              <CheckSquare size={18} className="checked" />
            ) : (
              <Square size={18} />
            )}
          </button>
        </div>
        <div className="col-info">会话 / 联系人</div>
        <div className="col-count sortable" onClick={() => handleSortClick('messageCount')} style={{ cursor: 'pointer', display: 'flex', gap: '4px', userSelect: 'none' }}>
          总消息数
          {sortConfig.key === 'messageCount' && (
            <span className="sort-icon">{sortConfig.order === 'desc' ? '↓' : '↑'}</span>
          )}
        </div>
        <div className="col-time sortable" onClick={() => handleSortClick('latestMessageTime')} style={{ cursor: 'pointer', display: 'flex', gap: '4px', userSelect: 'none' }}>
          最新消息时间
          {sortConfig.key === 'latestMessageTime' && (
            <span className="sort-icon">{sortConfig.order === 'desc' ? '↓' : '↑'}</span>
          )}
        </div>
        <div className="col-stat">表情包</div>
        <div className="col-stat">语音</div>
        <div className="col-stat">图片</div>
        <div className="col-stat">视频</div>
        <div className="col-stat">文件</div>
        <div className="col-action">操作</div>
      </div>

      {/* ─── Virtualized List ─────────────────────────────────────────── */}
      <div className="table-body">
        {sessions.length === 0 ? (
          <div className="empty-state">
            {isLoading ? '加载中...' : (searchQuery ? '没有匹配的会话' : '此分类下没有会话')}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={sessions}
            itemContent={(index, session) => {
              if (!session) return null
              
              const metrics = metricsMap?.[session.username]
              const totalCount = metrics?.totalMessages ?? session.messageCountHint ?? 0

              return (
                <div className="st-row" key={session.username}>
                  <div className="col-checkbox">
                    <button className="checkbox-btn" onClick={() => toggleSelection(session.username)}>
                      {selectedSessionIds.has(session.username) ? (
                        <CheckSquare size={18} className="checked" />
                      ) : (
                        <Square size={18} />
                      )}
                    </button>
                  </div>
                  <div className="col-info">
                    <div className="st-avatar">
                      {session.avatarUrl ? (
                        <img src={session.avatarUrl} alt="avatar" />
                      ) : (
                        <span className="avatar-letter">{getAvatarLetter(session.displayName || session.username)}</span>
                      )}
                    </div>
                    <div className="st-text">
                      <span className="st-name" title={session.displayName || session.username}>{session.displayName || session.username}</span>
                      <span className="st-id" title={session.username}>{session.username}</span>
                    </div>
                  </div>
                  <div className="col-count">{totalCount.toLocaleString()}</div>
                  <div className="col-time">
                    {session.lastTimestamp ? formatLatestMessageTimeFromSeconds(session.lastTimestamp).text : '-'}
                  </div>
                  <div className="col-stat">{metrics?.emojiMessages ?? '-'}</div>
                  <div className="col-stat">{metrics?.voiceMessages ?? '-'}</div>
                  <div className="col-stat">{metrics?.imageMessages ?? '-'}</div>
                  <div className="col-stat">{metrics?.videoMessages ?? '-'}</div>
                  <div className="col-stat">{metrics?.fileMessages ?? '-'}</div>
                  <div className="col-action">
                    <button 
                      className="st-action-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSingleExport?.(session.username)
                      }}
                    >
                      导出
                    </button>
                  </div>
                </div>
              )
            }}
          />
        )}
      </div>
    </div>
  )
}

export default memo(SessionTable)
