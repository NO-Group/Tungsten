/**
 * The Monaco side of the language servers.
 *
 * Every provider here answers by asking the server that the main process
 * runs: completions, hovers, go to definition, references, rename,
 * signature help, semantic tokens and code actions. LSP counts lines and
 * columns from zero and Monaco counts from one, so `toMonacoRangeArgs` is the
 * one place that conversion happens.
 *
 * Nothing here runs in the browser build -- there is no `window.tungsten` to
 * talk to -- which is why snippets live in their own provider.
 */

/** Languages Tungsten ships a server for. */
export const lspLanguages = new Set(['javascript', 'typescript', 'python', 'rust', 'go', 'c', 'cpp', 'java', 'csharp', 'ruby', 'php', 'kotlin', 'lua'])
const openedLspDocuments = new Set<string>()
let languageProvidersRegistered = false
const semanticTokenTypes = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator']
const semanticTokenModifiers = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary']

export async function prepareLanguageDocument(language: string, model: any) {
  const api = window.tungsten
  if (!api || !lspLanguages.has(language)) return null
  const relativePath = model.uri.path.replace(/^\/+/, '')
  const server = await api.startLanguageServer(language).catch(() => null)
  if (!server?.running) return null
  const uri = await api.fileUri(relativePath)
  const key = `${language}:${uri}`
  if (!openedLspDocuments.has(key)) {
    await api.languageNotify(language, 'textDocument/didOpen', {
      textDocument: { uri, languageId: language, version: model.getVersionId(), text: model.getValue() },
    })
    openedLspDocuments.add(key)
  }
  return { api, uri }
}

/** LSP ranges count lines and columns from zero; Monaco counts from one. */
export function toMonacoRangeArgs(range: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  return [range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1] as const
}

function toMonacoRange(monaco: any, range: any) {
  const [startLine, startColumn, endLine, endColumn] = toMonacoRangeArgs(range)
  return new monaco.Range(startLine, startColumn, endLine, endColumn)
}

export function registerLanguageProviders(monaco: any) {
  if (languageProvidersRegistered || !window.tungsten) return
  languageProvidersRegistered = true
  for (const language of lspLanguages) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '>', '/', '"', "'"],
      provideCompletionItems: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { suggestions: [] }
        const result = await context.api.languageRequest(language, 'textDocument/completion', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).catch(() => null)
        const items = Array.isArray(result) ? result : result?.items || []
        const word = model.getWordUntilPosition(position)
        const fallbackRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          suggestions: items.slice(0, 200).map((item: any) => ({
            label: typeof item.label === 'string' ? item.label : item.label?.label || 'completion',
            detail: item.detail,
            documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
            insertText: item.textEdit?.newText || item.insertText || (typeof item.label === 'string' ? item.label : item.label?.label) || 'completion',
            insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            kind: Math.max(0, Math.min(27, (item.kind || 1) - 1)),
            range: item.textEdit?.range ? toMonacoRange(monaco, item.textEdit.range) : fallbackRange,
          })),
        }
      },
    })
    monaco.languages.registerHoverProvider(language, {
      provideHover: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const result = await context.api.languageRequest(language, 'textDocument/hover', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).catch(() => null)
        if (!result?.contents) return null
        const contents = Array.isArray(result.contents) ? result.contents : [result.contents]
        return { contents: contents.map((entry: any) => ({ value: typeof entry === 'string' ? entry : entry.value || '' })) }
      },
    })
    const locationRequest = async (method: string, model: any, position: any, extra: Record<string, unknown> = {}) => {
      const context = await prepareLanguageDocument(language, model)
      if (!context) return []
      const result = await context.api.languageRequest(language, method, {
        textDocument: { uri: context.uri },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        ...extra,
      }).catch(() => null)
      const locations = Array.isArray(result) ? result : result ? [result] : []
      return locations.map((location: any) => {
        const target = location.targetUri ? { uri: location.targetUri, range: location.targetSelectionRange || location.targetRange } : location
        return {
          uri: monaco.Uri.parse(target.uri),
          range: toMonacoRange(monaco, target.range),
        }
      })
    }
    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: (model: any, position: any) => locationRequest('textDocument/definition', model, position),
    })
    monaco.languages.registerReferenceProvider(language, {
      provideReferences: (model: any, position: any) => locationRequest('textDocument/references', model, position, { context: { includeDeclaration: true } }),
    })
    monaco.languages.registerRenameProvider(language, {
      provideRenameEdits: async (model: any, position: any, newName: string) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { edits: [], rejectReason: 'Language server unavailable.' }
        const result = await context.api.languageRequest(language, 'textDocument/rename', {
          textDocument: { uri: context.uri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          newName,
        }).catch(() => null)
        const edits: any[] = []
        for (const [uri, changes] of Object.entries(result?.changes || {})) {
          for (const change of changes as any[]) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { text: change.newText, range: toMonacoRange(monaco, change.range) }, versionId: undefined })
        }
        return { edits, rejectReason: edits.length ? undefined : 'No rename edits were returned.' }
      },
      resolveRenameLocation: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const result = await context.api.languageRequest(language, 'textDocument/prepareRename', { textDocument: { uri: context.uri }, position: { line: position.lineNumber - 1, character: position.column - 1 } }).catch(() => null)
        const range = result?.range || result
        if (!range) return null
        const monacoRange = toMonacoRange(monaco, range)
        return { range: monacoRange, text: model.getValueInRange(monacoRange) }
      },
    })
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model: any, position: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return null
        const value = await context.api.languageRequest(language, 'textDocument/signatureHelp', { textDocument: { uri: context.uri }, position: { line: position.lineNumber - 1, character: position.column - 1 } }).catch(() => null)
        return value ? { value, dispose: () => undefined } : null
      },
    })
    monaco.languages.registerDocumentSemanticTokensProvider(language, {
      getLegend: () => ({ tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers }),
      provideDocumentSemanticTokens: async (model: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { data: new Uint32Array() }
        const result = await context.api.languageRequest(language, 'textDocument/semanticTokens/full', { textDocument: { uri: context.uri } }).catch(() => null)
        return { data: new Uint32Array(result?.data || []), resultId: result?.resultId }
      },
      releaseDocumentSemanticTokens: () => undefined,
    })
    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions: async (model: any, range: any, actionContext: any) => {
        const context = await prepareLanguageDocument(language, model)
        if (!context) return { actions: [], dispose: () => undefined }
        const diagnostics = actionContext.markers.map((marker: any) => ({
          range: { start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 }, end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 } },
          severity: marker.severity === monaco.MarkerSeverity.Error ? 1 : marker.severity === monaco.MarkerSeverity.Warning ? 2 : 3,
          message: marker.message,
          source: marker.source,
          code: marker.code,
        }))
        const results = await context.api.languageRequest(language, 'textDocument/codeAction', {
          textDocument: { uri: context.uri },
          range: { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } },
          context: { diagnostics, only: actionContext.only ? [actionContext.only] : undefined },
        }).catch(() => [])
        const actions = (results || []).map((action: any) => {
          const edits: any[] = []
          for (const [uri, changes] of Object.entries(action.edit?.changes || {})) {
            for (const change of changes as any[]) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { text: change.newText, range: toMonacoRange(monaco, change.range) }, versionId: undefined })
          }
          return { title: action.title, kind: action.kind, diagnostics: actionContext.markers, isPreferred: action.isPreferred, edit: edits.length ? { edits } : undefined, command: action.command ? { id: action.command.command, title: action.command.title || action.title, arguments: action.command.arguments } : undefined }
        })
        return { actions, dispose: () => undefined }
      },
    })
  }
}
