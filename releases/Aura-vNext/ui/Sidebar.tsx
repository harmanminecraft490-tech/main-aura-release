import { useMemo, useState } from 'react'
import {
  Plus, Search, Settings, FolderPlus, Folder as FolderIcon, ChevronRight,
  Pin, MessageSquare, Trash2, FolderTree, PanelLeftClose, Sparkles,
} from 'lucide-react'
import { useStore } from '@services/store'
import type { Conversation, Folder } from '@/domain'
import { cn } from './cn'

export function Sidebar() {
  const conversations = useStore(state => state.conversations)
  const folders = useStore(state => state.folders)
  const projects = useStore(state => state.projects)
  const activeId = useStore(state => state.activeConversationId)
  const searchQuery = useStore(state => state.searchQuery)
  const setSearchQuery = useStore(state => state.setSearchQuery)

  const createConversation = useStore(state => state.createConversation)
  const setActive = useStore(state => state.setActiveConversation)
  const deleteConversation = useStore(state => state.deleteConversation)
  const updateConversation = useStore(state => state.updateConversation)
  const createFolder = useStore(state => state.createFolder)
  const setView = useStore(state => state.setView)
  const setSettingsTab = useStore(state => state.setSettingsTab)
  const toggleSidebar = useStore(state => state.toggleSidebar)

  const query = searchQuery.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!query) return conversations
    return conversations.filter(
      c =>
        c.title.toLowerCase().includes(query) ||
        c.messages.some(m => m.content.toLowerCase().includes(query))
    )
  }, [conversations, query])

  const pinned = filtered.filter(c => c.pinned)
  const rootChats = filtered.filter(c => !c.pinned && !c.folderId)
  const recent = useMemo(
    () => [...filtered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    [filtered]
  )

  return (
    <aside className="relative z-20 flex h-full w-72 shrink-0 flex-col border-r border-white/[0.06] bg-surface-1/70 backdrop-blur-2xl">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button className="btn-primary flex-1" onClick={() => createConversation()}>
          <Plus className="h-4 w-4" /> New chat
        </button>
        <button className="btn-ghost !px-2.5" onClick={() => createFolder('New folder')} title="New folder">
          <FolderPlus className="h-4 w-4" />
        </button>
        <button className="btn-ghost !px-2.5" onClick={toggleSidebar} title="Collapse sidebar">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            className="field !pl-9"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {projects.length > 0 && (
          <Section label="Projects" icon={<Sparkles className="h-3.5 w-3.5" />}>
            {projects.map(project => (
              <button
                key={project.id}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-white/70 transition hover:bg-white/[0.06]"
                onClick={() => setView('projects')}
              >
                <span className="text-base">{project.icon}</span>
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </Section>
        )}

        {pinned.length > 0 && (
          <Section label="Pinned" icon={<Pin className="h-3.5 w-3.5" />}>
            {pinned.map(c => (
              <ChatRow key={c.id} conversation={c} active={c.id === activeId} onSelect={setActive}
                onDelete={deleteConversation} onTogglePin={() => updateConversation(c.id, { pinned: !c.pinned })} />
            ))}
          </Section>
        )}

        {folders.filter(f => !f.parentId).map(folder => (
          <FolderNode
            key={folder.id}
            folder={folder}
            allFolders={folders}
            conversations={filtered}
            activeId={activeId}
            depth={0}
          />
        ))}

        {!query && recent.length > 0 && (
          <Section label="Recent" icon={<MessageSquare className="h-3.5 w-3.5" />}>
            {recent.map(c => (
              <ChatRow key={`recent-${c.id}`} conversation={c} active={c.id === activeId} onSelect={setActive}
                onDelete={deleteConversation} onTogglePin={() => updateConversation(c.id, { pinned: !c.pinned })} />
            ))}
          </Section>
        )}

        <Section label="All chats" icon={<FolderTree className="h-3.5 w-3.5" />}>
          {rootChats.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-white/30">No chats yet.</p>
          ) : (
            rootChats.map(c => (
              <ChatRow key={c.id} conversation={c} active={c.id === activeId} onSelect={setActive}
                onDelete={deleteConversation} onTogglePin={() => updateConversation(c.id, { pinned: !c.pinned })} />
            ))
          )}
        </Section>
      </nav>

      <div className="border-t border-white/[0.06] p-2">
        <button
          className="btn-subtle w-full justify-start"
          onClick={() => setSettingsTab('general')}
        >
          <Settings className="h-4 w-4" /> Settings
        </button>
      </div>
    </aside>
  )
}

function Section({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">
        {icon} {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

/** Recursive folder node — supports unlimited nesting. */
function FolderNode({
  folder, allFolders, conversations, activeId, depth,
}: {
  folder: Folder
  allFolders: Folder[]
  conversations: Conversation[]
  activeId: string | null
  depth: number
}) {
  const [open, setOpen] = useState(true)
  const setActive = useStore(state => state.setActiveConversation)
  const deleteConversation = useStore(state => state.deleteConversation)
  const updateConversation = useStore(state => state.updateConversation)
  const deleteFolder = useStore(state => state.deleteFolder)

  const children = allFolders.filter(f => f.parentId === folder.id)
  const chats = conversations.filter(c => c.folderId === folder.id && !c.pinned)

  return (
    <div style={{ paddingLeft: depth * 10 }}>
      <div className="group flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
        <button className="flex flex-1 items-center gap-1.5 text-left" onClick={() => setOpen(o => !o)}>
          <ChevronRight className={cn('h-3.5 w-3.5 text-white/40 transition', open && 'rotate-90')} />
          <FolderIcon className="h-3.5 w-3.5 text-aura-300/70" />
          <span className="truncate text-sm text-white/70">{folder.name}</span>
        </button>
        <button
          className="opacity-0 transition group-hover:opacity-100"
          onClick={() => deleteFolder(folder.id)}
          title="Delete folder"
        >
          <Trash2 className="h-3.5 w-3.5 text-white/30 hover:text-red-300" />
        </button>
      </div>
      {open && (
        <div className="mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-2">
          {children.map(child => (
            <FolderNode key={child.id} folder={child} allFolders={allFolders}
              conversations={conversations} activeId={activeId} depth={depth + 1} />
          ))}
          {chats.map(c => (
            <ChatRow key={c.id} conversation={c} active={c.id === activeId} onSelect={setActive}
              onDelete={deleteConversation} onTogglePin={() => updateConversation(c.id, { pinned: !c.pinned })} />
          ))}
          {children.length === 0 && chats.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-white/25">Empty</p>
          )}
        </div>
      )}
    </div>
  )
}

function ChatRow({
  conversation, active, onSelect, onDelete, onTogglePin,
}: {
  conversation: Conversation
  active: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onTogglePin: () => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition',
        active ? 'bg-aura-500/15 ring-1 ring-aura-400/30' : 'hover:bg-white/[0.06]'
      )}
    >
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelect(conversation.id)}>
        <MessageSquare className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-aura-200' : 'text-white/35')} />
        <span className={cn('truncate text-sm', active ? 'text-white' : 'text-white/70')}>{conversation.title}</span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button onClick={onTogglePin} title={conversation.pinned ? 'Unpin' : 'Pin'}>
          <Pin className={cn('h-3.5 w-3.5', conversation.pinned ? 'text-aura-300' : 'text-white/30 hover:text-white/70')} />
        </button>
        <button onClick={() => onDelete(conversation.id)} title="Delete">
          <Trash2 className="h-3.5 w-3.5 text-white/30 hover:text-red-300" />
        </button>
      </div>
    </div>
  )
}
