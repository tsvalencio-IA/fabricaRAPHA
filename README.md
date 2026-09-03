# SMARTSAT GPS

Frontend SMARTSAT para Traccar 6.14 com BFF Express, mapa em tempo real, comandos seguros, identificação de motoristas e webview de câmera ao clicar na placa.

## Principais recursos

- Login por credenciais Traccar com cookie local HttpOnly.
- Proxy seguro no `server.js`; credenciais não ficam no React/browser.
- Rate limit, Helmet, CSP, timeout, cache control e allowlist de endpoints.
- Dashboard com mapa, camadas, frota, alertas, comandos, atributos e relatórios.
- Placa clicável abre câmera em webview e solicita imagem ao vivo quando o Traccar retorna comando compatível.
- Motorista atual resolvido por `position.attributes.driverUniqueId`, com match opcional em `Driver.uniqueId`.

## Instalação local

```bash
npm ci
npm test
npm start
```

`npm test` executa lint, análise sintática do servidor, build de produção e integração do BFF contra um mock Traccar isolado. Para executar somente a integração, use `npm run test:integration`.

Durante desenvolvimento:

```bash
npm run dev
```

## Configuração segura

Exemplo de `data/config.local.json`:

```json
{
  "traccarUrl": "https://gps.smartsatrastreamento.com.br",
  "port": 3000,
  "pollingMs": 30000,
  "authMode": "traccar-user-session",
  "featureLiveVideo": true,
  "featureDriverIdentification": true,
  "allowUnsafeGoogleTiles": true
}
```

Também pode usar variáveis Railway:

```env
TRACCAR_URL=https://gps.smartsatrastreamento.com.br
POLLING_MS=30000
SESSION_TTL_MS=28800000
NODE_ENV=production
```

## Identidade visual

As artes padrão ficam em `public/brand/`:

- `smartsat-logo-light.png`: tema claro.
- `smartsat-logo-dark.png`: tema escuro.
- `smartsat-logo-light-transparent.png`: versão transparente para fundos claros.
- `smartsat-logo-dark-transparent.png`: versão transparente para fundos escuros.
- `smartsat-icon-1024.png`: ícone quadrado usado pelo PWA e pelo launcher Android.

O tema pode ser alternado na própria tela de login. O painel seleciona automaticamente a logo correspondente.

O wrapper em `mobile/capacitor/` inclui o projeto Android, ícones normal/redondo/adaptativo e splashes específicos para os temas claro e escuro. O workflow `SMARTSAT Android` gera um APK debug verificável no GitHub Actions.

Antes de gerar uma versão de loja, substitua a URL ilustrativa de `mobile/capacitor/capacitor.config.json` pela URL HTTPS real do frontend publicado e execute `npm run android:sync` dentro de `mobile/capacitor`.

## Câmera ao vivo

Fluxo implementado:

- Clicar na placa do veículo no mapa, lista ou tabela.
- Abrir webview de câmera.
- Chamar `POST /api/live-camera/session`.
- Solicitar imagem ao vivo se houver comando compatível ou comando salvo no Traccar.
- Abrir HLS via `/api/stream/{deviceId}/{channel}/live.m3u8`.

Vídeo e imagem dependem de suporte real do equipamento, canal, comandos do Traccar e servidor de stream.

## Railway

Use Railway como Web Service Node/Express.

- Guia operacional: [`docs/RAILWAY_DEPLOY.md`](docs/RAILWAY_DEPLOY.md)
- Deploy detalhado: [`docs/DEPLOYMENT_RAILWAY.md`](docs/DEPLOYMENT_RAILWAY.md)
- App mobile e push: [`docs/MOBILE_APP_PUSH.md`](docs/MOBILE_APP_PUSH.md)
- Wrapper Android/WebView: [`mobile/capacitor`](mobile/capacitor)
- Plano de evolução: [`docs/LONG_TERM_PLAN.md`](docs/LONG_TERM_PLAN.md)
- Configuração versionada: [`railway.toml`](railway.toml)

O Traccar continua rodando separado. A Railway hospeda apenas o frontend SMARTSAT e o proxy Express que consome a API do Traccar.


## Android nativo e notificacoes em segundo plano

O projeto preserva o painel SMARTSAT existente e adiciona uma camada Android nativa de Firebase Cloud Messaging. Eventos do Traccar podem chegar como notificacoes do sistema mesmo com o WebView em segundo plano ou com o app removido dos recentes.

Configuracao completa: [`docs/ANDROID_NATIVE_PUSH_SETUP.md`](docs/ANDROID_NATIVE_PUSH_SETUP.md).
