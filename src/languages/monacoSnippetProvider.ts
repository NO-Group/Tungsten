/**
 * Snippet completions, registered straight into Monaco.
 *
 * Separate from the language client because snippets need no server: they
 * work in the browser build and for languages nothing else supports. Monaco's
 * own snippet controller drives the tabstops, so the body is handed over raw
 * with only our variables resolved.
 */

import { resolveSnippet, snippetsForLanguage, type Snippet } from '../snippets/snippetService'
import type { SnippetVariableContext } from '../snippets/snippetVariables'
import { supportedLanguages } from '../workspace'

let snippetProviderRegistered = false

/** Registers snippet completions for every supported language. */
export function registerSnippetProvider(monaco: any, getSnippets: () => Snippet[], getContext: () => SnippetVariableContext) {
  if (snippetProviderRegistered) return
  snippetProviderRegistered = true
  for (const language of supportedLanguages) {
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const available = snippetsForLanguage(getSnippets(), language)
        return {
          suggestions: available.map((snippet) => {
            // Hand Monaco the raw TextMate body so its own snippet controller
            // drives the tabstops, but resolve our variables first.
            const { text } = resolveSnippet(snippet.body, { ...getContext(), languageId: language })
            return {
              label: snippet.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: snippet.name,
              documentation: { value: `${snippet.description ?? snippet.name}\n\n\`\`\`${language}\n${text}\n\`\`\`` },
              insertText: snippet.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `0${snippet.prefix}`,
            }
          }),
        }
      },
    })
  }
}
