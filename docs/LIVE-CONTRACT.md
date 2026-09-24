# Live API v1 (implementation contract)

Mount `createWindChimeLiveRouteHandlers({service, authorizeAdmin, hasAdminAccess?, mediaDirectory?, allowedOrigins?, gatewayPublicKeys?, gatewayIssuer?})` at `/api/mail/live/[...path]` and `/api/mail/live`. Node runtime, one persistent server process, private persistent media directory. Every JSON response has `Cache-Control: no-store`. Errors use `{error,code}`. `service.broadcast` owns all rules. Ordinary consumers need no live configuration or sharp import.

Export **GET, POST, PUT, PATCH, DELETE, OPTIONS** from the Next.js route module. Omitting PUT/PATCH makes ordinary management and the keyword switch return framework-level 405 responses even when the shared handlers support them.

Control requests use the host's existing admin cookie OR `Authorization: Bearer wc_ctl_...`. Display requests ONLY accept `Bearer wc_disp_...` and never elevate from cookies. In 0.7.0 control grants have explicit `scope:site|topic`; site control has `topicId:null`, while every display and legacy control grant binds one topic. Caller parameters cannot elevate scope. Host cookie writes require a matching Origin when Origin is present; explicit cross-site origins require allowlisting. Desktop main-process requests can omit Origin.

Package 0.7.0 keeps `wc_conn_v1` encoding and the control-Bearer-only identity endpoint. Identity additionally returns `scope`; site identity has both `topicId` and `topicTitle` null. Capabilities adds `siteControl`, `mailManagement`, `keywordFilterToggle`. The 0.7.0 migration keeps old grants topic-scoped with original IDs, hashes, expiries and parent relationships. Both host and desktop must be upgraded to use site keys.

## Full mailbox management (0.7.0)

All routes below remain under `/control`, use the existing mailbox service, and return `no-store`. Site control can choose any topic in the same database; topic control only its own. Global settings, sender blocking, blocklist, word-list writes and topic lifecycle management require site control (or the original website administrator, except the keyword toggle).

| Resource | Methods / behavior |
| --- | --- |
| `/topics`, `/topics/:id` | GET list/detail, POST create, PATCH update, DELETE archive with `{markReadFirst}`; `include=archived` includes archived items |
| `/topics/:id/purge` | DELETE permanently removes one archived non-default topic; does not delete site grants |
| `/messages?topicId=...&filter=...` | GET ordinary inbox or flagged filter; includes counts and `blockedTermsEnabled` |
| `/messages/:id?topicId=...` | GET original, PATCH read/favorite/legacy flag, DELETE soft-delete |
| `/messages/batch?topicId=...` | POST `{action:delete|markRead,ids}` in one service transaction |
| `/messages/:id/block?topicId=...` | POST site-wide sender block, unavailable to topic keys |
| `/settings` | GET site settings; PUT `{enabled}` controls the default mailbox; PATCH `{blockedTermsEnabled}` accepts only site Bearer, never website cookies |
| `/blocked-terms`, `/blocklist` | GET/PUT word list, GET blocklist, DELETE `/blocklist/:hash` unblocks |
| `/share?topicId=...` | GET `{siteName,origin,topicId,topicTitle,submissionUrl,posterDefaults}` from trusted host configuration |
| `/grants` | Website admin POST `{kind:control,scope:site,label}` creates a 30-day site key. Desktop can list/revoke grants and issue topic-only display grants, but cannot create control keys or approve pairing |

The keyword switch is absent/false by default even when a word list exists. Disabled list responses include historical flagged originals and normal unread/favorite counts; flags remain stored but flagged classification is hidden. Re-enabling affects only future submissions, with no rescan. The switch never changes broadcast approval. `useWindChimeSubmission` and the optional Sender accept `blockedTermsEnabled` to opt into client-side hints using the same public settings value.

## Endpoints

