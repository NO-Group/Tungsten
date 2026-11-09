/**
 * Organization → Project → Targets.
 *
 * One graph on the canvas is one *project*. A project is not a platform:
 * it is a program that several platforms can be asked to carry. So the
 * thing a user ships is a list of **targets**, each of which turns the
 * same intermediate representation into a source tree a platform's own
 * toolchain understands.
 *
 *     [ Organization ]
 *             └── [ Project ]
 *                     ├── Android App Target
 *                     ├── iOS App Target
 *                     ├── Cross-Platform Mobile Target
 *                     ├── Windows Desktop Target
 *                     ├── macOS Desktop Target
 *                     └── Linux Desktop Target
 *
 * The organization sits above the project for one practical reason: every
 * mobile and desktop platform identifies an application by a reverse-DNS
 * string, and the only honest source for the first half of that string is
 * who you are. Deriving `com.acme.timer` from an organization named Acme
 * and a project named Timer means nobody has to remember the convention,
 * and the same identifier reaches the Android manifest, the iOS plist and
 * the desktop installer without being typed three times.
 *
 * Everything here is pure data and pure functions. Code generation lives
 * in `src/builder/targets/`, and the store that holds the user's actual
 * organization lives in `useBuilder`.
 */

export type TargetKind =
  | 'android'
  | 'ios'
  | 'mobile'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'web'

/** Platforms that share a toolchain, a renderer and a set of problems. */
export type TargetGroup = 'mobile' | 'desktop' | 'web'

export type TargetInfo = {
  kind: TargetKind
  /** The name in the tree, exactly as it is shown to the user. */
  label: string
  group: TargetGroup
  language: string
  framework: string
  /** Where this target's source tree is written, under `targets/`. */
  directory: string
  /** What you get at the end. */
  artifact: string
  /** What has to be installed to turn the source into that artifact. */
  toolchain: string
}

/**
 * Every target, in the order they appear in the tree.
 *
 * Web is last and is not in the default set: a project gets it by asking,
 * because Tungsten already runs on the web and an app that is only a web
 * app does not need a target to say so.
 */
export const TARGETS: readonly TargetInfo[] = [
  {
    kind: 'android',
    label: 'Android App Target',
    group: 'mobile',
    language: 'Kotlin',
    framework: 'Jetpack Compose',
    directory: 'android',
    artifact: 'an APK or an Android App Bundle',
    toolchain: 'Android Studio or the Android SDK with Gradle',
  },
  {
    kind: 'ios',
    label: 'iOS App Target',
    group: 'mobile',
    language: 'Swift',
    framework: 'SwiftUI',
    directory: 'ios',
    artifact: 'an .ipa, or a run on the simulator',
    toolchain: 'Xcode on macOS, plus XcodeGen for the project file',
  },
  {
    kind: 'mobile',
    label: 'Cross-Platform Mobile Target',
    group: 'mobile',
    language: 'Dart',
    framework: 'Flutter',
    directory: 'mobile',
    artifact: 'one source tree that builds for both phones',
    toolchain: 'the Flutter SDK',
  },
  {
    kind: 'windows',
    label: 'Windows Desktop Target',
    group: 'desktop',
    language: 'TypeScript',
    framework: 'Electron',
    directory: 'windows',
    artifact: 'an NSIS installer and a portable .exe',
    toolchain: 'Node and electron-builder; signing is optional',
  },
  {
    kind: 'macos',
    label: 'macOS Desktop Target',
    group: 'desktop',
    language: 'TypeScript',
    framework: 'Electron',
    directory: 'macos',
    artifact: 'a .dmg and a .zip, universal binary',
    toolchain: 'Node and electron-builder, on macOS for notarisation',
  },
  {
    kind: 'linux',
    label: 'Linux Desktop Target',
    group: 'desktop',
    language: 'TypeScript',
    framework: 'Electron',
    directory: 'linux',
    artifact: 'an AppImage and a .deb',
    toolchain: 'Node and electron-builder',
  },
  {
    kind: 'web',
    label: 'Web Target',
    group: 'web',
    language: 'TypeScript',
    framework: 'none — it is the DOM',
    directory: 'web',
    artifact: 'a folder of static files',
    toolchain: 'nothing; any static host will do',
  },
]

/** The six in the tree. Web is opt-in. */
export const DEFAULT_TARGETS: readonly TargetKind[] = [
  'android', 'ios', 'mobile', 'windows', 'macos', 'linux',
]

const BY_KIND = new Map(TARGETS.map((target) => [target.kind, target]))

export function targetInfo(kind: TargetKind): TargetInfo {
  const info = BY_KIND.get(kind)
  if (!info) throw new Error(`Unknown target: ${kind}`)
  return info
}

