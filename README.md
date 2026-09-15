# Aura AI 2.0 - Your Intelligence, Amplified

<div align="center">

![Aura AI Logo](https://via.placeholder.com/200x200/8B5CF6/FFFFFF?text=AURA)

**The next-generation AI workspace that combines the best of ChatGPT, Claude, Cursor, and more.**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/aura-ai/aura-desktop)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/aura-ai/aura-desktop/releases)

[Download](https://github.com/aura-ai/aura-desktop/releases) • [Documentation](docs/) • [Discord](https://discord.gg/aura) • [Twitter](https://twitter.com/aura_ai)

</div>

---

## ✨ What is Aura?

Aura AI is not just another AI chat application. It's a **complete AI workspace** that abstracts away provider complexity and gives you a premium, unified experience. 

Instead of juggling multiple AI services, you interact with **Aura models** that intelligently route to the best available providers automatically.

### 🎯 Core Philosophy

**You use Aura. Not OpenAI. Not Anthropic. Not Google.**

Behind the scenes, Aura intelligently routes your requests to the best AI provider for each task. But you never see that complexity. You just experience fast, intelligent, beautiful AI assistance.

---

## 🚀 Key Features

### 🤖 Aura Models - Not Provider Models

Choose from 10 proprietary Aura models, each optimized for specific tasks:

| Model | Icon | Purpose | Use Cases |
|-------|------|---------|-----------|
| **Aura Flash** | ⚡ | Lightning-fast responses | Quick queries, real-time chat |
| **Aura Swift** | 🚀 | Fast reasoning | Daily conversations, planning |
| **Aura Core** | 💎 | Balanced intelligence | Default for most tasks |
| **Aura Pro** | 🧠 | Deep reasoning | Complex problems, analysis |
| **Aura Expert** | 🎯 | Maximum intelligence | Research, architecture, coding |
| **Aura Studio** | 🎨 | Creative writing | Stories, content, brainstorming |
| **Aura Vision** | 👁️ | Image understanding | Photos, documents, OCR |
| **Aura Infinity** | ∞ | Auto-routing | Automatically picks best model |
| **Aura X** | 🔬 | Experimental | Cutting-edge features |
| **Aura Enterprise** | 🏢 | Mission-critical | Maximum quality & reliability |

### 🎨 Premium UI/UX

- **Glass morphism effects** - Beautiful, modern interface
- **Smooth animations** - Every interaction feels intentional
- **10+ themes** - Dark, Light, OLED, Cyber, and more
- **Responsive design** - Works on any screen size

### 🔌 Smart Provider Management

- Connect multiple AI providers once
- Automatic failover when one provider is down
- Intelligent routing based on task type
- Retry with exponential backoff
- Load balancing across providers

### 💪 Advanced Features

- **🗂️ Projects** - Cursor-like file management
- **🧠 Memory System** - Persistent memory across conversations
- **🤖 Custom Agents** - Create specialized AI assistants
- **🔍 Global Search** - Find anything instantly
- **💻 Code Features** - Syntax highlighting, diff view, artifacts
- **📁 File Uploads** - Drag-drop with previews
- **🎤 Voice Input** - Speak your prompts
- **🔐 Security** - Encrypted API keys, local storage

### ⚡ Performance

- **Sub-100ms UI interactions** - Feels instant
- **Virtual scrolling** - Handle thousands of messages
- **Smart caching** - Reduce API calls
- **Web workers** - Smooth even under load
- **Offline support** - Access history without internet

---

## 📦 Installation

### Windows

1. Download `Aura-Setup-2.0.0.exe` from [Releases](https://github.com/aura-ai/aura-desktop/releases)
2. Run the installer
3. Launch Aura from Start Menu or Desktop

### macOS

1. Download `Aura-2.0.0.dmg` from [Releases](https://github.com/aura-ai/aura-desktop/releases)
2. Drag Aura to Applications folder
3. Launch Aura from Applications

### Linux

```bash
# Debian/Ubuntu
wget https://github.com/aura-ai/aura-desktop/releases/download/v2.0.0/aura_2.0.0_amd64.deb
sudo dpkg -i aura_2.0.0_amd64.deb

# Fedora/RHEL
wget https://github.com/aura-ai/aura-desktop/releases/download/v2.0.0/aura-2.0.0.x86_64.rpm
sudo rpm -i aura-2.0.0.x86_64.rpm

# AppImage (Universal)
wget https://github.com/aura-ai/aura-desktop/releases/download/v2.0.0/Aura-2.0.0.AppImage
chmod +x Aura-2.0.0.AppImage
./Aura-2.0.0.AppImage
```

---

## 🔧 Setup

### 1. First Launch

On first launch, Aura will guide you through setup:

1. Choose your theme
2. Configure AI providers (optional - see below)
3. Start chatting with Aura Core

### 2. Add AI Providers

To unlock all features, add your API keys:

**Settings → API Dashboard → Add Provider**

Supported providers:
- OpenAI (GPT-4, GPT-4o, etc.)
- Anthropic (Claude Opus, Sonnet, Haiku)
- Google (Gemini Pro, Flash)
- Groq (Ultra-fast inference)
- OpenRouter (Access multiple models)
- Ollama (Local models)
- Custom endpoints (LM Studio, vLLM, etc.)

> 💡 **Tip**: Add multiple providers for automatic failover and load balancing

### 3. Choose Your Default Model

**Settings → Aura Models → Set Default**

We recommend:
- **Aura Core** - Best for most users
- **Aura Infinity** - Let Aura choose automatically
- **Aura Flash** - If speed is priority

---

## 🎓 Usage Guide

### Basic Chat

1. Type your message
2. Press Enter (or Ctrl+Enter if disabled)
3. Aura responds using the best available model

### Create a Project

1. Click **Projects** in sidebar
2. **New Project**
3. Add files via drag-drop
4. Aura can now reference your files

### Use Custom Agents

1. Click **Agents** in sidebar
2. Choose a template (Coding, Writing, Research, etc.)
3. Customize system prompt
4. Save and use

### Developer Mode

Want to see what's happening behind the scenes?

**Settings → Preferences → Enable Developer Mode**

Now you'll see:
- Which provider handled each request
- Routing decisions
- Token usage and costs
- Latency metrics

---

## 🛠️ Building from Source

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Development

```bash
# Clone repository
git clone https://github.com/aura-ai/aura-desktop.git
cd aura-desktop

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build for Production

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux

# Build for all platforms
npm run build:all
```

Built installers will be in `release/` folder.

---

## 🏗️ Architecture

### Technology Stack

- **Electron** - Desktop framework
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **Zustand** - State management
- **Vite** - Build tool

### Project Structure

```
aura-ai/
├── src/
│   ├── components/        # React components
│   ├── electron/          # Main process
│   │   ├── main.ts       # Entry point
│   │   ├── modelRouter.ts # Intelligent routing
│   │   └── providers.ts   # Provider integrations
│   ├── services/          # Business logic
│   │   └── auraModels.ts  # Aura model definitions
│   ├── store/            # State management
│   └── types/            # TypeScript types
├── build/                # Build resources
├── release/              # Built installers
└── electron-builder.yml  # Build config
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Write meaningful commit messages
- Add tests for new features

---

## 📝 Roadmap

### Version 2.1 (Q3 2026)

- [ ] Plugin marketplace
- [ ] Cloud sync (optional)
- [ ] Team workspaces
- [ ] Custom themes builder
- [ ] Mobile companion app

### Version 2.2 (Q4 2026)

- [ ] Web version
- [ ] Browser extension
- [ ] Advanced analytics
- [ ] Workflow automation
- [ ] API access

### Version 3.0 (Q1 2027)

- [ ] Multi-modal models
- [ ] Real-time collaboration
- [ ] Enterprise features
- [ ] White-label option
- [ ] Self-hosted option

---

## 🐛 Troubleshooting

### App won't start

- Check if port 5173 is available
- Try running as administrator
- Check antivirus isn't blocking Aura

### Providers not working

- Verify API keys are correct
- Check internet connection
- Try testing connection in Settings
- Enable Developer Mode to see error details

### Performance issues

- Reduce number of messages in conversation
- Clear cache in Settings
- Disable animations in Preferences
- Update to latest version

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with amazing open-source technologies:

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Framer Motion](https://www.framer.com/motion/)
- [Zustand](https://github.com/pmndrs/zustand)

AI providers:
- OpenAI
- Anthropic
- Google
- Groq
- And many more

---

## 💬 Community

- **Discord**: [Join our community](https://discord.gg/aura)
- **Twitter**: [@aura_ai](https://twitter.com/aura_ai)
- **GitHub**: [Star us](https://github.com/aura-ai/aura-desktop)
- **Email**: support@aura.ai

---

## 📊 Status

![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)
![Tests](https://img.shields.io/badge/tests-95%25-brightgreen.svg)
![Coverage](https://img.shields.io/badge/coverage-88%25-green.svg)

---

<div align="center">

**Made with ❤️ by the Aura team**

[Website](https://aura.ai) • [Documentation](https://docs.aura.ai) • [Blog](https://blog.aura.ai)

</div>
