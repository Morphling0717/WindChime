// Pure DI 3-source broadcast timeline auto-sync engine for WindChime Desktop:
// 1. OBS WebSocket v5 (loopback 127.0.0.1 only, default enabled, zero third-party deps, exact encoder outputDuration)
// 2. OBS Studio local log parser (%APPDATA%/obs-studio/logs/*.txt, default enabled, zero config, handles midnight rollover)
// 3. Bilibili public read-only room API (opt-in via room ID, no login/cookies, compatible with Livehime & all platforms)
// Plus local recording file birthtimeMs inspection for universal post-stream VOD alignment.

const DEFAULT_TIMELINE_CONFIG = Object.freeze({
  obsLogEnabled: true,
  obsWsEnabled: true,
  obsWsPort: 4455,
  bilibiliRoomId: '',
  preferTrack: 'stream',
});

const MAX_OBS_LOG_BYTES = 8 * 1024 * 1024;
const OBS_LOG_STALE_MS = 18 * 60 * 60 * 1000;
const BILIBILI_COOLDOWN_MS = 30 * 1000;
const WS_PROBE_TIMEOUT_MS = 2500;
const BILIBILI_TIMEOUT_MS = 5000;

function normalizeTimelineConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const port = Number(src.obsWsPort);
  const room = typeof src.bilibiliRoomId === 'string' ? src.bilibiliRoomId.trim() : '';
  return {
    obsLogEnabled: src.obsLogEnabled !== false,
    obsWsEnabled: src.obsWsEnabled !== false,
    obsWsPort: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_TIMELINE_CONFIG.obsWsPort,
    bilibiliRoomId: /^\d{1,12}$/.test(room) ? room : '',
    preferTrack: src.preferTrack === 'record' ? 'record' : 'stream',
  };
}

function parseObsLogFile(fileName, content) {
  if (typeof fileName !== 'string' || typeof content !== 'string') return null;
  const nameMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!nameMatch) return null;
  const year = Number(nameMatch[1]);
  const month = Number(nameMatch[2]);
  const day = Number(nameMatch[3]);
  const launchH = Number(nameMatch[4]);
  const launchM = Number(nameMatch[5]);
  const launchS = Number(nameMatch[6]);
  if (![year, month, day, launchH, launchM, launchS].every(Number.isFinite)) return null;

  let dayOffset = 0;
  let prevClockMs = ((launchH * 60 + launchM) * 60 + launchS) * 1000;
  let streamActive = false;
  let streamStartedAt = null;
  let streamStoppedAt = null;
  let recordActive = false;
  let recordStartedAt = null;
  let recordStoppedAt = null;
  let shutDown = false;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3}):\s+(.*)$/);
    if (!m) continue;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ms = Number(m[4]);
    const msg = m[5];
    const clockMs = ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
    if (clockMs + 60000 < prevClockMs) {
      dayOffset += 1;
    }
    prevClockMs = clockMs;

    if (
      msg.includes('==== Streaming Start') ||
      msg.includes('==== Streaming Stop') ||
      msg.includes('==== Recording Start') ||
      msg.includes('==== Recording Stop') ||
      msg.includes('==== Shutting down') ||
      msg.startsWith('Freeing OBS context data')
    ) {
      const iso = new Date(year, month - 1, day + dayOffset, hh, mm, ss, ms).toISOString();
      if (/^====\s*Streaming Start\s*====/i.test(msg)) {
        streamActive = true;
        streamStartedAt = iso;
        streamStoppedAt = null;
      } else if (/^====\s*Streaming Stop\s*====/i.test(msg)) {
        streamActive = false;
        streamStoppedAt = iso;
      } else if (/^====\s*Recording Start\s*====/i.test(msg)) {
        recordActive = true;
        recordStartedAt = iso;
        recordStoppedAt = null;
      } else if (/^====\s*Recording Stop\s*====/i.test(msg)) {
        recordActive = false;
        recordStoppedAt = iso;
      } else if (/^====\s*Shutting down\s*====/i.test(msg) || msg.startsWith('Freeing OBS context data')) {
        shutDown = true;
        streamActive = false;
        recordActive = false;
      }
    }
  }

  return {
    fileName,
    streamActive,
    streamStartedAt,
    streamStoppedAt,
    recordActive,
    recordStartedAt,
    recordStoppedAt,
    shutDown,
  };
}

