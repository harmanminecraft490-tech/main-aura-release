import { useEffect, useState } from 'react'
import { Folder, Plus, Trash2, HardDrive } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useAuraStore } from '@/store'
import type { Project } from '@/types'

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProjectState] = useState<Project | null>(null)

  useEffect(() => {
    refreshProjects()
  }, [])

  async function refreshProjects() {
    const list = await window.aura?.projects.list()
    setProjects(list || [])
    const active = await window.aura?.projects.getActive()
    setActiveProjectState(active ?? null)
  }

  async function createProject() {
    // The user picks an existing folder — Aura never creates its own folder.
    const picked = await window.aura?.projects.pickFolder()
    if (!picked || picked.canceled || !picked.path) return
    const name = picked.path.split(/[\\/]/).pop() || 'Project'
    const project = await window.aura?.projects.create({
      name,
      description: '',
      settings: { workspace: picked.path },
    })

    if (project) {
      await refreshProjects()
    }
  }

  async function deleteProject(id: string) {
    if (!confirm('Are you sure you want to delete this project?')) return
    await window.aura?.projects.delete(id)
    await refreshProjects()
  }

  async function activateProject(id: string) {
    await window.aura?.projects.setActive(id)
    await refreshProjects()
    useAuraStore.getState().setViewMode('chat')
  }

  return (
    <div className="flex h-full flex-col px-6 py-8 text-white">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-white/40 text-sm mt-1">Manage your coding workspaces and project files.</p>
        </div>
        <button
          onClick={() => void createProject()}
          className="flex items-center gap-2 rounded-xl bg-white text-black px-4 py-2 text-sm font-medium transition hover:bg-white/90"
        >
          <Plus size={16} />
          Open Folder
        </button>
      </header>

      {
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center opacity-30">
              <HardDrive size={48} className="mb-4" />
              <p>No projects found. Create one to start coding.</p>
            </div>
          ) : (
            projects.map(project => (
              <div
                key={project.id}
                className={cn(
                  "group relative p-5 rounded-3xl border transition cursor-pointer",
                  activeProject?.id === project.id
                    ? "bg-white/10 border-aura-400/50 shadow-lg shadow-aura-500/10"
                    : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                )}
                onClick={() => activateProject(project.id)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-2xl bg-white/10 text-aura-400">
                    <Folder size={24} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                    className="p-2 rounded-lg text-white/20 hover:text-red-400 transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <h3 className="font-medium text-lg mb-1">{project.name}</h3>
                <p className="text-white/30 text-xs truncate">{project.settings?.workspace}</p>

                {activeProject?.id === project.id && (
                  <div className="absolute top-4 right-4">
                    <span className="flex h-2 w-2 rounded-full bg-aura-400 animate-pulse" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      }
    </div>
  )
}
