import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

const rootDir = process.cwd();
const dataDir = path.resolve(process.env.SMARTSAT_DATA_DIR || path.join(rootDir, 'data'));
const distDir = path.join(rootDir, 'dist');
const configFile = path.join(dataDir, 'config.local.json');
const configExampleFile = path.join(dataDir, 'config.local.example.json');
const notificationsConfigFile = path.join(dataDir, 'notifications.local.json');
const notificationsExampleFile = path.join(dataDir, 'notifications.example.json');
const mobilePushRegistryFile = path.resolve(process.env.SMARTSAT_PUSH_REGISTRY_FILE || path.join(dataDir, 'mobile-push-tokens.local.json'));

function readJsonSafe(file, fallback = {}) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
  catch (error) { console.error(`[config] Falha ao ler ${file}:`, error.message); return fallback; }
}

function ensureConfigFiles() {
  fs.mkdirSync(dataDir, { recursive: true });
  const example = { traccarUrl: 'https://gps.smartsatrastreamento.com.br', port: 3000, pollingMs: 30000, allowUnsafeGoogleTiles: true, sessionTtlHours: 8 };
  const notificationsExample = {
    publicAppUrl: 'https://seu-dominio-smartsat.example.com',
    traccarWebhookSecret: 'troque-por-um-segredo-forte',
    pushover: {
      appToken: '',
      userKey: '',
      device: '',
      sound: 'pushover',
      priority: 0
    },
    firebase: {
      vapidKey: '',
      webConfig: {
        apiKey: '',
        authDomain: '',
        projectId: 'smartsat-gps',
        storageBucket: '',
        messagingSenderId: '',
        appId: ''
      }
    }
  };
  if (!fs.existsSync(configExampleFile)) fs.writeFileSync(configExampleFile, `${JSON.stringify(example, null, 2)}\n`);
  if (!fs.existsSync(notificationsExampleFile)) fs.writeFileSync(notificationsExampleFile, `${JSON.stringify(notificationsExample, null, 2)}\n`);
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, `${JSON.stringify(example, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(configFile, 0o600); } catch { /* ignore */ }
  try { if (fs.existsSync(notificationsConfigFile)) fs.chmodSync(notificationsConfigFile, 0o600); } catch { /* ignore */ }
}

ensureConfigFiles();
const localConfig = readJsonSafe(configFile, {});
const notificationsConfig = readJsonSafe(notificationsConfigFile, {});
const pushoverConfig = notificationsConfig.pushover || {};
const firebaseConfig = notificationsConfig.firebase || {};

function firebaseWebConfigJson() {
  const value = process.env.FIREBASE_WEB_CONFIG_JSON || localConfig.firebaseWebConfigJson || firebaseConfig.webConfigJson || firebaseConfig.webConfig || '';
  if (!value) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return ''; }
}

function decodeJsonSecret(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* try base64 below */ }
  try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
}

function loadFirebaseServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON_B64 || '';
  const decoded = decodeJsonSecret(inline);
  if (decoded?.client_email && decoded?.private_key && decoded?.project_id) return decoded;
  const filePath = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  if (filePath) {
    const fromFile = readJsonSafe(path.resolve(filePath), null);
    if (fromFile?.client_email && fromFile?.private_key && fromFile?.project_id) return fromFile;
  }
  return null;
}

const firebaseServiceAccount = loadFirebaseServiceAccount();
let googleAccessTokenCache = { token: '', expiresAt: 0 };
let googleAccessTokenPromise = null;

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function firebaseAccessToken() {
  if (!firebaseServiceAccount) {
    const error = new Error('FCM Android nao configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON_B64 no backend.');
    error.status = 503;
    throw error;
  }
  const now = Math.floor(Date.now() / 1000);
  if (googleAccessTokenCache.token && googleAccessTokenCache.expiresAt - 120 > now) return googleAccessTokenCache.token;
  if (googleAccessTokenPromise) return googleAccessTokenPromise;

  googleAccessTokenPromise = (async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenUri = firebaseServiceAccount.token_uri || 'https://oauth2.googleapis.com/token';
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const claims = base64UrlJson({
      iss: firebaseServiceAccount.client_email,
      sub: firebaseServiceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600
    });
    const unsigned = `${header}.${claims}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${signer.sign(firebaseServiceAccount.private_key).toString('base64url')}`;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      const error = new Error(payload.error_description || payload.error || `Falha OAuth Firebase HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }
    googleAccessTokenCache = { token: String(payload.access_token), expiresAt: issuedAt + Number(payload.expires_in || 3600) };
    return googleAccessTokenCache.token;
  })();

  try { return await googleAccessTokenPromise; }
  finally { googleAccessTokenPromise = null; }
}

function firebaseNativeConfigured() {
  return Boolean(firebaseServiceAccount?.client_email && firebaseServiceAccount?.private_key && firebaseServiceAccount?.project_id);
}

function readPushRegistry() {
  const payload = readJsonSafe(mobilePushRegistryFile, { version: 1, tokens: {} });
  return payload && typeof payload === 'object'
    ? { version: 1, tokens: payload.tokens && typeof payload.tokens === 'object' ? payload.tokens : {} }
    : { version: 1, tokens: {} };
}

