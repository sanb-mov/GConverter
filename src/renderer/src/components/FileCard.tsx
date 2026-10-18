import { AlertCircle, Film, FolderOpen, ImageIcon, Music, Search, Trash2 } from 'lucide-react'
import type { MediaFile } from '@shared/models'
import {
  formatBytes,
  formatDuration,
  formatFps,
  formatResolution,
  resolutionName
} from '../lib/format'
import { api } from '../store/useStore'
import { Badge } from './ui'

/** A media file as a card (spec §8). */
export function FileCard({
  file,
  selected,
  onSelect,
  onRemove,
  onInspect
}: {
  file: MediaFile
  selected?: boolean
  onSelect?: () => void
  onRemove?: () => void
  onInspect?: () => void
}): React.JSX.Element {
  const video = file.primaryVideo
  const audio = file.primaryAudio
  const kind = file.error ? 'error' : file.isImage ? 'image' : file.hasVideo ? 'video' : 'audio'

  return (
    <div
      className={`file-card${selected ? ' selected' : ''}${file.error ? ' invalid' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect?.()
      }}
    >
      <div className={`file-thumb ${kind}`}>
        {file.error ? (
          <AlertCircle size={21} />
        ) : kind === 'image' ? (
          <ImageIcon size={21} />
        ) : kind === 'video' ? (
          <Film size={21} />
        ) : (
          <Music size={21} />
        )}
      </div>

      <div className="file-info">
        <div className="file-name" title={file.path}>
          {file.name}
        </div>

        {file.error ? (
          <div className="file-meta" style={{ color: 'var(--danger)' }}>
            <span>{file.error}</span>
          </div>
        ) : (
          <div className="file-meta">
            {video && (
              <span>
                {formatResolution(video.width, video.height)}
                {resolutionName(video.width, video.height) && (
                  <span className="text-faint"> ({resolutionName(video.width, video.height)})</span>
                )}
              </span>
            )}
            {video && <span>{video.codec.toUpperCase()}</span>}
            {video?.fps && !file.isImage && <span>{formatFps(video.fps)}</span>}
            {audio && <span>{audio.codec.toUpperCase()}</span>}
            {!video && audio?.sampleRate && <span>{(audio.sampleRate / 1000).toFixed(1)} kHz</span>}
            {!file.isImage && <span>{formatDuration(file.duration)}</span>}
            <span>{formatBytes(file.size)}</span>
          </div>
        )}
      </div>

      <div className="row gap-6" style={{ flexShrink: 0 }}>
        {video?.isHDR && <Badge tone="accent">{video.hdrFormat ?? 'HDR'}</Badge>}
        {file.hasSubtitles && <Badge tone="neutral">SUB</Badge>}
        {file.chapters.length > 0 && <Badge tone="neutral">{file.chapters.length} CH</Badge>}
      </div>

      <div className="file-actions">
        {onInspect && (
          <button
            className="btn-icon"
            title="Inspect"
            onClick={(e) => {
              e.stopPropagation()
              onInspect()
            }}
          >
            <Search size={15} />
          </button>
        )}
        <button
          className="btn-icon"
          title="Show in folder"
          onClick={(e) => {
            e.stopPropagation()
            void api().shell.revealPath(file.path)
          }}
        >
          <FolderOpen size={15} />
        </button>
        {onRemove && (
          <button
            className="btn-icon"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