- `GET /capabilities` → `{protocolVersion:1,siteId,basePath,features:{images:boolean,pairing:true,broadcast:true,connectionKeys:true,siteControl:true,mailManagement:true,keywordFilterToggle:true},pollIntervalMs:1000,leaseMs:3000}`. siteId is a persistent random database identity. `connectionKeys` is absent on 0.6.0 hosts; clients must check it before importing a connection key.
- `GET /control/identity` requires exactly `Authorization: Bearer wc_ctl_...`. It never accepts an admin cookie, a display token, a query parameter or a caller-selected topic. Returns `{siteId,scope,topicId,topicTitle,label,expiresAt,grantId}` from the grant's actual scope, without a token or inbox content. `CONNECTION_KEY_INVALID`, `CONNECTION_KEY_EXPIRED` and `CONNECTION_KEY_REVOKED` are HTTP 401; any query returns `INVALID_QUERY` 400 after valid Bearer syntax, and non-GET requests return 405.
- `GET /control/state?topicId=default` → `WindChimeLiveControlState` from `/core`: `{topicId,revision,epoch,messages,queue,current,appearance,receivers}`. messages contain private source + editable draft + review status. queue is ordered message IDs. current is null or `{messageId,snapshotId}`. receivers is the online count. No read/favorite/flagged value grants broadcast approval.
- `POST /control/action` → updated control state. Body `{topicId,action,messageId?,expectedRevision,expectedDraftRevision?,operationId,draft?,order?,appearance?}`. Actions: `draft`, `approve`, `reject`, `revoke`, `show`, `next`, `hide`, `end`, `reorder`, `appearance`. operationId is an arbitrary unique 8–128 character command identifier. `hide`/`end`/`revoke`/`reject` supersede stale control revisions; other actions reject stale revisions with 409 `REVISION_CONFLICT`. Draft/approval also require `expectedDraftRevision`. Draft is `{text,nickname,linkUrl,assets:[{id,caption}]}`. Approval only queues. show requires an online receiver; no receiver → 409 `DISPLAY_NOT_READY`. Queue retains ALL approved messages in their full order after showing/closing. `next` advances after lastShown without looping; exhaustion blanks. Hide retains the private cursor; end/restart resets cursor but preserves approvals/order.
- `POST /control/message` body `{topicId,messageId,isRead?,isFavorited?}` delegates existing scoped message mutations and returns updated control state. These flags do not affect approval.
- `POST /control/grants` body `{topicId,kind:"display",label?}` → `{id,token,expiresAt,topicId,kind}`. Host admins can also create `kind:"control"`. Tokens expire after 30 days; store only hashes server-side. A display grant issued by a desktop control grant also requires that parent grant to remain valid; revoking the parent atomically revokes its display grants. Independent host-created display grants are separate. `GET /control/grants?topicId` lists metadata only. `DELETE /control/grants/:id?topicId` revokes immediately.
- `POST /devices/request` body `{deviceName,challenge}` where challenge is base64url SHA-256 of a PKCE verifier → `{deviceCode,userCode,expiresAt,interval:2}` (10 minute lifetime).
- `POST /devices/approve` host admin only, body `{userCode,topicId}` → `{ok:true}`.
- `POST /devices/poll` body `{deviceCode,verifier}` → `{status:"pending"}` or `{status:"approved",token,topicId,expiresAt}`. Approved token can be redeemed once; consumed/expired → 410. Poll cannot select scope.
- `POST /upload` public multipart fields: `topicId` (ID or slug), optional `turnstileToken`, repeated `file` (1–3 static JPEG/PNG/WebP). → `{attachments:[{id,receipt,mimeType,width,height,size,sha256}]}` (one file also returns these fields at top level). At most 5 MiB input/16 MP per file. Challenge is verified once for the batch. Fan submits up to 3 `{id,receipt}` as `attachments` in existing `POST /api/mail/messages`; receipts are one-use, topic-bound, 24 hours. Valid receipts replace re-verification of the spent Turnstile token. Uploads are private and normalized. Default quota: 200 MiB/topic/day, 2 GiB/topic total; 10 upload batches/IP/minute, two simultaneous decoders. Raw links never fetch remote content.
- `GET /control/assets/:id?topicId` → private normalized image for review.
- `POST /control/upload` authenticated multipart `{topicId,messageId,file}` (repeated file 1–3) → `{attachments:[{id,caption:"",mimeType,width,height,size,sha256}]}` (single file also top-level). No anonymous receipt is issued. Moderator assets belong to exactly this message and topic, remain private, and do not rewrite the original fan source. Add them to an edited draft, save (invalidates approval), preview and approve again. Another message cannot reference them.
- `POST /display/open` (display bearer, empty JSON) → `{receiverId,epoch,leaseMs:3000,pollIntervalMs:1000}`. Always joins blank. Opening does not replay current content.
- `GET /display/frame?receiverId=...` → `WindChimeLiveFrame`: `{receiverId,epoch,revision,activation,leaseMs:3000,appearance,snapshot:null|{id,messageId,text,nickname,linkUrl,assets:[{id,caption,mimeType,width,height,sha256}]}}`. Only activation newer than receiver join can deliver content. First frame blank; show after open delivers. Missing/expired receivers return 409 `RECEIVER_EXPIRED`; reconnect with open and stay blank until another manual show.
- `GET /display/assets/:id?receiverId=...&activation=...` → bytes only when the asset is in that receiver's currently approved active snapshot. Revocation/hide/switch stops all old asset access. Use fetch bearer → Blob, not public URLs.

