/**
 * MONACO SETUP — local bundle, no CDN.
 *
 * `@monaco-editor/react` loads Monaco from jsDelivr by default. That fails
 * offline and is blocked by the app's Content-Security-Policy, which is why the
 * editor used to render black. This module wires the loader to the locally
 * bundled `monaco-editor` ESM build and registers its web workers, so the
 * editor works offline with syntax highlighting. Import it before rendering.
 */

// `editor.main` (not the package root) so all language contributions register.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.main'
import { loader } from '@monaco-editor/react'

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Monaco's widget/UI styling (suggest, context menu, find widget, scrollbars).
import 'monaco-editor/min/vs/editor/editor.main.css'

const scope = self as unknown as {
  MonacoEnvironment: {
    getWorker: (workerId: string, label: string) => Worker
  }
}

scope.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json': return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less': return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor': return new htmlWorker()
      case 'typescript':
      case 'javascript': return new tsWorker()
      default: return new editorWorker()
    }
  },
}

// Use the local bundle instead of the jsDelivr CDN default.
loader.config({ monaco })

export { monaco }
