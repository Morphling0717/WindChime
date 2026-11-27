// Pure DI local broadcast session history store (bounded ring buffer, privacy-safe snippets, Markdown/CSV export).

const MAX_ENTRIES = 500;

function formatDateKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知日期';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

const VALID_START_SOURCES = new Set([
  'manual',
  'obs-ws-stream',
  'obs-ws-record',
  'obs-log-stream',
  'obs-log-record',
  'bilibili',
  'file',
]);

function formatSecondsClock(totalSec) {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSec) ? totalSec : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map(n => String(n).padStart(2, '0')).join(':');
}

function formatRelativeOffset(playedAtIso, anchorIso, offsetSec = 0) {
  const playedMs = Date.parse(playedAtIso);
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(playedMs) || !Number.isFinite(anchorMs)) return '';
  const shift = Number.isFinite(offsetSec) ? Math.round(offsetSec) : 0;
  const diffSec = Math.max(0, Math.floor((playedMs - anchorMs) / 1000) + shift);
  return formatSecondsClock(diffSec);
}

function entryHasDirectEncoderOffset(item, streamStartSource) {
  if (streamStartSource === 'obs-ws-record' && Number.isFinite(item.obsRecordMs) && item.obsRecordMs >= 0) {
    return true;
  }
  if (streamStartSource === 'obs-ws-stream' && Number.isFinite(item.obsStreamMs) && item.obsStreamMs >= 0) {
    return true;
  }
  return false;
}

function resolveEntryOffset(item, anchorIso, { streamStartSource = null, timelineOffsetSec = 0 } = {}) {
  const shift = Number.isFinite(timelineOffsetSec) ? Math.round(timelineOffsetSec) : 0;
  if (streamStartSource === 'obs-ws-record' && Number.isFinite(item.obsRecordMs) && item.obsRecordMs >= 0) {
    return formatSecondsClock(Math.floor(item.obsRecordMs / 1000) + shift);
  }
  if (streamStartSource === 'obs-ws-stream' && Number.isFinite(item.obsStreamMs) && item.obsStreamMs >= 0) {
    return formatSecondsClock(Math.floor(item.obsStreamMs / 1000) + shift);
  }
  return formatRelativeOffset(item.playedAt, anchorIso, shift);
}

function normalizeOffsetSec(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(Math.min(7200, Math.max(-7200, num)));
}

function normalizeIsoTimestamp(value) {
  if (value === null || value === '' || value === undefined) return null;
  if (value === 'now') return new Date().toISOString();
  if (typeof value !== 'string') throw new Error('无效开播时间格式');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('无效开播时间格式');
  return new Date(ms).toISOString();
}

function formatBilibiliChapters(entries, { streamStartedAt = null, streamStartSource = null, timelineOffsetSec = 0, dateKey } = {}) {
  const validStart = streamStartedAt && Number.isFinite(Date.parse(streamStartedAt)) ? streamStartedAt : null;
  const startMs = validStart ? Date.parse(validStart) : null;
  const offsetSec = normalizeOffsetSec(timelineOffsetSec);
  let scoped;
  if (dateKey) {
    scoped = entries.filter(e => e.dateKey === dateKey);
  } else if (startMs !== null) {
    const startDay = formatDateKey(validStart);
    const matching = entries.filter(e => {
      const playedMs = Date.parse(e.playedAt);
      if (playedMs >= startMs) return true;
      return entryHasDirectEncoderOffset(e, streamStartSource) && Math.abs(playedMs - startMs) <= 24 * 3600 * 1000;
    });
    if (matching.length) {
      scoped = matching;
    } else {
      scoped = entries.filter(e => e.dateKey === startDay);
    }
  } else {
    const latestDay = entries[0]?.dateKey;
    scoped = latestDay ? entries.filter(e => e.dateKey === latestDay) : [];
  }
  const sorted = [...scoped].sort((a, b) => Date.parse(a.playedAt) - Date.parse(b.playedAt));
  if (!sorted.length) return '';
  const anchor = validStart ?? sorted[0].playedAt;
  const lines = [];
  const firstOffset = resolveEntryOffset(sorted[0], anchor, { streamStartSource, timelineOffsetSec: offsetSec });
  if (validStart && firstOffset && firstOffset !== '00:00:00') {
    lines.push('00:00:00 开场 / 读信开始');
  }
  for (const item of sorted) {
    const ts = resolveEntryOffset(item, anchor, { streamStartSource, timelineOffsetSec: offsetSec }) || '00:00:00';
    const who = item.nickname || '匿名来信';
    const rawSnippet = (item.textSnippet || '').replace(/[\r\n]+/g, ' ').trim();
    const shortSnippet = rawSnippet.length > 26 ? `${rawSnippet.slice(0, 26)}…` : rawSnippet;
    const label = shortSnippet ? `${who} - ${shortSnippet}` : who;
    lines.push(`${ts} ${label}`);
  }
  return lines.join('\n');
}

