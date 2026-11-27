const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const {
  DEFAULT_TIMELINE_CONFIG,
  normalizeTimelineConfig,
  parseObsLogFile,
  computeObsWsAuth,
  parseBilibiliLiveTime,
  queryObsWebSocket,
  createTimelineSync,
} = require('../main/timeline-sync.cjs');

// Minimal pure-Node RFC 6455 WebSocket mock server for OBS WebSocket v5 handshake & RPC tests.
function encodeWsTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function encodeWsCloseFrame(code) {
  const buf = Buffer.alloc(4);
  buf[0] = 0x88;
  buf[1] = 2;
  buf.writeUInt16BE(code, 2);
  return buf;
}

function decodeWsClientFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let len = buffer[offset + 1] & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buffer.length) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    }
    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buffer.length) break;
    const mask = masked ? buffer.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const data = Buffer.from(buffer.subarray(pos, pos + len));
    if (mask) {
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    }
    frames.push({ opcode, text: data.toString('utf8') });
    offset = pos + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

async function startMockObsWsServer({ password = '', streamStatus, recordStatus }) {
  const salt = 'testSalt123456==';
  const challenge = 'testChallenge987654==';
  const expectedAuth = password ? computeObsWsAuth(password, salt, challenge, crypto) : null;

  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const hello = {
      op: 0,
      d: {
        obsWebSocketVersion: '5.5.0',
        rpcVersion: 1,
        ...(password ? { authentication: { salt, challenge } } : {}),
      },
    };
    socket.write(encodeWsTextFrame(JSON.stringify(hello)));

    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const parsed = decodeWsClientFrames(buf);
      buf = parsed.rest;
      for (const frame of parsed.frames) {
        if (frame.opcode === 8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 1) continue;
        const msg = JSON.parse(frame.text);
        if (msg.op === 1) {
          if (expectedAuth && msg.d?.authentication !== expectedAuth) {
            socket.write(encodeWsCloseFrame(4009));
            socket.end();
            return;
          }
          socket.write(encodeWsTextFrame(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })));
        } else if (msg.op === 6) {
          const responseData = msg.d.requestType === 'GetStreamStatus' ? streamStatus : recordStatus;
          socket.write(
            encodeWsTextFrame(
              JSON.stringify({
                op: 7,
                d: {
                  requestType: msg.d.requestType,
                  requestId: msg.d.requestId,
                  requestStatus: { result: true, code: 100 },
                  responseData,
                },
              }),
            ),
          );
        }
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

test('OBS log parser handles streaming/recording starts, stops, midnight rollover, and shutdown cleanly', () => {
  const content = [
    '23:50:00.100: OBS 31.0.0 (64-bit, windows)',
    '23:55:12.400: ==== Streaming Start ===============================================',
    '23:56:00.050: ==== Recording Start ===============================================',
    '00:12:30.250: ==== Recording Stop ================================================',
  ].join('\n');
  const parsed = parseObsLogFile('2026-11-26 23-50-00.txt', content);
  assert.equal(parsed.streamActive, true);
  assert.equal(parsed.recordActive, false);
  assert.equal(parsed.shutDown, false);
  assert.equal(new Date(parsed.streamStartedAt).getDate(), 26);
  assert.equal(new Date(parsed.streamStartedAt).getHours(), 23);
  assert.equal(new Date(parsed.streamStartedAt).getMinutes(), 55);
  assert.equal(new Date(parsed.recordStoppedAt).getDate(), 27, 'midnight rollover advances date by 1 day');
  assert.equal(new Date(parsed.recordStoppedAt).getHours(), 0);
  assert.equal(new Date(parsed.recordStoppedAt).getMinutes(), 12);

  const ended = parseObsLogFile(
    '2026-11-26 20-00-00.txt',
    '20:05:00.000: ==== Streaming Start ====\n21:00:00.000: ==== Shutting down ====',
  );
  assert.equal(ended.streamActive, false);
  assert.equal(ended.shutDown, true);
  assert(ended.streamStartedAt, 'retains last startedAt even after OBS shuts down');
});

test('Bilibili live_time parses explicitly as Beijing Time (UTC+08:00) and rejects offline sentinels', () => {
  assert.equal(parseBilibiliLiveTime('2026-11-26 20:00:05'), '2026-11-26T12:00:05.000Z');
  assert.equal(parseBilibiliLiveTime('0000-00-00 00:00:00'), null);
  assert.equal(parseBilibiliLiveTime('invalid'), null);
  assert.equal(parseBilibiliLiveTime(null), null);
});

test('OBS WebSocket v5 client authenticates with SHA-256 + Base64, reads exact durations, and reports 4009 auth errors', async () => {
  assert.equal(DEFAULT_TIMELINE_CONFIG.obsWsEnabled, true);
  assert.equal(DEFAULT_TIMELINE_CONFIG.preferTrack, 'stream');
  assert.equal(normalizeTimelineConfig(null).obsWsEnabled, true);

  const mock = await startMockObsWsServer({
    password: 'secret-obs-password',
    streamStatus: { outputActive: true, outputDuration: 120000 },
    recordStatus: { outputActive: true, outputPaused: true, outputDuration: 95000 },
  });
  try {
    const fixedNow = Date.parse('2026-11-26T12:30:00.000Z');
    const ok = await queryObsWebSocket({
      port: mock.port,
      password: 'secret-obs-password',
      WebSocketImpl: globalThis.WebSocket,
      crypto,
      nowFn: () => fixedNow,
    });
    assert.equal(ok.reachable, true);
    assert.equal(ok.authError, '');
    assert.equal(ok.streamActive, true);
    assert.equal(ok.streamDurationMs, 120000);
    assert.equal(ok.streamStartedAt, '2026-11-26T12:28:00.000Z');
    assert.equal(ok.recordActive, true);
    assert.equal(ok.recordPaused, true);
    assert.equal(ok.recordDurationMs, 95000);

    const bad = await queryObsWebSocket({
      port: mock.port,
      password: 'wrong-password',
      WebSocketImpl: globalThis.WebSocket,
      crypto,
      nowFn: () => fixedNow,
    });
    assert.equal(bad.reachable, true);
    assert(bad.authError.includes('密码'));
  } finally {
    await mock.close();
  }
});

