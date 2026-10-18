/** YouTube downloader — whole videos, audio only, or just a fragment. */

import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Link,
  LogOut,
  MonitorPlay,
  ShieldCheck,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import type {
  YouTubeAudioFormat,
  YouTubeAuthStatus,
  YouTubeCookiesBrowser,
  YouTubeDownload,
  YouTubeMode,
  YouTubeVerifyResult,
  YouTubeVideoFormat,
  YouTubeVideoInfo,
  YtDlpInfo
} from '@shared/models'
import {
  formatTimecode,
  isValidSection,
  normalizeYouTubeUrl,
  parseTimecode
} from '@shared/youtube'
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  Progress,
  Segmented,
  Select,
  Spinner,
  Toggle
} from '../components/ui'
import { api, useStore, type YouTubeVerifyRequest } from '../store/useStore'
import { useT } from '../lib/i18n'

const VIDEO_FORMATS: YouTubeVideoFormat[] = ['mp4', 'mkv', 'webm']
const AUDIO_FORMATS: YouTubeAudioFormat[] = ['mp3', 'm4a', 'opus', 'flac', 'wav']
const AUDIO_BITRATES = [0, 320, 256, 192, 128, 96]
const BROWSERS: { value: YouTubeCookiesBrowser; label: string }[] = [
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
  { value: 'opera', label: 'Opera' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'safari', label: 'Safari' }
]

/** Friendly names for the common heights; anything else shows as "<h>p". */
function heightLabel(height: number): string {
  const names: Record<number, string> = { 4320: '8K', 2160: '4K', 1440: '1440p (2K)' }
  return names[height] ?? `${height}p`
}

