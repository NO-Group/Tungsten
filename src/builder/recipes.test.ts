/**
 * Every shipped recipe, held to the standard a hand-built graph is held to.
 *
 * A starter that arrives with a red error badge is worse than no starter, so
 * each one has to instantiate with no refused links, generate code, pass the
 * integrity checker without a single error, and come back unchanged through
 * the parser.
 */

import { describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { generateProgram } from './codeGenerator'
import { parseProgram } from './codeParser'
import { checkIntegrity } from './integrity'
import { resetIds } from './graph'
import { instantiate, recipeById, recipes } from './recipes'

const registry = createRegistry(builtinBlocks)
const empty = { nodes: [], connections: [] }

describe('recipes', () => {
  it('ships a handful, each with a name and a summary', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(5)
    for (const recipe of recipes) {
      expect(recipe.name.length).toBeGreaterThan(2)
      expect(recipe.summary.length).toBeGreaterThan(10)
      expect(recipe.blocks.length).toBeGreaterThan(1)
    }
  })

  it('has unique ids', () => {
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(recipes.length)
  })

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))('%s builds a clean graph', (_id, recipe) => {
    resetIds()
    const result = instantiate(recipe, empty, registry)

    // Not one link the builder would have refused.
    expect(result.rejected).toEqual([])
    expect(result.added).toHaveLength(recipe.blocks.length)
    expect(result.graph.connections).toHaveLength(recipe.links.length)

    // Not one integrity error, and something to actually run.
    const report = checkIntegrity(result.graph, registry)
    expect(report.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([])
    expect(report.compilable).toBe(true)

    const program = generateProgram(result.graph, registry)
    expect(program.code).toContain('app.on')
    expect(program.code).not.toContain('undefined')
  })

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))('%s survives the round trip', (_id, recipe) => {
    resetIds()
    const { graph } = instantiate(recipe, empty, registry)
    const first = generateProgram(graph, registry).code
    const parsed = parseProgram(first, registry)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(generateProgram(parsed.graph, registry).code).toBe(first)
  })

  it('drops a second recipe below the first instead of on top of it', () => {
    resetIds()
    const first = instantiate(recipes[0], empty, registry)
    const second = instantiate(recipes[1], first.graph, registry)

    const lowestOfFirst = Math.max(...first.graph.nodes.map((node) => node.position.y))
    const highestOfSecond = Math.min(
      ...second.graph.nodes.filter((node) => second.added.includes(node.id)).map((node) => node.position.y),
    )
    expect(highestOfSecond).toBeGreaterThan(lowestOfFirst)
    expect(second.rejected).toEqual([])
  })

  it('keeps the values the recipe specifies', () => {
    resetIds()
    const { graph } = instantiate(recipeById('signin-form')!, empty, registry)
    const button = graph.nodes.find((node) => node.type === 'ui.button')
    expect(button?.values.text).toBe('Sign in')
    expect(button?.values.id).toBe('signin')
  })

  it('places a recipe where it is asked to', () => {
    resetIds()
    const { graph } = instantiate(recipes[0], empty, registry, { x: 500, y: 250 })
    expect(graph.nodes[0].position).toEqual({ x: 500, y: 250 })
  })
})

describe('generated apps wear Graphene', () => {
  it('takes every colour from tokens.json rather than repeating it', async () => {
    const { previewHtml } = await import('./previewRuntime')
    const { UI_THEME } = await import('./uiTokens')
    const tokens = (await import('../theme/tokens.json')).default

    const html = previewHtml({ document: { components: [] }, code: '' })
    expect(html).toContain(`--app-accent: ${tokens.accent.base}`)
    expect(html).toContain(`--app-surface: ${tokens.ramp.base}`)
    expect(UI_THEME.accent).toBe(tokens.accent.base)

    // Components are written in terms of the variables, so a generated app
    // can be re-themed by overriding :root and nothing else.
    expect(html).toContain('background: var(--app-accent)')
    const styles = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
    const literals = styles.match(/#[0-9a-fA-F]{6}/g) ?? []
    expect(literals.every((hex) => JSON.stringify(tokens).includes(hex))).toBe(true)
  })

  it('carries the same palette into the mobile target', async () => {
    const { compile } = await import('./compile')
    const tokens = (await import('../theme/tokens.json')).default
    resetIds()
    const { graph } = instantiate(recipeById('signin-form')!, empty, registry)
    const built = compile({ graph, registry, schema: { tables: [] }, target: 'mobile' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const dart = built.files.find((file) => file.path.endsWith('main.dart'))!.contents
    expect(dart).toContain(`Color(0xFF${tokens.accent.base.replace('#', '').toUpperCase()})`)
    expect(dart).toContain('class AppTheme')
  })
})
