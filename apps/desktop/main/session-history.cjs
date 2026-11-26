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

function escapeCsvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.playedAt !== 'string' || Number.isNaN(Date.parse(raw.playedAt))) return null;
  return {
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
}

function formatMarkdown(entries, dateKey) {
  const filtered = dateKey ? entries.filter(e => e.dateKey === dateKey) : entries;
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
      lines.push(`${index + 1}. \`${formatTime(item.playedAt)}\` **${who}**${topic}${media}`);
      if (item.textSnippet) lines.push(`   > ${item.textSnippet}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function formatCsv(entries, dateKey) {
  const filtered = dateKey ? entries.filter(e => e.dateKey === dateKey) : entries;
  const header = ['日期', '时间', '站点', '话题', '称呼', '正文摘要', '附图数', '信件ID'].map(escapeCsvCell).join(',');
  const rows = filtered.map(item =>
    [
      item.dateKey,
      formatTime(item.playedAt),
      item.siteLabel,
      item.topicTitle,
      item.nickname || '匿名来信',
      item.textSnippet,
      String(item.assetCount),
      item.messageId,
    ].map(escapeCsvCell).join(','),
  );
  return '\uFEFF' + [header, ...rows].join('\r\n');
}

function createSessionHistoryStore({ fs, getPath, atomicRename, crypto, onChanged, setTimeoutFn = setTimeout }) {
  let entries = [];
  let tail = Promise.resolve();
  let lastSnapshotId = '';

  async function read() {
    try {
      const parsed = JSON.parse(await fs.readFile(getPath(), 'utf8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
        entries = parsed.entries.map(sanitizeEntry).filter(Boolean).slice(0, MAX_ENTRIES);
      }
    } catch {}
    return entries;
  }

  function persist(nextEntries) {
    const op = tail.then(async () => {
      const target = getPath();
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: nextEntries }));
      await atomicRename(fs, tmp, target, setTimeoutFn);
      entries = nextEntries;
      onChanged?.([...entries]);
      return entries;
    });
    tail = op.catch(() => {});
    return op;
  }

  function record({ snapshot, siteLabel, topicTitle }) {
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
    });
    if (!entry) return Promise.resolve(entries);
    const next = [entry, ...entries].slice(0, MAX_ENTRIES);
    return persist(next);
  }

  function clear() {
    lastSnapshotId = '';
    return persist([]);
  }

  return {
    read,
    list: () => [...entries],
    record,
    clear,
    resetSessionDedupe: () => { lastSnapshotId = ''; },
    exportMarkdown: dateKey => formatMarkdown(entries, dateKey),
    exportCsv: dateKey => formatCsv(entries, dateKey),
  };
}

module.exports = { MAX_ENTRIES, formatMarkdown, formatCsv, createSessionHistoryStore };