function writePushRegistry(registry) {
  fs.mkdirSync(path.dirname(mobilePushRegistryFile), { recursive: true });
  const tmp = `${mobilePushRegistryFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, mobilePushRegistryFile);
  try { fs.chmodSync(mobilePushRegistryFile, 0o600); } catch { /* ignore */ }
}

function pushTokenKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function validFcmToken(token) {
  const value = String(token || '').trim();
  return value.length >= 64 && value.length <= 4096 && /^[A-Za-z0-9_:\-.]+$/.test(value);
}

function userPushRecords(userId) {
  const registry = readPushRegistry();
  return Object.entries(registry.tokens)
    .filter(([, item]) => item?.enabled !== false && String(item?.userId || '') === String(userId || ''))
    .map(([key, item]) => ({ key, ...item }));
}

function removePushToken(token) {
  if (!validFcmToken(token)) return false;
  const registry = readPushRegistry();
  const key = pushTokenKey(token);
  if (!registry.tokens[key]) return false;
  delete registry.tokens[key];
  writePushRegistry(registry);
  return true;
}

function webhookDeviceId(payload = {}) {
  const candidates = [
    payload?.event?.deviceId, payload?.position?.deviceId, payload?.device?.id,
    payload?.deviceId, payload?.deviceID, payload?.id
  ];
  for (const value of candidates) {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) return id;
  }
  return 0;
}

function fcmNotificationBody(payload = {}) {
  return formatWebhookMessage(payload).replace(/\s*\n\s*/g, ' • ').slice(0, 420);
}

function fcmDataPayload(payload = {}) {
  const deviceId = webhookDeviceId(payload);
  const eventType = String(payload?.event?.type || payload?.type || payload?.alarm || payload?.notification || 'evento').slice(0, 100);
  const eventTime = String(payload?.event?.eventTime || payload?.eventTime || payload?.deviceTime || payload?.fixTime || payload?.serverTime || new Date().toISOString()).slice(0, 80);
  return {
    tab: 'eventos',
    deviceId: deviceId ? String(deviceId) : '',
    eventType,
    eventTime,
    source: 'traccar'
  };
}

async function sendFcmToToken(token, payload = {}, { title = 'SMARTSAT RASTREADORES' } = {}) {
  if (!validFcmToken(token)) throw new Error('Token FCM invalido.');
  const accessToken = await firebaseAccessToken();
  const projectId = firebaseServiceAccount.project_id;
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body: fcmNotificationBody(payload) },
        data: fcmDataPayload(payload),
        android: {
          priority: 'HIGH',
          ttl: '3600s',
          notification: { channel_id: 'smartsat_alerts', sound: 'default', tag: `smartsat-${webhookDeviceId(payload) || 'general'}` }
        }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.error?.message || `FCM retornou HTTP ${response.status}`);
    error.status = response.status;
    error.payload = result;
    throw error;
  }
  return result;
}

function fcmTokenIsInvalid(error) {
  const text = JSON.stringify(error?.payload || {}) + ' ' + String(error?.message || '');
  return /UNREGISTERED|registration token is not a valid|Requested entity was not found/i.test(text);
}

async function sendFcmToRecipients(records, payload = {}, options = {}) {
  const unique = new Map();
  for (const record of records || []) if (validFcmToken(record?.token)) unique.set(record.token, record);
  const entries = [...unique.values()].slice(0, 500);
  let sent = 0;
  let failed = 0;
  let cleaned = 0;
  const concurrency = 20;
  for (let start = 0; start < entries.length; start += concurrency) {
    const chunk = entries.slice(start, start + concurrency);
    const results = await Promise.allSettled(chunk.map((record) => sendFcmToToken(record.token, payload, options)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') sent += 1;
      else {
        failed += 1;
        if (fcmTokenIsInvalid(result.reason) && removePushToken(chunk[index].token)) cleaned += 1;
      }
    });
  }
  return { attempted: entries.length, sent, failed, cleaned };
}

function numberInRange(value, fallback, min, max, { integer = false } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  return normalized >= min && normalized <= max ? normalized : fallback;
}

function normalizeBaseUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fallback;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

const defaultTraccarUrl = 'https://gps.smartsatrastreamento.com.br';

const config = {
  port: numberInRange(process.env.PORT || localConfig.port, 3000, 1, 65535, { integer: true }),
  traccarUrl: normalizeBaseUrl(process.env.TRACCAR_URL || localConfig.traccarUrl, defaultTraccarUrl),
  pollingMs: numberInRange(process.env.POLLING_MS || localConfig.pollingMs, 30000, 5000, 300000, { integer: true }),
  allowUnsafeGoogleTiles: String(process.env.ALLOW_UNSAFE_GOOGLE_TILES ?? localConfig.allowUnsafeGoogleTiles ?? 'true') !== 'false',
  sessionTtlMs: numberInRange(process.env.SESSION_TTL_MS || (Number(localConfig.sessionTtlHours || 8) * 60 * 60 * 1000), 8 * 60 * 60 * 1000, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, { integer: true }),
  publicAppUrl: String(process.env.PUBLIC_APP_URL || localConfig.publicAppUrl || notificationsConfig.publicAppUrl || '').replace(/\/+$/, ''),
  pushover: {
    token: String(process.env.PUSHOVER_APP_TOKEN || process.env.PUSHOVER_TOKEN || localConfig.pushoverAppToken || localConfig.pushoverToken || pushoverConfig.appToken || pushoverConfig.token || ''),
    user: String(process.env.PUSHOVER_USER_KEY || process.env.PUSHOVER_USER || localConfig.pushoverUserKey || localConfig.pushoverUser || pushoverConfig.userKey || pushoverConfig.user || ''),
    device: String(process.env.PUSHOVER_DEVICE || localConfig.pushoverDevice || pushoverConfig.device || ''),
    sound: String(process.env.PUSHOVER_SOUND || localConfig.pushoverSound || pushoverConfig.sound || 'pushover'),
    priority: numberInRange(process.env.PUSHOVER_PRIORITY || localConfig.pushoverPriority || pushoverConfig.priority, 0, -2, 2, { integer: true })
  },
  firebase: {
    vapidKey: String(process.env.FIREBASE_VAPID_KEY || localConfig.firebaseVapidKey || firebaseConfig.vapidKey || ''),
    webConfigJson: firebaseWebConfigJson()
  },
  traccarWebhookSecret: String(process.env.TRACCAR_WEBHOOK_SECRET || localConfig.traccarWebhookSecret || notificationsConfig.traccarWebhookSecret || '')
};

const app = express();
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const endpointAllowList = [
  /^\/api\/server$/, /^\/api\/session$/, /^\/api\/users(?:\/\d+)?$/, /^\/api\/permissions$/, /^\/api\/statistics$/,
  /^\/api\/devices(?:\/\d+)?$/, /^\/api\/positions(?:\/\d+)?$/, /^\/api\/events$/, /^\/api\/groups(?:\/\d+)?$/,
  /^\/api\/drivers(?:\/\d+)?$/, /^\/api\/geofences(?:\/\d+)?$/, /^\/api\/calendars(?:\/\d+)?$/,
  /^\/api\/attributes\/computed(?:\/\d+)?$/, /^\/api\/notifications(?:\/\d+)?$/, /^\/api\/notifications\/types$/,
  /^\/api\/maintenance(?:\/\d+)?$/, /^\/api\/commands(?:\/\d+)?$/, /^\/api\/commands\/types$/,
  /^\/api\/reports\/(events|route|trips|stops|summary)$/, /^\/api\/geocode$/, /^\/api\/geocode\/reverse$/
];

const COOKIE_NAME = 'smartsat_sid';
const sessions = new Map();
const MAX_LOCAL_SESSIONS = 10000;
const MAX_STREAM_BYTES = 24 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 1024 * 1024;

function isAllowedEndpoint(urlPath) { return endpointAllowList.some((rx) => rx.test(urlPath)); }
function pushoverConfigured() { return Boolean(config.pushover.token && config.pushover.user); }
function firebaseConfigured() { return Boolean((config.firebase.vapidKey && config.firebase.webConfigJson) || firebaseNativeConfigured()); }
function safePublicConfig(req = null) {
  return {
    pollingMs: config.pollingMs,
    traccarUrl: config.traccarUrl,
    authMode: 'traccar-user-session',
    authenticated: Boolean(req ? getSession(req) : false),
    configExists: fs.existsSync(configFile),
    allowUnsafeGoogleTiles: config.allowUnsafeGoogleTiles,
    mobile: { installable: true, serviceWorker: true, appUrl: config.publicAppUrl || '' },
    notifications: {
      pushover: { enabled: pushoverConfigured(), deviceConfigured: Boolean(config.pushover.device), webhookReady: Boolean(config.traccarWebhookSecret) },
      firebase: { enabled: firebaseConfigured(), vapidKeyConfigured: Boolean(config.firebase.vapidKey), webConfigConfigured: Boolean(config.firebase.webConfigJson), nativeAndroidConfigured: firebaseNativeConfigured(), tokenRegistryReady: true }
    }
  };
}
function redact(value) { if (!value) return ''; const s = String(value); return s.length <= 8 ? '********' : `${s.slice(0, 4)}…${s.slice(-4)}`; }
function decodeCookiePart(value) {
  try { return decodeURIComponent(value); } catch { return ''; }
}
function parseCookies(req) {
  const entries = [];
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    const key = decodeCookiePart(rawKey || '');
    if (key) entries.push([key, decodeCookiePart(rawValue.join('=') || '')]);
  }
  return Object.fromEntries(entries);
}
function cookieOptions(req) { const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https'; return { httpOnly: true, sameSite: 'lax', secure: Boolean(isSecure), path: '/', maxAge: config.sessionTtlMs }; }
function parseSetCookie(headers) { const raw = headers.get('set-cookie'); if (!raw) return ''; return raw.split(/,(?=[^;,]+=)/g).map((part) => part.split(';')[0].trim()).filter(Boolean).join('; '); }
function sanitizeUser(payload, fallbackLogin = '') { const user = payload && typeof payload === 'object' ? payload : {}; return { id: user.id ?? null, name: user.name || user.email || fallbackLogin, email: user.email || fallbackLogin, administrator: Boolean(user.administrator), readonly: Boolean(user.readonly), deviceReadonly: Boolean(user.deviceReadonly), disabled: Boolean(user.disabled) }; }
function sanitizeProfilePayload(body = {}, currentUser = {}) {
  const payload = { ...(currentUser && typeof currentUser === 'object' ? currentUser : {}) };
  for (const key of ['password', 'token', 'hashedPassword', 'salt']) delete payload[key];
  const stringLimits = { name: 160, email: 180, phone: 64, coordinateFormat: 64 };
  for (const [key, limit] of Object.entries(stringLimits)) {
    if (body[key] !== undefined) payload[key] = String(body[key] ?? '').trim().slice(0, limit);
  }
  for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['zoom', 0, 20]]) {
    if (body[key] === undefined || body[key] === '') continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < min || value > max) {
      const error = new Error(`Campo ${key} invalido.`);
      error.status = 400;
      throw error;
    }
    payload[key] = key === 'zoom' ? Math.trunc(value) : value;
  }
  if (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
    if (JSON.stringify(body.attributes).length > 32768) {
      const error = new Error('Atributos do perfil excedem o limite permitido.');
      error.status = 413;
      throw error;
    }
    payload.attributes = { ...(currentUser.attributes || {}), ...body.attributes };
  }
  payload.id = currentUser.id;
  return payload;
}
function createLocalSession(req, res, remoteCookie, user) {
  cleanupSessions();
  while (sessions.size >= MAX_LOCAL_SESSIONS) sessions.delete(sessions.keys().next().value);
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sid, { sid, remoteCookie, user, createdAt: now, lastSeenAt: now, expiresAt: now + config.sessionTtlMs });
  res.cookie(COOKIE_NAME, sid, cookieOptions(req));
  return sid;
}
function destroyLocalSession(req, res) { const sid = parseCookies(req)[COOKIE_NAME]; if (sid) sessions.delete(sid); res.clearCookie(COOKIE_NAME, { path: '/' }); }
function cleanupSessions() { const now = Date.now(); for (const [sid, session] of sessions.entries()) if (!session?.expiresAt || session.expiresAt <= now) sessions.delete(sid); }
function getSession(req) { cleanupSessions(); const sid = parseCookies(req)[COOKIE_NAME]; if (!sid) return null; const session = sessions.get(sid); if (!session) return null; if (session.expiresAt <= Date.now()) { sessions.delete(sid); return null; } session.lastSeenAt = Date.now(); session.expiresAt = Date.now() + config.sessionTtlMs; return session; }
function requireAuth(req, res, next) { const session = getSession(req); if (!session) return res.status(401).json({ ok: false, error: 'Login necessário. Entre com as credenciais do Traccar.' }); req.smartsatSession = session; return next(); }
function requireAdministrator(req, res, next) { if (!req.smartsatSession?.user?.administrator) return res.status(403).json({ ok: false, error: 'Somente administrador pode testar notificacoes.' }); return next(); }
function isDeviceReadOnly(req) { return Boolean(req.smartsatSession?.user?.readonly || req.smartsatSession?.user?.deviceReadonly); }

async function responseBufferWithLimit(response, limit, controller) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    controller.abort();
    const error = new Error('Resposta de stream excede o limite permitido.');
    error.status = 502;
    throw error;
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      controller.abort();
      const error = new Error('Resposta de stream excede o limite permitido.');
      error.status = 502;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function loginToTraccar(login, password) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const body = new URLSearchParams({ email: login, password });
    const response = await fetch(`${config.traccarUrl}/api/session`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal, redirect: 'manual' });
    const setCookie = parseSetCookie(response.headers); const text = await response.text(); let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text ? { raw: text } : null; }
    if (!response.ok || !setCookie) { const message = payload?.message || payload?.error || payload?.raw || `Traccar retornou HTTP ${response.status}`; const error = new Error(String(message).slice(0, 500)); error.status = response.status || 401; throw error; }
    return { remoteCookie: setCookie, user: sanitizeUser(payload, login) };
  } catch (error) { if (error.name === 'AbortError') throw new Error('Tempo esgotado ao autenticar no Traccar.'); throw error; }
  finally { clearTimeout(timeout); }
}

function buildAuthHeaders(req, extra = {}) { const session = req.smartsatSession || getSession(req); if (!session?.remoteCookie) { const error = new Error('Sessão Traccar não encontrada. Faça login novamente.'); error.status = 401; throw error; } return { Accept: 'application/json', Cookie: session.remoteCookie, ...extra }; }

async function traccarFetch(req, apiPath, options = {}) {
  if (!apiPath.startsWith('/api/')) throw new Error('Caminho interno inválido para proxy Traccar.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 18000)); const url = `${config.traccarUrl}${apiPath}`;
  try {
    const response = await fetch(url, { method: options.method || 'GET', headers: buildAuthHeaders(req, options.headers), body: options.body, signal: controller.signal, redirect: 'manual' });
    const setCookie = parseSetCookie(response.headers); if (setCookie) { const session = req.smartsatSession || getSession(req); if (session) session.remoteCookie = setCookie; }
    const contentType = response.headers.get('content-type') || ''; const text = await response.text(); let payload = null;
    if (contentType.includes('application/json')) { try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; } } else { payload = text ? { raw: text } : null; }
    if (response.status === 401) { const sid = parseCookies(req)[COOKIE_NAME]; if (sid) sessions.delete(sid); }
    if (!response.ok) { const message = payload?.message || payload?.error || payload?.raw || `Traccar retornou HTTP ${response.status}`; const error = new Error(String(message).slice(0, 500)); error.status = response.status; error.payload = payload; throw error; }
    return payload;
  } catch (error) { if (error.name === 'AbortError') throw new Error('Tempo esgotado ao conectar ao Traccar.'); throw error; }
  finally { clearTimeout(timeout); }
}

function normalizeCommandToken(value = '') {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}

function commandTypeValue(item = {}) {
  if (typeof item === 'string') return item;
  return String(item.type || item.name || item.command || '').trim();
}

function commandSearchText(item = {}) {
  if (typeof item === 'string') return normalizeCommandToken(item);
  return normalizeCommandToken([
    item.type,
    item.name,
    item.description,
    item.textChannel,
    item.attributes?.data,
    item.attributes?.command,
    item.attributes?.label
  ].filter(Boolean).join(' '));
}

function findSupportedType(types = [], candidates = []) {
  const wanted = candidates.map(normalizeCommandToken).filter(Boolean);
  const available = Array.isArray(types) ? types : [];
  for (const item of available) {
    const raw = commandTypeValue(item);
    const token = normalizeCommandToken(raw);
    if (raw && wanted.includes(token)) return raw;
  }
  for (const item of available) {
    const raw = commandTypeValue(item);
    const token = normalizeCommandToken(raw);
    if (raw && wanted.some((candidate) => token.includes(candidate) || candidate.includes(token))) return raw;
  }
  return '';
}

function findSavedCommand(commands = [], candidates = []) {
  const wanted = candidates.map(normalizeCommandToken).filter(Boolean);
  return (Array.isArray(commands) ? commands : []).find((command) => {
    const text = commandSearchText(command);
    if (!text) return false;
    return wanted.some((candidate) => text.includes(candidate));
  }) || null;
}

async function sendTraccarCommand(req, command) {
  return traccarFetch(req, '/api/commands/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
}

async function sendTypedCommand(req, deviceId, type, attributes = {}) {
  if (!type) return null;
  return sendTraccarCommand(req, { id: 0, deviceId, type, attributes });
}

async function sendSavedCommand(req, savedCommand, deviceId, attributes = {}) {
  if (!savedCommand) return null;
  const command = {
    ...savedCommand,
    id: Number(savedCommand.id || 0),
    deviceId,
    attributes: {
      ...(savedCommand.attributes && typeof savedCommand.attributes === 'object' ? savedCommand.attributes : {}),
      ...attributes
    }
  };
  return sendTraccarCommand(req, command);
}

function liveStreamUrls(deviceId, channel) {
  return {
    streamUrl: `/api/stream/${deviceId}/${channel}/live.m3u8`,
    fallbackStreamUrl: `/api/stream/${deviceId}/live.m3u8`
  };
}

async function loadCameraCommands(req, deviceId) {
  const [types, saved] = await Promise.allSettled([
    traccarFetch(req, `/api/commands/types?deviceId=${deviceId}`),
    traccarFetch(req, `/api/commands/send?deviceId=${deviceId}`)
  ]);
  return {
    types: types.status === 'fulfilled' && Array.isArray(types.value) ? types.value : [],
    saved: saved.status === 'fulfilled' && Array.isArray(saved.value) ? saved.value : [],
    errors: [types, saved].filter((item) => item.status === 'rejected').map((item) => item.reason?.message || String(item.reason))
  };
}

async function startCameraSession(req, deviceId, channel) {
  if (isDeviceReadOnly(req)) {
    return {
      ...liveStreamUrls(deviceId, channel),
      sent: [],
      commandErrors: [],
      commandLoadErrors: [],
      availableTypes: [],
      savedCommands: [],
      liveVideoCommandSent: false,
      snapshotRequested: false,
      readOnly: true
    };
  }
  const commands = await loadCameraCommands(req, deviceId);
  const sent = [];
  const commandErrors = [];
  const videoAttributes = { channel, streamType: 0, mediaType: 'video' };
  const photoAttributes = { channel, count: 1, interval: 0, save: false, upload: true, mediaType: 'image' };

  const videoSaved = findSavedCommand(commands.saved, ['videostart', 'startvideo', 'livevideo', 'iniciarvideo', 'cameraonline', '9101']);
  const videoType = videoSaved ? '' : findSupportedType(commands.types, ['videoStart', 'startVideo', 'liveVideo', 'streamStart']);
  try {
    const payload = videoSaved
      ? await sendSavedCommand(req, videoSaved, deviceId, videoAttributes)
      : await sendTypedCommand(req, deviceId, videoType, videoAttributes);
    if (payload) sent.push({ kind: 'videoStart', source: videoSaved ? 'saved' : 'type', type: videoSaved?.type || videoType || '', id: videoSaved?.id || null });
  } catch (error) {
    commandErrors.push(`videoStart: ${error.message}`);
  }

  const photoSaved = findSavedCommand(commands.saved, ['requestphoto', 'takephoto', 'capturephoto', 'snapshot', 'captura', 'foto', 'imagem', '8801']);
  const photoType = photoSaved ? '' : findSupportedType(commands.types, ['requestPhoto', 'takePhoto', 'capturePhoto', 'snapshot', 'cameraCapture', 'imageCapture']);
  try {
    const payload = photoSaved
      ? await sendSavedCommand(req, photoSaved, deviceId, photoAttributes)
      : await sendTypedCommand(req, deviceId, photoType, photoAttributes);
    if (payload) sent.push({ kind: 'liveImage', source: photoSaved ? 'saved' : 'type', type: photoSaved?.type || photoType || '', id: photoSaved?.id || null });
  } catch (error) {
    commandErrors.push(`liveImage: ${error.message}`);
  }

  return {
    ...liveStreamUrls(deviceId, channel),
    sent,
    commandErrors,
    commandLoadErrors: commands.errors,
    availableTypes: commands.types.map(commandTypeValue).filter(Boolean),
    savedCommands: commands.saved.map((command) => ({ id: command.id ?? null, type: command.type || '', description: command.description || command.textChannel || command.attributes?.label || '' })),
    liveVideoCommandSent: sent.some((item) => item.kind === 'videoStart'),
    snapshotRequested: sent.some((item) => item.kind === 'liveImage')
  };
}

async function stopCameraSession(req, deviceId, channel) {
  if (isDeviceReadOnly(req)) return { stopped: false, readOnly: true, reason: 'Usuario somente leitura: nenhum comando de camera foi enviado.' };
  const commands = await loadCameraCommands(req, deviceId);
  const videoSaved = findSavedCommand(commands.saved, ['videostop', 'stopvideo', 'closevideo', 'pararvideo', '9102']);
  const videoType = videoSaved ? '' : findSupportedType(commands.types, ['videoStop', 'stopVideo', 'streamStop']);
  if (!videoSaved && !videoType) return { stopped: false, reason: 'Comando de parada de video nao retornado pelo Traccar.' };
  const attributes = { channel, control: 'close', mediaType: 'video' };
  if (videoSaved) await sendSavedCommand(req, videoSaved, deviceId, attributes);
  else await sendTypedCommand(req, deviceId, videoType, attributes);
  return { stopped: true, type: videoSaved?.type || videoType || '', source: videoSaved ? 'saved' : 'type' };
}

async function proxyTraccarStream(req, res, streamPath) {
  const cleanPath = String(streamPath || '').replace(/^\/+/, '');
  if (!cleanPath || cleanPath.includes('..') || !/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(cleanPath)) {
    return res.status(400).json({ ok: false, error: 'Caminho de stream invalido.' });
  }
  const query = new URLSearchParams(req.query).toString();
  const apiPath = `/api/stream/${cleanPath}${query ? `?${query}` : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try {
    const response = await fetch(`${config.traccarUrl}${apiPath}`, {
      method: 'GET',
      headers: buildAuthHeaders(req, { Accept: '*/*' }),
      signal: controller.signal,
      redirect: 'manual'
    });
    const setCookie = parseSetCookie(response.headers);
    if (setCookie) {
      const session = req.smartsatSession || getSession(req);
      if (session) session.remoteCookie = setCookie;
    }
    const contentType = response.headers.get('content-type') || (cleanPath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
    const body = await responseBufferWithLimit(response, cleanPath.endsWith('.m3u8') ? MAX_PLAYLIST_BYTES : MAX_STREAM_BYTES, controller);
    res.status(response.status);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', contentType);
    if (!response.ok) return res.send(body.length ? body : `Stream indisponivel no Traccar (HTTP ${response.status}).`);
    if (cleanPath.endsWith('.m3u8')) {
      const playlist = body.toString('utf8')
        .replaceAll(`${config.traccarUrl}/api/stream`, '/api/stream')
        .replaceAll(`${config.traccarUrl.replace(/^http:/, 'https:')}/api/stream`, '/api/stream')
        .replaceAll(`${config.traccarUrl.replace(/^https:/, 'http:')}/api/stream`, '/api/stream');
      return res.send(playlist);
    }
    return res.send(body);
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ ok: false, error: 'Tempo esgotado ao abrir stream Traccar.' });
    return res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao abrir stream Traccar.' });
  } finally {
    clearTimeout(timeout);
  }
}

