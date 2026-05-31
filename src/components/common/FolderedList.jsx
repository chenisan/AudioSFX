import { useState, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../stores/projectStore'

/**
 * Generic flat-folder list shared by Asset / Script / Sketch panels and the
 * timeline track stack. Folders live on `project.folderGroups[namespace]`;
 * items are looked up by stable id (filename / scriptId / sketchId / trackId).
 *
 * Items not present in any folder bucket are gathered into a "未分類" pseudo-
 * folder rendered at the bottom (default collapsed) — set explicitly so users
 * who haven't created any folders still see all their items.
 *
 * Props:
 *   namespace     : 'asset' | 'script' | 'sketch' | 'track'
 *   items         : the panel's full flat list (any object with stable id)
 *   getItemId     : (item) => stable id used in folder.itemIds
 *   renderItem    : (item, ctx: { folderId | null }) => ReactNode
 *   uncategorisedLabel?: defaults to '未分類'
 *   onItemContext?: (item, e) => void  — caller's own right-click menu
 *
 * The component owns folder mutations (create/rename/delete/move/collapse)
 * via the store. Item-level context menu and rendering are delegated to the
 * caller so each panel can keep its own item card UI.
 */
export default function FolderedList({
  namespace,
  items,
  getItemId,
  renderItem,
  uncategorisedLabel = '未分類',
  emptyHint,
}) {
  const folders = useProjectStore(s => s.project?.folderGroups?.[namespace] ?? [])
  const createFolder = useProjectStore(s => s.createFolder)
  const renameFolder = useProjectStore(s => s.renameFolder)
  const deleteFolder = useProjectStore(s => s.deleteFolder)
  const moveItemToFolder = useProjectStore(s => s.moveItemToFolder)
  const moveItemsToFolder = useProjectStore(s => s.moveItemsToFolder)
  const setFolderCollapsed = useProjectStore(s => s.setFolderCollapsed)

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextItem, setContextItem] = useState(null)  // { item, x, y } for "move to folder" menu
  const [contextFolder, setContextFolder] = useState(null)  // { folder, x, y } for "rename / delete" menu
  const [uncategorisedCollapsed, setUncategorisedCollapsed] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  // Anchor for shift-click range selection in select mode. Tracks the last
  // *plain* click; cleared on exit.
  const [anchorId, setAnchorId] = useState(null)
  // Floating action bar's "move to ▾" submenu open state
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  // null = uncategorised drop target highlighted; folderId = that folder
  // header highlighted; undefined = no drag-over.
  const [dragOverFolderId, setDragOverFolderId] = useState(undefined)

  const renameInputRef = useRef(null)
  useEffect(() => { if (renamingId) renameInputRef.current?.focus() }, [renamingId])

  // Bucket items: first pass groups by folder, then anything not claimed
  // becomes uncategorised. Stale folder.itemIds (item deleted from disk)
  // simply produce nothing — no error, no hard reference.
  const { byFolder, uncategorised } = useMemo(() => {
    const idToItem = new Map(items.map(it => [getItemId(it), it]))
    const claimed = new Set()
    const byFolder = new Map()
    for (const f of folders) {
      const ordered = []
      for (const id of f.itemIds) {
        const it = idToItem.get(id)
        if (it) { ordered.push(it); claimed.add(id) }
      }
      byFolder.set(f.id, ordered)
    }
    const uncategorised = items.filter(it => !claimed.has(getItemId(it)))
    return { byFolder, uncategorised }
  }, [items, folders, getItemId])

  const handleCreate = async () => {
    const name = window.prompt('資料夾名稱')?.trim()
    if (!name) return
    await createFolder(namespace, name)
  }

  const startRename = (folder) => {
    setRenamingId(folder.id)
    setRenameValue(folder.name)
  }
  const commitRename = async (folder) => {
    const next = renameValue.trim()
    setRenamingId(null)
    if (next && next !== folder.name) await renameFolder(namespace, folder.id, next)
  }
  const cancelRename = () => setRenamingId(null)

  const handleDelete = async (folder) => {
    const itemCount = byFolder.get(folder.id)?.length ?? 0
    const msg = itemCount > 0
      ? `刪除「${folder.name}」？裡面 ${itemCount} 個項目會回到未分類`
      : `刪除「${folder.name}」？`
    if (!window.confirm(msg)) return
    await deleteFolder(namespace, folder.id)
  }

  const openItemMenu = (item, e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextItem({ item, x: e.clientX, y: e.clientY })
  }

  // Close menu on any click elsewhere
  useEffect(() => {
    if (!contextItem) return
    const close = () => setContextItem(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextItem])

  useEffect(() => {
    if (!contextFolder) return
    const close = () => setContextFolder(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextFolder])

  const openFolderMenu = (folder, e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextFolder({ folder, x: e.clientX, y: e.clientY })
  }

  // Flat display-order id list — used by shift-click range selection. The
  // order matches what the user actually sees: folders top-down (in
  // folders array order), each folder's items in folder.itemIds order, then
  // uncategorised items. Collapsed items are still included so range
  // selection isn't broken by collapse state — selecting the hidden range
  // is harmless and matches Finder/File Explorer behaviour.
  const displayOrderIds = useMemo(() => {
    const ids = []
    for (const f of folders) {
      for (const it of byFolder.get(f.id) ?? []) ids.push(getItemId(it))
    }
    for (const it of uncategorised) ids.push(getItemId(it))
    return ids
  }, [folders, byFolder, uncategorised, getItemId])

  // Selection helpers ── Set is intentionally cloned on every change so React
  // sees a new reference (Sets are reference-compared by useState dispatch).
  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setAnchorId(id)
  }
  const selectRange = (id) => {
    if (!anchorId) { toggleSelected(id); return }
    const a = displayOrderIds.indexOf(anchorId)
    const b = displayOrderIds.indexOf(id)
    if (a < 0 || b < 0) { toggleSelected(id); return }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (let i = lo; i <= hi; i++) next.add(displayOrderIds[i])
      return next
    })
    // Don't move the anchor — Finder/Explorer convention: shift-click
    // extends from the original anchor, additional shift-clicks re-extend.
  }
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setAnchorId(null)
    setBulkMoveOpen(false)
  }
  const selectedCount = selectedIds.size

  const handleBulkNewFolder = async () => {
    if (selectedCount === 0) return
    const name = window.prompt(`為選取的 ${selectedCount} 項建立新資料夾，名稱：`)?.trim()
    if (!name) return
    const ids = [...selectedIds]
    await moveItemsToFolder(namespace, ids, { createFolderName: name })
    exitSelectMode()
  }
  const handleBulkMoveTo = async (folderId) => {
    if (selectedCount === 0) return
    const ids = [...selectedIds]
    await moveItemsToFolder(namespace, ids, { folderId })
    exitSelectMode()
  }

  // Drop-target helpers used by both folder headers and the uncategorised
  // header. We piggyback on the caller's existing dragstart (which already
  // sets `application/json` for timeline drops) by attaching extra data on
  // the same drag via the capture-phase wrapper below; folders read it back
  // and only intercept when both ns + itemId match.
  const FOLDER_ITEMID_MIME = 'text/x-folder-itemid'
  const FOLDER_NS_MIME     = 'text/x-folder-ns'

  const onFolderDragOver = (folderIdOrNull) => (e) => {
    // Drag carries our MIME type → we're a valid target → preventDefault
    // enables the drop. Without this the browser falls back to "no drop".
    if (!e.dataTransfer.types.includes(FOLDER_ITEMID_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    if (dragOverFolderId !== folderIdOrNull) setDragOverFolderId(folderIdOrNull)
  }
  const onFolderDragLeave = (folderIdOrNull) => (e) => {
    // Only clear if the drag is *actually* leaving — dragleave fires
    // erratically when crossing child boundaries within the same target.
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dragOverFolderId === folderIdOrNull) setDragOverFolderId(undefined)
  }
  const onFolderDrop = (folderIdOrNull) => async (e) => {
    const id = e.dataTransfer.getData(FOLDER_ITEMID_MIME)
    const ns = e.dataTransfer.getData(FOLDER_NS_MIME)
    setDragOverFolderId(undefined)
    if (!id || ns !== namespace) return  // not our drag
    e.preventDefault()
    e.stopPropagation()
    await moveItemToFolder(namespace, id, folderIdOrNull)
  }

  // Wraps the caller's renderItem with select-mode UI: an overlay div that
  // captures clicks (so the caller's onClick / dragstart don't fire), shows
  // a checkbox, and toggles selection. Outside select mode the caller's
  // interactions pass through cleanly.
  const renderItemWrapper = (item, folderIdCtx) => {
    const id = getItemId(item)
    const isSel = selectedIds.has(id)
    if (selectMode) {
      return (
        <div
          key={id}
          className={`relative cursor-pointer ${isSel ? 'bg-[#6d5efc]/15 ring-1 ring-[#6d5efc]/40' : 'hover:bg-[#2a2a2a]/30'}`}
          onClick={(e) => {
            e.stopPropagation()
            if (e.shiftKey) selectRange(id)
            else toggleSelected(id)
          }}
        >
          {/* Checkbox indicator on the left edge */}
          <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-4 h-4 rounded border border-[#666] bg-[#0d0d0d] flex items-center justify-center pointer-events-none">
            {isSel && <span className="text-[#6d5efc] text-xs leading-none">✓</span>}
          </div>
          <div className="pointer-events-none pl-5">
            {renderItem(item, { folderId: folderIdCtx })}
          </div>
        </div>
      )
    }
    // Capture-phase dragstart so we run *after* the inner card has already
    // populated dataTransfer (timeline payload). Adding our MIME types to
    // the same drag is invisible to timeline drop targets but lets folder
    // headers identify the source. dragstart bubbles, capture is needed
    // only to be defensive against a child that calls stopPropagation.
    return (
      <div
        key={id}
        onContextMenu={e => openItemMenu(item, e)}
        onDragStartCapture={(e) => {
          try {
            e.dataTransfer.setData(FOLDER_ITEMID_MIME, id)
            e.dataTransfer.setData(FOLDER_NS_MIME, namespace)
          } catch {
            // Older browsers throw on unknown MIME types — silently ignore;
            // user can still right-click → move-to-folder.
          }
        }}
      >
        {renderItem(item, { folderId: folderIdCtx })}
      </div>
    )
  }

  return (
    <div className="flex flex-col" onContextMenu={e => e.preventDefault()}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#252525]">
        <span className="text-[11px] text-[#666]">
          {folders.length > 0 ? `${folders.length} 個資料夾` : '尚未建立資料夾'}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            className={`text-[11px] px-2 py-0.5 rounded ${
              selectMode ? 'bg-[#6d5efc] text-white' : 'bg-[#252525] hover:bg-[#333] text-[#ccc]'
            }`}
            title="切換選擇模式"
          >
            {selectMode ? '退出選擇' : '☑ 選擇'}
          </button>
          <button
            onClick={handleCreate}
            className="text-[11px] px-2 py-0.5 rounded bg-[#252525] hover:bg-[#333] text-[#ccc]"
            title="新增資料夾"
          >
            + 資料夾
          </button>
        </div>
      </div>

      {/* Bulk action bar — only visible in select mode */}
      {selectMode && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-[#1a1a1a] border-b border-[#252525] sticky top-0 z-10">
          <span className="text-[11px] text-[#ccc] mr-1">
            選了 <span className="text-[#6d5efc] font-medium">{selectedCount}</span> 項
          </span>
          <button
            onClick={handleBulkNewFolder}
            disabled={selectedCount === 0}
            className="text-[11px] px-2 py-0.5 rounded bg-[#6d5efc] text-white hover:bg-[#d33c54] disabled:opacity-30"
            title="建立新資料夾並把選取項放進去"
          >
            ✚ 成立資料夾
          </button>
          <div className="relative">
            <button
              onClick={() => setBulkMoveOpen(o => !o)}
              disabled={selectedCount === 0}
              className="text-[11px] px-2 py-0.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-[#ccc] disabled:opacity-30"
              title="移到既有資料夾"
            >
              移到 ▾
            </button>
            {bulkMoveOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-[#1f1f1f] border border-[#333] rounded shadow-xl py-1 min-w-[140px]">
                <button
                  onClick={() => { setBulkMoveOpen(false); handleBulkMoveTo(null) }}
                  className="w-full text-left px-3 py-1 text-[11px] text-[#ccc] hover:bg-[#2a2a2a] italic"
                >
                  未分類
                </button>
                {folders.length > 0 && <div className="border-t border-[#2a2a2a] my-0.5" />}
                {folders.map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setBulkMoveOpen(false); handleBulkMoveTo(f.id) }}
                    className="w-full text-left px-3 py-1 text-[11px] text-[#ccc] hover:bg-[#2a2a2a]"
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setSelectedIds(new Set(items.map(getItemId)))}
            className="text-[11px] px-2 py-0.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-[#ccc] ml-auto"
          >
            全選
          </button>
        </div>
      )}

      {/* Folders */}
      {folders.map(folder => {
        const folderItems = byFolder.get(folder.id) ?? []
        const isCollapsed = !!folder.collapsed
        const isDropTarget = dragOverFolderId === folder.id
        return (
          <div key={folder.id} className="border-b border-[#1a1a1a]">
            <div
              className={`flex items-center px-2 py-1 group transition-colors ${
                isDropTarget
                  ? 'bg-[#6d5efc]/30 ring-1 ring-[#6d5efc]'
                  : 'bg-[#1a1a1a] hover:bg-[#252525]'
              }`}
              onDragOver={onFolderDragOver(folder.id)}
              onDragLeave={onFolderDragLeave(folder.id)}
              onDrop={onFolderDrop(folder.id)}
              onContextMenu={e => openFolderMenu(folder, e)}
            >
              <button
                onClick={() => setFolderCollapsed(namespace, folder.id, !isCollapsed)}
                className="text-[#888] mr-1 w-4"
                title={isCollapsed ? '展開' : '收起'}
              >
                {isCollapsed ? '▶' : '▼'}
              </button>
              {renamingId === folder.id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(folder)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(folder)
                    else if (e.key === 'Escape') cancelRename()
                  }}
                  className="flex-1 text-[12px] bg-[#0d0d0d] text-white px-1 py-0.5 rounded outline-none"
                />
              ) : (
                <button
                  className="flex-1 text-left text-[12px] text-[#ccc] truncate"
                  onDoubleClick={() => startRename(folder)}
                  title="雙擊重新命名 / 右鍵刪除"
                >
                  {folder.name}
                </button>
              )}
              <span className="text-[10px] text-[#666] ml-1">{folderItems.length}</span>
              <button
                onClick={(e) => { e.stopPropagation(); startRename(folder) }}
                className="opacity-60 group-hover:opacity-100 text-[#888] hover:text-[#ccc] ml-1 px-1 text-[11px]"
                title="重新命名"
              >
                ✎
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(folder) }}
                className="opacity-60 group-hover:opacity-100 text-[#888] hover:text-red-400 px-1 text-[11px]"
                title="刪除資料夾"
              >
                ✕
              </button>
            </div>
            {!isCollapsed && (
              <div className="flex flex-col">
                {folderItems.length === 0 ? (
                  <div className="text-[11px] text-[#555] px-4 py-2">空</div>
                ) : (
                  folderItems.map(it => renderItemWrapper(it, folder.id))
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Uncategorised bucket — always last, defaults collapsed */}
      <div className="border-b border-[#1a1a1a]">
        <div
          className={`flex items-center px-2 py-1 cursor-pointer transition-colors ${
            dragOverFolderId === null
              ? 'bg-[#6d5efc]/30 ring-1 ring-[#6d5efc]'
              : 'bg-[#161616] hover:bg-[#1c1c1c]'
          }`}
          onClick={() => setUncategorisedCollapsed(c => !c)}
          onDragOver={onFolderDragOver(null)}
          onDragLeave={onFolderDragLeave(null)}
          onDrop={onFolderDrop(null)}
        >
          <span className="text-[#666] mr-1 w-4">{uncategorisedCollapsed ? '▶' : '▼'}</span>
          <span className="flex-1 text-[12px] text-[#888] italic">{uncategorisedLabel}</span>
          <span className="text-[10px] text-[#666]">{uncategorised.length}</span>
        </div>
        {!uncategorisedCollapsed && (
          <div className="flex flex-col">
            {uncategorised.length === 0 ? (
              <div className="text-[11px] text-[#555] px-4 py-2">{emptyHint ?? '空'}</div>
            ) : (
              uncategorised.map(it => renderItemWrapper(it, null))
            )}
          </div>
        )}
      </div>

      {/* Folder context menu (right-click on folder header) */}
      {contextFolder && (
        <div
          className="fixed z-50 bg-[#1f1f1f] border border-[#333] rounded shadow-xl py-1 min-w-[140px]"
          style={{ left: contextFolder.x, top: contextFolder.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { startRename(contextFolder.folder); setContextFolder(null) }}
            className="w-full text-left px-3 py-1 text-[12px] text-[#ccc] hover:bg-[#2a2a2a]"
          >
            ✎ 重新命名
          </button>
          <button
            onClick={async () => {
              const folder = contextFolder.folder
              setContextFolder(null)
              await handleDelete(folder)
            }}
            className="w-full text-left px-3 py-1 text-[12px] text-red-400 hover:bg-[#2a2a2a]"
          >
            ✕ 刪除資料夾
          </button>
        </div>
      )}

      {/* Move-to-folder context menu */}
      {contextItem && (
        <div
          className="fixed z-50 bg-[#1f1f1f] border border-[#333] rounded shadow-xl py-1 min-w-[160px]"
          style={{ left: contextItem.x, top: contextItem.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[10px] text-[#666] px-3 py-1 border-b border-[#2a2a2a]">移到資料夾</div>
          <button
            onClick={async () => {
              await moveItemToFolder(namespace, getItemId(contextItem.item), null)
              setContextItem(null)
            }}
            className="w-full text-left px-3 py-1 text-[12px] text-[#ccc] hover:bg-[#2a2a2a] italic"
          >
            未分類
          </button>
          {folders.map(f => (
            <button
              key={f.id}
              onClick={async () => {
                await moveItemToFolder(namespace, getItemId(contextItem.item), f.id)
                setContextItem(null)
              }}
              className="w-full text-left px-3 py-1 text-[12px] text-[#ccc] hover:bg-[#2a2a2a]"
            >
              {f.name}
            </button>
          ))}
          <div className="border-t border-[#2a2a2a] mt-1">
            <button
              onClick={async () => {
                const name = window.prompt('新資料夾名稱')?.trim()
                setContextItem(null)
                if (!name) return
                const created = await createFolder(namespace, name)
                if (created) await moveItemToFolder(namespace, getItemId(contextItem.item), created.id)
              }}
              className="w-full text-left px-3 py-1 text-[12px] text-[#ccc] hover:bg-[#2a2a2a]"
            >
              + 新資料夾…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