function computeObsWsAuth(password, salt, challenge, crypto) {
  const secret = crypto
    .createHash('sha256')
    .update(`${password ?? ''}${salt ?? ''}`, 'utf8')
    .digest('base64');
  return crypto
    .createHash('sha256')
    .update(`${secret}${challenge ?? ''}`, 'utf8')
    .digest('base64');
}

function parseBilibiliLiveTime(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year) || year < 2015) return null;
  // Bilibili Room/get_info live_time is always China Standard Time (UTC+08:00).
  const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function queryObsWebSocket({ port, password, WebSocketImpl, crypto, nowFn = Date.now, timeoutMs = WS_PROBE_TIMEOUT_MS }) {
  if (typeof WebSocketImpl !== 'function') {
    return Promise.resolve({ reachable: false, authError: '' });
  }
  return new Promise(resolve => {
    let settled = false;
    let ws = null;
    let streamData = null;
    let recordData = null;
    let sawHello = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close?.(1000); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ reachable: false, authError: '' }), timeoutMs);
    timer.unref?.();

    try {
      ws = new WebSocketImpl(`ws://127.0.0.1:${port}`);
    } catch {
      finish({ reachable: false, authError: '' });
      return;
    }

    const onMessage = rawEvent => {
      let msg;
      try {
        const text = typeof rawEvent === 'string' ? rawEvent : typeof rawEvent?.data === 'string' ? rawEvent.data : String(rawEvent?.data ?? '');
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.op === 0) {
        sawHello = true;
        const auth = msg.d?.authentication;
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (auth && typeof auth.salt === 'string' && typeof auth.challenge === 'string') {
          identify.authentication = computeObsWsAuth(password || '', auth.salt, auth.challenge, crypto);
        }
        try { ws.send(JSON.stringify({ op: 1, d: identify })); } catch { finish({ reachable: false, authError: '' }); }
      } else if (msg.op === 2) {
        try {
          ws.send(JSON.stringify({ op: 6, d: { requestType: 'GetStreamStatus', requestId: 'wc-stream' } }));
          ws.send(JSON.stringify({ op: 6, d: { requestType: 'GetRecordStatus', requestId: 'wc-record' } }));
        } catch {
          finish({ reachable: false, authError: '' });
        }
      } else if (msg.op === 7 && msg.d) {
        if (msg.d.requestId === 'wc-stream') streamData = msg.d.responseData || {};
        if (msg.d.requestId === 'wc-record') recordData = msg.d.responseData || {};
        if (streamData && recordData) {
          const sampleNow = nowFn();
          const streamActive = Boolean(streamData.outputActive);
          const streamDurationMs = Number.isFinite(streamData.outputDuration) && streamData.outputDuration >= 0
            ? Math.round(streamData.outputDuration)
            : 0;
          const recordActive = Boolean(recordData.outputActive);
          const recordPaused = Boolean(recordData.outputPaused);
          const recordDurationMs = Number.isFinite(recordData.outputDuration) && recordData.outputDuration >= 0
            ? Math.round(recordData.outputDuration)
            : 0;
          finish({
            reachable: true,
            authError: '',
            sampledAt: sampleNow,
            streamActive,
            streamDurationMs,
            streamStartedAt: streamActive ? new Date(sampleNow - streamDurationMs).toISOString() : null,
            recordActive,
            recordPaused,
            recordDurationMs,
            recordStartedAt: recordActive ? new Date(sampleNow - recordDurationMs).toISOString() : null,
          });
        }
      }
    };

    const onClose = ev => {
      const code = Number(ev?.code ?? 0);
      if (code === 4009) {
        finish({ reachable: true, authError: 'OBS WebSocket 密码验证失败，请检查设置中的服务器密码' });
      } else if (sawHello && code >= 4000) {
        finish({ reachable: true, authError: `OBS WebSocket 握手失败（代码 ${code}）` });
      } else {
        finish({ reachable: false, authError: '' });
      }
    };

    const onError = () => {
      finish({ reachable: false, authError: '' });
    };

    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
      ws.addEventListener('error', onError);
    } else if (typeof ws.on === 'function') {
      ws.on('message', data => onMessage({ data: Buffer.isBuffer(data) ? data.toString('utf8') : String(data) }));
      ws.on('close', code => onClose({ code }));
      ws.on('error', onError);
    }
  });
}