function recentIso(hoursBack = 24) { return new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString(); }
function nowIso() { return new Date().toISOString(); }
async function buildSnapshot(req) {
  const eventsPath = `/api/reports/events?from=${encodeURIComponent(recentIso(24))}&to=${encodeURIComponent(nowIso())}`;
  const [server, devices, positions, events, drivers] = await Promise.allSettled([traccarFetch(req, '/api/server'), traccarFetch(req, '/api/devices'), traccarFetch(req, '/api/positions'), traccarFetch(req, eventsPath), traccarFetch(req, '/api/drivers')]);
  return { ok: true, user: req.smartsatSession?.user || null, server: server.status === 'fulfilled' ? server.value : null, devices: devices.status === 'fulfilled' && Array.isArray(devices.value) ? devices.value : [], positions: positions.status === 'fulfilled' && Array.isArray(positions.value) ? positions.value : [], events: events.status === 'fulfilled' && Array.isArray(events.value) ? events.value : [], drivers: drivers.status === 'fulfilled' && Array.isArray(drivers.value) ? drivers.value : [], errors: [server, devices, positions, events].filter((item) => item.status === 'rejected').map((item) => item.reason?.message || String(item.reason)), config: safePublicConfig(req) };
}

function formatWebhookMessage(payload = {}) {
  const event = payload.event || payload.type || payload.alarm || payload.notification || 'evento';
  const device = payload.device?.name || payload.deviceName || payload.name || payload.device?.uniqueId || payload.deviceId || 'veiculo';
  const time = payload.eventTime || payload.deviceTime || payload.fixTime || payload.serverTime || new Date().toISOString();
  const address = payload.position?.address || payload.address || '';
  const speed = payload.position?.speed ?? payload.speed;
  const parts = [`${device}: ${event}`, `Horario: ${time}`];
  if (address) parts.push(`Local: ${address}`);
  if (speed !== undefined && speed !== null && speed !== '') parts.push(`Velocidade: ${speed}`);
  return parts.join('\n');
}

