/**
 * The activity bar.
 *
 * The six primary views, plus the account and manage buttons pinned to the
 * bottom. Badges surface counts that would otherwise need the view opened to
 * be seen -- pending changes, discovered test profiles.
 */

import { Blocks, BugPlay, CircleUserRound, FlaskConical, Files, GitBranch, Search, Settings } from 'lucide-react'

export type Activity = 'explorer' | 'search' | 'source' | 'debug' | 'tests' | 'extensions'

const activityItems: Array<{ id: Activity; label: string; icon: typeof Files }> = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'source', label: 'Source Control', icon: GitBranch },
  { id: 'debug', label: 'Run and Debug', icon: BugPlay },
  { id: 'tests', label: 'Testing', icon: FlaskConical },
  { id: 'extensions', label: 'Extensions', icon: Blocks },
]

export type ActivityBarProps = {
  active: Activity
  /** The active item is only highlighted while its view is actually showing. */
  sidebarVisible: boolean
  /** Counts to badge, keyed by activity. Zero and undefined both render nothing. */
  badges?: Partial<Record<Activity, number>>
  onSelect: (id: Activity) => void
  onOpenSettings: () => void
}

export function ActivityBar({ active, sidebarVisible, badges = {}, onSelect, onOpenSettings }: ActivityBarProps) {
  return (
    <aside className="activitybar">
      <div>
        {activityItems.map((item) => {
          const Icon = item.icon
          const badge = badges[item.id]
          return (
            <button
              key={item.id}
              className={item.id === active && sidebarVisible ? 'active' : ''}
              aria-label={item.label}
              aria-pressed={item.id === active && sidebarVisible}
              title={item.label}
              onClick={() => onSelect(item.id)}
            >
              <Icon size={21} strokeWidth={1.65} />
              {Boolean(badge) && <span className="activity-badge">{badge}</span>}
            </button>
          )
        })}
      </div>

      <div>
        <button aria-label="Accounts" title="Accounts"><CircleUserRound size={20} strokeWidth={1.6} /><span className="presence-dot" /></button>
        <button aria-label="Manage" title="Manage" onClick={onOpenSettings}><Settings size={20} strokeWidth={1.6} /></button>
      </div>
    </aside>
  )
}

export default ActivityBar
