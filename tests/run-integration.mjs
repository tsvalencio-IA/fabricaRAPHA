import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootDir = process.cwd();
const bffPort = 3110;
const mockPort = 3111;
const baseUrl = `http://127.0.0.1:${bffPort}`;
const logs = { mock: '', bff: '' };
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsat-integration-'));

function start(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { logs[name] += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs[name] += chunk.toString(); });
  return child;
}

function stop(child) {
  if (child && child.exitCode === null) child.kill('SIGTERM');
}

async function waitUntilReady(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // O processo ainda está iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Servidor de teste não iniciou em ${url}.`);
}

const mock = start('mock', ['tests/mock-traccar.mjs'], { MOCK_TRACCAR_PORT: String(mockPort) });
const bff = start('bff', ['server.js'], {
  PORT: String(bffPort),
  TRACCAR_URL: `http://127.0.0.1:${mockPort}`,
  TRACCAR_WEBHOOK_SECRET: 'test-secret',
  SMARTSAT_DATA_DIR: testDataDir,
  NODE_ENV: 'test'
});

try {
  await waitUntilReady(`${baseUrl}/api/health`);
  process.env.SMARTSAT_TEST_BASE_URL = baseUrl;
  await import('./api-smoke.mjs');
  process.stdout.write('INTEGRATION_TESTS=PASS\n');
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.stderr.write(`MOCK_LOG\n${logs.mock.slice(-4000)}\n`);
  process.stderr.write(`BFF_LOG\n${logs.bff.slice(-4000)}\n`);
  process.exitCode = 1;
} finally {
  stop(bff);
  stop(mock);
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
