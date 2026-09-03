# Ambiente e variáveis

## Traccar

Valor padrão aplicado conforme referência da tarefa:

```env
TRACCAR_URL=https://gps.smartsatrastreamento.com.br
POLLING_MS=30000
SESSION_TTL_MS=28800000
ALLOW_UNSAFE_GOOGLE_TILES=true
NODE_ENV=production
```

O frontend não usa IP do Traccar diretamente. O navegador fala com o BFF Express e o BFF encaminha para o Traccar usando a sessão HttpOnly.

## Recursos

```env
FEATURE_LIVE_VIDEO=true
FEATURE_DRIVER_IDENTIFICATION=true
PUBLIC_APP_NAME=SMARTSAT
PUBLIC_APP_URL=https://seu-dominio-smartsat.example.com
```

## Câmera ao vivo

O painel usa:

- `POST /api/live-camera/session`
- `POST /api/live-camera/stop`
- `GET /api/stream/{deviceId}/{channel}/live.m3u8`
- fallback `GET /api/stream/{deviceId}/live.m3u8`

O stream é sempre proxied pelo BFF para preservar cookies e evitar expor credenciais no browser.

## Android nativo / Firebase Cloud Messaging

Variaveis do backend Railway para push Android:

```env
FIREBASE_SERVICE_ACCOUNT_JSON=
TRACCAR_WEBHOOK_SECRET=
SMARTSAT_PUSH_REGISTRY_FILE=/data/mobile-push-tokens.local.json
```

Use volume persistente no caminho do registro de tokens. A Service Account Firebase fica somente no backend.

Secrets do GitHub Actions para compilar o APK:

```text
SMARTSAT_APP_URL
GOOGLE_SERVICES_JSON  # ou GOOGLE_SERVICES_JSON_B64
```

Detalhes em `docs/ANDROID_NATIVE_PUSH_SETUP.md`.
