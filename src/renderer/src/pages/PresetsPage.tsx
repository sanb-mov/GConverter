/** Preset library and custom preset builder (spec §10, §45). */

import { useState } from 'react'
import {
  Activity,
  Archive,
  Film,
  Gem,
  Globe,
  Image,
  MessageCircle,
  MessageSquare,
  Mic,
  Monitor,
  Music,
  Pencil,
  Plus,
  Radio,
  Scissors,
  Shield,
  Smartphone,
  Sparkles,
  Trash2,
  AtSign,
  PlaySquare,
  Zap
} from 'lucide-react'
import type { ConversionProfile } from '@shared/models'
import { AUDIO_CODECS, CONTAINERS, VIDEO_CODECS, getCodec } from '@shared/formats'
import { Badge, Field, Modal, Select } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'

const ICONS: Record<string, React.JSX.Element> = {
  shield: <Shield size={16} />,
  gem: <Gem size={16} />,
  zap: <Zap size={16} />,
  youtube: <PlaySquare size={16} />,
  monitor: <Monitor size={16} />,
  instagram: <Image size={16} />,
  smartphone: <Smartphone size={16} />,
  twitter: <AtSign size={16} />,
  'message-circle': <MessageCircle size={16} />,
  'message-square': <MessageSquare size={16} />,
  globe: <Globe size={16} />,
  archive: <Archive size={16} />,
  scissors: <Scissors size={16} />,
  radio: <Radio size={16} />,
  image: <Image size={16} />,
  music: <Music size={16} />,
  mic: <Mic size={16} />,
  activity: <Activity size={16} />
}

export function PresetsPage(): React.JSX.Element {
  const t = useT()
  const profiles = useStore((s) => s.profiles)
  const setProfiles = useStore((s) => s.setProfiles)
  const pushToast = useStore((s) => s.pushToast)
  const selectedFileId = useStore((s) => s.selectedFileId)
  const files = useStore((s) => s.files)
  const setFileSettings = useStore((s) => s.setFileSettings)
  const setPage = useStore((s) => s.setPage)

  const [filter, setFilter] = useState<'all' | 'video' | 'audio' | 'custom'>('all')
  const [editing, setEditing] = useState<ConversionProfile | null>(null)

  const visible = profiles.filter((p) => filter === 'all' || p.category === filter)
  const selected = files.find((f) => f.id === selectedFileId)

  const apply = async (profile: ConversionProfile): Promise<void> => {
    if (!selected) {
      pushToast({
        kind: 'info',
        title: t('presets.noFile'),
        message: t('presets.noFileText')
      })
      return
    }
    const settings = await api().conversion.profileSettings(selected, profile.id)
    setFileSettings(selected.id, settings)
    const effects = await api().profiles.effect(selected, profile.id)
    pushToast({
      kind: 'success',
      title: t('presets.applied', { preset: t(profile.name), file: selected.name }),
      message: effects.length ? effects.join(' · ') : undefined
    })
    setPage('convert')
  }

  const remove = async (profile: ConversionProfile): Promise<void> => {
    const updated = await api().profiles.remove(profile.id)
    setProfiles(updated)
    pushToast({ kind: 'success', title: `Deleted "${profile.name}"` })
  }

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('presets.title')}</div>
          <div className="page-subtitle">
            {t('presets.subtitle')}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() =>
            setEditing({
              id: `custom-${Date.now()}`,
              name: t('presets.myPreset'),
              description: '',
              category: 'custom',
              builtIn: false,
              settings: structuredClone(
                profiles.find((p) => p.id === 'maximum-quality')!.settings
              ),
              createdAt: Date.now()
            })
          }
        >
          <Plus size={15} />
          {t('presets.create')}
        </button>
      </div>

      <div className="row gap-8 mb-20">
        {(['all', 'video', 'audio', 'custom'] as const).map((key) => (
          <button
            key={key}
            className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(key)}
          >
            {key === 'all' ? t('common.all') : key === 'video' ? t('common.video') : key === 'audio' ? t('common.audio') : t('presets.filterCustom')}
            <span className="text-xs" style={{ opacity: 0.7 }}>
              {key === 'all' ? profiles.length : profiles.filter((p) => p.category === key).length}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="verdict verdict-mixed mb-20">
          <Sparkles size={17} style={{ color: 'var(--info)' }} />
          <div>
            <div className="verdict-title">{t('presets.applyingTo', { name: selected.name })}</div>
            <div className="verdict-detail">{t('presets.applyingText')}</div>
          </div>
        </div>
      )}

      <div className="preset-grid">
        {visible.map((profile) => (
          <PresetCard
            key={profile.id}
            profile={profile}
            onApply={() => void apply(profile)}
            onEdit={() => setEditing(structuredClone(profile))}
            onDelete={() => void remove(profile)}
          />
        ))}
      </div>

      {editing && (
        <PresetEditor
          profile={editing}
          onClose={() => setEditing(null)}
          onSave={async (profile) => {
            const updated = await api().profiles.save(profile)
            setProfiles(updated)
            setEditing(null)
            pushToast({ kind: 'success', title: `Saved "${profile.name}"` })
          }}
        />
      )}
    </div>
  )
}