Rendering must immediately blank on explicit errors and within 3 seconds of a lost lease; never accept stale epoch/receiver/revision or delayed image decode. Start/refresh/reconnect blank. Clear on sleep/page restore. Preview is a separate control-auth surface. Outbound HTTP/link previews and remote image loading are absent from display.

Appearance is the `/core` `WindChimeLiveAppearance` type: safe font name, fontSize12–96, hex colors, transparent, layout card/letter/minimal, imageLayout row/column/grid (default column), animation none/fade/slide, padding/borderRadius0–100. No arbitrary CSS, HTML or remote URLs are accepted by configuration. Developers may provide their own renderer with only the filtered snapshot contract.

## Reusable connection keys (0.6.1 encoding, 0.7.0 scope)

`@windchime/embed/core` exports `encodeWindChimeConnectionKey({origin,siteId,token,v?:1})` and `parseWindChimeConnectionKey(unknown)`. The wire format is `wc_conn_v1.<base64url UTF-8 JSON>`, whose payload contains exactly `{v:1,origin,siteId,token}`. The complete input is limited to 4096 characters. Unknown fields, unsupported versions, invalid UTF-8/base64url, and non-control tokens are rejected with local `CONNECTION_KEY_INVALID` 400. Control tokens must match `wc_ctl_` followed by exactly 43 base64url characters.

The codec normalizes an HTTPS origin, or HTTP on exact loopback hosts `localhost`, `127.0.0.1` and `[::1]`. It rejects credentials, non-root paths, query strings and fragments. The key is an encoding of a reusable control credential, not encrypted storage; never put it in a public URL, repository, log or capture surface.

A website administrator creates a site grant with `POST /control/grants` and `{scope:"site",kind:"control",label}`; `{topicId,kind:"control",label}` remains the legacy topic-scoped form. Encoding uses the current website origin and capability siteId. The raw grant is returned only when created; subsequent grant lists contain metadata. Its fixed 30-day expiry is not extended by importing or querying identity. Existing control Bearers cannot issue another control grant.

On import, the desktop parses locally, checks `features.connectionKeys`, compares the capability siteId with the encoded siteId, then queries `/control/identity` using the encoded token. It saves only the verified scope and credentials using OS-backed encryption. The key cannot choose a different topic via payload or identity query. Clients must not persist an unverified credential or show an old connection's content while changing scope.

Import is repeatable and does not consume the grant. Several computers may share one key; revoking its grant invalidates all of those connections and child display grants. Issue separate keys for independent revocation. The old one-time PKCE device pairing endpoints remain supported and separate from this import flow.

## Gateway binding

Gateway keys are Ed25519 public PEMs indexed by JWT `kid`. Issuer must exactly equal configured `gatewayIssuer`. No platform secret belongs in a site or desktop package. Gateway does not fetch arbitrary site URLs or inboxes.

- `POST /control/binding-challenge` body `{topicId}` → `{nonce,siteId,topicId,siteOrigin,expiresAt}` (5 minutes).
- Gateway signs a compact EdDSA JWT with `{kind:"binding",iss,aud:siteOrigin,siteId,topicId,nonce,bindingId,biliSubject,sessionId,jti,iat,exp}` (all IDs strings; iat/exp Unix seconds, validity ≤5 minutes).
- `POST /control/bind` body `{topicId,proof}` verifies the unused local nonce, scope, issuer, key, audience, time and jti, then stores `{bindingId,biliSubject,sessionId}`. Returns `{ok:true,bindingId}`. Only existing host admin/control authorization can approve a binding.
- Gateway signs display proof `{kind:"display",iss,aud:siteOrigin,siteId,topicId,bindingId,biliSubject,sessionId,jti,iat,exp}` (validity ≤60 seconds).
- `POST /gateway/exchange` body `{proof}` checks the stored approved binding and consumes jti once → `{token,topicId,expiresAt}` (display-only grant, 120 seconds). This does not arm output; display/open still joins blank. Approved bindings may be reused by a new platform session of the same subject.
- `POST /gateway/renew` existing display Bearer + `{proof}` extends credential lifetime for the SAME binding/session without changing receiver or token. A different session must exchange/open and remains blank.
- Gateway grant display/open, frame and asset requests additionally require `X-WindChime-Platform-Lease`: EdDSA JWT with the same identity claims, `kind:"lease"`, maximum lifetime 3 seconds. Gateway renews every second and stops on platform-session end/heartbeat failure. Site checks current binding and grant platform session on each request. A missing/expired lease returns an error and must blank output.

No gateway proof can authorize control or read draft/history. Removing a binding with `DELETE /control/bind?topicId=...` revokes its display grants. Display credential expiry and 3 second platform/connection leases are separate constraints; valid credentials cannot bypass missing leases.
