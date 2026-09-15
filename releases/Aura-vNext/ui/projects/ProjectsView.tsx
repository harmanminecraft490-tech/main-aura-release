import { useState } from 'react'
import { Plus, FolderOpen, Trash2, StickyNote, Pin, MessageSquarePlus } from 'lucide-react'
import { useStore } from '@services/store'
import type { Project } from '@/domain'

export function ProjectsView() {
  const projects = useStore(state => state.projects)
  const createProject = useStore(state => state.createProject)
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null)
  const selected = projects.find(p => p.id === selectedId) ?? projects[0]

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-white/[0.06] bg-surface-1/40">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-white/80">Projects</h2>
          <button className="btn-subtle !px-2" onClick={() => setSelectedId(createProject({ name: 'New project' }))}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
          {projects.length === 0 && <p className="px-2.5 py-2 text-xs text-white/30">No projects yet.</p>}
          {projects.map(project => (
            <button
              key={project.id}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                project.id === selected?.id ? 'bg-aura-500/15 text-white' : 'text-white/65 hover:bg-white/[0.06]'
              }`}
              onClick={() => setSelectedId(project.id)}
            >
              <span className="text-base">{project.icon}</span>
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      </div>

      {selected ? <ProjectDetail key={selected.id} project={selected} /> : (
        <div className="flex flex-1 items-center justify-center text-white/40">
          <div className="text-center">
            <FolderOpen className="mx-auto h-10 w-10 text-white/20" />
            <p className="mt-3">Create a project to organize chats, files and context.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectDetail({ project }: { project: Project }) {
  const updateProject = useStore(state => state.updateProject)
  const deleteProject = useStore(state => state.deleteProject)
  const createConversation = useStore(state => state.createConversation)
  const [newPrompt, setNewPrompt] = useState('')
  const [newNote, setNewNote] = useState('')

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <input
              className="w-14 rounded-xl border border-white/10 bg-white/[0.04] py-2 text-center text-2xl outline-none"
              value={project.icon}
              maxLength={2}
              onChange={event => updateProject(project.id, { icon: event.target.value })}
            />
            <div>
              <input
                className="bg-transparent text-2xl font-semibold text-white outline-none"
                value={project.name}
                onChange={event => updateProject(project.id, { name: event.target.value })}
              />
              <p className="text-sm text-white/40">Project workspace</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => createConversation({ projectId: project.id, auraModelId: project.auraModelId })}>
              <MessageSquarePlus className="h-4 w-4" /> New chat
            </button>
            <button className="btn-ghost !px-2.5 text-red-300" onClick={() => deleteProject(project.id)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <Panel title="Context" hint="Injected into every chat in this project.">
            <textarea
              className="field min-h-[100px] resize-y"
              placeholder="Background, goals, constraints, tone…"
              value={project.context ?? ''}
              onChange={event => updateProject(project.id, { context: event.target.value })}
            />
          </Panel>

          <Panel title="Pinned prompts" icon={<Pin className="h-4 w-4" />}>
            <div className="space-y-2">
              {project.pinnedPrompts.map((prompt, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-sm text-white/70">
                  <span className="flex-1">{prompt}</span>
                  <button onClick={() => updateProject(project.id, { pinnedPrompts: project.pinnedPrompts.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-3.5 w-3.5 text-white/30 hover:text-red-300" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input className="field" placeholder="Add a reusable prompt…" value={newPrompt}
                  onChange={event => setNewPrompt(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && newPrompt.trim()) {
                      updateProject(project.id, { pinnedPrompts: [...project.pinnedPrompts, newPrompt.trim()] })
                      setNewPrompt('')
                    }
                  }} />
              </div>
            </div>
          </Panel>

          <Panel title="Notes" icon={<StickyNote className="h-4 w-4" />}>
            <div className="space-y-2">
              {project.notes.map(note => (
                <div key={note.id} className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-sm text-white/70">
                  <span className="flex-1 whitespace-pre-wrap">{note.content}</span>
                  <button onClick={() => updateProject(project.id, { notes: project.notes.filter(n => n.id !== note.id) })}>
                    <Trash2 className="h-3.5 w-3.5 text-white/30 hover:text-red-300" />
                  </button>
                </div>
              ))}
              <textarea className="field min-h-[60px] resize-y" placeholder="Jot a note…" value={newNote}
                onChange={event => setNewNote(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && newNote.trim()) {
                    updateProject(project.id, {
                      notes: [...project.notes, { id: Date.now().toString(36), content: newNote.trim(), createdAt: Date.now() }],
                    })
                    setNewNote('')
                  }
                }} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-white/85">{title}</h3>
        {hint && <span className="text-xs text-white/35">— {hint}</span>}
      </div>
      {children}
    </section>
  )
}