function escapeCsvCell(value) {
  const raw = String(value ?? '');
  const safe = /^\s*[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.playedAt !== 'string' || Number.isNaN(Date.parse(raw.playedAt))) return null;
  const out = {
    id: typeof raw.id === 'string' && raw.id.length <= 128 ? raw.id : `${Date.parse(raw.playedAt)}`,
    snapshotId: typeof raw.snapshotId === 'string' ? raw.snapshotId.slice(0, 128) : '',
    messageId: typeof raw.messageId === 'string' ? raw.messageId.slice(0, 128) : '',
    playedAt: raw.playedAt,
    dateKey: formatDateKey(raw.playedAt),
    siteLabel: typeof raw.siteLabel === 'string' ? raw.siteLabel.slice(0, 80) : '',
    topicTitle: typeof raw.topicTitle === 'string' ? raw.topicTitle.slice(0, 80) : '',
    nickname: typeof raw.nickname === 'string' && raw.nickname.trim() ? raw.nickname.trim().slice(0, 40) : null,
    textSnippet: typeof raw.textSnippet === 'string' ? raw.textSnippet.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
    assetCount: Number.isInteger(raw.assetCount) && raw.assetCount >= 0 ? Math.min(20, raw.assetCount) : 0,
  };
  if (Number.isFinite(raw.obsStreamMs) && raw.obsStreamMs >= 0 && raw.obsStreamMs < 48 * 3600 * 1000) {
    out.obsStreamMs = Math.round(raw.obsStreamMs);
  }
  if (Number.isFinite(raw.obsRecordMs) && raw.obsRecordMs >= 0 && raw.obsRecordMs < 48 * 3600 * 1000) {
    out.obsRecordMs = Math.round(raw.obsRecordMs);
  }
  return out;
}

