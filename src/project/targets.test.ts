import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TARGETS,
  TARGETS,
  addProject,
  appIdFor,
  createOrganization,
  createProject,
  describeTargets,
  domainFor,
  formatTree,
  groupOf,
  identifierFor,
  identifierSegment,
  isTargetKind,
  isValidIdentifier,
  orderTargets,
  readOrganization,
  outputRoot,
  removeProject,
  renameOrganization,
  slug,
  targetInfo,
  toggleTarget,
  updateProject,
  uniqueProjectName,
  type Organization,
} from './targets'

const acme = (): Organization => addProject(createOrganization('Acme'), 'Timer')

describe('the target catalogue', () => {
  it('has the six the tree names, plus web', () => {
    expect(TARGETS.map((target) => target.kind)).toEqual([
      'android', 'ios', 'mobile', 'windows', 'macos', 'linux', 'web',
    ])
  })

  it('defaults to the six, leaving web opt-in', () => {
    expect(DEFAULT_TARGETS).toEqual(['android', 'ios', 'mobile', 'windows', 'macos', 'linux'])
    expect(DEFAULT_TARGETS).not.toContain('web')
  })

  it('labels them the way the tree does', () => {
    expect(targetInfo('android').label).toBe('Android App Target')
    expect(targetInfo('mobile').label).toBe('Cross-Platform Mobile Target')
    expect(targetInfo('macos').label).toBe('macOS Desktop Target')
  })

  it('groups them by the toolchain they share', () => {
    expect(groupOf('android')).toBe('mobile')
    expect(groupOf('ios')).toBe('mobile')
    expect(groupOf('mobile')).toBe('mobile')
    expect(groupOf('windows')).toBe('desktop')
    expect(groupOf('macos')).toBe('desktop')
    expect(groupOf('linux')).toBe('desktop')
    expect(groupOf('web')).toBe('web')
  })

  it('says what each one needs and produces', () => {
    for (const target of TARGETS) {
      expect(target.artifact.length).toBeGreaterThan(5)
      expect(target.toolchain.length).toBeGreaterThan(5)
      expect(target.directory).toMatch(/^[a-z]+$/)
    }
  })

  it('recognises its own kinds and nothing else', () => {
    expect(isTargetKind('ios')).toBe(true)
    expect(isTargetKind('blackberry')).toBe(false)
  })

  it('refuses to describe a target it does not have', () => {
    // @ts-expect-error -- the guard exists for data read back from disk.
    expect(() => targetInfo('symbian')).toThrow(/Unknown target/)
  })

  it('always orders targets the way the tree does', () => {
    expect(orderTargets(['linux', 'android', 'web', 'ios'])).toEqual(['android', 'ios', 'linux', 'web'])
  })

  it('drops duplicates while ordering', () => {
    expect(orderTargets(['ios', 'ios', 'ios'])).toEqual(['ios'])
  })
})

describe('slug', () => {
  it('makes a name safe for a filesystem', () => {
    expect(slug('My App!')).toBe('my-app')
    expect(slug('  Spaced   Out  ')).toBe('spaced-out')
  })

  it('folds accents rather than dropping the word', () => {
    expect(slug('Café')).toBe('cafe')
  })

  it('never starts or ends with a hyphen', () => {
    expect(slug('--weird--')).toBe('weird')
  })
})

describe('identifierSegment', () => {
  it('removes what a package segment cannot contain', () => {
    expect(identifierSegment('My App')).toBe('myapp')
  })

  it('rescues a name that starts with a digit', () => {
    expect(identifierSegment('2048')).toBe('app2048')
  })

  it('rescues a reserved word', () => {
    expect(identifierSegment('class')).toBe('classapp')
    expect(identifierSegment('package')).toBe('packageapp')
  })

  it('always returns something', () => {
    expect(identifierSegment('!!!')).toBe('app')
  })
})