async function sendPushoverMessage({ title = 'SMARTSAT RASTREADORES', message, priority = config.pushover.priority, url = config.publicAppUrl }) {
  if (!pushoverConfigured()) {
    const error = new Error('Pushover nao configurado. Defina PUSHOVER_APP_TOKEN e PUSHOVER_USER_KEY na Railway.');
    error.status = 503;
    throw error;
  }
  const body = new URLSearchParams({
    token: config.pushover.token,
    user: config.pushover.user,
    title: String(title).slice(0, 250),
    message: String(message || 'Teste SMARTSAT').slice(0, 1024),
    priority: String(Number.isFinite(priority) ? priority : 0),
    sound: config.pushover.sound || 'pushover'
  });
  if (config.pushover.device) body.set('device', config.pushover.device);
  if (url) {
    body.set('url', url);
    body.set('url_title', 'Abrir SMARTSAT');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok || payload?.status === 0) {
      const error = new Error(payload?.errors?.join(', ') || payload?.raw || `Pushover retornou HTTP ${response.status}`);
      error.status = response.status || 502;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Tempo esgotado ao enviar notificacao Pushover.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

app.disable('x-powered-by'); app.set('trust proxy', 1);
const connectSrc = ["'self'", 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://server.arcgisonline.com'];
const imgSrc = ["'self'", 'data:', 'blob:', 'https:'];
if (config.allowUnsafeGoogleTiles) connectSrc.push('https://mt0.google.com', 'https://mt1.google.com', 'https://mt2.google.com', 'https://mt3.google.com');
app.use(helmet({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: { useDefaults: true, directives: { "default-src": ["'self'"], "connect-src": connectSrc, "img-src": imgSrc, "media-src": ["'self'", 'blob:'], "style-src": ["'self'", "'unsafe-inline'", 'https:'], "script-src": ["'self'"], "font-src": ["'self'", 'data:'], "object-src": ["'none'"], "base-uri": ["'self'"] } } }));
app.use(compression()); app.use(express.json({ limit: '512kb' })); app.use(express.urlencoded({ extended: false, limit: '512kb' })); app.use(morgan('combined'));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: 'Muitas tentativas de login. Aguarde alguns minutos.' } });