function formatMarkdown(entries, dateKey, { streamStartedAt = null, streamStartSource = null, timelineOffsetSec = 0 } = {}) {
  const filtered = dateKey ? entries.filter(e => e.dateKey === dateKey) : entries;
  const validStart = streamStartedAt && Number.isFinite(Date.parse(streamStartedAt)) ? streamStartedAt : null;
  const offsetSec = normalizeOffsetSec(timelineOffsetSec);
  const heading = dateKey ? `# 风铃直播读信复盘 · ${dateKey}` : '# 风铃直播读信复盘清单';
  const lines = [heading, '', `共记录 **${filtered.length}** 封上屏来信。`, ''];
  const groups = new Map();
  for (const item of filtered) {
    const list = groups.get(item.dateKey) || [];
    list.push(item);
    groups.set(item.dateKey, list);
  }
  for (const [day, items] of groups) {
    lines.push(`## ${day}（${items.length} 封）`, '');
    items.forEach((item, index) => {
      const who = item.nickname || '匿名来信';
      const topic = item.topicTitle ? ` · ${item.topicTitle}` : '';
      const media = item.assetCount > 0 ? ` · 含 ${item.assetCount} 张图` : '';
      const offset = validStart && (Date.parse(item.playedAt) >= Date.parse(validStart) || entryHasDirectEncoderOffset(item, streamStartSource))
        ? ` [${resolveEntryOffset(item, validStart, { streamStartSource, timelineOffsetSec: offsetSec })}]`
        : '';
      lines.push(`${index + 1}. \`${formatTime(item.playedAt)}\`${offset} **${who}**${topic}${media}`);
      if (item.textSnippet) lines.push(`   > ${item.textSnippet}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function formatCsv(entries, dateKey, { streamStartedAt = null, streamStartSource = null, timelineOffsetSec = 0 } = {}) {
  const filtered = dateKey ? entries.filter(e => e.dateKey === dateKey) : entries;
  const validStart = streamStartedAt && Number.isFinite(Date.parse(streamStartedAt)) ? streamStartedAt : null;
  const offsetSec = normalizeOffsetSec(timelineOffsetSec);
  const headerCols = validStart
    ? ['日期', '时间', '录播时间轴', '站点', '话题', '称呼', '正文摘要', '附图数', '信件ID']
    : ['日期', '时间', '站点', '话题', '称呼', '正文摘要', '附图数', '信件ID'];
  const header = headerCols.map(escapeCsvCell).join(',');
  const rows = filtered.map(item => {
    const base = [
      item.dateKey,
      formatTime(item.playedAt),
      ...(validStart
        ? [(Date.parse(item.playedAt) >= Date.parse(validStart) || entryHasDirectEncoderOffset(item, streamStartSource))
          ? resolveEntryOffset(item, validStart, { streamStartSource, timelineOffsetSec: offsetSec })
          : '']
        : []),
      item.siteLabel,
      item.topicTitle,
      item.nickname || '匿名来信',
      item.textSnippet,
      String(item.assetCount),
      item.messageId,
    ];
    return base.map(escapeCsvCell).join(',');
  });
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

function createSessionHistoryStore({ fs, getPath, atomicRename, crypto, onChanged, onStreamStartChanged, setTimeoutFn = setTimeout }) {
  let entries = [];
  let streamStartedAt = null;
  let streamStartSource = null;
  let streamStartLabel = '';
  let streamMarkedAt = null;
  let timelineOffsetSec = 0;
  let tail = Promise.resolve();
  let lastSnapshotId = '';

  async function read() {
    try {
      const parsed = JSON.parse(await fs.readFile(getPath(), 'utf8'));
      if (parsed && parsed.version === 1) {
        if (Array.isArray(parsed.entries)) {
          entries = parsed.entries.map(sanitizeEntry).filter(Boolean).slice(0, MAX_ENTRIES);
        }
        if (typeof parsed.streamStartedAt === 'string' && Number.isFinite(Date.parse(parsed.streamStartedAt))) {
          streamStartedAt = new Date(Date.parse(parsed.streamStartedAt)).toISOString();
          streamStartSource = VALID_START_SOURCES.has(parsed.streamStartSource) ? parsed.streamStartSource : 'manual';
          streamStartLabel = typeof parsed.streamStartLabel === 'string' ? parsed.streamStartLabel.slice(0, 80) : '';
          streamMarkedAt =
            typeof parsed.streamMarkedAt === 'string' && Number.isFinite(Date.parse(parsed.streamMarkedAt))
              ? new Date(Date.parse(parsed.streamMarkedAt)).toISOString()
              : null;
        } else {
          streamStartedAt = null;
          streamStartSource = null;
          streamStartLabel = '';
          streamMarkedAt = null;
        }
        timelineOffsetSec = normalizeOffsetSec(parsed.timelineOffsetSec);
      }
    } catch {}
    return entries;
  }

  function persistMutation(mutator) {
    const op = tail.then(async () => {
      const patch = mutator({
        entries,
        streamStartedAt,
        streamStartSource,
        streamStartLabel,
        streamMarkedAt,
        timelineOffsetSec,
      });
      const nextEntries = 'entries' in patch ? patch.entries : entries;
      const nextStartedAt = 'streamStartedAt' in patch ? patch.streamStartedAt : streamStartedAt;
      const nextSource = 'streamStartSource' in patch ? patch.streamStartSource : streamStartSource;
      const nextLabel = 'streamStartLabel' in patch ? patch.streamStartLabel : streamStartLabel;
      const nextMarkedAt = 'streamMarkedAt' in patch ? patch.streamMarkedAt : streamMarkedAt;
      const nextOffset = 'timelineOffsetSec' in patch ? normalizeOffsetSec(patch.timelineOffsetSec) : timelineOffsetSec;

      const target = getPath();
      const tmp = `${target}.tmp`;
      const payload = {
        version: 1,
        ...(nextStartedAt ? {
          streamStartedAt: nextStartedAt,
          ...(nextSource ? { streamStartSource: nextSource } : {}),
          ...(nextLabel ? { streamStartLabel: nextLabel } : {}),
          ...(nextMarkedAt ? { streamMarkedAt: nextMarkedAt } : {}),
        } : {}),
        ...(nextOffset !== 0 ? { timelineOffsetSec: nextOffset } : {}),
        entries: nextEntries,
      };
      await fs.writeFile(tmp, JSON.stringify(payload));
      await atomicRename(fs, tmp, target, setTimeoutFn);
      const startChanged =
        nextStartedAt !== streamStartedAt ||
        nextSource !== streamStartSource ||
        nextLabel !== streamStartLabel ||
        nextOffset !== timelineOffsetSec;
      entries = nextEntries;
      streamStartedAt = nextStartedAt;
      streamStartSource = nextStartedAt ? nextSource : null;
      streamStartLabel = nextStartedAt ? nextLabel : '';
      streamMarkedAt = nextStartedAt ? nextMarkedAt : null;
      timelineOffsetSec = nextOffset;
      onChanged?.([...entries]);
      if (startChanged) onStreamStartChanged?.(streamStartedAt);
      return entries;
    });
    tail = op.catch(() => {});
    return op;
  }

  function record({ snapshot, siteLabel, topicTitle, obsStreamMs, obsRecordMs }) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.id) return Promise.resolve(entries);
    if (snapshot.id === lastSnapshotId) return Promise.resolve(entries);
    lastSnapshotId = snapshot.id;
    const nowIso = new Date().toISOString();
    const entry = sanitizeEntry({
      id: crypto.randomUUID(),
      snapshotId: snapshot.id,
      messageId: snapshot.messageId || '',
      playedAt: nowIso,
      siteLabel: siteLabel || '',
      topicTitle: topicTitle || '',
      nickname: snapshot.nickname || null,
      textSnippet: snapshot.text || '',
      assetCount: Array.isArray(snapshot.assets) ? snapshot.assets.length : 0,
      obsStreamMs,
      obsRecordMs,
    });
    if (!entry) return Promise.resolve(entries);
    return persistMutation(cur => ({
      entries: [entry, ...cur.entries].slice(0, MAX_ENTRIES),
    }));
  }

  async function setStreamStartedAt(value, meta = {}) {
    const normalized = normalizeIsoTimestamp(value);
    const source = normalized
      ? (VALID_START_SOURCES.has(meta?.source) ? meta.source : 'manual')
      : null;
    const label = normalized
      ? (typeof meta?.label === 'string' && meta.label.trim() ? meta.label.trim().slice(0, 80) : source === 'manual' ? '手动标记' : '')
      : '';
    const markedAt = normalized && (source === 'manual' || source === 'file') ? new Date().toISOString() : null;
    await persistMutation(() => ({
      streamStartedAt: normalized,
      streamStartSource: source,
      streamStartLabel: label,
      streamMarkedAt: markedAt,
    }));
    return streamStartedAt;
  }

  async function setTimelineOffsetSec(sec) {
    const normalized = normalizeOffsetSec(sec);
    await persistMutation(() => ({ timelineOffsetSec: normalized }));
    return timelineOffsetSec;
  }

  function clear() {
    lastSnapshotId = '';
    return persistMutation(() => ({ entries: [] }));
  }

  return {
    read,
    list: () => [...entries],
    getStreamStartedAt: () => streamStartedAt,
    getTimelineMeta: () => ({
      streamStartedAt,
      streamStartSource,
      streamStartLabel,
      streamMarkedAt,
      timelineOffsetSec,
    }),
    setStreamStartedAt,
    setTimelineOffsetSec,
    record,
    clear,
    resetSessionDedupe: () => { lastSnapshotId = ''; },
    exportMarkdown: dateKey => formatMarkdown(entries, dateKey, { streamStartedAt, streamStartSource, timelineOffsetSec }),
    exportCsv: dateKey => formatCsv(entries, dateKey, { streamStartedAt, streamStartSource, timelineOffsetSec }),
    exportChapters: dateKey => formatBilibiliChapters(entries, { streamStartedAt, streamStartSource, timelineOffsetSec, dateKey }),
  };
}

module.exports = {
  MAX_ENTRIES,
  formatSecondsClock,
  formatRelativeOffset,
  resolveEntryOffset,
  formatBilibiliChapters,
  formatMarkdown,
  formatCsv,
  createSessionHistoryStore,
};
