# SMARTSAT Android — camada nativa + painel SMARTSAT

Este pacote gera o APK Android SMARTSAT. A interface operacional continua vindo do painel HTTPS publicado, sem duplicar nem simplificar as funcionalidades do React/Traccar, enquanto notificacoes passam por uma camada Android nativa via Firebase Cloud Messaging.

## Recursos Android nativos

- `FirebaseMessagingService`;
- notificacoes em background / app removido dos recentes;
- permissao `POST_NOTIFICATIONS` no Android 13+;
- canal `smartsat_alerts`;
- ponte nativa controlada para registrar o token FCM no backend autenticado;
- toque na notificacao abre Eventos e informa o `deviceId` ao painel.

## Build GitHub Actions

Workflow:

```text
SMARTSAT Android Native Push
```

Secrets obrigatorios:

```text
SMARTSAT_APP_URL
GOOGLE_SERVICES_JSON
```

`SMARTSAT_APP_URL` deve ser a URL HTTPS publica real do SMARTSAT.

`GOOGLE_SERVICES_JSON` deve conter o `google-services.json` de um Firebase Android app registrado exatamente como:

```text
br.com.smartsatrastreadores.smartsat
```

O workflow chama `scripts/prepare-android.mjs`, valida os dados, sincroniza Capacitor e compila `app-debug.apk`.

Artefato:

```text
smartsat-android-native-push-debug-apk
```

## Backend

O APK nao contem Service Account. O envio FCM e feito pelo `server.js` no backend Railway. Veja `../../docs/ANDROID_NATIVE_PUSH_SETUP.md`.
