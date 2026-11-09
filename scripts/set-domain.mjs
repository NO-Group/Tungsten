#!/usr/bin/env node
/**
 * Tells the build what address it lives at.
 *
 *   npm run domain -- tungsten.dev
 *   npm run domain                  # show the current one
 *   npm run domain -- --clear       # go back to being address-less
 *
 * One command rather than an instruction to hand-edit JSON, because the
 * value has to be a bare hostname and the most natural thing to paste is a
 * URL. The normalisation lives in `src/web/site.ts` and is tested there.
 */

import { readSite, writeSite, normaliseDomain } from './site-config.mjs'
import { isValidDomain } from '../src/web/site.ts'

const argument = process.argv.slice(2).find((value) => !value.startsWith('--'))
const clear = process.argv.includes('--clear')
const site = readSite()

if (!argument && !clear) {
  console.log(site.domain
    ? `domain: ${site.domain}`
    : [
      'domain: not set.',
      '',
      'The site builds and deploys fine without one -- every path it emits is',
      'relative. Setting it adds the canonical link, the social card, the',
      'sitemap and the CNAME file a static host reads.',
      '',
      '  npm run domain -- yourdomain.com',
    ].join('\n'))
  process.exit(0)
}

if (clear) {
  writeSite({ ...site, domain: '' })
  console.log('domain: cleared. The build will emit relative URLs only.')
  process.exit(0)
}

const domain = normaliseDomain(argument)

if (!isValidDomain(domain)) {
  console.error([
    `domain: "${argument}" is not a hostname this can deploy to.`,
    '',
    'Expected something like `tungsten.dev` or `ide.example.co.uk`:',
    'letters, digits and hyphens, at least one dot, no path.',
  ].join('\n'))
  process.exit(1)
}

writeSite({ ...site, domain })

console.log(`domain: set to ${domain}.`)
console.log(`         https://${domain}/ will be the canonical address.`)
console.log('         Run `npm run web:build` to produce dist/ with the CNAME in it.')
