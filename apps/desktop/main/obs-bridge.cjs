// Pure DI local loopback-only OBS Browser Source HTTP + SSE server.
// Strictly binds 127.0.0.1, rejects cross-origin/non-loopback hosts, requires persisted path capability key,
// never exposes website credentials, and bridges approved frames, test cards, overlays, scroll, and instant hide.

function createObsBridge({
  http,
  crypto,
  fs,
  path,
  buildDir,
  getInitialState,
  fetchDisplayAsset,
  getOverlayBytes,
  getOverlayPayload,
  onScrollMetrics,
  onClientCountChange,
  onStatusChange,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let server = null;
  let enabled = false;
  let port = 17420;
  let actualPort = 0;
  let key = '';
  let lastError = '';
  let cachedHtml = null;
  let cachedJs = null;
  const clients = new Set();
  let heartbeatTimer = null;

  function timingSafeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }

  function isValidLoopbackHost(hostHeader) {
    if (typeof hostHeader !== 'string') return false;
    const lower = hostHeader.trim().toLowerCase();
    return (
      lower === `127.0.0.1:${actualPort}` ||
      lower === `localhost:${actualPort}` ||
      lower === `[::1]:${actualPort}`
    );
  }

  function isAllowedOrigin(originHeader) {
    if (!originHeader) return true;
    try {
      const parsed = new URL(originHeader);
      return (
        parsed.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) &&
        Number(parsed.port || 80) === actualPort
      );
    } catch {
      return false;
    }
  }

  function securityHeaders(extra = {}) {
    return {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extra,
    };
  }

  function sendSse(res, event, data) {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }

  function broadcast(event, data) {
    for (const res of [...clients]) {
      sendSse(res, event, data);
    }
  }

  function getStatus() {
    const running = !!(server && server.listening && actualPort > 0);
    return {
      enabled,
      running,
      port: running ? actualPort : port,
      url: running && key ? `http://127.0.0.1:${actualPort}/obs/${key}` : '',
      clientCount: clients.size,
      error: lastError,
    };
  }

  function emitStatus() {
    onStatusChange?.(getStatus());
  }

  async function loadBundle() {
    if (cachedHtml === null) {
      cachedHtml = await fs.readFile(path.join(buildDir, 'obs-display.html'), 'utf8');
    }
    if (cachedJs === null) {
      cachedJs = await fs.readFile(path.join(buildDir, 'obs-display.js'), 'utf8');
    }
  }

  function closeAllClients(sendBlankFirst = true) {
    const hadClients = clients.size > 0;
    for (const res of [...clients]) {
      if (sendBlankFirst) sendSse(res, 'blank', { ts: Date.now() });
      try { res.end(); } catch {}
    }
    clients.clear();
    if (hadClients) {
      onClientCountChange?.(0);
      emitStatus();
    }
  }

  async function handleRequest(req, res) {
    try {
      if (!isValidLoopbackHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
        res.writeHead(403, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('Forbidden');
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${actualPort}`);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length < 2 || segments[0] !== 'obs' || !timingSafeEqualStr(segments[1], key)) {
        res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('Not Found');
        return;
      }

      const basePath = `/obs/${key}`;
      const subPath = segments.slice(2);

      // 1. Entry HTML page
      if (req.method === 'GET' && subPath.length === 0) {
        await loadBundle();
        const html = cachedHtml.replace('__WINDCHIME_OBS_BASE__', basePath);
        res.writeHead(200, securityHeaders({
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        }));
        res.end(html);
        return;
      }

      // 2. Bundled renderer script
      if (req.method === 'GET' && subPath.length === 1 && subPath[0] === 'app.js') {
        await loadBundle();
        res.writeHead(200, securityHeaders({ 'content-type': 'application/javascript; charset=utf-8' }));
        res.end(cachedJs);
        return;
      }

      // 3. Real-time SSE stream
      if (req.method === 'GET' && subPath.length === 1 && subPath[0] === 'events') {
        res.writeHead(200, securityHeaders({
          'content-type': 'text/event-stream; charset=utf-8',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        }));
        res.write(': connected\n\n');
        clients.add(res);
        const count = clients.size;
        onClientCountChange?.(count);
        emitStatus();

        const initial = getInitialState?.(basePath);
        if (initial?.overlay) sendSse(res, 'overlay', initial.overlay);
        if (initial?.frame) sendSse(res, 'frame', initial.frame);
        else if (initial?.testCard?.active) sendSse(res, 'test-card', initial.testCard);
        else sendSse(res, 'blank', { ts: Date.now() });

        const cleanup = () => {
          if (!clients.delete(res)) return;
          onClientCountChange?.(clients.size);
          emitStatus();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);
        return;
      }

      // 4. Proxied approved display asset (zero website credentials in browser)
      if (req.method === 'GET' && subPath.length === 2 && subPath[0] === 'assets') {
        const assetId = subPath[1];
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(assetId)) {
          res.writeHead(400, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
          res.end('Invalid asset');
          return;
        }
        const activation = parsedUrl.searchParams.get('activation') || '';
        const asset = await fetchDisplayAsset(assetId, activation);
        if (!asset || !asset.bytes || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) || asset.bytes.length > 5 * 1024 * 1024) {
          res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
          res.end('Asset unavailable');
          return;
        }
        res.writeHead(200, securityHeaders({
          'content-type': asset.mimeType,
          'content-length': String(asset.bytes.length),
        }));
        res.end(asset.bytes);
        return;
      }

      // 5. Local custom overlay image (badge / background)
      if (req.method === 'GET' && subPath.length === 2 && subPath[0] === 'overlay') {
        const slot = subPath[1];
        const bytes = getOverlayBytes?.(slot);
        if (!bytes) {
          res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
          res.end('Overlay not set');
          return;
        }
        res.writeHead(200, securityHeaders({
          'content-type': 'image/png',
          'content-length': String(bytes.length),
        }));
        res.end(bytes);
        return;
      }

      // 6. Scroll metrics feedback from OBS page to private teleprompter
      if (req.method === 'POST' && subPath.length === 1 && subPath[0] === 'scroll-metrics') {
        const chunks = [];
        let total = 0;
        let overflowed = false;
        req.on('data', chunk => {
          total += chunk.length;
          if (total > 4096) {
            overflowed = true;
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (overflowed) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            onScrollMetrics?.(payload);
            res.writeHead(204, securityHeaders());
            res.end();
          } catch {
            res.writeHead(400, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
            res.end('Invalid JSON');
          }
        });
        return;
      }

      res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
      res.end('Not Found');
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end(error?.message || 'Internal Error');
      }
    }
  }

  async function stop() {
    if (heartbeatTimer) {
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
    }
    closeAllClients(true);
    const active = server;
    server = null;
    actualPort = 0;
    if (active) {
      await new Promise(resolve => {
        try { active.close(() => resolve()); } catch { resolve(); }
      });
    }
    emitStatus();
  }

  async function start(targetPort = port) {
    await stop();
    lastError = '';
    if (!key) key = crypto.randomBytes(18).toString('base64url');
    const srv = http.createServer((req, res) => { void handleRequest(req, res); });
    try {
      await new Promise((resolve, reject) => {
        const onError = err => { srv.removeListener('listening', onListening); reject(err); };
        const onListening = () => { srv.removeListener('error', onError); resolve(); };
        srv.once('error', onError);
        srv.once('listening', onListening);
        srv.listen(targetPort, '127.0.0.1');
      });
      server = srv;
      const addr = srv.address();
      actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
      if (targetPort > 0) port = actualPort;
      heartbeatTimer = setIntervalFn(() => {
        for (const res of [...clients]) {
          if (res.writableEnded || res.destroyed) clients.delete(res);
          else {
            try { res.write(': ping\n\n'); } catch {}
          }
        }
      }, 15000);
      heartbeatTimer.unref?.();
      emitStatus();
      return getStatus();
    } catch (error) {
      try { srv.close(); } catch {}
      lastError = error?.code === 'EADDRINUSE'
        ? `本机端口 ${targetPort} 已被其他程序占用，请换一个端口重试`
        : error?.message || '无法启动本地 OBS 服务';
      emitStatus();
      throw new Error(lastError);
    }
  }

  async function configure(next = {}) {
    const nextEnabled = next.enabled !== undefined ? Boolean(next.enabled) : enabled;
    const nextPort = next.port !== undefined ? Number(next.port) : port;
    if (next.port !== undefined && (!Number.isInteger(nextPort) || (nextPort !== 0 && (nextPort < 1024 || nextPort > 65535)))) {
      throw new Error('端口号必须在 1024 到 65535 之间');
    }
    if (typeof next.key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(next.key)) {
      key = next.key;
    } else if (!key) {
      key = crypto.randomBytes(18).toString('base64url');
    }

    const portChanged = nextPort !== port && nextPort !== actualPort;
    port = nextPort;
    enabled = nextEnabled;

    if (!enabled) {
      lastError = '';
      await stop();
      return { status: getStatus(), persisted: { enabled: false, port, key } };
    }
    if (!server || !server.listening || portChanged) {
      try {
        await start(port);
      } catch (err) {
        enabled = false;
        emitStatus();
        throw err;
      }
    } else {
      emitStatus();
    }
    return { status: getStatus(), persisted: { enabled: true, port, key } };
  }

  async function resetKey() {
    key = crypto.randomBytes(18).toString('base64url');
    closeAllClients(true);
    emitStatus();
    return { status: getStatus(), persisted: { enabled, port, key } };
  }

  return {
    configure,
    resetKey,
    stop,
    getStatus,
    getKey: () => key,
    getClientCount: () => clients.size,
    pushFrame: frame => broadcast('frame', frame),
    pushBlank: () => broadcast('blank', { ts: Date.now() }),
    pushScroll: command => broadcast('scroll', command),
    pushTestCard: payload => broadcast('test-card', payload),
    pushOverlay: () => {
      if (!key || !clients.size) return;
      const payload = getOverlayPayload?.(`/obs/${key}`);
      if (payload) broadcast('overlay', payload);
    },
    disconnectAll: () => closeAllClients(true),
  };
}

module.exports = { createObsBridge };
