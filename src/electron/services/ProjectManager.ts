import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Project, ProjectFile } from '../../types'

const PROJECTS_FILE = path.join(require('os').homedir(), '.claude', 'projects.json')
const ACTIVE_PROJECT_FILE = path.join(require('os').homedir(), '.claude', 'aura-active-project.json')

class ProjectManager {
  private projects: Project[] = []
  private activeProjectId: string | null = null

  constructor() {
    this.load()
    this.loadActiveProject()
  }

  private loadActiveProject() {
    try {
      if (fs.existsSync(ACTIVE_PROJECT_FILE)) {
        const data = JSON.parse(fs.readFileSync(ACTIVE_PROJECT_FILE, 'utf8'))
        if (data && typeof data.id === 'string') this.activeProjectId = data.id
      }
    } catch {
      this.activeProjectId = null
    }
  }

  private saveActiveProject() {
    try {
      fs.mkdirSync(path.dirname(ACTIVE_PROJECT_FILE), { recursive: true })
      fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify({ id: this.activeProjectId }), 'utf8')
    } catch {
      // non-fatal
    }
  }

  private load() {
    try {
      if (fs.existsSync(PROJECTS_FILE)) {
        const data = fs.readFileSync(PROJECTS_FILE, 'utf8')
        this.projects = JSON.parse(data)
      }
    } catch (error) {
      console.error('Failed to load projects:', error)
      this.projects = []
    }
  }

  private save() {
    try {
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(this.projects, null, 2))
    } catch (error) {
      console.error('Failed to save projects:', error)
    }
  }

  list(): Project[] {
    return this.projects
  }

  create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessed'>): Project {
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
    const slug = (project.name ?? 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'project'
    const workspace = project.settings?.workspace?.trim()
      || path.join(os.homedir(), 'AuraProjects', slug)
    const newProject: Project = {
      ...project,
      id,
      settings: { ...(project.settings ?? {}), workspace },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessed: Date.now(),
      files: [],
    }
    this.projects.push(newProject)
    this.save()
    return newProject
  }

  update(id: string, updates: Partial<Project>): Project | null {
    const project = this.projects.find(p => p.id === id)
    if (!project) return null

    Object.assign(project, updates, { updatedAt: Date.now() })
    this.save()
    return project
  }

  delete(id: string): boolean {
    const index = this.projects.findIndex(p => p.id === id)
    if (index === -1) return false

    this.projects.splice(index, 1)
    if (this.activeProjectId === id) this.activeProjectId = null
    this.save()
    return true
  }

  setActive(id: string | null) {
    this.activeProjectId = id
    this.saveActiveProject()
    // Update lastAccessed for the active project
    if (id) {
      const project = this.projects.find(p => p.id === id)
      if (project) {
        project.lastAccessed = Date.now()
        this.save()
      }
    }
  }

  getActiveProject(): Project | null {
    return this.projects.find(p => p.id === this.activeProjectId) || null
  }

  async uploadFile(projectId: string, file: any): Promise<ProjectFile> {
    const project = this.projects.find(p => p.id === projectId)
    if (!project) throw new Error('Project not found')

    // In a real Electron app, the 'file' would be a path or a buffer from IPC.
    // For this implementation, we assume the project.settings.workspace is the root folder.
    const workspace = project.settings?.workspace
    if (!workspace) throw new Error('Project workspace not configured')

    const filePath = path.join(workspace, file.name)

    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Write file content
    // 'file.data' is expected to be base64 or a buffer
    const content = file.data.startsWith('data:')
      ? Buffer.from(file.data.split(',')[1], 'base64')
      : Buffer.from(file.data)

    fs.writeFileSync(filePath, content)

    const projectFile: ProjectFile = {
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
      name: file.name,
      type: 'file',
      path: filePath,
      size: file.size,
      mimeType: file.type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    if (!project.files) project.files = []
    project.files.push(projectFile)
    this.save()

    return projectFile
  }

  async deleteFile(projectId: string, fileId: string): Promise<void> {
    const project = this.projects.find(p => p.id === projectId)
    if (!project) throw new Error('Project not found')

    const fileIndex = project.files?.findIndex((f: ProjectFile) => f.id === fileId)
    if (fileIndex === undefined || fileIndex === -1) throw new Error('File not found')

    const file = project.files[fileIndex]
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
    }

    project.files.splice(fileIndex, 1)
    this.save()
  }
}

export const projectManager = new ProjectManager()