test('createTimelineSync latches active anchor, preserves after offline, avoids Bilibili fetch when unconfigured, and encrypts WS password', async () => {
  let savedConfig = {};
  let encryptedBlob = null;
  let fetchCount = 0;
  let meta = {
    streamStartedAt: null,
    streamStartSource: null,
    streamStartLabel: '',
    streamMarkedAt: null,
    timelineOffsetSec: 0,
  };
  const nowMs = Date.parse('2026-11-26T12:30:00.000Z');
  let logText = '20:00:01.000: ==== Streaming Start ====\n20:02:00.000: ==== Recording Start ====\n';

  const fsMock = {
    readdir: async () => ['2026-11-26 19-55-00.txt'],
    stat: async file => {
      if (file.endsWith('.mkv')) return { isFile: () => true, birthtimeMs: nowMs + 60000, ctimeMs: nowMs + 60000 };
      return { isFile: () => true, size: logText.length, mtimeMs: nowMs - 1000 };
    },
    readFile: async file => {
      if (file.endsWith('timeline-secrets.v1.enc')) {
        if (!encryptedBlob) throw Object.assign(new Error(), { code: 'ENOENT' });
        return encryptedBlob;
      }
      return logText;
    },
    writeFile: async (file, data) => {
      if (file.endsWith('.tmp')) encryptedBlob = data;
    },
    rename: async () => {},
    unlink: async () => { encryptedBlob = null; },
  };

  const sync = createTimelineSync({
    fs: fsMock,
    path,
    crypto,
    fetchFn: async () => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: { room_id: 223344, live_status: 1, live_time: '2026-11-26 20:00:05', title: '风铃读信回' },
        }),
      };
    },
    WebSocketImpl: null,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: s => Buffer.from(`enc:${s}`),
      decryptString: b => b.toString().replace(/^enc:/, ''),
    },
    getObsLogsDir: () => '/virtual/obs/logs',
    getSecretsPath: () => '/virtual/timeline-secrets.v1.enc',
    getConfig: () => savedConfig,
    saveConfig: async next => { savedConfig = next; },
    getTimelineMeta: () => meta,
    applyTimelineAnchor: async (iso, { source, label }) => {
      meta = { ...meta, streamStartedAt: iso, streamStartSource: source, streamStartLabel: label };
    },
    nowFn: () => nowMs,
  });

  // 1. Default sync picks active OBS stream start and makes ZERO Bilibili requests when roomId is empty
  const s1 = await sync.syncNow();
  assert.equal(fetchCount, 0, 'must not call Bilibili API when bilibiliRoomId is empty');
  assert.equal(meta.streamStartSource, 'obs-log-stream');
  assert(s1.tracks.stream?.active && s1.tracks.record?.active);

  // 2. Going offline preserves the latched stream anchor (never wipes post-stream!)
  const latchedIso = meta.streamStartedAt;
  logText += '20:29:00.000: ==== Streaming Stop ====\n20:29:10.000: ==== Recording Stop ====\n';
  await sync.syncNow();
  assert.equal(meta.streamStartedAt, latchedIso, 'going offline must preserve latched stream anchor');

  // 3. Explicit track switch to local recording works cleanly
  await sync.syncNow({ track: 'record', forceApply: true });
  assert.equal(meta.streamStartSource, 'obs-log-record');

  // 4. Configuring Bilibili room ID + encrypted WS password works without leaking plaintext password
  const s2 = await sync.updateConfig({ bilibiliRoomId: '223344', obsWsPassword: 'my-ws-secret' });
  assert.equal(fetchCount, 1);
  assert.equal(s2.bilibili.live, true);
  assert.equal(s2.bilibili.title, '风铃读信回');
  assert.equal(s2.bilibili.startedAt, '2026-11-26T12:00:05.000Z');
  assert.equal(s2.config.hasObsWsPassword, true);
  assert(!JSON.stringify(savedConfig).includes('my-ws-secret'), 'WS password must never be saved to workspace config');
  assert(!JSON.stringify(s2).includes('my-ws-secret'), 'status payload must never leak WS password');

  // 5. Inspecting a remuxed recording file created AFTER latest letter triggers friendly warning
  const fileCheck = await sync.inspectRecordingFile('/virtual/remuxed.mkv', new Date(nowMs).toISOString());
  assert.equal(fileCheck.afterLatestEntry, true);
  assert(fileCheck.warning.includes('晚于'));

  // 6. Bilibili short_id (resolving to different canonical room_id) still obeys 30s cooldown
  await sync.updateConfig({ bilibiliRoomId: '123' });
  const afterShort = fetchCount;
  await sync.syncNow({ forceBilibili: false, forceApply: false });
  assert.equal(fetchCount, afterShort, 'short room id must not bypass 30s Bilibili cooldown');
});
