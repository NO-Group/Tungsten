import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-600.css'

import { createSplash } from './boot/splash'

/**
 * Start-up, with the boot screen reporting real milestones.
 *
 * The workbench is imported dynamically rather than statically so those
 * milestones mean something: by the time `import('./App')` resolves, the
 * editor, the language grammars, the shell dictionary and the block library
 * genuinely are in memory, and the screen can say so honestly instead of
 * animating a bar against a timer.
 */
const splash = createSplash()

async function start() {
  const [{ default: App }, { supportedLanguages }, { shellDictionary }, { builtinBlocks }] = await Promise.all([
    import('./App'),
    import('./workspace'),
    import('./shell/commandDictionary'),
    import('./builder/blockLibrary'),
  ])

  splash.step('workbench')
  splash.step('grammars', `${supportedLanguages.length}`)
  splash.step('shell', `${shellDictionary.entries.length}`)
  splash.step('blocks', `${builtinBlocks.length}`)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App onReady={(files) => { splash.step('workspace', `${files} files`); splash.finish() }} />
    </StrictMode>,
  )
}

void start().catch((error: Error) => {
  // A failure here means no workbench at all, so the boot screen is the only
  // place left to say so.
  const boot = document.getElementById('boot')
  if (boot) boot.querySelector('.tagline')!.textContent = `Failed to start: ${error.message}`
  else throw error
})
