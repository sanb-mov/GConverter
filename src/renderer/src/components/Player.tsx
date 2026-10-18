/**
 * Built-in preview player (spec §17).
 *
 * Uses the Chromium media stack directly through a file:// URL, so no
 * external player is required. Formats Chromium cannot decode natively
 * (MKV with HEVC, ProRes, …) fall back to a clear message rather than a
 * silent black rectangle.
 */

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Music, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { MediaFile } from '@shared/models'
import { api } from '../store/useStore'
import { useT } from '../lib/i18n'
import { formatDuration } from '../lib/format'

export function Player({ file }: { file: MediaFile }): React.JSX.Element {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState<string>('')
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(file.duration)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    setPlaying(false)
    setCurrent(0)
    void api().shell.fileUrl(file.path).then(setUrl)
  }, [file.path])

  const toggle = (): void => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setError(t('player.playbackFailed')))
    else el.pause()
  }

  const seek = (value: number): void => {
    const el = videoRef.current
    if (!el) return
    el.currentTime = value
    setCurrent(value)
  }

  // A still picture needs no transport controls, just the image itself.
  if (file.isImage) {
    return (
      <div className="image-preview">
        {error ? (
          <div className="text-sm text-muted">{error}</div>
        ) : (
          url && (
            <img
              src={url}
              alt={file.name}
              onError={() =>
                setError(
                  t('player.cannotDecode', {
                    codec: file.primaryVideo?.codec.toUpperCase() ?? file.extension.toUpperCase(),
                    container: file.extension.toUpperCase()
                  })
                )
              }
            />
          )
        )}
      </div>
    )
  }

  return (
    <div className="player">
      {error ? (
        <div
          className="player-audio-art"
          style={{ flexDirection: 'column', gap: 8, color: 'var(--text-muted)' }}
        >
          <Music size={26} />
          <div className="text-sm" style={{ textAlign: 'center', maxWidth: 300 }}>
            {error}
          </div>
        </div>
      ) : (
        <>
          {!file.hasVideo && (
            <div className="player-audio-art">
              <Music size={44} />
            </div>
          )}
          <video
            ref={videoRef}
            src={url}
            style={file.hasVideo ? undefined : { display: 'none' }}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration)
            }}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() =>
              setError(
                t('player.cannotDecode', {
                  codec: file.primaryVideo?.codec.toUpperCase() ?? file.extension.toUpperCase(),
                  container: file.extension.toUpperCase()
                })
              )
            }
            onClick={toggle}
          />
        </>
      )}

      <div className="player-controls">
        <button className="btn-icon" onClick={toggle} disabled={!!error} aria-label="Play/Pause">
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>

        <span className="player-time">{formatDuration(current)}</span>

        <input
          type="range"
          className="range player-seek"
          min={0}
          max={duration || 1}
          step={0.1}
          value={current}
          disabled={!!error}
          onChange={(e) => seek(Number(e.target.value))}
        />

        <span className="player-time">{formatDuration(duration)}</span>

        <button
          className="btn-icon"
          onClick={() => {
            const el = videoRef.current
            if (!el) return
            el.muted = !el.muted
            setMuted(el.muted)
          }}
          aria-label="Mute"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        <input
          type="range"
          className="range"
          style={{ width: 66 }}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const value = Number(e.target.value)
            setVolume(value)
            if (videoRef.current) videoRef.current.volume = value
          }}
        />

        {file.hasVideo && (
          <button
            className="btn-icon"
            onClick={() => void videoRef.current?.requestFullscreen()}
            disabled={!!error}
            aria-label="Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
