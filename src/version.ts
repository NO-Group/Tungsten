/**
 * The product version, injected at build time from package.json.
 *
 * Declared with a fallback because the constant only exists once Vite has
 * replaced it -- anything loading this module outside a Vite build (a bare
 * node script, for instance) still gets a sensible string.
 */

declare const __APP_VERSION__: string | undefined

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
