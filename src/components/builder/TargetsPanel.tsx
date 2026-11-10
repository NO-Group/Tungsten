import { Hammer, Plus, Server, Trash2 } from 'lucide-react'

import {
  TARGETS,
  describeTargets,
  formatTree,
  isToolchain,
  isValidIdentifier,
  outputRoot,
  toolchainFor,
  toolchainInfo,
  toolchainsFor,
  type Organization,
  type Project,
  type TargetKind,
  type Toolchain,
} from '../../project/targets'

export type TargetsPanelProps = {
  organization: Organization
  projectIndex: number
  project: Project
  /** Blocked by an integrity error: nothing can be built right now. */
  blocked?: boolean
  onOpenProject: (index: number) => void
  onAddProject: () => void
  onRemoveProject: (index: number) => void
  onRenameOrganization: (name: string) => void
  onChangeProject: (index: number, change: Partial<Project>) => void
  onToggleTarget: (kind: TargetKind) => void
  onChangeToolchain: (kind: TargetKind, toolchain: Toolchain) => void
  /** `server` is the backend every target calls; the rest are platforms. */
  onBuild: (kind: TargetKind | 'server') => void
}

/**
 * Organization → Project → Targets, as a panel.
 *
 * The tree on the left is not decoration. The single most useful thing to
 * know about this builder is that one canvas becomes six applications, and
 * a sentence claiming that is less convincing than the shape of it.
 *
 * Every field here feeds a real file: the organization name becomes the
 * first half of the application identifier, the identifier becomes the
 * Android `applicationId` and the iOS `PRODUCT_BUNDLE_IDENTIFIER`, and the
 * version becomes `versionName`, `MARKETING_VERSION` and the npm version
 * of the desktop builds. Nothing here is metadata for its own sake.
 */
export function TargetsPanel({
  organization,
  projectIndex,
  project,
  blocked,
  onOpenProject,
  onAddProject,
  onRemoveProject,
  onRenameOrganization,
  onChangeProject,
  onToggleTarget,
  onChangeToolchain,
  onBuild,
}: TargetsPanelProps) {
  const identifierValid = isValidIdentifier(project.identifier)

  return (
    <div className="targets-panel">
      <div className="targets-tree">
        <pre aria-label="Project tree">{formatTree(organization)}</pre>
      </div>

      <div className="targets-detail">
        <div className="targets-row">
          <label>
            <span>Organization</span>
            <input
              key={organization.name}
              aria-label="Organization name"
              defaultValue={organization.name}
              onBlur={(event) => onRenameOrganization(event.target.value)}
            />
          </label>

          <label>
            <span>Project</span>
            <select
              aria-label="Active project"
              value={projectIndex}
              onChange={(event) => onOpenProject(Number(event.target.value))}
            >
              {organization.projects.map((entry, index) => (
                <option key={entry.identifier + index} value={index}>{entry.name}</option>
              ))}
            </select>
          </label>

          <button aria-label="Add a project" title="Add a project" onClick={() => onAddProject()}>
            <Plus size={13} />
          </button>
          <button
            aria-label="Delete this project"
            title={organization.projects.length > 1
              ? 'Delete this project'
              : 'The last project cannot be deleted'}
            onClick={() => onRemoveProject(projectIndex)}
            disabled={organization.projects.length <= 1}
          >
            <Trash2 size={13} />
          </button>
        </div>

        <div className="targets-row">
          <label>
            <span>Name</span>
            <input
              key={`${projectIndex}-${project.name}`}
              aria-label="Project name"
              defaultValue={project.name}
              onBlur={(event) => onChangeProject(projectIndex, { name: event.target.value })}
            />
          </label>

          <label>
            <span>Identifier</span>
            <input
              key={`${projectIndex}-${project.identifier}`}
              aria-label="Application identifier"
              className={identifierValid ? undefined : 'invalid'}
              defaultValue={project.identifier}
              onBlur={(event) => onChangeProject(projectIndex, { identifier: event.target.value.trim() })}
            />
          </label>

          <label>
            <span>Version</span>
            <input
              key={`${projectIndex}-${project.version}`}
              aria-label="Version"
              defaultValue={project.version}
              onBlur={(event) => onChangeProject(projectIndex, { version: event.target.value.trim() })}
            />
          </label>
        </div>

        {!identifierValid && (
          <p className="targets-warning" role="alert">
            Android and iOS will refuse “{project.identifier}”. An application
            identifier is reverse-DNS: lowercase letters and digits, at least
            one dot, no hyphens — com.example.myapp.
          </p>
        )}

        <ul className="targets-list">
          {TARGETS.map((target) => {
            const enabled = project.targets.includes(target.kind)
            const choices = toolchainsFor(target.kind)
            const chosen = toolchainFor(project, target.kind)
            const built = toolchainInfo(chosen)
            return (
              <li key={target.kind} className={enabled ? 'enabled' : undefined}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={target.label}
                    checked={enabled}
                    onChange={() => onToggleTarget(target.kind)}
                  />
                  <span className="targets-label">{target.label}</span>
                </label>
                {choices.length > 1 ? (
                  <select
                    className="targets-toolchain"
                    aria-label={`Toolchain for the ${target.label}`}
                    value={chosen}
                    onChange={(event) => {
                      const next = event.target.value
                      if (isToolchain(next)) onChangeToolchain(target.kind, next)
                    }}
                  >
                    {choices.map((choice) => (
                      <option key={choice} value={choice}>{toolchainInfo(choice).label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="targets-meta">{built.label}</span>
                )}
                <span className="targets-meta">{built.language} · {built.framework}</span>
                <code>{outputRoot(project, target.kind)}</code>
                <button
                  aria-label={`Build the ${target.label}`}
                  title={blocked
                    ? 'Fix the integrity errors first'
                    : `${target.artifact}. Needs ${built.requires}.`}
                  onClick={() => onBuild(target.kind)}
                  disabled={blocked || !enabled}
                >
                  <Hammer size={12} /> Build
                </button>
              </li>
            )
          })}

          {/* Not a platform, and not optional either: every target's
              runtime calls this, so it sits with them rather than in a
              menu somewhere. */}
          <li className="enabled">
            <span className="targets-label targets-backend">
              <Server size={12} /> Backend Service
            </span>
            <span className="targets-meta">Node</span>
            <span className="targets-meta">JavaScript · SQLite</span>
            <code>{`${outputRoot(project, 'web').replace(/\/web$/, '')}/server`}</code>
            <button
              aria-label="Build the Backend Service"
              title={blocked
                ? 'Fix the integrity errors first'
                : 'Accounts, the tables you drew, and file storage. Run it with node main.js.'}
              onClick={() => onBuild('server')}
              disabled={blocked}
            >
              <Hammer size={12} /> Build
            </button>
          </li>
        </ul>

        <p className="targets-summary">
          {project.name} ships to {describeTargets(project)}. One canvas, one
          program, one source tree each — and one backend they all call.
        </p>
      </div>
    </div>
  )
}

export default TargetsPanel