describe('isValidIdentifier', () => {
  it('accepts reverse-DNS', () => {
    expect(isValidIdentifier('com.acme.timer')).toBe(true)
    expect(isValidIdentifier('io.github.someone.app')).toBe(true)
  })

  it('rejects what a platform would reject', () => {
    expect(isValidIdentifier('timer')).toBe(false)
    expect(isValidIdentifier('com.acme.my-app')).toBe(false)
    expect(isValidIdentifier('com.acme.2048')).toBe(false)
    expect(isValidIdentifier('com.acme.class')).toBe(false)
    expect(isValidIdentifier('Com.Acme.Timer')).toBe(false)
  })
})

describe('identity', () => {
  it('derives the organization domain', () => {
    expect(domainFor('Acme')).toBe('com.acme')
    expect(domainFor('Acme Industries')).toBe('com.acmeindustries')
  })

  it('derives the project identifier from both halves', () => {
    const organization = createOrganization('Acme')
    expect(identifierFor(organization, 'Timer')).toBe('com.acme.timer')
  })

  it('gives every platform the identifier it actually wants', () => {
    const project = acme().projects[0]
    expect(appIdFor(project, 'android')).toBe('com.acme.timer')
    expect(appIdFor(project, 'ios')).toBe('com.acme.timer')
    expect(appIdFor(project, 'macos')).toBe('com.acme.timer')
    // A .deb is not called com.acme.timer.
    expect(appIdFor(project, 'linux')).toBe('timer')
  })
})

describe('organizations and projects', () => {
  it('starts empty, with a name', () => {
    const organization = createOrganization('Acme')
    expect(organization.name).toBe('Acme')
    expect(organization.domain).toBe('com.acme')
    expect(organization.projects).toEqual([])
  })

  it('never has a nameless organization', () => {
    expect(createOrganization('   ').name).toBe('My Organization')
  })

  it('gives a new project the six default targets', () => {
    const project = acme().projects[0]
    expect(project.targets).toEqual(DEFAULT_TARGETS)
    expect(project.version).toBe('1.0.0')
  })

  it('keeps sibling project names apart', () => {
    const organization = addProject(addProject(createOrganization('Acme'), 'Timer'), 'Timer')
    expect(organization.projects.map((project) => project.name)).toEqual(['Timer', 'Timer 2'])
    expect(uniqueProjectName(organization, 'Timer')).toBe('Timer 3')
  })

  it('removes a project by index and ignores a bad one', () => {
    const organization = acme()
    expect(removeProject(organization, 0).projects).toHaveLength(0)
    expect(removeProject(organization, 7)).toBe(organization)
  })

  it('re-derives the identifier when a derived name changes', () => {
    const organization = updateProject(acme(), 0, { name: 'Stopwatch' })
    expect(organization.projects[0].identifier).toBe('com.acme.stopwatch')
  })

  it('never overwrites an identifier someone typed', () => {
    const typed = updateProject(acme(), 0, { identifier: 'dev.acme.chronograph' })
    const renamed = updateProject(typed, 0, { name: 'Stopwatch' })
    expect(renamed.projects[0].identifier).toBe('dev.acme.chronograph')
  })

  it('keeps targets in tree order however they are set', () => {
    const organization = updateProject(acme(), 0, { targets: ['linux', 'android'] })
    expect(organization.projects[0].targets).toEqual(['android', 'linux'])
  })

  it('follows the organization when it is renamed', () => {
    const renamed = renameOrganization(acme(), 'Globex')
    expect(renamed.domain).toBe('com.globex')
    expect(renamed.projects[0].identifier).toBe('com.globex.timer')
  })

  it('leaves a hand-typed identifier alone when the organization is renamed', () => {
    const typed = updateProject(acme(), 0, { identifier: 'dev.other.thing' })
    expect(renameOrganization(typed, 'Globex').projects[0].identifier).toBe('dev.other.thing')
  })

  it('adds and removes one target at a time', () => {
    const project = acme().projects[0]
    const without = toggleTarget(project, 'ios')
    expect(without.targets).not.toContain('ios')
    const back = toggleTarget(without, 'ios')
    expect(back.targets).toEqual(DEFAULT_TARGETS)
  })
})