export function isTargetKind(value: string): value is TargetKind {
  return BY_KIND.has(value as TargetKind)
}

export function groupOf(kind: TargetKind): TargetGroup {
  return targetInfo(kind).group
}

/** Targets in tree order, whatever order they were added in. */
export function orderTargets(kinds: readonly TargetKind[]): TargetKind[] {
  const wanted = new Set(kinds)
  return TARGETS.filter((target) => wanted.has(target.kind)).map((target) => target.kind)
}

// ------------------------------------------------------------- identity

export type Project = {
  name: string
  /** Reverse-DNS, e.g. `com.acme.timer`. The one id every platform wants. */
  identifier: string
  version: string
  targets: readonly TargetKind[]
}

export type Organization = {
  name: string
  /** Reverse-DNS prefix, e.g. `com.acme`. */
  domain: string
  projects: readonly Project[]
}

/**
 * A name turned into something a filesystem, a package manager and a
 * Gradle module can all accept.
 *
 * Deliberately lossy: `My App!` and `my-app` are the same slug, which is
 * what makes the uniqueness checks below mean anything.
 */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/**
 * The same, but legal as an identifier segment.
 *
 * Reverse-DNS segments cannot start with a digit and cannot contain
 * hyphens, and a Java package segment that is a reserved word will not
 * compile. `2048` becomes `app2048`, not a build failure three tools
 * later.
 */
const RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'is',
  'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
  'val', 'var', 'void', 'volatile', 'while',
])

export function identifierSegment(name: string): string {
  const base = slug(name).replace(/-/g, '')
  if (!base) return 'app'
  const safe = /^[0-9]/.test(base) ? `app${base}` : base
  return RESERVED.has(safe) ? `${safe}app` : safe
}

export function isValidIdentifier(identifier: string): boolean {
  if (identifier.length > 155) return false
  const segments = identifier.split('.')
  if (segments.length < 2) return false
  return segments.every((segment) => /^[a-z][a-z0-9]*$/.test(segment) && !RESERVED.has(segment))
}

/** `com.acme` from an organization called Acme. */
export function domainFor(organizationName: string): string {
  return `com.${identifierSegment(organizationName)}`
}

export function identifierFor(organization: Organization, projectName: string): string {
  return `${organization.domain}.${identifierSegment(projectName)}`
}

/**
 * The application id a given platform wants.
 *
 * They are almost the same everywhere, which is the point of deriving them
 * from one place -- but not quite: a Linux package name is the slug, not
 * the reverse-DNS string, and `com.acme.timer` as a .deb name is wrong.
 */
export function appIdFor(project: Project, kind: TargetKind): string {
  if (kind === 'linux') return slug(project.name) || 'app'
  if (kind === 'web') return slug(project.name) || 'app'
  return project.identifier
}

// ------------------------------------------------------------ mutations

export function createOrganization(name: string): Organization {
  return { name: name.trim() || 'My Organization', domain: domainFor(name), projects: [] }
}

export function createProject(
  organization: Organization,
  name: string,
  targets: readonly TargetKind[] = DEFAULT_TARGETS,
): Project {
  const clean = name.trim() || 'My Project'
  return {
    name: clean,
    identifier: identifierFor(organization, clean),
    version: '1.0.0',
    targets: orderTargets(targets),
  }
}

/** A name no sibling project already uses, after slugging. */
export function uniqueProjectName(organization: Organization, name: string): string {
  const taken = new Set(organization.projects.map((project) => slug(project.name)))
  const base = name.trim() || 'My Project'
  if (!taken.has(slug(base))) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(slug(candidate))) return candidate
  }
  return `${base} ${Date.now()}`
}

export function addProject(
  organization: Organization,
  name: string,
  targets?: readonly TargetKind[],
): Organization {
  const project = createProject(organization, uniqueProjectName(organization, name), targets)
  return { ...organization, projects: [...organization.projects, project] }
}

export function removeProject(organization: Organization, index: number): Organization {
  if (index < 0 || index >= organization.projects.length) return organization
  return { ...organization, projects: organization.projects.filter((_, at) => at !== index) }
}

export function updateProject(
  organization: Organization,
  index: number,
  change: Partial<Project>,
): Organization {
  const project = organization.projects[index]
  if (!project) return organization
  const next: Project = { ...project, ...change }
  // Renaming a project re-derives its identifier, unless the identifier was
  // the thing being changed: a user who typed an identifier by hand meant
  // it, and having a later rename silently overwrite it is the kind of bug
  // that is only noticed in a store listing.
  if (change.name !== undefined && change.identifier === undefined) {
    if (project.identifier === identifierFor(organization, project.name)) {
      next.identifier = identifierFor(organization, next.name)
    }
  }
  if (change.targets) next.targets = orderTargets(change.targets)
  return {
    ...organization,
    projects: organization.projects.map((entry, at) => (at === index ? next : entry)),
  }
}