async function readLatestObsLog({ fs, path, getObsLogsDir, nowFn = Date.now }) {
  const dir = getObsLogsDir?.();
  if (!dir) return null;
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const candidates = names.filter(name => /^\d{4}-\d{2}-\d{2}[ _]\d{2}-\d{2}-\d{2}.*\.txt$/i.test(name));
  if (!candidates.length) return null;

  const stats = await Promise.all(
    candidates.map(async name => {
      try {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        if (!st.isFile() || st.size <= 0 || st.size > MAX_OBS_LOG_BYTES) return null;
        return { name, full, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const sorted = stats.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = sorted[0];
  if (!latest) return null;
  const isFresh = nowFn() - latest.mtimeMs <= OBS_LOG_STALE_MS;
  if (!isFresh) return null;
  try {
    const content = await fs.readFile(latest.full, 'utf8');
    return parseObsLogFile(latest.name, content);
  } catch {
    return null;
  }
}

async function queryBilibiliRoom({ roomId, fetchFn, timeoutMs = BILIBILI_TIMEOUT_MS }) {
  if (!/^\d{1,12}$/.test(roomId || '')) {
    return { configured: false, roomId: '', live: false, startedAt: null, title: '', error: '' };
  }
  if (typeof fetchFn !== 'function') {
    return { configured: true, roomId, live: false, startedAt: null, title: '', error: '网络接口暂不可用' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetchFn(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'WindChime-Desktop/1.3.0',
        },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      return { configured: true, roomId, live: false, startedAt: null, title: '', error: `B站接口请求失败（HTTP ${res.status}）` };
    }
    const json = await res.json();
    if (!json || json.code !== 0 || !json.data || typeof json.data !== 'object') {
      return {
        configured: true,
        roomId,
        live: false,
        startedAt: null,
        title: '',
        error: json?.message || json?.msg || '未找到该 B站直播间，请核对房间号',
      };
    }
    const data = json.data;
    const live = Number(data.live_status) === 1;
    const startedAt = live ? parseBilibiliLiveTime(data.live_time) : null;
    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 80) : '';
    const resolvedRoomId = data.room_id ? String(data.room_id) : roomId;
    return { configured: true, roomId: resolvedRoomId, live, startedAt, title, error: '' };
  } catch (err) {
    return {
      configured: true,
      roomId,
      live: false,
      startedAt: null,
      title: '',
      error: controller.signal.aborted ? '连接 B站直播间接口超时' : (err?.message || '无法连接 B站直播间接口'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function createTimelineSync({
  fs,
  path,
  crypto,
  fetchFn,
  WebSocketImpl,
  safeStorage,
  atomicRename,
  getObsLogsDir,
  getSecretsPath,
  getConfig,
  saveConfig,
  getTimelineMeta,
  applyTimelineAnchor,
  onStatusChange,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  nowFn = Date.now,
}) {
  let obsWsPassword = '';
  let lastBilibiliFetchAt = 0;
  let lastBilibiliQueriedRoomId = '';
  let lastBilibiliState = { configured: false, roomId: '', live: false, startedAt: null, title: '', error: '' };
  let lastWsSample = null;
  let lastObsLog = null;
  let pollTimer = null;
  let syncing = false;
  let queuedSync = null;
  let lastCheckedAt = null;

  function currentConfig() {
    return normalizeTimelineConfig(getConfig?.());
  }

  async function readSecrets() {
    const file = getSecretsPath?.();
    if (!file) return;
    try {
      const bytes = await fs.readFile(file);
      if (safeStorage?.isEncryptionAvailable?.()) {
        const parsed = JSON.parse(safeStorage.decryptString(bytes));
        if (parsed && parsed.version === 1 && typeof parsed.obsWsPassword === 'string') {
          obsWsPassword = parsed.obsWsPassword.slice(0, 256);
        }
      }
    } catch {}
  }

  async function writeSecrets(nextPassword) {
    obsWsPassword = typeof nextPassword === 'string' ? nextPassword.slice(0, 256) : '';
    const file = getSecretsPath?.();
    if (!file) return;
    if (!obsWsPassword) {
      try { await fs.unlink(file); } catch {}
      return;
    }
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('系统凭据加密暂不可用，无法保存 OBS WebSocket 密码');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, obsWsPassword }));
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, encrypted);
    if (atomicRename) await atomicRename(fs, tmp, file, setTimeoutFn);
    else await fs.rename(tmp, file);
  }

  function buildTracks() {
    const ws = lastWsSample;
    const log = lastObsLog;
    const bili = lastBilibiliState;

    let streamTrack = null;
    if (ws?.reachable && ws.streamActive && ws.streamStartedAt) {
      streamTrack = { source: 'obs-ws-stream', label: 'OBS 推流（WebSocket）', startedAt: ws.streamStartedAt, active: true };
    } else if (log?.streamActive && log.streamStartedAt) {
      streamTrack = { source: 'obs-log-stream', label: 'OBS 推流', startedAt: log.streamStartedAt, active: true };
    } else if (bili?.live && bili.startedAt) {
      streamTrack = {
        source: 'bilibili',
        label: bili.title ? `B站直播间 #${bili.roomId} · ${bili.title}` : `B站直播间 #${bili.roomId}`,
        startedAt: bili.startedAt,
        active: true,
      };
    } else if (log?.streamStartedAt) {
      streamTrack = { source: 'obs-log-stream', label: 'OBS 上次推流', startedAt: log.streamStartedAt, active: false };
    }

    let recordTrack = null;
    if (ws?.reachable && ws.recordActive && ws.recordStartedAt) {
      recordTrack = {
        source: 'obs-ws-record',
        label: ws.recordPaused ? 'OBS 本地录制（已暂停）' : 'OBS 本地录制（WebSocket）',
        startedAt: ws.recordStartedAt,
        active: true,
      };
    } else if (log?.recordActive && log.recordStartedAt) {
      recordTrack = { source: 'obs-log-record', label: 'OBS 本地录制', startedAt: log.recordStartedAt, active: true };
    } else if (log?.recordStartedAt) {
      recordTrack = { source: 'obs-log-record', label: 'OBS 上次录制', startedAt: log.recordStartedAt, active: false };
    }

    const bilibiliTrack = bili?.live && bili.startedAt
      ? {
          source: 'bilibili',
          label: bili.title ? `B站直播间 #${bili.roomId} · ${bili.title}` : `B站直播间 #${bili.roomId}`,
          startedAt: bili.startedAt,
          active: true,
        }
      : null;

    return { streamTrack, recordTrack, bilibiliTrack };
  }

  function getStatus() {
    const cfg = currentConfig();
    const meta = getTimelineMeta?.() || {
      streamStartedAt: null,
      streamStartSource: null,
      streamStartLabel: '',
      timelineOffsetSec: 0,
    };
    const { streamTrack, recordTrack, bilibiliTrack } = buildTracks();
    return {
      config: {
        ...cfg,
        hasObsWsPassword: Boolean(obsWsPassword),
      },
      anchor: {
        startedAt: meta.streamStartedAt ?? null,
        source: meta.streamStartSource ?? null,
        label: meta.streamStartLabel ?? '',
        offsetSec: Number.isFinite(meta.timelineOffsetSec) ? meta.timelineOffsetSec : 0,
      },
      obsWs: {
        enabled: cfg.obsWsEnabled,
        reachable: Boolean(lastWsSample?.reachable),
        streamActive: Boolean(lastWsSample?.streamActive),
        recordActive: Boolean(lastWsSample?.recordActive),
        recordPaused: Boolean(lastWsSample?.recordPaused),
        authError: lastWsSample?.authError || '',
      },
      obsLog: {
        enabled: cfg.obsLogEnabled,
        detected: Boolean(lastObsLog),
        streamActive: Boolean(lastObsLog?.streamActive),
        recordActive: Boolean(lastObsLog?.recordActive),
      },
      bilibili: {
        configured: Boolean(cfg.bilibiliRoomId),
        roomId: cfg.bilibiliRoomId || '',
        live: Boolean(lastBilibiliState?.live),
        startedAt: lastBilibiliState?.startedAt ?? null,
        title: lastBilibiliState?.title || '',
        error: cfg.bilibiliRoomId ? (lastBilibiliState?.error || '') : '',
      },
      tracks: {
        stream: streamTrack,
        record: recordTrack,
        bilibili: bilibiliTrack,
      },
      checkedAt: lastCheckedAt,
    };
  }

  function emitStatus() {
    onStatusChange?.(getStatus());
  }

  function getLiveEncoderOffsets() {
    const ws = lastWsSample;
    if (!ws || !ws.reachable) return {};
    const elapsed = Math.max(0, nowFn() - (ws.sampledAt || nowFn()));
    // Ignore stale samples older than 60 seconds.
    if (elapsed > 60000) return {};
    const out = {};
    if (ws.streamActive && Number.isFinite(ws.streamDurationMs)) {
      out.obsStreamMs = Math.round(ws.streamDurationMs + elapsed);
    }
    if (ws.recordActive && Number.isFinite(ws.recordDurationMs)) {
      out.obsRecordMs = Math.round(ws.recordPaused ? ws.recordDurationMs : ws.recordDurationMs + elapsed);
    }
    return out;
  }

  function pickCandidate(preferTrack) {
    const { streamTrack, recordTrack, bilibiliTrack } = buildTracks();
    if (preferTrack === 'bilibili') return bilibiliTrack;
    if (preferTrack === 'record') {
      if (recordTrack?.active) return recordTrack;
      if (streamTrack?.active) return streamTrack;
      return recordTrack || streamTrack || null;
    }
    // Default 'stream': align with broadcast start (OBS stream or Bilibili live_time), fallback to recording.
    if (streamTrack?.active) return streamTrack;
    if (recordTrack?.active) return recordTrack;
    return streamTrack || recordTrack || null;
  }

  async function maybeApplyCandidate(candidate, { forceApply = false } = {}) {
    if (!candidate || !candidate.startedAt || !applyTimelineAnchor) return;
    if (!forceApply && !candidate.active) return;

    const meta = getTimelineMeta?.() || {};
    const existingIso = meta.streamStartedAt || null;
    const existingSource = meta.streamStartSource || null;
    const existingMarkedMs = meta.streamMarkedAt ? Date.parse(meta.streamMarkedAt) : NaN;
    const candidateMs = Date.parse(candidate.startedAt);
    const existingMs = existingIso ? Date.parse(existingIso) : NaN;

    if (!forceApply && (existingSource === 'manual' || existingSource === 'file') && Number.isFinite(existingMs)) {
      // Respect explicit manual/file override for the current broadcast session unless a genuinely newer stream started after it.
      const isNewSessionAfterOverride =
        Number.isFinite(candidateMs) &&
        (!Number.isFinite(existingMarkedMs) || candidateMs > existingMarkedMs + 15000) &&
        Math.abs(candidateMs - existingMs) > 60000;
      if (!isNewSessionAfterOverride) return;
    }

    // Avoid redundant writes if the same source is already latched within 3 seconds.
    if (
      !forceApply &&
      existingSource === candidate.source &&
      Number.isFinite(existingMs) &&
      Number.isFinite(candidateMs) &&
      Math.abs(candidateMs - existingMs) < 3000 &&
      meta.streamStartLabel === candidate.label
    ) {
      return;
    }

    await applyTimelineAnchor(candidate.startedAt, {
      source: candidate.source,
      label: candidate.label,
    });
  }

  async function syncNow({ forceBilibili = false, track = null, forceApply = false } = {}) {
    if (syncing) {
      if (forceBilibili || forceApply || track) {
        if (!queuedSync) {
          let resolveFn, rejectFn;
          const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
          queuedSync = { forceBilibili: Boolean(forceBilibili), track: track || null, forceApply: Boolean(forceApply), promise, resolveFn, rejectFn };
        } else {
          queuedSync.forceBilibili = queuedSync.forceBilibili || Boolean(forceBilibili);
          queuedSync.forceApply = queuedSync.forceApply || Boolean(forceApply);
          if (track) queuedSync.track = track;
        }
        return queuedSync.promise;
      }
      return getStatus();
    }
    syncing = true;
    try {
      const cfg = currentConfig();
      const tasks = [];

      if (cfg.obsWsEnabled) {
        tasks.push(
          queryObsWebSocket({
            port: cfg.obsWsPort,
            password: obsWsPassword,
            WebSocketImpl,
            crypto,
            nowFn,
          }).then(res => {
            // While recording is paused, outputDuration freezes while wall clock keeps advancing.
            // Preserve the previous recordStartedAt anchor so the timeline does not drift forward every poll.
            if (
              res?.reachable &&
              res.recordActive &&
              res.recordPaused &&
              lastWsSample?.recordActive &&
              lastWsSample.recordStartedAt
            ) {
              res.recordStartedAt = lastWsSample.recordStartedAt;
            }
            lastWsSample = res;
          }),
        );
      } else {
        lastWsSample = null;
      }

      if (cfg.obsLogEnabled) {
        tasks.push(
          readLatestObsLog({ fs, path, getObsLogsDir, nowFn }).then(res => { lastObsLog = res; }),
        );
      } else {
        lastObsLog = null;
      }

      if (cfg.bilibiliRoomId) {
        const now = nowFn();
        const roomChanged = lastBilibiliQueriedRoomId !== cfg.bilibiliRoomId;
        if (forceBilibili || roomChanged || now - lastBilibiliFetchAt >= BILIBILI_COOLDOWN_MS) {
          lastBilibiliFetchAt = now;
          lastBilibiliQueriedRoomId = cfg.bilibiliRoomId;
          tasks.push(
            queryBilibiliRoom({ roomId: cfg.bilibiliRoomId, fetchFn }).then(res => { lastBilibiliState = res; }),
          );
        }
      } else {
        lastBilibiliQueriedRoomId = '';
        lastBilibiliState = { configured: false, roomId: '', live: false, startedAt: null, title: '', error: '' };
      }

      await Promise.allSettled(tasks);
      lastCheckedAt = new Date(nowFn()).toISOString();

      const chosen = pickCandidate(track || cfg.preferTrack);
      await maybeApplyCandidate(chosen, { forceApply });
      const status = getStatus();
      emitStatus();
      return status;
    } finally {
      syncing = false;
      if (queuedSync) {
        const next = queuedSync;
        queuedSync = null;
        void syncNow({
          forceBilibili: next.forceBilibili,
          track: next.track,
          forceApply: next.forceApply,
        }).then(next.resolveFn, next.rejectFn);
      }
    }
  }

  async function updateConfig(patch = {}) {
    if (!patch || typeof patch !== 'object') throw new Error('无效时间轴同步配置');
    const prev = currentConfig();
    const next = { ...prev };
    if ('obsLogEnabled' in patch) {
      if (typeof patch.obsLogEnabled !== 'boolean') throw new Error('无效 OBS 日志开关');
      next.obsLogEnabled = patch.obsLogEnabled;
    }
    if ('obsWsEnabled' in patch) {
      if (typeof patch.obsWsEnabled !== 'boolean') throw new Error('无效 OBS WebSocket 开关');
      next.obsWsEnabled = patch.obsWsEnabled;
    }
    if ('obsWsPort' in patch) {
      const p = Number(patch.obsWsPort);
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('OBS WebSocket 端口必须在 1024 到 65535 之间');
      next.obsWsPort = p;
    }
    if ('bilibiliRoomId' in patch) {
      const room = typeof patch.bilibiliRoomId === 'string' ? patch.bilibiliRoomId.trim() : '';
      if (room && !/^\d{1,12}$/.test(room)) throw new Error('B站直播间号仅支持纯数字（1～12 位）');
      next.bilibiliRoomId = room;
    }
    if ('preferTrack' in patch) {
      if (patch.preferTrack !== 'stream' && patch.preferTrack !== 'record') throw new Error('无效默认对齐轨道');
      next.preferTrack = patch.preferTrack;
    }
    if ('obsWsPassword' in patch && typeof patch.obsWsPassword === 'string') {
      await writeSecrets(patch.obsWsPassword);
    } else if (patch.clearObsWsPassword === true) {
      await writeSecrets('');
    }
    await saveConfig?.(next);
    return syncNow({ forceBilibili: Boolean(next.bilibiliRoomId), forceApply: false });
  }

  async function inspectRecordingFile(filePath, latestEntryIso = null) {
    if (typeof filePath !== 'string' || !filePath) throw new Error('无效录播文件路径');
    const st = await fs.stat(filePath);
    if (!st.isFile()) throw new Error('请选择有效的录播视频文件');
    const createdMs = Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
    if (!Number.isFinite(createdMs) || createdMs <= 0) throw new Error('无法读取该视频文件的创建时间');
    const startedAt = new Date(createdMs).toISOString();
    const baseName = path.basename(filePath).slice(0, 48);
    const latestMs = latestEntryIso ? Date.parse(latestEntryIso) : NaN;
    const afterLatestEntry = Number.isFinite(latestMs) && createdMs > latestMs + 5000;
    return {
      startedAt,
      fileName: baseName,
      afterLatestEntry,
      warning: afterLatestEntry
        ? '该文件创建时间晚于本场读信记录（可能是转封装或导出后的副本），若时间轴不准请改选原始录制文件或微调时间。'
        : '',
    };
  }

  function startPolling(intervalMs = 15000) {
    stopPolling();
    pollTimer = setIntervalFn(() => {
      void syncNow({ forceBilibili: false, forceApply: false }).catch(() => {});
    }, intervalMs);
    pollTimer?.unref?.();
  }

  function stopPolling() {
    if (pollTimer) {
      clearIntervalFn(pollTimer);
      pollTimer = null;
    }
  }

  return {
    readSecrets,
    getStatus,
    syncNow,
    updateConfig,
    getLiveEncoderOffsets,
    inspectRecordingFile,
    startPolling,
    stopPolling,
    notifyExternalChange: emitStatus,
  };
}

module.exports = {
  DEFAULT_TIMELINE_CONFIG,
  normalizeTimelineConfig,
  parseObsLogFile,
  computeObsWsAuth,
  parseBilibiliLiveTime,
  queryObsWebSocket,
  readLatestObsLog,
  queryBilibiliRoom,
  createTimelineSync,
};