app.get('/api/health', (req, res) => { const session = getSession(req); res.set('Cache-Control', 'no-store'); res.json({ ok: true, service: 'smartsat-gps', version: '6.1.1-android-native-push', port: config.port, traccarUrl: config.traccarUrl, authMode: 'traccar-user-session', authenticated: Boolean(session), sessions: sessions.size, configExists: fs.existsSync(configFile), user: session?.user ? redact(session.user.email || session.user.name) : '' }); });
app.get('/api/config', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, config: safePublicConfig(req) }); });
app.get('/api/mobile/status', requireAuth, (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ok: true, mobile: safePublicConfig(req).mobile, notifications: safePublicConfig(req).notifications }); });
app.get('/api/mobile/fcm/status', requireAuth, (req, res) => {
  const userId = req.smartsatSession?.user?.id;
  const records = userPushRecords(userId);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, configured: firebaseNativeConfigured(), registeredDevices: records.length, records: records.map((item) => ({ platform: item.platform, updatedAt: item.updatedAt, deviceCount: Array.isArray(item.deviceIds) ? item.deviceIds.length : 0 })) });
});

app.post('/api/mobile/fcm/register', requireAuth, async (req, res) => {
  try {
    if (!firebaseNativeConfigured()) return res.status(503).json({ ok: false, error: 'FCM Android nao configurado no backend.' });
    const token = String(req.body?.token || '').trim();
    if (!validFcmToken(token)) return res.status(400).json({ ok: false, error: 'Token FCM invalido.' });
    const devices = await traccarFetch(req, '/api/devices');
    const deviceIds = Array.isArray(devices) ? devices.map((device) => Number(device?.id)).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
    const registry = readPushRegistry();
    const key = pushTokenKey(token);
    registry.tokens[key] = {
      token,
      userId: req.smartsatSession?.user?.id ?? null,
      administrator: Boolean(req.smartsatSession?.user?.administrator),
      platform: 'android',
      appId: 'br.com.smartsatrastreadores.smartsat',
      deviceIds: [...new Set(deviceIds)],
      enabled: true,
      updatedAt: new Date().toISOString()
    };
    writePushRegistry(registry);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, registered: true, deviceCount: registry.tokens[key].deviceIds.length });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao registrar notificacoes Android.' });
  }
});