export function renameOrganization(organization: Organization, name: string): Organization {
  const clean = name.trim() || organization.name
  const domain = domainFor(clean)
  const next = { ...organization, name: clean, domain }
  // Every identifier that was derived from the old domain follows the new
  // one; every identifier someone typed themselves is left alone.
  return {
    ...next,
    projects: organization.projects.map((project) => (
      project.identifier.startsWith(`${organization.domain}.`)
        ? { ...project, identifier: `${domain}.${project.identifier.slice(organization.domain.length + 1)}` }
        : project
    )),
  }
}

export function toggleTarget(project: Project, kind: TargetKind): Project {
  const has = project.targets.includes(kind)
  return {
    ...project,
    targets: orderTargets(has
      ? project.targets.filter((entry) => entry !== kind)
      : [...project.targets, kind]),
  }
}

// ----------------------------------------------------------------- tree

/** Where a target's generated source tree goes in the workspace. */
export function outputRoot(project: Project, kind: TargetKind): string {
  return `targets/${slug(project.name) || 'app'}/${targetInfo(kind).directory}`
}

/**
 * The hierarchy, drawn.
 *
 * Not decoration: this is what a build writes into the generated README
 * and what the Targets panel shows, so a user can see at a glance that
 * six platforms are coming from one canvas.
 */
export function formatTree(organization: Organization): string {
  const lines = [`[ ${organization.name} ]`]
  organization.projects.forEach((project, index) => {
    const lastProject = index === organization.projects.length - 1
    lines.push(`${lastProject ? '└──' : '├──'} [ ${project.name} ]`)
    const indent = lastProject ? '    ' : '│   '
    const targets = orderTargets(project.targets)
    if (!targets.length) lines.push(`${indent}└── (no targets yet)`)
    targets.forEach((kind, at) => {
      const lastTarget = at === targets.length - 1
      lines.push(`${indent}${lastTarget ? '└──' : '├──'} ${targetInfo(kind).label}`)
    })
  })
  if (!organization.projects.length) lines.push('└── (no projects yet)')
  return lines.join('\n')
}

/** A one-line summary for the status area and the build notification. */
export function describeTargets(project: Project): string {
  const targets = orderTargets(project.targets)
  if (!targets.length) return 'no targets'
  const groups = new Map<TargetGroup, number>()
  targets.forEach((kind) => {
    const group = groupOf(kind)
    groups.set(group, (groups.get(group) ?? 0) + 1)
  })
  const parts = [...groups.entries()].map(([group, count]) => `${count} ${group}`)
  return `${targets.length} target${targets.length === 1 ? '' : 's'} (${parts.join(', ')})`
}

// ------------------------------------------------------- persistence

/**
 * The organization as read back from storage.
 *
 * A saved file outlives its format, and this one is edited by hand often
 * enough -- it holds the app identifier -- that it will eventually be
 * wrong. Every field is checked and anything unusable is replaced, so a
 * bad entry costs a default rather than a canvas that will not open.
 */
export function readOrganization(raw: unknown): Organization {
  const fallback = defaultOrganization()
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<Organization>

  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : fallback.name
  const domain = typeof value.domain === 'string' && isValidIdentifier(`${value.domain}.app`)
    ? value.domain
    : domainFor(name)

  const projects = Array.isArray(value.projects)
    ? value.projects.flatMap((entry): Project[] => {
      if (!entry || typeof entry !== 'object') return []
      const project = entry as Partial<Project>
      const projectName = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : 'My Project'
      const identifier = typeof project.identifier === 'string' && isValidIdentifier(project.identifier)
        ? project.identifier
        : `${domain}.${identifierSegment(projectName)}`
      const targets = Array.isArray(project.targets)
        ? orderTargets(project.targets.filter((kind): kind is TargetKind => (
          typeof kind === 'string' && isTargetKind(kind)
        )))
        : [...DEFAULT_TARGETS]
      return [{
        name: projectName,
        identifier,
        version: typeof project.version === 'string' && /^\d+(\.\d+)*$/.test(project.version)
          ? project.version
          : '1.0.0',
        targets,
      }]
    })
    : []

  return { name, domain, projects: projects.length ? projects : fallback.projects }
}

/** What a workspace that has never thought about shipping starts with. */
export function defaultOrganization(): Organization {
  return addProject(createOrganization('My Organization'), 'My App')
}
