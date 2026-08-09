/** Watch folders and automation rules (spec §26, §27). */

import { useState } from 'react'
import { ArrowRight, FolderInput, FolderOutput, Play, Plus, Trash2, Zap } from 'lucide-react'
import type { AutomationRule, PostAction } from '@shared/models'
import { Badge, EmptyState, Field, Modal, Select, Toggle } from '../components/ui'
import { api, useStore } from '../store/useStore'
import { useLanguage, useT } from '../lib/i18n'
import { formatRelativeDate } from '../lib/format'

export function AutomationPage(): React.JSX.Element {
  const t = useT()
  const lang = useLanguage()
  const rules = useStore((s) => s.automationRules)
  const setRules = useStore((s) => s.setAutomationRules)
  const profiles = useStore((s) => s.profiles)
  const pushToast = useStore((s) => s.pushToast)

  const [editing, setEditing] = useState<AutomationRule | null>(null)

  const blank = (): AutomationRule => ({
    id: `rule-${Date.now()}`,
    name: t('automation.newRuleName'),
    enabled: false,
    watchFolder: '',
    outputFolder: '',
    recursive: false,
    extensions: [],
    profileId: profiles[0]?.id ?? 'original-quality',
    sourceAction: 'nothing',
    createdAt: Date.now(),
    stats: { processed: 0, failed: 0 }
  })

  const save = async (rule: AutomationRule): Promise<void> => {
    const updated = await api().automation.save(rule)
    setRules(updated)
    setEditing(null)
    pushToast({
      kind: 'success',
      title: rule.enabled
        ? t('automation.watching', { folder: rule.watchFolder })
        : t('presets.saved', { name: rule.name })
    })
  }

  const toggle = async (rule: AutomationRule): Promise<void> => {
    const updated = await api().automation.save({ ...rule, enabled: !rule.enabled })
    setRules(updated)
  }

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <div className="page-title">{t('automation.title')}</div>
          <div className="page-subtitle">
            {t('automation.subtitle')}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(blank())}>
          <Plus size={15} />
          {t('automation.newRule')}
        </button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={<Zap size={40} />}
          title={t('automation.emptyTitle')}
          text={t('automation.emptyText')}
          action={
            <button className="btn btn-primary" onClick={() => setEditing(blank())}>
              {t('automation.createFirst')}
            </button>
          }
        />
      ) : (
        <div className="col gap-12">
          {rules.map((rule) => {
            const profile = profiles.find((p) => p.id === rule.profileId)
            return (
              <div className="card card-pad" key={rule.id}>
                <div className="row-between">
                  <div className="row gap-12">
                    <div
                      className={`file-thumb ${rule.enabled ? 'video' : ''}`}
                      style={{ width: 38, height: 38 }}
                    >
                      <Zap size={17} />
                    </div>
                    <div>
                      <div className="row gap-8">
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{rule.name}</span>
                        {rule.enabled ? (
                          <Badge tone="success">{t('automation.active')}</Badge>
                        ) : (
                          <Badge tone="neutral">{t('automation.paused')}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted mt-8">
                        {t('automation.processed', { count: rule.stats.processed })}
                        {rule.stats.failed > 0 &&
                          ` · ` + t('automation.failed', { count: rule.stats.failed })}
                        {rule.stats.lastRunAt &&
                          ` · ` +
                            t('automation.lastRun', {
                              when: formatRelativeDate(rule.stats.lastRunAt, t, lang)
                            })}
                      </div>
                    </div>
                  </div>

                  <div className="row gap-6">
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() =>
                        void api()
                          .automation.scan(rule.id)
                          .then((count) =>
                            pushToast({
                              kind: count > 0 ? 'success' : 'info',
                              title:
                                count > 0
                                  ? t('automation.queuedExisting', { count })
                                  : t('automation.noNewFiles')
                            })
                          )
                      }
                      disabled={!rule.watchFolder}
                    >
                      <Play size={13} />
                      {t('automation.scanNow')}
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => setEditing(structuredClone(rule))}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      className={`btn btn-sm ${rule.enabled ? 'btn-ghost' : 'btn-primary'}`}
                      onClick={() => void toggle(rule)}
                      disabled={!rule.watchFolder || !rule.outputFolder}
                    >
                      {rule.enabled ? t('common.pause') : t('common.enable')}
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() =>
                        void api().automation.remove(rule.id).then(setRules)
                      }
                      title={t('automation.deleteRule')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="divider" />

                <div className="row gap-16 text-sm" style={{ flexWrap: 'wrap' }}>
                  <div className="row gap-6">
                    <FolderInput size={14} style={{ color: 'var(--text-faint)' }} />
                    <span className="mono text-xs">{rule.watchFolder || t('common.notSet')}</span>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-faint)' }} />
                  <Badge tone="accent">{profile ? t(profile.name) : t('automation.missingPreset')}</Badge>
                  <ArrowRight size={14} style={{ color: 'var(--text-faint)' }} />
                  <div className="row gap-6">
                    <FolderOutput size={14} style={{ color: 'var(--text-faint)' }} />
                    <span className="mono text-xs">{rule.outputFolder || t('common.notSet')}</span>
                  </div>
                  {rule.sourceAction !== 'nothing' && (
                    <Badge tone="warning">
                      {t('automation.sourceLabel', {
                        action: t(
                          rule.sourceAction === 'move'
                            ? 'automation.actionMove'
                            : rule.sourceAction === 'trash'
                              ? 'automation.actionTrash'
                              : 'automation.actionDelete'
                        )
                      })}
                      {rule.sourceAction === 'move' && rule.sourceMoveFolder
                        ? ` → ${rule.sourceMoveFolder}`
                        : ''}
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <RuleEditor rule={editing} onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  )
}

function RuleEditor({
  rule,
  onClose,
  onSave
}: {
  rule: AutomationRule
  onClose: () => void
  onSave: (rule: AutomationRule) => void
}): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(rule)
  const profiles = useStore((s) => s.profiles)

  const update = (mutate: (d: AutomationRule) => void): void => {
    const next = structuredClone(draft)
    mutate(next)
    setDraft(next)
  }

  const pickFolder = async (key: 'watchFolder' | 'outputFolder' | 'sourceMoveFolder'): Promise<void> => {
    const folder = await api().media.pickFolder()
    if (folder) update((d) => { d[key] = folder })
  }

  const valid = draft.name.trim() && draft.watchFolder && draft.outputFolder

  return (
    <Modal
      title={t('automation.rule')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={!valid}>
            {t('automation.saveRule')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label={t('automation.ruleName')}>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => update((d) => { d.name = e.target.value })}
          />
        </Field>

        <Field label={t('automation.watchFolder')} hint={t('automation.watchFolderHint')}>
          <div className="row gap-8">
            <input
              className="input mono"
              style={{ fontSize: 12 }}
              value={draft.watchFolder}
              placeholder={t('automation.chooseFolder')}
              readOnly
            />
            <button className="btn btn-secondary" onClick={() => void pickFolder('watchFolder')}>
              {t('common.browse')}
            </button>
          </div>
        </Field>

        <Field label={t('automation.outputFolder')}>
          <div className="row gap-8">
            <input
              className="input mono"
              style={{ fontSize: 12 }}
              value={draft.outputFolder}
              placeholder={t('automation.chooseFolder')}
              readOnly
            />
            <button className="btn btn-secondary" onClick={() => void pickFolder('outputFolder')}>
              {t('common.browse')}
            </button>
          </div>
        </Field>

        <Field label={t('automation.convertWith')}>
          <Select
            value={draft.profileId}
            onChange={(value) => update((d) => { d.profileId = value })}
            options={profiles.map((p) => ({
              value: p.id,
              label: t(p.name),
              group:
                p.category === 'video' ? t('common.video') : p.category === 'audio' ? t('common.audio') : t('presets.filterCustom')
            }))}
          />
        </Field>

        <Field
          label={t('automation.fileTypes')}
          hint={t('automation.fileTypesHint')}
        >
          <input
            className="input"
            placeholder="mkv, avi, mov"
            value={draft.extensions.join(', ')}
            onChange={(e) =>
              update((d) => {
                d.extensions = e.target.value
                  .split(',')
                  .map((s) => s.trim().replace(/^\./, '').toLowerCase())
                  .filter(Boolean)
              })
            }
          />
        </Field>

        <Field label={t('automation.onSuccess')}>
          <Select
            value={draft.sourceAction}
            onChange={(value) => update((d) => { d.sourceAction = value as PostAction })}
            options={[
              { value: 'nothing', label: t('automation.actionNothing') },
              { value: 'move', label: t('automation.actionMove') },
              { value: 'trash', label: t('automation.actionTrash') },
              { value: 'delete', label: t('automation.actionDelete') }
            ]}
          />
        </Field>

        {draft.sourceAction === 'move' && (
          <Field label={t('automation.moveTo')}>
            <div className="row gap-8">
              <input
                className="input mono"
                style={{ fontSize: 12 }}
                value={draft.sourceMoveFolder ?? ''}
                placeholder={t('automation.chooseFolder')}
                readOnly
              />
              <button
                className="btn btn-secondary"
                onClick={() => void pickFolder('sourceMoveFolder')}
              >
                {t('common.browse')}
              </button>
            </div>
          </Field>
        )}

        {draft.sourceAction === 'delete' && (
          <div className="verdict verdict-encode">
            <div>
              <div className="verdict-title">{t('automation.deleteWarnTitle')}</div>
              <div className="verdict-detail">
                {t('automation.deleteWarnText')}
              </div>
            </div>
          </div>
        )}

        <Toggle
          title={t('automation.recursive')}
          description={t('automation.recursiveHint')}
          checked={draft.recursive}
          onChange={(value) => update((d) => { d.recursive = value })}
        />

        <Toggle
          title={t('automation.enableNow')}
          description={t('automation.enableNowHint')}
          checked={draft.enabled}
          onChange={(value) => update((d) => { d.enabled = value })}
        />
      </div>
    </Modal>
  )
}