export function YouTubePage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const downloads = useStore((s) => s.downloads)
  const pushToast = useStore((s) => s.pushToast)
  const verifyRequest = useStore((s) => s.youtubeVerify)
  const setYouTubeVerify = useStore((s) => s.setYouTubeVerify)
  const yt = settings?.youtube

  const [engine, setEngine] = useState<YtDlpInfo | null>(null)
  const [auth, setAuth] = useState<YouTubeAuthStatus | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<YouTubeVideoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [mode, setMode] = useState<YouTubeMode>(yt?.mode ?? 'video')
  const [quality, setQuality] = useState<number>(yt?.quality ?? 1080)
  const [videoFormat, setVideoFormat] = useState<YouTubeVideoFormat>(yt?.videoFormat ?? 'mp4')
  const [audioFormat, setAudioFormat] = useState<YouTubeAudioFormat>(yt?.audioFormat ?? 'mp3')
  const [audioBitrate, setAudioBitrate] = useState(0)
  const [folder, setFolder] = useState(yt?.downloadFolder ?? '')
  const [cookies, setCookies] = useState<YouTubeCookiesBrowser>(yt?.cookiesBrowser ?? '')

  const [useSection, setUseSection] = useState(false)
  const [startText, setStartText] = useState('0:00')
  const [endText, setEndText] = useState('')
  const [exactCuts, setExactCuts] = useState(false)

  useEffect(() => {
    void api().youtube.engine().then(setEngine)
    void api().youtube.authStatus().then(setAuth)
  }, [])

  // Settings arrive asynchronously on first launch; adopt them once.
  useEffect(() => {
    if (!yt) return
    setFolder((current) => current || yt.downloadFolder)
  }, [yt])

  const normalizedUrl = normalizeYouTubeUrl(url)
  const urlInvalid = url.trim().length > 0 && !normalizedUrl

  const analyse = async (cookiesOverride?: YouTubeCookiesBrowser): Promise<void> => {
    if (!normalizedUrl || loading) return
    setLoading(true)
    setInfo(null)
    setInfoError(null)
    try {
      const result = await api().youtube.info(normalizedUrl, cookiesOverride ?? cookies)
      if (!result.ok) {
        setInfoError(result.error)
        // YouTube wants the robot check (or an adult account): offer it now.
        if (result.code === 'bot' || result.code === 'age') {
          setYouTubeVerify({ code: result.code, url: normalizedUrl })
        }
        return
      }
      const found = result.info
      setInfo(found)
      setStartText('0:00')
      setEndText(found.duration ? formatTimecode(found.duration) : '')
      // Keep the remembered quality if offered, else the best one below it.
      if (quality > 0 && !found.heights.includes(quality)) {
        setQuality(found.heights.find((h) => h <= quality) ?? 0)
      }
    } catch (err) {
      setInfoError(cleanIpcError(err))
    } finally {
      setLoading(false)
    }
  }

  /** After a successful check: switch to the saved session and try again. */
  const onVerified = (result: YouTubeVerifyResult, request: YouTubeVerifyRequest): void => {
    setAuth({ hasCookies: result.hasCookies, signedIn: result.signedIn })
    setCookies('app')
    pushToast({
      kind: 'success',
      title: result.signedIn ? t('yt.verifySignedIn') : t('yt.verifySaved')
    })
    if (request.downloadId) void api().youtube.retry(request.downloadId, 'app')
    else void analyse('app')
  }

  /* --------------------------- fragment checks --------------------------- */

  const sectionStart = parseTimecode(startText)
  const sectionEnd = parseTimecode(endText)
  const duration = info?.duration ?? 0
  const timeError =
    useSection && (sectionStart === null || sectionEnd === null)
      ? t('yt.timeInvalid')
      : useSection && !isValidSection(sectionStart!, sectionEnd!, duration)
        ? t('yt.rangeInvalid', { duration: formatTimecode(duration) })
        : null

  const qualityOptions = useMemo(() => {
    const heights = info?.heights.length ? info.heights : [2160, 1440, 1080, 720, 480, 360]
    return [
      { value: '0', label: t('yt.qualityBest') },
      ...heights.map((h) => ({ value: String(h), label: heightLabel(h) }))
    ]
  }, [info, t])

  const lossless = audioFormat === 'flac' || audioFormat === 'wav'
  const canDownload =
    !!info && !info.isLive && !!folder && !timeError && !starting && engine?.available === true

  const startDownload = async (): Promise<void> => {
    if (!info || !canDownload) return
    setStarting(true)
    try {
      await api().youtube.start({
        url: info.url,
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        mode,
        quality,
        videoFormat,
        audioFormat,
        audioBitrate: lossless ? 0 : audioBitrate,
        outputFolder: folder,
        sectionStart: useSection ? (sectionStart ?? undefined) : undefined,
        sectionEnd: useSection ? (sectionEnd ?? undefined) : undefined,
        exactCuts: useSection && exactCuts,
        cookiesBrowser: cookies
      })
      pushToast({ kind: 'info', title: t('yt.started'), message: info.title })
    } catch (err) {
      pushToast({ kind: 'error', title: t('yt.failedToast'), message: cleanIpcError(err) })
    } finally {
      setStarting(false)
    }
  }

  const finished = downloads.some((d) => d.status !== 'queued' && d.status !== 'downloading' && d.status !== 'processing')

  return (
    <div className="page-inner">
      <div className="page-header">
        <div>
          <div className="page-title">{t('yt.title')}</div>
          <div className="page-subtitle">{t('yt.subtitle')}</div>
        </div>
        {engine?.available && <span className="text-xs text-faint mono">yt-dlp {engine.version}</span>}
      </div>

      {engine && !engine.available && (
        <div className="verdict verdict-encode mb-16">
          <div className="verdict-icon">
            <TriangleAlert size={19} style={{ color: 'var(--warning)' }} />
          </div>
          <div className="flex-1">
            <div className="verdict-title">{t('yt.missing')}</div>
            <div className="verdict-detail">{t('yt.missingText')}</div>
          </div>
        </div>
      )}

      {/* ------------------------------ link ------------------------------ */}
      <div className="panel">
        <div className="panel-body col gap-12">
          <div className="row gap-8">
            <div className="yt-url flex-1">
              <Link size={15} />
              <input
                className="input"
                placeholder="https://www.youtube.com/watch?v=…"
                value={url}
                spellCheck={false}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setInfoError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void analyse()
                }}
              />
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void analyse()}
              disabled={!normalizedUrl || loading || engine?.available === false}
            >
              {loading ? <Spinner size={15} /> : <MonitorPlay size={15} />}
              {t('yt.analyse')}
            </button>
          </div>

          {urlInvalid && <div className="text-sm" style={{ color: 'var(--danger)' }}>{t('yt.invalidUrl')}</div>}
          {loading && <div className="text-sm text-muted">{t('yt.analysing')}</div>}
          {infoError && (
            <div className="row gap-6 text-sm" style={{ color: 'var(--danger)' }}>
              <TriangleAlert size={14} />
              <span>
                {t('yt.infoFailed')}: {infoError}
              </span>
            </div>
          )}

          {info && (
            <div className="yt-info">
              {info.thumbnail ? (
                <img className="yt-info-thumb" src={info.thumbnail} alt="" />
              ) : (
                <div className="yt-info-thumb" />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="yt-info-title">{info.title}</div>
                <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                  {[info.channel, info.duration ? formatTimecode(info.duration) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {info.isLive && (
                  <div className="text-sm mt-8" style={{ color: 'var(--warning)' }}>
                    {t('yt.live')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------- options ---------------------------- */}
      <div className="panel mt-16">
        <div className="panel-header">
          <div className="panel-title">
            <Download size={15} />
            {t('yt.whatToDownload')}
          </div>
        </div>
        <div className="panel-body col gap-16">
          <Segmented<YouTubeMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'video', label: t('yt.modeVideo') },
              { value: 'audio', label: t('yt.modeAudio') }
            ]}
          />

          {mode === 'video' ? (
            <div className="field-row">
              <Field label={t('yt.quality')}>
                <Select
                  value={String(quality)}
                  onChange={(v) => setQuality(Number(v))}
                  options={qualityOptions}
                />
              </Field>
              <Field label={t('yt.format')}>
                <Select
                  value={videoFormat}
                  onChange={(v) => setVideoFormat(v as YouTubeVideoFormat)}
                  options={VIDEO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
                />
              </Field>
            </div>
          ) : (
            <div className="field-row">
              <Field label={t('yt.audioFormat')}>
                <Select
                  value={audioFormat}
                  onChange={(v) => setAudioFormat(v as YouTubeAudioFormat)}
                  options={AUDIO_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
                />
              </Field>
              <Field label={t('yt.audioBitrate')}>
                <Select
                  value={String(lossless ? 0 : audioBitrate)}
                  disabled={lossless}
                  onChange={(v) => setAudioBitrate(Number(v))}
                  options={AUDIO_BITRATES.map((b) => ({
                    value: String(b),
                    label: b === 0 ? t('yt.bitrateBest') : `${b} kbps`
                  }))}
                />
              </Field>
            </div>
          )}

          <Field label={t('yt.folder')}>
            <div className="row gap-8">
              <input
                className="input input-mono flex-1"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
              <button
                className="btn btn-secondary"
                onClick={() =>
                  void api()
                    .media.pickFolder()
                    .then((picked) => picked && setFolder(picked))
                }
              >
                <FolderOpen size={15} />
                {t('yt.browse')}
              </button>
            </div>
          </Field>

          <Toggle
            title={t('yt.section')}
            description={t('yt.sectionHint')}
            checked={useSection}
            onChange={setUseSection}
          />

          {useSection && (
            <div className="col gap-10">
              <div className="field-row-3">
                <Field label={t('yt.start')}>
                  <input
                    className="input input-mono"
                    value={startText}
                    placeholder="30:00"
                    onChange={(e) => setStartText(e.target.value)}
                  />
                </Field>
                <Field label={t('yt.end')}>
                  <input
                    className="input input-mono"
                    value={endText}
                    placeholder="50:00"
                    onChange={(e) => setEndText(e.target.value)}
                  />
                </Field>
                <Field label={' '}>
                  <div className="text-sm text-muted" style={{ paddingTop: 8 }}>
                    {!timeError && sectionStart !== null && sectionEnd !== null && (
                      <span className="row gap-6">
                        <Scissors size={13} />
                        {t('yt.sectionLength', {
                          duration: formatTimecode(
                            Math.min(sectionEnd, duration || sectionEnd) - sectionStart
                          )
                        })}
                      </span>
                    )}
                  </div>
                </Field>
              </div>
              {timeError && (
                <div className="text-sm" style={{ color: 'var(--danger)' }}>
                  {timeError}
                </div>
              )}
              <Toggle
                title={t('yt.exactCuts')}
                description={t('yt.exactCutsHint')}
                checked={exactCuts}
                onChange={setExactCuts}
              />
            </div>
          )}

          <Field label={t('yt.cookies')} hint={t('yt.cookiesHint')}>
            <div className="row gap-8">
              <div className="flex-1">
                <Select
                  value={cookies}
                  onChange={(v) => setCookies(v as YouTubeCookiesBrowser)}
                  options={[
                    { value: '', label: t('yt.cookiesNone') },
                    { value: 'app', label: t('yt.cookiesApp') },
                    ...BROWSERS
                  ]}
                />
              </div>
              <button
                className="btn btn-secondary"
                disabled={signingIn}
                onClick={() => {
                  setSigningIn(true)
                  void api()
                    .youtube.verify(info?.url ?? normalizedUrl ?? undefined)
                    .then((result) => {
                      setAuth({ hasCookies: result.hasCookies, signedIn: result.signedIn })
                      if (result.hasCookies) setCookies('app')
                    })
                    .finally(() => setSigningIn(false))
                }}
              >
                {signingIn ? <Spinner size={15} /> : <ShieldCheck size={15} />}
                {t('yt.signIn')}
              </button>
              {auth?.hasCookies && (
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    void api()
                      .youtube.signOut()
                      .then((status) => {
                        setAuth(status)
                        if (cookies === 'app') setCookies('')
                      })
                  }
                >
                  <LogOut size={15} />
                  {t('yt.signOut')}
                </button>
              )}
            </div>
            {auth && (
              <div className="row gap-6 text-xs mt-8" style={{ color: auth.hasCookies ? 'var(--success)' : 'var(--text-faint)' }}>
                {auth.hasCookies ? <CheckCircle2 size={12} /> : null}
                {auth.signedIn ? t('yt.sessionSignedIn') : auth.hasCookies ? t('yt.sessionSaved') : t('yt.sessionNone')}
              </div>
            )}
          </Field>

          <div className="row gap-12" style={{ justifyContent: 'space-between' }}>
            <div className="text-xs text-faint" style={{ maxWidth: 520 }}>
              {t('yt.legal')}
            </div>
            <button className="btn btn-primary" disabled={!canDownload} onClick={() => void startDownload()}>
              {starting ? <Spinner size={15} /> : <Download size={15} />}
              {t('yt.download')}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------------------- downloads --------------------------- */}
      <div className="panel mt-16">
        <div className="panel-header">
          <div className="panel-title">
            <Download size={15} />
            {t('yt.downloads')}
          </div>
          {finished && (
            <button className="btn btn-sm btn-ghost" onClick={() => void api().youtube.clearFinished()}>
              <Trash2 size={13} />
              {t('yt.clearFinished')}
            </button>
          )}
        </div>
        {downloads.length === 0 ? (
          <EmptyState
            icon={<MonitorPlay size={36} />}
            title={t('yt.noDownloads')}
            text={t('yt.noDownloadsText')}
          />
        ) : (
          <div>
            {downloads.map((download) => (
              <DownloadRow key={download.id} download={download} />
            ))}
          </div>
        )}
      </div>

      {verifyRequest && (
        <VerifyDialog
          request={verifyRequest}
          needsSignIn={!!auth?.hasCookies && !auth.signedIn && cookies === 'app'}
          onClose={() => setYouTubeVerify(null)}
          onVerified={(result) => {
            setYouTubeVerify(null)
            onVerified(result, verifyRequest)
          }}
        />
      )}
    </div>
  )
}

/**
 * "Confirm you're not a robot". Opens GConverter's YouTube window, waits
 * for the user to complete the check (or sign in) and close it, then hands
 * the saved session back so the refused request can be retried.
 */
function VerifyDialog({
  request,
  needsSignIn,
  onClose,
  onVerified
}: {
  request: YouTubeVerifyRequest
  /** A check was already saved and YouTube still refused: only a sign-in helps now. */
  needsSignIn: boolean
  onClose: () => void
  onVerified: (result: YouTubeVerifyResult) => void
}): React.JSX.Element {
  const t = useT()
  const [waiting, setWaiting] = useState(false)
  const [nothingSaved, setNothingSaved] = useState(false)

  const open = (): void => {
    setWaiting(true)
    setNothingSaved(false)
    // For the robot check the window closes itself once it is passed; an
    // age check needs a sign-in, which only the user knows is finished.
    void api()
      .youtube.verify(request.url, request.code === 'bot' && !needsSignIn)
      .then((result) => {
        if (result.ok && result.hasCookies) onVerified(result)
        else setNothingSaved(true)
      })
      .finally(() => setWaiting(false))
  }

  return (
    <Modal
      title={t('yt.verifyTitle')}
      onClose={() => {
        // Closing the dialog also closes the window it is waiting on.
        if (waiting) void api().youtube.verifyFinish()
        onClose()
      }}
      footer={
        waiting ? (
          <button className="btn btn-primary" onClick={() => void api().youtube.verifyFinish()}>
            <CheckCircle2 size={15} />
            {t('yt.verifyDone')}
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              {t('yt.verifyLater')}
            </button>
            <button className="btn btn-primary" onClick={open}>
              <ShieldCheck size={15} />
              {t('yt.verifyOpen')}
            </button>
          </>
        )
      }
    >
      <div className="col gap-12">
        <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
          <ShieldCheck size={28} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div className="text-sm" style={{ lineHeight: 1.55 }}>
            {request.code === 'age' ? t('yt.verifyAgeText') : t('yt.verifyText')}
          </div>
        </div>
        {needsSignIn && request.code === 'bot' && (
          <div className="text-sm" style={{ color: 'var(--warning)' }}>
            {t('yt.verifyNeedSignIn')}
          </div>
        )}
        {waiting && (
          <div className="row gap-8 text-sm text-muted">
            <Spinner size={14} />
            {t('yt.verifyWaiting')}
          </div>
        )}
        {nothingSaved && (
          <div className="text-sm" style={{ color: 'var(--warning)' }}>
            {t('yt.verifyNothing')}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DownloadRow({ download }: { download: YouTubeDownload }): React.JSX.Element {
  const t = useT()
  const { request, status } = download
  const active = status === 'downloading' || status === 'processing'

  const details = [
    request.mode === 'video'
      ? `${request.quality ? heightLabel(request.quality) : t('yt.qualityBest')} · ${request.videoFormat.toUpperCase()}`
      : request.audioFormat.toUpperCase(),
    request.sectionStart !== undefined && request.sectionEnd !== undefined
      ? t('yt.part', {
          start: formatTimecode(request.sectionStart),
          end: formatTimecode(request.sectionEnd)
        })
      : null
  ].filter(Boolean)

  const badge = (): React.JSX.Element => {
    switch (status) {
      case 'completed':
        return (
          <Badge tone="success">
            <CheckCircle2 size={11} /> {t('yt.status.completed')}
          </Badge>
        )
      case 'failed':
        return <Badge tone="danger">{t('yt.status.failed')}</Badge>
      case 'cancelled':
        return <Badge tone="neutral">{t('yt.status.cancelled')}</Badge>
      case 'processing':
        return <Badge tone="info">{t('yt.status.processing')}</Badge>
      case 'downloading':
        return <Badge tone="accent">{Math.round(download.percent)}%</Badge>
      default:
        return <Badge tone="neutral">{t('yt.status.queued')}</Badge>
    }
  }

  return (
    <div className="job-row yt-row">
      {request.thumbnail ? (
        <img className="yt-row-thumb" src={request.thumbnail} alt="" />
      ) : (
        <div className="yt-row-thumb" />
      )}

      <div style={{ minWidth: 0 }}>
        <div className="job-title">
          <span className="job-path">{request.title ?? request.url}</span>
        </div>
        <div className="job-stats">
          {details.map((d) => (
            <span key={d}>{d}</span>
          ))}
          {status === 'downloading' && download.speed && <span>{download.speed}</span>}
          {status === 'downloading' && download.eta && <span>ETA {download.eta}</span>}
        </div>
        {active && (
          <div className="mt-8">
            <Progress percent={status === 'processing' ? 100 : download.percent} animated />
          </div>
        )}
        {status === 'failed' && download.error && (
          <div className="job-stats" style={{ color: 'var(--danger)' }}>
            <span>{download.error}</span>
          </div>
        )}
      </div>

      <div className="job-actions">
        {badge()}
        {status === 'completed' && download.outputPath && (
          <>
            <button
              className="btn-icon"
              title={t('yt.open')}
              onClick={() => void api().shell.openPath(download.outputPath!)}
            >
              <Play size={15} />
            </button>
            <button
              className="btn-icon"
              title={t('yt.showInFolder')}
              onClick={() => void api().shell.revealPath(download.outputPath!)}
            >
              <FolderOpen size={15} />
            </button>
          </>
        )}
        {status === 'failed' && (download.errorCode === 'bot' || download.errorCode === 'age') && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={() =>
              useStore.getState().setYouTubeVerify({
                code: download.errorCode as 'bot' | 'age',
                url: request.url,
                downloadId: download.id
              })
            }
          >
            <ShieldCheck size={13} />
            {t('yt.verifyAction')}
          </button>
        )}
        {(status === 'failed' || status === 'cancelled') && (
          <button className="btn-icon" title={t('yt.retry')} onClick={() => void api().youtube.retry(download.id)}>
            <RotateCcw size={15} />
          </button>
        )}
        {status === 'queued' || active ? (
          <button className="btn-icon" title={t('yt.cancel')} onClick={() => void api().youtube.cancel(download.id)}>
            <X size={16} />
          </button>
        ) : (
          <button className="btn-icon" title={t('yt.remove')} onClick={() => void api().youtube.remove(download.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Electron prefixes rejected IPC calls with "Error invoking remote method …: Error: ". */
function cleanIpcError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