describe('outputRoot', () => {
  it('gives every target its own tree under the project', () => {
    const project = acme().projects[0]
    expect(outputRoot(project, 'android')).toBe('targets/timer/android')
    expect(outputRoot(project, 'macos')).toBe('targets/timer/macos')
  })

  it('never collides between two targets', () => {
    const project = acme().projects[0]
    const roots = project.targets.map((kind) => outputRoot(project, kind))
    expect(new Set(roots).size).toBe(roots.length)
  })
})

describe('formatTree', () => {
  it('draws the hierarchy', () => {
    expect(formatTree(acme())).toBe([
      '[ Acme ]',
      '└── [ Timer ]',
      '    ├── Android App Target',
      '    ├── iOS App Target',
      '    ├── Cross-Platform Mobile Target',
      '    ├── Windows Desktop Target',
      '    ├── macOS Desktop Target',
      '    └── Linux Desktop Target',
    ].join('\n'))
  })

  it('carries the branch down past a project that is not last', () => {
    const organization = addProject(
      updateProject(acme(), 0, { targets: ['android'] }),
      'Notes',
    )
    const lines = formatTree(updateProject(organization, 1, { targets: ['linux'] })).split('\n')
    expect(lines).toEqual([
      '[ Acme ]',
      '├── [ Timer ]',
      '│   └── Android App Target',
      '└── [ Notes ]',
      '    └── Linux Desktop Target',
    ])
  })

  it('says so when there is nothing yet', () => {
    expect(formatTree(createOrganization('Acme'))).toBe('[ Acme ]\n└── (no projects yet)')
  })

  it('says so when a project ships nowhere', () => {
    const organization = updateProject(acme(), 0, { targets: [] })
    expect(formatTree(organization)).toContain('(no targets yet)')
  })
})

describe('describeTargets', () => {
  it('counts by group', () => {
    expect(describeTargets(acme().projects[0])).toBe('6 targets (3 mobile, 3 desktop)')
  })

  it('reads properly with one', () => {
    const project = createProject(createOrganization('Acme'), 'Timer', ['ios'])
    expect(describeTargets(project)).toBe('1 target (1 mobile)')
  })

  it('is honest about none', () => {
    const project = createProject(createOrganization('Acme'), 'Timer', [])
    expect(describeTargets(project)).toBe('no targets')
  })
})

describe('readOrganization', () => {
  it('reads back what it wrote', () => {
    const organization = acme()
    expect(readOrganization(JSON.parse(JSON.stringify(organization)))).toEqual(organization)
  })

  it('falls back to a usable default for nonsense', () => {
    expect(readOrganization(null).projects).toHaveLength(1)
    expect(readOrganization('nope').name).toBe('My Organization')
    expect(readOrganization({ projects: 'lots' }).projects[0].name).toBe('My App')
  })

  it('replaces an identifier no platform would accept', () => {
    const read = readOrganization({ name: 'Acme', domain: 'com.acme', projects: [{ name: 'Timer', identifier: 'Not An Id' }] })
    expect(read.projects[0].identifier).toBe('com.acme.timer')
  })

  it('keeps a hand-written identifier that is legal', () => {
    const read = readOrganization({ name: 'Acme', projects: [{ name: 'Timer', identifier: 'dev.acme.chronograph' }] })
    expect(read.projects[0].identifier).toBe('dev.acme.chronograph')
  })

  it('drops targets it does not have and orders the rest', () => {
    const read = readOrganization({ name: 'Acme', projects: [{ name: 'Timer', targets: ['linux', 'symbian', 'android'] }] })
    expect(read.projects[0].targets).toEqual(['android', 'linux'])
  })

  it('gives a project with no target list the default six', () => {
    expect(readOrganization({ name: 'Acme', projects: [{ name: 'Timer' }] }).projects[0].targets)
      .toEqual(DEFAULT_TARGETS)
  })

  it('refuses a version string that is not one', () => {
    expect(readOrganization({ projects: [{ name: 'Timer', version: 'latest' }] }).projects[0].version)
      .toBe('1.0.0')
  })

  it('always leaves at least one project to build', () => {
    expect(readOrganization({ name: 'Acme', projects: [] }).projects).toHaveLength(1)
  })
})
