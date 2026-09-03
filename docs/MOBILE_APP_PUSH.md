# SMARTSAT Mobile App e Push

## Estado atual

O SMARTSAT continua com a interface React existente, mas o APK Android agora possui **camada nativa de Firebase Cloud Messaging (FCM)**. O WebView nao precisa estar aberto para o Android exibir notificacoes de eventos do Traccar.

Fluxo:

```text
Traccar -> webhook SMARTSAT -> Railway/Express -> FCM -> Android nativo
```

A implementacao completa e o passo a passo estao em:

- [`ANDROID_NATIVE_PUSH_SETUP.md`](ANDROID_NATIVE_PUSH_SETUP.md)

## PWA

O painel ainda pode ser instalado como PWA. O service worker em `public/sw.js` continua cuidando da experiencia web/cache, mas **push Android real nao depende do PWA**.

## APK Android

O projeto Android fica em:

```text
mobile/capacitor
```

Ele preserva a interface SMARTSAT publicada na Railway e adiciona codigo Android nativo para:

- permissao de notificacao Android 13+;
- Firebase Messaging;
- canal de alertas;
- token FCM;
- abertura do evento/veiculo ao tocar na notificacao.

O workflow atual e:

```text
SMARTSAT Android Native Push
```

O build exige os GitHub Secrets `SMARTSAT_APP_URL` e `GOOGLE_SERVICES_JSON` (ou `GOOGLE_SERVICES_JSON_B64`).

## Backend FCM

Na Railway, configure a Service Account Firebase somente no servidor:

```env
FIREBASE_SERVICE_ACCOUNT_JSON=
TRACCAR_WEBHOOK_SECRET=
SMARTSAT_PUSH_REGISTRY_FILE=/data/mobile-push-tokens.local.json
```

Use volume persistente em `/data`.

Webhook:

```text
POST https://SEU-DOMINIO-SMARTSAT/api/webhooks/traccar/fcm?secret=SEU_SEGREDO
```

## Pushover

Pushover foi preservado como integracao alternativa e continua independente do FCM.
