/** Convert workspace — file list, editor, preset strip and preview (spec §6, §9). */

import { useEffect, useMemo, useState } from 'react'
import {
  Eye,
  FileVideo,
  Layers,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react'
import type { ConversionProfile } from '@shared/models'
import { CONTAINERS } from '@shared/formats'
import { ConversionEditor } from '../components/ConversionEditor'
import { Dropzone } from '../components/Dropzone'
import { FileCard } from '../components/FileCard'
import { Player } from '../components/Player'
import { Badge, EmptyState, Modal, Select, Spinner } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useT } from '../lib/i18n'

export function ConvertPage(): React.JSX.Element {
  const t = useT()
  const files = useStore((s) => s.files)
  const selectedFileId = useStore((s) => s.selectedFileId)
  const selectFile = useStore((s) => s.selectFile)
  const removeFile = useStore((s) => s.removeFile)
  const clearFiles = useStore((s) => s.clearFiles)
  const settingsByFile = useStore((s) => s.settingsByFile)
  const setFileSettings = useStore((s) => s.setFileSettings)
  const profiles = useStore((s) => s.profiles)
  const preview = useStore((s) => s.preview)
  const pushToast = useStore((s) => s.pushToast)
  const setPage = useStore((s) => s.setPage)

  const [showPlayer, setShowPlayer] = useState(false)
  const [adding, setAdding] = useState(false)

  const selected = files.find((f) => f.id === selectedFileId) ?? null
  const validFiles = files.filter((f) => !f.error)

  const suggestedProfiles = useMemo(() => {
    if (!selected) return profiles.slice(0, 8)
    const wanted = selected.hasVideo ? 'video' : 'audio'
    return profiles.filter((p) => p.category === wanted || p.category === 'custom').slice(0, 10)
  }, [profiles, selected])

  /* Keep a valid selection as files come and go. */
  useEffect(() => {
    if (selectedFileId && files.some((f) => f.id === selectedFileId)) return
    selectFile(validFiles[0]?.id ?? null)
  }, [files, selectedFileId, selectFile, validFiles])

  const applyProfile = async (profile: ConversionProfile): Promise<void> => {
    if (!selected) return
    const settings = await api().conversion.profileSettings(selected, profile.id)
    setFileSettings(selected.id, settings)

    const effects = await api().profiles.effect(selected, profile.id)
    if (effects.length > 0) {
      pushToast({
        kind: 'info',
        title: t('convert.presetApplied', { name: t(profile.name) }),
        message: effects.join(' · ')
      })
    }
  }

  const addToQueue = async (all: boolean): Promise<void> => {
    const targets = all ? validFiles : selected ? [selected] : []
    if (targets.length === 0) return

    setAdding(true)
    try {
      let queued = 0
      for (const file of targets) {
        let settings = settingsByFile[file.id]
        if (!settings) {
          // Files never opened in the editor still need sensible settings.
          const reference = selected ? settingsByFile[selected.id] : undefined
          settings = reference
            ? structuredClone(reference)
            : await api().conversion.smartSettings(file, file.hasVideo ? 'mp4' : 'mp3')
        }
        await api().queue.add(file, settings)
        queued++
      }

      await api().queue.start()
      pushToast({
        kind: 'success',
        title: t('convert.started', { count: queued }),
        actions: [{ label: t('convert.viewQueue'), onClick: () => setPage('queue') }]
      })
      setPage('queue')
    } catch (err) {
      pushToast({
        kind: 'error',
        title: t('convert.startFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setAdding(false)
    }
  }

  if (files.length === 0) {
    return (
      <div className="page-inner">
        <div className="page-header">
          <div>
            <div className="page-title">{t('convert.title')}</div>
            <div className="page-subtitle">{t('convert.emptySubtitle')}</div>
          </div>
        </div>
        <Dropzone />
      </div>
    )
  }

  const blocked = preview?.validation.issues.some((i) => i.severity === 'error') ?? false

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('convert.title')}</div>
          <div className="page-subtitle">
            {t('convert.filesReady', { count: files.length })}
            {validFiles.length !== files.length &&
              ` · ${t('convert.unreadable', { count: files.length - validFiles.length })}`}
          </div>
        </div>

        <div className="row gap-8">
          <button className="btn btn-ghost btn-sm" onClick={clearFiles}>
            <Trash2 size={14} />
            {t('common.clear')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => void api().media.pickFiles().then((f) => useStore.getState().addFiles(f))}
          >
            <Plus size={15} />
            {t('common.add')}
          </button>
          {validFiles.length > 1 && (
            <button
              className="btn btn-secondary"
              onClick={() => void addToQueue(true)}
              disabled={adding}
            >
              <Layers size={15} />
              {t('convert.convertAll', { count: validFiles.length })}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void addToQueue(false)}
            disabled={!selected || adding || blocked}
            title={blocked ? t('convert.resolveErrors') : undefined}
          >
            {adding ? <Spinner size={15} /> : <Play size={15} />}
            {t('convert.title')}
          </button>
        </div>
      </div>

      <div className="split">
        {/* ------------------------------ left ------------------------------ */}
        <div className="col gap-16">
          {selected ? (
            <ConversionEditor file={selected} key={selected.id} />
          ) : (
            <EmptyState
              icon={<FileVideo size={40} />}
              title={t('convert.selectFile')}
              text={t('convert.selectFileText')}
            />
          )}
        </div>

        {/* ------------------------------ right ----------------------------- */}
        <div className="col gap-16">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Layers size={15} />
                {t('convert.files')}
              </div>
              <span className="text-xs text-faint">{files.length}</span>
            </div>
            <div className="panel-body" style={{ padding: 10, maxHeight: 300, overflowY: 'auto' }}>
              <div className="file-grid">
                {files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    selected={file.id === selectedFileId}
                    onSelect={() => selectFile(file.id)}
                    onRemove={() => removeFile(file.id)}
                  />
                ))}
              </div>
            </div>
          </div>

          {selected && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Sparkles size={15} />
                  {t('nav.presets')}
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setPage('presets')}>
                  {t('common.all')}
                </button>
              </div>
              <div className="panel-body" style={{ padding: 12 }}>
                <div className="col gap-6">
                  {suggestedProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      className="file-card"
                      style={{ padding: '10px 12px' }}
                      onClick={() => void applyProfile(profile)}
                    >
                      <div className="file-info">
                        <div className="file-name">{t(profile.name)}</div>
                        <div className="file-meta">
                          <span>{t(profile.description ?? '')}</span>
                        </div>
                      </div>
                      {!profile.builtIn && <Badge tone="accent">{t('presets.filterCustom')}</Badge>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {selected && (
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Wand2 size={15} />
                  {t('convert.quickConvert')}
                </div>
              </div>
              <div className="panel-body col gap-10">
                <div className="text-sm text-muted">
                  {t('convert.quickConvertText')}
                </div>
                <Select
                  value=""
                  onChange={(value) => {
                    if (!value) return
                    void api()
                      .conversion.smartSettings(selected, value)
                      .then((settings) => setFileSettings(selected.id, settings))
                  }}
                  options={[
                    { value: '', label: t('convert.convertTo') },
                    ...CONTAINERS.map((c) => ({
                      value: c.id,
                      label: c.label,
                      group: c.kind === 'video' ? t('common.video') : t('common.audio')
                    }))
                  ]}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowPlayer(true)}
                  disabled={!!selected.error}
                >
                  <Eye size={15} />
                  {t('convert.previewFile')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPlayer && selected && (
        <Modal title={selected.name} onClose={() => setShowPlayer(false)} large>
          <Player file={selected} />
        </Modal>
      )}

    </div>
  )
}
