/**
 * Live collaboration: presence and review comments over a shared room.
 */

import { CircleUserRound, Mic, Plus, UsersRound, X } from 'lucide-react'
import { Modal } from '../Modal'

export type ReviewComment = { name: string; text: string; path?: string; line?: number }

export type CollaborationDialogProps = {
  displayName: string
  onDisplayNameChange: (value: string) => void
  roomUrl: string
  onRoomUrlChange: (value: string) => void
  active: boolean
  participants: string[]
  comments: ReviewComment[]
  commentInput: string
  onCommentInputChange: (value: string) => void
  onHost: () => void
  onJoin: () => void
  onLeave: () => void
  onSendComment: () => void
  onOpenComment: (comment: ReviewComment) => void
  onAnnounceVoice: () => void
  onClose: () => void
}

export function CollaborationDialog({
  displayName, onDisplayNameChange, roomUrl, onRoomUrlChange, active, participants, comments,
  commentInput, onCommentInputChange, onHost, onJoin, onLeave, onSendComment, onOpenComment,
  onAnnounceVoice, onClose,
}: CollaborationDialogProps) {
  return (
    <Modal label="Live collaboration" className="collaboration-modal" onClose={onClose}>
      <header>
        <span className="modal-icon"><UsersRound size={18} /></span>
        <div>
          <h2>Live collaboration</h2>
          <p>Shared Yjs editing, presence, review comments, and encrypted-room signaling foundations.</p>
        </div>
        <button onClick={onClose} aria-label="Close"><X size={16} /></button>
      </header>

      <div className="collaboration-connect">
        <label>Display name<input value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} /></label>
        <label>Room URL<input value={roomUrl} placeholder="ws://host:port/token" onChange={(event) => onRoomUrlChange(event.target.value)} /></label>
        <button onClick={onHost}>Host</button>
        <button disabled={!roomUrl} onClick={onJoin}>Join</button>
      </div>

      <div className="collaboration-body">
        <section>
          <div className="section-heading"><span>PRESENCE</span><span className="count-pill">{participants.length}</span></div>
          {participants.map((name) => (
            <div className="participant" key={name}><CircleUserRound size={14} /><span>{name}</span><i /></div>
          ))}
          <button className="voice-foundation" disabled={!active} onClick={onAnnounceVoice}>
            <Mic size={13} /> Voice room ready
          </button>
        </section>

        <section>
          <div className="section-heading"><span>REVIEW COMMENTS</span><span className="count-pill">{comments.length}</span></div>
          <div className="comment-list">
            {comments.map((comment, index) => (
              <button key={index} onClick={() => onOpenComment(comment)}>
                <strong>{comment.name}</strong>
                <span>{comment.text}</span>
                <small>{comment.path}{comment.line ? `:${comment.line}` : ''}</small>
              </button>
            ))}
          </div>
          <div className="comment-input">
            <input
              value={commentInput}
              placeholder="Comment on the current line"
              onChange={(event) => onCommentInputChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onSendComment() }}
            />
            <button disabled={!active} onClick={onSendComment}><Plus size={12} /></button>
          </div>
        </section>
      </div>

      <footer>
        {active && <button className="secondary" onClick={onLeave}>Leave room</button>}
        <span />
        <button className="primary" onClick={onClose}>Done</button>
      </footer>
    </Modal>
  )
}

export default CollaborationDialog
