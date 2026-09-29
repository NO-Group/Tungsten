/**
 * The checker, run the way the worker runs it.
 *
 * What matters here is that nothing is lost crossing the boundary: the
 * worker cannot be handed the registry, so it rebuilds one from the built-in
 * library and the plugin manifests, and that rebuilt registry has to reach
 * the same verdict as the one on the main thread.
 */

import { describe, expect, it } from 'vitest'

import { builtinBlocks } from './blockLibrary'
import { createRegistry } from './blockSchema'
import { checkIntegrity } from './integrity'
import { resetIds } from './graph'
import { instantiate, recipes } from './recipes'
import { EXAMPLE_PLUGIN, loadPluginBlocks } from './pluginBlocks'
import { runIntegrity } from './integrityWorker'

const registry = createRegistry(builtinBlocks)
const empty = { nodes: [], connections: [] }

describe('the integrity worker', () => {
  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))(
    'agrees with the main thread about %s',
    (_id, recipe) => {
      resetIds()
      const { graph } = instantiate(recipe, empty, registry)
      const here = checkIntegrity(graph, registry)
      const there = runIntegrity({ docVersion: 7, graph, manifests: [] })

      expect(there.docVersion).toBe(7)
      expect(there.report.compilable).toBe(here.compilable)
      expect(there.report.diagnostics).toEqual(here.diagnostics)
      expect([...there.report.orphans]).toEqual([...here.orphans])
    },
  )

  it('rebuilds plugin blocks from their manifests, not from functions', () => {
    const plugins = loadPluginBlocks([{ path: 'plugins/notify.block.json', content: EXAMPLE_PLUGIN }])
    const withPlugin = createRegistry([...builtinBlocks, ...plugins.blocks])
    resetIds()
    const { graph } = instantiate(
      {
        id: 'p',
        name: 'p',
        summary: 'p',
        outcome: 'p',
        blocks: [
          { type: 'event.start', at: { x: 0, y: 0 } },
          { type: 'acme.notify', at: { x: 300, y: 0 }, values: { channel: 'ops', message: 'hi' } },
        ],
        links: [[0, 'exec', 1, 'exec']],
      },
      empty,
      withPlugin,
    )

    // Without the manifests the worker would call the block unknown.
    const blind = runIntegrity({ docVersion: 1, graph, manifests: [] })
    expect(blind.report.diagnostics.some((entry) => entry.code === 'unknown-block')).toBe(true)

    const informed = runIntegrity({ docVersion: 1, graph, manifests: plugins.manifests })
    expect(informed.report.diagnostics).toEqual(checkIntegrity(graph, withPlugin).diagnostics)
    expect(informed.report.compilable).toBe(true)
  })

  it('carries the manifests out of the loader alongside the blocks', () => {
    const load = loadPluginBlocks([
      { path: 'plugins/notify.block.json', content: EXAMPLE_PLUGIN },
      { path: 'plugins/broken.block.json', content: '{ not json' },
    ])
    expect(load.manifests).toHaveLength(1)
    expect(load.manifests[0].type).toBe('acme.notify')
    expect(load.problems).toHaveLength(1)
  })
})