/**
 * A cap of 1080×1920 (portrait) limits the *short* edge to 1080, so the
 * honest label is "≤ 1080p", not "≤ 1920p".
 */
function resolutionCapLabel(profile: ConversionProfile): string | null {
  const { maxWidth, maxHeight } = profile
  if (!maxWidth && !maxHeight) return null
  const shortEdge = Math.min(maxWidth ?? Infinity, maxHeight ?? Infinity)
  if (!Number.isFinite(shortEdge)) return null
  return `≤ ${shortEdge}p`
}

function PresetCard({
  profile,
  onApply,
  onEdit,
  onDelete
}: {
  profile: ConversionProfile
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const container = CONTAINERS.find((c) => c.id === profile.settings.container.format)
  const videoCodec =
    profile.settings.video.codec === 'copy'
      ? 'Copy'
      : profile.settings.video.codec === 'none'
        ? null
        : (getCodec(profile.settings.video.codec as string)?.label ?? profile.settings.video.codec)
  const audioCodec =
    profile.settings.audio.codec === 'copy'
      ? 'Copy'
      : profile.settings.audio.codec === 'none'
        ? null
        : (getCodec(profile.settings.audio.codec as string)?.label ?? profile.settings.audio.codec)

  return (
    <div className="preset-card">
      <div className="row-between">
        <div className="preset-icon">{ICONS[profile.icon ?? ''] ?? <Sparkles size={16} />}</div>
        <div className="row gap-4">
          {!profile.builtIn && (
            <>
              <button className="btn-icon" onClick={onEdit} title={t('common.edit')}>
                <Pencil size={13} />
              </button>
              <button className="btn-icon" onClick={onDelete} title={t('common.delete')}>
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="preset-name">{t(profile.name)}</div>
        <div className="preset-desc mt-8">{t(profile.description ?? '')}</div>
      </div>

      <div className="preset-tags">
        <Badge tone="neutral">{container?.label ?? profile.settings.container.format}</Badge>
        {videoCodec && <Badge tone="neutral">{videoCodec}</Badge>}
        {audioCodec && <Badge tone="neutral">{audioCodec}</Badge>}
        {resolutionCapLabel(profile) && (
          <Badge tone="warning">{resolutionCapLabel(profile)}</Badge>
        )}
        {profile.settings.quality === 'lossless' && <Badge tone="success">Lossless</Badge>}
      </div>

      <button className="btn btn-secondary btn-sm mt-8" onClick={onApply}>
        {t('common.apply')}
      </button>
    </div>
  )
}

function PresetEditor({
  profile,
  onClose,
  onSave
}: {
  profile: ConversionProfile
  onClose: () => void
  onSave: (profile: ConversionProfile) => void
}): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState<ConversionProfile>(profile)
  const ffmpeg = useStore((s) => s.ffmpeg)
  const encoders = ffmpeg?.encoders ?? []

  const container = CONTAINERS.find((c) => c.id === draft.settings.container.format)

  const update = (mutate: (d: ConversionProfile) => void): void => {
    const next = structuredClone(draft)
    mutate(next)
    setDraft(next)
  }

  const videoOptions = [
    { value: 'copy', label: 'Copy (lossless)' },
    { value: 'none', label: 'No video' },
    ...VIDEO_CODECS.filter(
      (c) =>
        (container?.videoCodecs.includes('*') || container?.videoCodecs.includes(c.id)) &&
        c.encoders.some((e) => encoders.includes(e.name))
    ).map((c) => ({ value: c.id, label: c.label }))
  ]

  const audioOptions = [
    { value: 'copy', label: 'Copy (lossless)' },
    { value: 'none', label: 'No audio' },
    ...AUDIO_CODECS.filter(
      (c) =>
        (container?.audioCodecs.includes('*') || container?.audioCodecs.includes(c.id)) &&
        c.encoders.some((e) => encoders.includes(e.name))
    ).map((c) => ({ value: c.id, label: c.label }))
  ]

  return (
    <Modal
      title={profile.builtIn ? `Duplicate "${profile.name}"` : 'Custom preset'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              onSave({
                ...draft,
                id: profile.builtIn ? `custom-${Date.now()}` : draft.id,
                builtIn: false,
                category: 'custom'
              })
            }
            disabled={!draft.name.trim()}
          >
            Save preset
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label="Name">
          <input
            className="input"
            value={draft.name}
            onChange={(e) =>
              update((d) => {
                d.name = e.target.value
              })
            }
          />
        </Field>

        <Field label="Description">
          <input
            className="input"
            placeholder="What is this preset for?"
            value={draft.description ?? ''}
            onChange={(e) =>
              update((d) => {
                d.description = e.target.value
              })
            }
          />
        </Field>

        <div className="field-row">
          <Field label="Format">
            <Select
              value={draft.settings.container.format}
              onChange={(value) =>
                update((d) => {
                  d.settings.container.format = value
                  const c = CONTAINERS.find((x) => x.id === value)
                  d.settings.container.faststart = c?.supportsFaststart ?? false
                  // Reset codecs that the new container cannot hold.
                  if (c && !c.videoCodecs.includes('*')) {
                    const codec = String(d.settings.video.codec)
                    if (codec !== 'copy' && codec !== 'none' && !c.videoCodecs.includes(codec)) {
                      d.settings.video.codec = c.videoCodecs[0] ?? 'none'
                    }
                  }
                  if (c && !c.audioCodecs.includes('*')) {
                    const codec = String(d.settings.audio.codec)
                    if (codec !== 'copy' && codec !== 'none' && !c.audioCodecs.includes(codec)) {
                      d.settings.audio.codec = c.audioCodecs[0] ?? 'none'
                    }
                  }
                })
              }
              options={CONTAINERS.map((c) => ({
                value: c.id,
                label: c.label,
                group: c.kind === 'video' ? 'Video' : 'Audio'
              }))}
            />
          </Field>

          <Field label="Quality">
            <Select
              value={draft.settings.quality}
              onChange={(value) =>
                update((d) => {
                  d.settings.quality = value as typeof d.settings.quality
                })
              }
              options={[
                { value: 'lossless', label: 'Lossless' },
                { value: 'maximum', label: 'Maximum' },
                { value: 'very-high', label: 'Very high' },
                { value: 'high', label: 'High' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Video codec">
            <Select
              value={String(draft.settings.video.codec)}
              onChange={(value) =>
                update((d) => {
                  d.settings.video.codec = value
                })
              }
              options={videoOptions}
            />
          </Field>

          <Field label="Audio codec">
            <Select
              value={String(draft.settings.audio.codec)}
              onChange={(value) =>
                update((d) => {
                  d.settings.audio.codec = value
                })
              }
              options={audioOptions}
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="CRF / quality value" hint="Lower is better. Leave blank to derive from Quality.">
            <input
              className="input"
              type="number"
              value={draft.settings.video.crf ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.settings.video.crf = e.target.value ? Number(e.target.value) : undefined
                })
              }
            />
          </Field>

          <Field label="Audio bitrate (kbps)">
            <input
              className="input"
              type="number"
              value={draft.settings.audio.bitrate ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.settings.audio.bitrate = e.target.value ? Number(e.target.value) : undefined
                })
              }
            />
          </Field>
        </div>

        <div className="field-row">
          <Field
            label="Max width"
            hint="Only applied when the source is larger. Never upscales."
          >
            <input
              className="input"
              type="number"
              placeholder="no limit"
              value={draft.maxWidth ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.maxWidth = e.target.value ? Number(e.target.value) : undefined
                })
              }
            />
          </Field>

          <Field label="Max height">
            <input
              className="input"
              type="number"
              placeholder="no limit"
              value={draft.maxHeight ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.maxHeight = e.target.value ? Number(e.target.value) : undefined
                })
              }
            />
          </Field>
        </div>

        <Field label="Max frame rate" hint="Only applied when the source is faster.">
          <input
            className="input"
            type="number"
            placeholder="no limit"
            value={draft.maxFps ?? ''}
            onChange={(e) =>
              update((d) => {
                d.maxFps = e.target.value ? Number(e.target.value) : undefined
              })
            }
          />
        </Field>
      </div>
    </Modal>
  )
}
