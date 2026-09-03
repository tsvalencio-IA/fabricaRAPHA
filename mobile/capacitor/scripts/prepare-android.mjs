import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configPath = path.join(root, 'capacitor.config.json');
const googleServicesPath = path.join(root, 'android', 'app', 'google-services.json');
const appId = 'br.com.smartsatrastreadores.smartsat';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Secret/variavel obrigatoria ausente: ${name}`);
  return value;
}

function parseHttpsUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('SMARTSAT_APP_URL precisa ser uma URL HTTPS publica, sem usuario/senha embutidos.');
  }
  return url.toString().replace(/\/+$/, '');
}

function decodeGoogleServices() {
  const rawJson = String(process.env.GOOGLE_SERVICES_JSON || '').trim();
  const rawB64 = String(process.env.GOOGLE_SERVICES_JSON_B64 || '').trim();
  if (!rawJson && !rawB64) {
    throw new Error('Defina GOOGLE_SERVICES_JSON_B64 (recomendado) ou GOOGLE_SERVICES_JSON nos GitHub Secrets.');
  }
  const text = rawJson || Buffer.from(rawB64, 'base64').toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('google-services.json invalido: JSON nao pode ser interpretado.'); }
  const clients = Array.isArray(parsed.client) ? parsed.client : [];
  const packageNames = clients
    .map((item) => item?.client_info?.android_client_info?.package_name)
    .filter(Boolean);
  if (!packageNames.includes(appId)) {
    throw new Error(`google-services.json nao contem o app Android ${appId}. Pacotes encontrados: ${packageNames.join(', ') || 'nenhum'}`);
  }
  if (!parsed?.project_info?.project_id) throw new Error('google-services.json sem project_info.project_id.');
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, projectId: parsed.project_info.project_id };
}

const appUrl = parseHttpsUrl(required('SMARTSAT_APP_URL'));
const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
current.server = { ...(current.server || {}), url: appUrl, cleartext: false };
fs.writeFileSync(configPath, `${JSON.stringify(current, null, 2)}\n`);

const firebase = decodeGoogleServices();
fs.mkdirSync(path.dirname(googleServicesPath), { recursive: true });
fs.writeFileSync(googleServicesPath, firebase.text, { mode: 0o600 });

console.log(`[android] SMARTSAT_APP_URL: ${appUrl}`);
console.log(`[android] Firebase project: ${firebase.projectId}`);
console.log(`[android] Package: ${appId}`);
console.log('[android] Configuracao nativa preparada sem imprimir secrets.');
