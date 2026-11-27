import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DesktopTheme, DesktopUiSurface } from './bridge';
import { GUIDE_CHAPTERS, type GuideChapter, type GuideJumpTarget } from './guide-data';

const CATEGORIES: Array<GuideChapter['category']> = ['日常开播', '画面与采集', '高效进阶'];

function GuideMediaPlayer({
  chapter,
  zoomed = false,
  onOpenZoom,
  onCloseZoom,
}: {
  chapter: GuideChapter;
  zoomed?: boolean;
  onOpenZoom?: () => void;
  onCloseZoom?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState<1 | 0.75 | 0.5>(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    setPaused(false);
    setProgress(0);
    setDuration(0);
    setMediaFailed(false);
    const el = videoRef.current;
    if (el) {
      el.playbackRate = rate;
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
  }, [chapter.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  const replay = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
    setPaused(false);
  };

  const cycleRate = () => {
    setRate(cur => (cur === 1 ? 0.75 : cur === 0.75 ? 0.5 : 1));
  };

  const seek = (ratio: number) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.max(0, Math.min(el.duration, ratio * el.duration));
    setProgress(ratio);
  };

  return (
    <div className={`guide-media-frame${zoomed ? ' is-zoomed' : ''}`}>
      <div className="guide-media-viewport">
        {mediaFailed ? (
          <img
            className="guide-media-visual"
            src={chapter.media.poster}
            alt={chapter.media.caption}
          />
        ) : (
          <video
            key={`${chapter.id}:${zoomed ? 'zoom' : 'inline'}`}
            ref={videoRef}
            className="guide-media-visual"
            src={chapter.media.video}
            poster={chapter.media.poster}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onClick={() => (zoomed ? togglePlay() : onOpenZoom?.())}
            onLoadedMetadata={e => {
              const v = e.currentTarget;
              v.playbackRate = rate;
              if (Number.isFinite(v.duration)) setDuration(v.duration);
            }}
            onTimeUpdate={e => {
              const v = e.currentTarget;
              if (Number.isFinite(v.duration) && v.duration > 0) {
                setProgress(v.currentTime / v.duration);
              }
            }}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onError={() => setMediaFailed(true)}
          />
        )}
        <span className="guide-hd-pill" aria-hidden="true">2K 鼠标交互演示</span>
        {!zoomed && onOpenZoom ? (
          <button
            type="button"
            className="guide-zoom-fab"
            onClick={onOpenZoom}
            title="全屏 2K 放大细看"
          >
            ⤢ 放大细看
          </button>
        ) : null}
        {zoomed && onCloseZoom ? (
          <button
            type="button"
            className="guide-zoom-fab is-close"
            onClick={onCloseZoom}
            title="退出放大 (Esc)"
          >
            ✕ 关闭放大
          </button>
        ) : null}
      </div>

      <div className="guide-media-toolbar">
        <div className="guide-media-controls">
          <button type="button" onClick={togglePlay} disabled={mediaFailed}>
            {paused ? '▶ 继续' : '❚❚ 暂停'}
          </button>
          <button type="button" onClick={replay} disabled={mediaFailed}>
            ↺ 重播
          </button>
          <button
            type="button"
            className={rate !== 1 ? 'is-active' : ''}
            onClick={cycleRate}
            disabled={mediaFailed}
            title="切换倍速以便看清鼠标点击位置"
          >
            {rate === 1 ? '1x 常速' : rate === 0.75 ? '0.75x 慢放' : '0.5x 细看'}
          </button>
        </div>
        <input
          type="range"
          className="guide-media-scrubber"
          aria-label="拖动查看演示进度"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          disabled={mediaFailed || duration <= 0}
          onChange={e => seek(Number(e.target.value) / 1000)}
        />
        <span className="guide-media-caption" title={chapter.media.caption}>
          {chapter.media.caption}
        </span>
      </div>
    </div>
  );
}

export function GuideDrawer({
  open,
  onClose,
  onJump,
  hasSite,
  theme,
  uiSurface,
  initialChapterId,
}: {
  open: boolean;
  onClose: () => void;
  onJump: (target: GuideJumpTarget) => Promise<void> | void;
  hasSite: boolean;
  theme: DesktopTheme;
  uiSurface: DesktopUiSurface;
  initialChapterId?: string;
}) {
  const [activeId, setActiveId] = useState<string>(initialChapterId || GUIDE_CHAPTERS[0].id);
  const [query, setQuery] = useState('');
  const [zoomOpen, setZoomOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && initialChapterId && GUIDE_CHAPTERS.some(c => c.id === initialChapterId)) {
      setActiveId(initialChapterId);
    }
  }, [open, initialChapterId]);

  useEffect(() => {
    if (!open) {
      setZoomOpen(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (zoomOpen) setZoomOpen(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, zoomOpen, onClose]);

  const filteredChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDE_CHAPTERS;
    return GUIDE_CHAPTERS.filter(chapter => {
      const haystack = [
        chapter.title,
        chapter.shortTitle,
        chapter.summary,
        chapter.category,
        ...chapter.keywords,
        ...chapter.steps.map(s => `${s.title} ${s.detail} ${s.badge ?? ''}`),
        ...chapter.tips,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  const activeChapter = useMemo(() => {
    const found = filteredChapters.find(c => c.id === activeId);
    return found ?? filteredChapters[0] ?? GUIDE_CHAPTERS[0];
  }, [filteredChapters, activeId]);

  const activeIndex = GUIDE_CHAPTERS.findIndex(c => c.id === activeChapter.id);
  const prevChapter = activeIndex > 0 ? GUIDE_CHAPTERS[activeIndex - 1] : null;
  const nextChapter = activeIndex >= 0 && activeIndex < GUIDE_CHAPTERS.length - 1 ? GUIDE_CHAPTERS[activeIndex + 1] : null;

  const selectChapter = (id: string) => {
    setActiveId(id);
    setZoomOpen(false);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };

  if (!open) return null;

  return createPortal(
    <div
      className="guide-overlay"
      data-theme={theme}
      data-ui-surface={uiSurface}
      role="dialog"
      aria-modal="true"
      aria-label="风铃使用指南"
      onMouseDown={e => {
        if (e.target === e.currentTarget) {
          if (zoomOpen) setZoomOpen(false);
          else onClose();
        }
      }}
    >
      <div className="guide-drawer">
        <header className="guide-drawer-header">
          <div className="guide-drawer-title">
            <span className="guide-drawer-kicker">WINDCHIME GUIDE</span>
            <h2>风铃功能使用指南</h2>
          </div>
          <div className="guide-drawer-header-right">
            <span className="guide-shortcut-hint">按 <kbd>F1</kbd> 随时唤出 · <kbd>Esc</kbd> 关闭</span>
            <button
              type="button"
              className="guide-close-btn"
              aria-label="关闭使用指南"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="guide-drawer-body">
          <aside className="guide-toc" aria-label="指南章节目录">
            <div className="guide-search-wrap">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索 OBS / 打码 / 悬浮窗 / 复盘…"
                aria-label="搜索使用指南"
              />
            </div>

            <div className="guide-toc-groups">
              {filteredChapters.length === 0 ? (
                <p className="guide-toc-empty">没有找到匹配章节，换个关键词试试～</p>
              ) : (
                CATEGORIES.map(category => {
                  const items = filteredChapters.filter(c => c.category === category);
                  if (!items.length) return null;
                  return (
                    <div key={category} className="guide-toc-group">
                      <span className="guide-toc-cat">{category}</span>
                      {items.map(chapter => {
                        const selected = chapter.id === activeChapter.id;
                        return (
                          <button
                            key={chapter.id}
                            type="button"
                            className={`guide-toc-item${selected ? ' is-active' : ''}`}
                            aria-current={selected ? 'true' : undefined}
                            onClick={() => selectChapter(chapter.id)}
                          >
                            <span className="guide-toc-num">{chapter.number}</span>
                            <span className="guide-toc-label">{chapter.shortTitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <article ref={contentRef} className="guide-content">
            <div className="guide-chapter-head">
              <span className="guide-chapter-tag">
                {`${activeChapter.category} · 第 ${activeChapter.number} / 0${GUIDE_CHAPTERS.length} 章`}
              </span>
              <h3>{activeChapter.title}</h3>
              <p>{activeChapter.summary}</p>
            </div>

            <GuideMediaPlayer
              chapter={activeChapter}
              onOpenZoom={() => setZoomOpen(true)}
            />

            <section className="guide-steps-section" aria-label="操作步骤">
              <h4>操作要点</h4>
              <ol className="guide-steps-list">
                {activeChapter.steps.map((step, index) => (
                  <li key={step.title} className="guide-step-card">
                    <span className="guide-step-index">{index + 1}</span>
                    <div className="guide-step-body">
                      <div className="guide-step-title-row">
                        <strong>{step.title}</strong>
                        {step.badge ? <span className="guide-ui-chip">{step.badge}</span> : null}
                        {step.shortcut ? <kbd className="guide-kbd">{step.shortcut}</kbd> : null}
                      </div>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {activeChapter.tips.length > 0 ? (
              <section className="guide-tips-box" aria-label="实用小贴士">
                <strong>实用小贴士</strong>
                <ul>
                  {activeChapter.tips.map(tip => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        </div>

        <footer className="guide-drawer-footer">
          <div className="guide-pager">
            <button
              type="button"
              disabled={!prevChapter}
              onClick={() => prevChapter && selectChapter(prevChapter.id)}
            >
              {prevChapter ? `← ${prevChapter.number} ${prevChapter.shortTitle}` : '← 已是第一章'}
            </button>
            <button
              type="button"
              disabled={!nextChapter}
              onClick={() => nextChapter && selectChapter(nextChapter.id)}
            >
              {nextChapter ? `${nextChapter.number} ${nextChapter.shortTitle} →` : '已是最后一章'}
            </button>
          </div>
          <div className="guide-jump-actions">
            {activeChapter.actions.map(action => (
              <button
                key={action.label}
                type="button"
                className={action.primary ? 'guide-jump-primary' : 'guide-jump-secondary'}
                disabled={!hasSite}
                title={hasSite ? undefined : '请先连接网站后再跳转到该功能'}
                onClick={() => {
                  onClose();
                  void onJump(action.target);
                }}
              >
                {`${action.label} ↗`}
              </button>
            ))}
          </div>
        </footer>
      </div>

      {zoomOpen ? (
        <div
          className="guide-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeChapter.title} 全屏演示`}
          onMouseDown={e => {
            if (e.target === e.currentTarget) setZoomOpen(false);
          }}
        >
          <div className="guide-lightbox-card">
            <div className="guide-lightbox-head">
              <strong>{`${activeChapter.number} · ${activeChapter.title}`}</strong>
              <span>点击画面可暂停 / 继续，拖动滑块可逐帧查看鼠标点击位置</span>
            </div>
            <GuideMediaPlayer
              chapter={activeChapter}
              zoomed
              onCloseZoom={() => setZoomOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
