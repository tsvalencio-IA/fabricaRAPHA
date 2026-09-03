import http from 'node:http';

const PORT = Number(process.env.MOCK_TRACCAR_PORT || 3111);
const now = new Date();
const earlier = new Date(now.getTime() - 12 * 60 * 1000);

const user = {
  id: 1,
  name: 'Usuário de Teste',
  email: 'teste@smartsat.local',
  phone: '17999999999',
  administrator: true,
  readonly: false,
  deviceReadonly: false,
  disabled: false,
  attributes: {}
};

const readOnlyUser = {
  ...user,
  id: 2,
  name: 'Usuário Somente Leitura',
  email: 'readonly@smartsat.local',
  administrator: false,
  readonly: true,
  deviceReadonly: true
};

const devices = [
  {
    id: 101,
    name: 'Frota Teste 01',
    uniqueId: '860000000000101',
    status: 'online',
    category: 'car',
    lastUpdate: now.toISOString(),
    attributes: { plate: 'ABC1D23', model: 'Honda Civic', blocked: false }
  },
  {
    id: 102,
    name: 'Máquina Agrícola com Nome Muito Longo para Responsividade',
    uniqueId: '860000000000102',
    status: 'offline',
    category: 'tractor',
    lastUpdate: earlier.toISOString(),
    attributes: { plate: 'TRATOR-02', model: 'Colheitadeira', blocked: true }
  }
];

const positions = [
  {
    id: 1001,
    deviceId: 101,
    latitude: -20.812249,
    longitude: -49.375975,
    speed: 24,
    course: 75,
    valid: true,
    address: 'Avenida de Teste, 123 — São José do Rio Preto/SP',
    fixTime: now.toISOString(),
    deviceTime: now.toISOString(),
    serverTime: now.toISOString(),
    attributes: { ignition: true, motion: true, batteryLevel: 87, power: 13.8, driverUniqueId: 'MOTORISTA-01', temperature: 26 }
  },
  {
    id: 1002,
    deviceId: 102,
    latitude: -20.822249,
    longitude: -49.385975,
    speed: 0,
    course: 0,
    valid: true,
    address: 'Fazenda Modelo — Área Operacional',
    fixTime: earlier.toISOString(),
    deviceTime: earlier.toISOString(),
    serverTime: earlier.toISOString(),
    attributes: { ignition: false, motion: false, batteryLevel: 64, power: 12.2, blocked: true }
  }
];

const events = [
  { id: 501, deviceId: 101, type: 'deviceMoving', eventTime: now.toISOString(), attributes: {} },
  { id: 502, deviceId: 102, type: 'alarm', eventTime: earlier.toISOString(), attributes: { alarm: 'powerCut' } }
];

const drivers = [{ id: 301, name: 'Motorista Homologação', uniqueId: 'MOTORISTA-01', attributes: {} }];
const commandTypes = [{ type: 'engineStop' }, { type: 'engineResume' }, { type: 'custom' }, { type: 'videoStart' }, { type: 'videoStop' }, { type: 'requestPhoto' }];

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if ((req.headers['content-type'] || '').includes('application/json')) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname;

  if (path === '/api/session' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.email || !body.password || body.password === 'invalida') return json(res, 401, { message: 'Credenciais inválidas' });
    const selectedUser = String(body.email).includes('readonly') ? readOnlyUser : user;
    const remoteSession = selectedUser.readonly ? 'readonly-session' : 'mock-session';
    return json(res, 200, selectedUser, { 'Set-Cookie': `JSESSIONID=${remoteSession}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (path === '/api/session' && req.method === 'GET') return json(res, 200, String(req.headers.cookie || '').includes('readonly-session') ? readOnlyUser : user);
  if (path === '/api/server') return json(res, 200, { id: 1, registration: false, readonly: false, attributes: { title: 'SMARTSAT Mock' } });
  if (path === '/api/devices') return json(res, 200, devices);
  if (path === '/api/positions') return json(res, 200, positions);
  if (path === '/api/drivers') return json(res, 200, drivers);
  if (path === '/api/reports/events') return json(res, 200, events);
  if (path === '/api/reports/route') return json(res, 200, positions.filter((item) => item.deviceId === Number(url.searchParams.get('deviceId'))));
  if (path === '/api/reports/trips' || path === '/api/reports/stops' || path === '/api/reports/summary') return json(res, 200, []);
  if (path === '/api/commands/types') return json(res, 200, commandTypes);
  if (path === '/api/commands/send' && req.method === 'GET') return json(res, 200, []);
  if (path === '/api/commands/send' && req.method === 'POST') return json(res, 200, { ...(await readBody(req)), id: 9001 });
  if (path === '/api/users/1' && req.method === 'GET') return json(res, 200, user);
  if (path === '/api/users/1' && req.method === 'PUT') return json(res, 200, { ...user, ...(await readBody(req)), id: 1 });
  if (path === '/api/users/2' && req.method === 'GET') return json(res, 200, readOnlyUser);
  if (path === '/api/users/2' && req.method === 'PUT') return json(res, 200, { ...readOnlyUser, ...(await readBody(req)), id: 2 });
  if (path.endsWith('.m3u8')) {
    const body = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n';
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  return json(res, 404, { message: `Mock sem rota: ${req.method} ${path}` });
});

server.listen(PORT, '127.0.0.1', () => process.stdout.write(`mock-traccar:${PORT}\n`));

