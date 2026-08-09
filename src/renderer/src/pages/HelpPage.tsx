/**
 * In-app manual and credits.
 *
 * The article list mirrors the sidebar order, so "where am I in the app"
 * maps directly onto "where am I in the help".
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Clock,
  Code2,
  ExternalLink,
  Heart,
  HelpCircle,
  Home,
  Lightbulb,
  Link as LinkIcon,
  ListVideo,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Terminal,
  Zap
} from 'lucide-react'
import { AUTHOR_LINKS, helpArticles, openSource, type HelpArticle } from '../lib/helpContent'
import { useLanguage, useT } from '../lib/i18n'
import { api, useStore } from '../store/useStore'
import { Badge } from '../components/ui'

const ICONS: Record<string, React.JSX.Element> = {
  lightbulb: <Lightbulb size={16} />,
  home: <Home size={16} />,
  repeat: <Repeat size={16} />,
  sliders: <Sliders size={16} />,
  list: <ListVideo size={16} />,
  sparkles: <Sparkles size={16} />,
  search: <Search size={16} />,
  zap: <Zap size={16} />,
  clock: <Clock size={16} />,
  terminal: <Terminal size={16} />,
  settings: <SettingsIcon size={16} />,
  help: <HelpCircle size={16} />
}

export function HelpPage(): React.JSX.Element {
  const lang = useLanguage()
  const t = useT()
  const appInfo = useStore((s) => s.appInfo)

  const articles = useMemo(() => helpArticles(lang), [lang])
  const requested = useStore((s) => s.helpSection)
  const [activeId, setActiveId] = useState<string>(
    requested ?? articles[0]?.id ?? 'concepts'
  )
  const [query, setQuery] = useState('')

  // Opening help from another page jumps straight to that page's article.
  useEffect(() => {
    if (requested) setActiveId(requested)
  }, [requested])

  /* Search matches titles, summaries and individual option names. */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return articles
    return articles.filter((article) => {
      if (article.title.toLowerCase().includes(needle)) return true
      if (article.summary.toLowerCase().includes(needle)) return true
      return (article.options ?? []).some(
        (option) =>
          option.name.toLowerCase().includes(needle) || option.text.toLowerCase().includes(needle)
      )
    })
  }, [articles, query])

  const active =
    filtered.find((a) => a.id === activeId) ?? filtered[0] ?? articles[0]

  const isCredits = activeId === 'credits'

  return (
    <div className="page-inner wide">
      <div className="page-header">
        <div>
          <div className="page-title">{t('help.title')}</div>
          <div className="page-subtitle">{t('help.subtitle')}</div>
        </div>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder={t('help.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="help-layout">
        {/* ----------------------------- index ---------------------------- */}
        <nav className="help-index">
          {filtered.map((article) => (
            <button
              key={article.id}
              className={`help-index-item${!isCredits && active?.id === article.id ? ' active' : ''}`}
              onClick={() => setActiveId(article.id)}
            >
              {ICONS[article.icon] ?? <HelpCircle size={16} />}
              <span className="truncate">{article.title}</span>
            </button>
          ))}

          <div className="divider" style={{ margin: '10px 0' }} />

          <button
            className={`help-index-item${isCredits ? ' active' : ''}`}
            onClick={() => setActiveId('credits')}
          >
            <Heart size={16} />
            <span>{t('help.credits')}</span>
          </button>
        </nav>

        {/* ---------------------------- article --------------------------- */}
        <div className="help-content">
          {isCredits ? (
            <CreditsPanel />
          ) : active ? (
            <ArticleView article={active} />
          ) : (
            <div className="empty">
              <div className="empty-title">{t('help.noResults')}</div>
              <div className="empty-text">{t('help.noResultsText')}</div>
            </div>
          )}

          {!isCredits && appInfo && (
            <div className="text-xs text-faint mt-24">
              GConverter {appInfo.version} · Electron {appInfo.electron} · {appInfo.platform}{' '}
              {appInfo.arch}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ArticleView({ article }: { article: HelpArticle }): React.JSX.Element {
  const t = useT()

  return (
    <article>
      <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
        <div className="preset-icon" style={{ flexShrink: 0 }}>
          {ICONS[article.icon] ?? <HelpCircle size={16} />}
        </div>
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 650, letterSpacing: '-0.025em' }}>
            {article.title}
          </h2>
          <p className="text-muted mt-8" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 720 }}>
            {article.summary}
          </p>
        </div>
      </div>

      {article.steps && article.steps.length > 0 && (
        <section className="mt-24">
          <div className="section-title">{t('help.howToUse')}</div>
          <ol className="help-steps">
            {article.steps.map((step, i) => (
              <li key={i}>
                <span className="help-step-num">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {article.options && article.options.length > 0 && (
        <section className="mt-24">
          <div className="section-title">{t('help.whatEachDoes')}</div>
          <div className="panel">
            {article.options.map((option, i) => (
              <div className="help-option" key={i}>
                <div className="help-option-name">{option.name}</div>
                <div className="help-option-text">{option.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {article.notes && article.notes.length > 0 && (
        <section className="mt-24">
          <div className="section-title">{t('help.goodToKnow')}</div>
          <div className="col gap-10">
            {article.notes.map((note, i) => (
              <div className="verdict verdict-mixed" key={i} style={{ padding: '12px 14px' }}>
                <Lightbulb size={16} style={{ color: 'var(--info)', flexShrink: 0, marginTop: 1 }} />
                <div className="verdict-detail" style={{ marginTop: 0 }}>
                  {note}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}

function CreditsPanel(): React.JSX.Element {
  const t = useT()
  const lang = useLanguage()
  const packages = openSource(lang)

  const open = (url: string): void => {
    void api().shell.openExternal(url)
  }

  return (
    <article>
      <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
        <div className="preset-icon" style={{ flexShrink: 0 }}>
          <Heart size={16} />
        </div>
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 650, letterSpacing: '-0.025em' }}>
            {t('help.credits')}
          </h2>
          <p className="text-muted mt-8" style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: 720 }}>
            {t('credits.intro')}
          </p>
        </div>
      </div>

      {/* ---------------------------- author ---------------------------- */}
      <section className="mt-24">
        <div className="section-title">{t('credits.author')}</div>
        <div className="card card-pad card-static">
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 620, letterSpacing: '-0.02em' }}>
                sanb-mov
              </div>
              <div className="text-sm text-muted mt-8">{t('credits.authorRole')}</div>
            </div>

            <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
              {AUTHOR_LINKS.map((link) => (
                <button
                  key={link.url}
                  className="btn btn-secondary"
                  onClick={() => open(link.url)}
                  title={link.url}
                >
                  {link.icon === 'github' ? <Code2 size={15} /> : <LinkIcon size={15} />}
                  {link.label}
                  <ExternalLink size={12} style={{ opacity: 0.55 }} />
                </button>
              ))}
            </div>
          </div>

          <div className="divider" />

          <div className="col gap-8">
            {AUTHOR_LINKS.map((link) => (
              <button
                key={link.url}
                className="row gap-8 text-xs mono"
                style={{
                  color: 'var(--accent)',
                  background: 'none',
                  padding: 0,
                  textAlign: 'left'
                }}
                onClick={() => open(link.url)}
              >
                <ExternalLink size={12} />
                <span className="selectable">{link.url}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------- open source ------------------------- */}
      <section className="mt-24">
        <div className="section-title">{t('credits.builtWith')}</div>
        <div className="panel">
          {packages.map((entry) => (
            <div className="help-option" key={entry.name}>
              <div className="row-between">
                <div className="help-option-name">{entry.name}</div>
                {entry.url && (
                  <button
                    className="btn-icon"
                    onClick={() => open(entry.url!)}
                    title={entry.url}
                    aria-label={entry.name}
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
              </div>
              <div className="help-option-text">{entry.role}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------- licence --------------------------- */}
      <section className="mt-24">
        <div className="section-title">{t('credits.licence')}</div>
        <div className="card card-pad card-static">
          <div className="row gap-8 mb-12">
            <Badge tone="accent">MIT</Badge>
            <span className="text-sm text-muted">{t('credits.mitNote')}</span>
          </div>
          <div className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
            {t('credits.ffmpegNote')}
          </div>
          <button
            className="btn btn-secondary btn-sm mt-16"
            onClick={() => open('https://ffmpeg.org/legal.html')}
          >
            <ExternalLink size={13} />
            ffmpeg.org/legal.html
          </button>
        </div>
      </section>
    </article>
  )
}
