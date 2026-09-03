const BASE_URL = process.env.SMARTSAT_TEST_BASE_URL || 'http://127.0.0.1:3110';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(path, { cookie = '', expectedStatus = 200, ...options } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    },
    redirect: 'manual'
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert(response.status === expectedStatus, `${path}: esperado HTTP ${expectedStatus}, recebido ${response.status}: ${text.slice(0, 300)}`);
  return { response, payload, text };
}

function localCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/smartsat_sid=([^;]+)/);
  assert(match, 'Cookie local de sessão não foi criado.');
  return `smartsat_sid=${match[1]}`;
}

await call('/api/health');
await call('/api/config');
await call('/api/bootstrap', { expectedStatus: 401 });
await call('/api/bootstrap', { cookie: 'smartsat_sid=%', expectedStatus: 401 });
await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'teste', password: 'invalida' }), expectedStatus: 401 });

const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'teste@smartsat.local', password: 'teste-local' }) });
const cookie = localCookie(login.response);
assert(login.payload?.user?.id === 1, 'Usuário de teste inesperado.');

await call('/api/auth/me', { cookie });
const bootstrap = await call('/api/bootstrap', { cookie });
assert(bootstrap.payload.devices?.length === 2, 'Bootstrap não retornou os dispositivos esperados.');
assert(bootstrap.payload.positions?.length === 2, 'Bootstrap não retornou as posições esperadas.');
assert(bootstrap.payload.drivers?.length === 1, 'Bootstrap não retornou o motorista esperado.');

await call('/api/user/profile', { cookie });
await call('/api/user/profile', { cookie, method: 'PUT', body: JSON.stringify({ name: 'Usuário Atualizado', email: 'teste@smartsat.local', phone: '17999999999' }) });
await call('/api/user/profile', { cookie, method: 'PUT', body: JSON.stringify({ latitude: 200 }), expectedStatus: 400 });

const commandTypes = await call('/api/command-types?deviceId=101', { cookie });
assert(commandTypes.payload.some((item) => item.type === 'engineStop'), 'Tipos de comando não foram carregados.');
await call('/api/send-command', { cookie, method: 'POST', body: JSON.stringify({ deviceId: 101, type: 'engineStop', attributes: {} }) });
await call('/api/send-command', { cookie, method: 'POST', body: JSON.stringify({ deviceId: 101, type: 'tipoInventado', attributes: {} }), expectedStatus: 400 });
await call('/api/traccar/commands/send', { cookie, method: 'POST', body: JSON.stringify({ deviceId: 101, type: 'engineStop' }), expectedStatus: 403 });

await call('/api/traccar/reports/route?deviceId=101&from=2026-08-30T00%3A00%3A00.000Z&to=2026-08-31T00%3A00%3A00.000Z', { cookie });
const camera = await call('/api/live-camera/session', { cookie, method: 'POST', body: JSON.stringify({ deviceId: 101, channel: 1 }) });
assert(camera.payload.liveVideoCommandSent === true, 'Comando de vídeo mock não foi enviado.');
assert(camera.payload.snapshotRequested === true, 'Comando de captura mock não foi enviado.');
const stream = await call('/api/stream/101/1/live.m3u8', { cookie });
assert(String(stream.text).startsWith('#EXTM3U'), 'Playlist HLS não foi encaminhada.');
await call('/api/live-camera/stop', { cookie, method: 'POST', body: JSON.stringify({ deviceId: 101, channel: 1 }) });

const readOnlyLogin = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'readonly@smartsat.local', password: 'teste-local' }) });
const readOnlyCookie = localCookie(readOnlyLogin.response);
await call('/api/send-command', { cookie: readOnlyCookie, method: 'POST', body: JSON.stringify({ deviceId: 101, type: 'engineStop', attributes: {} }), expectedStatus: 403 });
const readOnlyCamera = await call('/api/live-camera/session', { cookie: readOnlyCookie, method: 'POST', body: JSON.stringify({ deviceId: 101, channel: 1 }) });
assert(readOnlyCamera.payload.readOnly === true && readOnlyCamera.payload.sent.length === 0, 'Perfil somente leitura tentou enviar comando de câmera.');

await call('/api/webhooks/traccar/pushover?secret=segredo-invalido', { method: 'POST', body: JSON.stringify({ type: 'alarm' }), expectedStatus: 401 });
await call('/api/webhooks/traccar/pushover?secret=test-secret', { method: 'POST', body: JSON.stringify({ type: 'alarm' }), expectedStatus: 503 });
await call('/api/auth/logout', { cookie, method: 'POST', body: '{}' });
await call('/api/auth/me', { cookie, expectedStatus: 401 });

process.stdout.write('API_SMOKE=PASS\n');
