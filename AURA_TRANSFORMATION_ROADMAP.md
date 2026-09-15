# Aura AI Vision - Complete Platform Rebuild Roadmap

## ✅ COMPLETED

### Phase 1: Core Model Architecture
- [x] Expanded Aura virtual models to include:
  - Aura Flash (ultra-fast, lowest latency)
  - Aura Swift (fast reasoning, daily conversations)
  - Aura Core (balanced intelligence) - **NEW DEFAULT**
  - Aura Pro (deep reasoning)
  - Aura Expert (research, coding, architecture)
  - Aura Studio (creative writing, images, ideas)
  - Aura Vision (images, documents, OCR)
  - Aura Infinity (auto-routes to best provider)
  - Aura X (experimental, can mix providers)
  - Aura Enterprise (maximum quality)

- [x] Added Developer Mode flag to UserPreferences type
- [x] Updated store with developerMode: false default

## 🚀 PRIORITY FIXES (DO THESE FIRST)

### 1. Fix Thinking/Streaming Bug
**Location:** [`src/components/ChatView.tsx`](../Aura(ai)/src/components/ChatView.tsx:140)
**Problem:** Thinking animation continues after response completes
**Solution:**
```typescript
onDone: (fullResponse, payload) => {
  updateMessage(conversationId!, assistantMessage.id, {
    content: fullResponse,
    isStreaming: false,
    thinking: undefined, // ⚠️ CRITICAL: Clear thinking state
    model: modelLabel,
  })
  useAuraStore.getState().setActivePipeline(null)
  setStreaming(false)
  abortRef.current = null
}
```

### 2. Hide Provider References Behind Developer Mode
**Location:** [`src/components/ModelPicker.tsx`](../Aura(ai)/src/components/ModelPicker.tsx:50)
**Change:** Only show "Provider Models" section when `preferences.developerMode === true`

```typescript
const preferences = useAuraStore(state => state.preferences)
const showProviderModels = preferences.developerMode

// In render:
{showProviderModels && providerSection.length > 0 && (
  <>
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-white/30">Provider Models</p>
    {providerSection.map(renderItem)}
  </>
)}
```

### 3. Add Developer Mode Toggle in Settings
**Location:** [`src/components/SettingsPanel.tsx`](../Aura(ai)/src/components/SettingsPanel.tsx)
**Add new tab:** "Developer"
- Toggle for Developer Mode
- When enabled: Show provider names, raw API details, latency, tokens, costs
- When disabled: Everything is "Aura"

## 📋 FEATURE IMPLEMENTATION CHECKLIST

### Brand & Identity
- [ ] Replace all "OpenAI", "Anthropic", "Gemini" references with "Aura"
- [ ] Hide provider details unless Developer Mode is ON
- [ ] Update all UI text to say "Aura" instead of provider names
- [ ] Create Aura-branded error messages

### Model System
- [x] Aura virtual models created
- [ ] Add custom model creation UI
- [ ] Allow users to create unlimited custom Aura models
- [ ] Save custom models to localStorage
- [ ] Export/import custom models as JSON
- [ ] Model categories and organization
- [ ] Model icons and colors

### Smart Routing
- [ ] Automatic provider health checks
- [ ] Fallback on provider failure
- [ ] Retry logic (3 attempts with exponential backoff)
- [ ] Load balancing across providers
- [ ] Parallel routing experiments
- [ ] Cost optimization routing
- [ ] Latency-based routing

### Performance
- [ ] Implement streaming optimizations
- [ ] Add virtual scrolling for long conversations
- [ ] IndexedDB caching layer
- [ ] Optimistic UI updates
- [ ] Background prewarming
- [ ] Message chunking for large responses
- [ ] WebWorker for markdown parsing
- [ ] Debounced rendering

### Project System
- [ ] Create ProjectsPanel component
- [ ] Folder structure with nested folders
- [ ] Drag and drop file upload
- [ ] Multiple file types support (images, PDFs, code, docs)
- [ ] File preview system
- [ ] Project settings per project
- [ ] Project memory/context
- [ ] Version history
- [ ] Git integration

### Chat Features
- [ ] Chat folders and organization
- [ ] Star/pin messages
- [ ] Chat search within conversation
- [ ] Global chat search
- [ ] Chat branching (fork conversations)
- [ ] Message regeneration
- [ ] Edit previous messages
- [ ] Export conversations (MD, JSON, PDF)
- [ ] Chat templates
- [ ] Slash commands
- [ ] Keyboard shortcuts

### Memory System
- [ ] Expand memory categories
- [ ] Workspace-level memory
- [ ] Project-level memory
- [ ] Conversation-level memory
- [ ] Selective memory (choose what to remember)
- [ ] Forget feature
- [ ] Memory search
- [ ] Memory importance ranking
- [ ] Auto-expire temporary memories

### Agents
- [ ] Agent creation UI
- [ ] Specialized agent templates:
  - Coding Agent
  - Writing Agent
  - Research Agent
  - Marketing Agent
  - Teacher Agent
  - Translator Agent
- [ ] Custom agent prompts
- [ ] Agent memory
- [ ] Agent tools/capabilities
- [ ] Agent marketplace

### Coding Features
- [ ] Code artifacts (inline editable code blocks)
- [ ] Multi-file editing
- [ ] Diff view
- [ ] Apply changes button
- [ ] Run code preview
- [ ] Terminal integration
- [ ] Git operations
- [ ] Dependency management