app.post('/api/mobile/fcm/unregister', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  const registry = readPushRegistry();
  const key = validFcmToken(token) ? pushTokenKey(token) : '';
  const record = key ? registry.tokens[key] : null;
  if (record && String(record.userId || '') === String(req.smartsatSession?.user?.id || '')) {
    delete registry.tokens[key];
    writePushRegistry(registry);
  }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.post('/api/mobile/fcm/test', requireAuth, async (req, res) => {
  try {
    if (!firebaseNativeConfigured()) return res.status(503).json({ ok: false, error: 'FCM Android nao configurado no backend.' });
    const userId = req.smartsatSession?.user?.id;
    const records = userPushRecords(userId);
    if (!records.length) return res.status(404).json({ ok: false, error: 'Nenhum Android registrado para este usuario. Abra o APK e permita notificacoes.' });
    const payload = { type: 'teste', eventTime: new Date().toISOString(), device: { name: 'SMARTSAT' } };
    const result = await sendFcmToRecipients(records, payload, { title: 'Teste SMARTSAT' });
    res.json({ ok: result.sent > 0, result });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao enviar teste FCM.', details: error.payload || null });
  }
});

app.post('/api/mobile/pushover/test', requireAuth, requireAdministrator, async (req, res) => {
  try {
    const user = req.smartsatSession?.user?.name || req.smartsatSession?.user?.email || 'admin';
    const payload = await sendPushoverMessage({ title: 'Teste SMARTSAT', message: `Notificacao Pushover enviada pelo painel SMARTSAT.\nUsuario: ${user}\nHorario: ${new Date().toISOString()}` });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, result: { status: payload?.status || 1, request: payload?.request || null } });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao enviar Pushover.', details: error.payload || null });
  }
});
app.post('/api/auth/login', loginLimiter, async (req, res) => { try { const body = req.body || {}; const login = String(body.email || body.user || body.username || '').trim(); const password = String(body.password || ''); if (!login || login.length > 180) return res.status(400).json({ ok: false, error: 'Usuário/e-mail inválido.' }); if (!password || password.length > 300) return res.status(400).json({ ok: false, error: 'Senha inválida.' }); const { remoteCookie, user } = await loginToTraccar(login, password); createLocalSession(req, res, remoteCookie, user); res.set('Cache-Control', 'no-store'); return res.json({ ok: true, user, config: safePublicConfig(req) }); } catch (error) { return res.status(error.status || 401).json({ ok: false, error: error.message || 'Login inválido no Traccar.' }); } });
app.post('/api/auth/logout', (req, res) => { destroyLocalSession(req, res); res.set('Cache-Control', 'no-store'); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, async (req, res) => { try { const remoteUser = await traccarFetch(req, '/api/session'); req.smartsatSession.user = sanitizeUser(remoteUser, req.smartsatSession.user?.email || ''); res.set('Cache-Control', 'no-store'); res.json({ ok: true, authenticated: true, user: req.smartsatSession.user, config: safePublicConfig(req) }); } catch { destroyLocalSession(req, res); res.status(401).json({ ok: false, authenticated: false, error: 'Sessão expirada. Faça login novamente.' }); } });
app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.smartsatSession?.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ ok: false, error: 'Usuario logado sem ID valido no Traccar.' });
    const profile = await traccarFetch(req, `/api/users/${userId}`);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, user: profile });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar usuario logado.', details: error.payload || null });
  }
});
app.put('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.smartsatSession?.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ ok: false, error: 'Usuario logado sem ID valido no Traccar.' });
    const currentUser = await traccarFetch(req, `/api/users/${userId}`);
    const payload = sanitizeProfilePayload(req.body || {}, currentUser || {});
    const updated = await traccarFetch(req, `/api/users/${userId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    req.smartsatSession.user = sanitizeUser(updated || payload, req.smartsatSession.user?.email || '');
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, user: updated || payload });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao atualizar usuario logado.', details: error.payload || null });
  }
});
app.get('/api/bootstrap', requireAuth, async (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(await buildSnapshot(req)); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar dados iniciais.' }); } });
app.get('/api/snapshot', requireAuth, async (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(await buildSnapshot(req)); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao atualizar dados.' }); } });
app.get('/api/command-types', requireAuth, async (req, res) => { try { const deviceId = Number(req.query.deviceId); const query = Number.isFinite(deviceId) && deviceId > 0 ? `?deviceId=${deviceId}` : ''; const payload = await traccarFetch(req, `/api/commands/types${query}`); res.set('Cache-Control', 'no-store'); res.json(Array.isArray(payload) ? payload : []); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao carregar comandos.' }); } });
app.post('/api/send-command', requireAuth, async (req, res) => {
  try {
    if (isDeviceReadOnly(req)) return res.status(403).json({ ok: false, error: 'Usuario somente leitura nao pode enviar comandos.' });
    const body = req.body || {};
    const deviceId = Number(body.deviceId);
    const type = String(body.type || '').trim();
    if (!Number.isSafeInteger(deviceId) || deviceId <= 0) return res.status(400).json({ ok: false, error: 'deviceId inválido.' });
    if (!type || type.length > 80) return res.status(400).json({ ok: false, error: 'Tipo de comando inválido.' });
    const attributes = body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes) ? body.attributes : {};
    if (JSON.stringify(attributes).length > 16384) return res.status(413).json({ ok: false, error: 'Atributos do comando excedem o limite permitido.' });
    const supportedTypes = await traccarFetch(req, `/api/commands/types?deviceId=${deviceId}`);
    const typeIsSupported = Array.isArray(supportedTypes) && supportedTypes.some((item) => commandTypeValue(item) === type);
    if (!typeIsSupported) return res.status(400).json({ ok: false, error: 'Tipo de comando nao suportado para este dispositivo.' });
    const command = { id: 0, deviceId, type, attributes };
    const payload = await traccarFetch(req, '/api/commands/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, command: payload });
  } catch (error) {
    return res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao enviar comando.', details: error.payload || null });
  }
});
app.post('/api/live-camera/session', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = Number(body.deviceId);
    const channel = Number(body.channel || 1);
    if (!Number.isFinite(deviceId) || deviceId <= 0) return res.status(400).json({ ok: false, error: 'deviceId invalido.' });
    if (!Number.isInteger(channel) || channel < 1 || channel > 32) return res.status(400).json({ ok: false, error: 'Canal de camera invalido. Use 1 a 32.' });
    const session = await startCameraSession(req, deviceId, channel);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, deviceId, channel, status: session.readOnly ? 'read_only_stream' : session.liveVideoCommandSent ? 'waiting_stream' : 'unsupported_or_waiting_stream', ...session });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao iniciar camera ao vivo.', details: error.payload || null });
  }
});
app.post('/api/live-camera/stop', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = Number(body.deviceId);
    const channel = Number(body.channel || 1);
    if (!Number.isFinite(deviceId) || deviceId <= 0) return res.status(400).json({ ok: false, error: 'deviceId invalido.' });
    if (!Number.isInteger(channel) || channel < 1 || channel > 32) return res.status(400).json({ ok: false, error: 'Canal de camera invalido. Use 1 a 32.' });
    const result = await stopCameraSession(req, deviceId, channel);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, deviceId, channel, ...result });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao parar camera ao vivo.', details: error.payload || null });
  }
});
app.get(/^\/api\/stream\/(.+)$/, requireAuth, async (req, res) => proxyTraccarStream(req, res, req.params[0]));
app.all('/api/traccar/*', requireAuth, async (req, res) => { try { if (!allowedMethods.has(req.method)) return res.status(405).json({ ok: false, error: 'Método não permitido.' }); const rawPath = `/${req.params[0] || ''}`.replace(/\/+/g, '/'); const apiPath = rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`; if (!isAllowedEndpoint(apiPath)) return res.status(403).json({ ok: false, error: 'Endpoint bloqueado pelo proxy seguro.', apiPath }); const query = new URLSearchParams(req.query).toString(); const finalPath = query ? `${apiPath}?${query}` : apiPath; const hasBody = !['GET', 'HEAD'].includes(req.method); const payload = await traccarFetch(req, finalPath, { method: req.method, headers: hasBody ? { 'Content-Type': 'application/json' } : {}, body: hasBody ? JSON.stringify(req.body || {}) : undefined }); res.set('Cache-Control', 'no-store'); res.json(payload); } catch (error) { res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao conectar ao Traccar.', details: error.payload || null }); } });
app.post('/api/webhooks/traccar/fcm', async (req, res) => {
  try {
    if (!config.traccarWebhookSecret) return res.status(503).json({ ok: false, error: 'Defina TRACCAR_WEBHOOK_SECRET antes de ativar o webhook.' });
    if (!firebaseNativeConfigured()) return res.status(503).json({ ok: false, error: 'Defina FIREBASE_SERVICE_ACCOUNT_JSON_B64 antes de ativar FCM.' });
    const providedSecret = String(req.get('x-smartsat-webhook-secret') || req.query.secret || '');
    if (!secretsMatch(providedSecret, config.traccarWebhookSecret)) return res.status(401).json({ ok: false, error: 'Webhook nao autorizado.' });
    const payload = req.body || {};
    const deviceId = webhookDeviceId(payload);
    const registry = readPushRegistry();
    const all = Object.values(registry.tokens || {}).filter((item) => item?.enabled !== false && validFcmToken(item?.token));
    const recipients = deviceId
      ? all.filter((item) => Array.isArray(item.deviceIds) && item.deviceIds.map(Number).includes(deviceId))
      : all.filter((item) => item.administrator === true);
    if (!recipients.length) return res.status(202).json({ ok: true, result: { attempted: 0, sent: 0, failed: 0, reason: deviceId ? 'Nenhum Android autorizado para este dispositivo.' : 'Evento sem deviceId e sem administrador Android registrado.' } });
    const deviceLabel = String(payload?.device?.name || payload?.deviceName || 'Alerta');
    const result = await sendFcmToRecipients(recipients, payload, { title: `SMARTSAT • ${deviceLabel}`.slice(0, 120) });
    res.json({ ok: result.sent > 0, deviceId: deviceId || null, result });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao processar webhook FCM.', details: error.payload || null });
  }
});

app.post('/api/webhooks/traccar/pushover', async (req, res) => {
  try {
    if (!config.traccarWebhookSecret) return res.status(503).json({ ok: false, error: 'Defina TRACCAR_WEBHOOK_SECRET antes de ativar o webhook.' });
    const providedSecret = String(req.get('x-smartsat-webhook-secret') || req.query.secret || '');
    if (!secretsMatch(providedSecret, config.traccarWebhookSecret)) return res.status(401).json({ ok: false, error: 'Webhook nao autorizado.' });
    const payload = await sendPushoverMessage({ title: 'Alerta SMARTSAT', message: formatWebhookMessage(req.body || {}) });
    res.json({ ok: true, result: { status: payload?.status || 1, request: payload?.request || null } });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message || 'Falha ao processar webhook Pushover.', details: error.payload || null });
  }
});
app.use(express.static(distDir, { etag: true, maxAge: '1h', setHeaders(res, filePath) { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store'); } }));
app.get('*', (_req, res) => { res.sendFile(path.join(distDir, 'index.html')); });
app.use((error, _req, res, _next) => { console.error('[server]', error); res.status(500).json({ ok: false, error: 'Erro interno no proxy SMARTSAT RASTREADORES.' }); });
app.listen(config.port, '0.0.0.0', () => { console.log(`SMARTSAT RASTREADORES rodando em 0.0.0.0:${config.port}`); console.log(`Proxy Traccar: ${config.traccarUrl}`); console.log('Auth mode: credenciais Traccar por usuário com cookie HttpOnly'); });