### UI/UX
- [ ] Premium themes:
  - Dark (default)
  - Light
  - Midnight
  - OLED
  - Glass
  - Cyber
  - Minimal
- [ ] Custom accent colors
- [ ] Smooth animations everywhere
- [ ] Glass morphism effects
- [ ] Perfect spacing and typography
- [ ] Responsive design (tablet, mobile)
- [ ] Loading skeletons
- [ ] Toast notifications

### Global Search
- [ ] Command palette (Cmd/Ctrl+K)
- [ ] Search across:
  - Conversations
  - Messages
  - Files
  - Projects
  - Memory
  - Settings
- [ ] Fuzzy search
- [ ] Recent items
- [ ] Quick actions

### Settings Overhaul
- [ ] Developer Mode tab
- [ ] Advanced settings visibility
- [ ] Import/export all settings
- [ ] Backup/restore functionality
- [ ] Reset to defaults

### Error Handling
- [ ] Graceful error recovery
- [ ] Automatic retry on failure
- [ ] Fallback provider selection
- [ ] Meaningful error messages
- [ ] Error logging for debugging
- [ ] Network issue detection

### Security
- [ ] Encrypt API keys at rest
- [ ] Secure credential storage
- [ ] Never expose secrets in UI
- [ ] Audit log for sensitive operations
- [ ] Local-first option (no cloud sync)

### Voice (Future)
- [ ] Voice input (STT)
- [ ] Voice output (TTS)
- [ ] Wake word detection
- [ ] Continuous conversation mode
- [ ] Emotion-aware responses

### Marketplace (Future)
- [ ] Plugin system
- [ ] Custom model sharing
- [ ] Theme marketplace
- [ ] Agent templates
- [ ] Community extensions

## 🔧 IMPLEMENTATION ORDER

### Sprint 1: Critical Fixes & Developer Mode
1. Fix thinking/streaming bug
2. Implement Developer Mode toggle
3. Hide provider references behind Developer Mode
4. Update Settings UI with Developer tab

### Sprint 2: Performance & Stability
1. Add retry logic and fallback
2. Implement streaming optimizations
3. Add error recovery
4. Improve message rendering performance

### Sprint 3: Projects & Files
1. Create Projects panel
2. File upload system
3. Folder organization
4. File previews

### Sprint 4: Chat Enhancements
1. Chat folders
2. Search within chats
3. Message starring
4. Chat branching

### Sprint 5: Themes & Polish
1. Theme system
2. Premium themes
3. Animation polish
4. Responsive design

### Sprint 6: Advanced Features
1. Custom model creation
2. Agent system
3. Code artifacts
4. Global search

## 📝 QUICK REFERENCE: FILE LOCATIONS

### Core Files
- **Types:** [`src/types/index.ts`](../Aura(ai)/src/types/index.ts)
- **Store:** [`src/store/index.ts`](../Aura(ai)/src/store/index.ts)
- **Models:** [`src/services/auraModels.ts`](../Aura(ai)/src/services/auraModels.ts)
- **Providers:** [`src/electron/providers.ts`](../Aura(ai)/src/electron/providers.ts)

### Components
- **App:** [`src/App.tsx`](../Aura(ai)/src/App.tsx)
- **Chat:** [`src/components/ChatView.tsx`](../Aura(ai)/src/components/ChatView.tsx)
- **Model Picker:** [`src/components/ModelPicker.tsx`](../Aura(ai)/src/components/ModelPicker.tsx)
- **Settings:** [`src/components/SettingsPanel.tsx`](../Aura(ai)/src/components/SettingsPanel.tsx)
- **Sidebar:** [`src/components/Sidebar.tsx`](../Aura(ai)/src/components/Sidebar.tsx)

### Settings Tabs
- **API Dashboard:** [`src/components/settings/APIDashboardTab.tsx`](../Aura(ai)/src/components/settings/APIDashboardTab.tsx)
- **Appearance:** [`src/components/settings/AppearanceTab.tsx`](../Aura(ai)/src/components/settings/AppearanceTab.tsx)
- **Aura Models:** [`src/components/settings/AuraModelsTab.tsx`](../Aura(ai)/src/components/settings/AuraModelsTab.tsx)

## 🎯 DESIGN PRINCIPLES

1. **Aura First:** Everything is Aura. Providers are infrastructure, not product.
2. **Premium Feel:** Apple-level polish, Cursor-level speed, Linear-level animations.
3. **Developer Mode:** Advanced users can see under the hood.
4. **Performance:** Sub-100ms UI interactions, instant feedback.
5. **Never Crash:** Graceful recovery, automatic retry, meaningful errors.
6. **Beautiful by Default:** Dark theme, glass effects, smooth transitions.
7. **Complete Features:** Nothing half-done, no placeholders.

## 🚨 CRITICAL BUG FIXES NEEDED

1. **Thinking Loop:** Clear thinking state on stream completion
2. **Provider Exposure:** Hide in normal mode, show in developer mode
3. **Stream Abort:** Ensure clean stream cleanup
4. **Error Recovery:** Retry failed requests automatically
5. **Memory Leaks:** Clean up listeners and subscriptions

---

**Status:** In Progress
**Last Updated:** 2026-07-14
**Version:** 1.0.0

This is a living document. Update as features are completed.
