# SMARTSAT GPS 6.1.1 — Android com notificacoes nativas FCM

## O que foi feito

A base recebida foi preservada. Nao foi reescrita nem simplificada a interface React/Traccar.

O APK passa a ter uma camada Android nativa para notificacoes:

- Firebase Cloud Messaging;
- `FirebaseMessagingService`;
- canal Android de alta importancia;
- permissao Android 13+;
- notificacoes em primeiro plano, segundo plano e quando o app foi removido dos recentes;
- toque no alerta abre SMARTSAT em Eventos e foca o veiculo quando existe `deviceId`;
- registro do token vinculado ao usuario Traccar e aos dispositivos visiveis para aquele usuario;
- teste FCM dentro de Integracoes;
- backend SMARTSAT recebe webhook do Traccar e envia FCM sem colocar Service Account no APK.

## Importante sobre o termo "nativo"

A parte que precisa sobreviver fora do WebView — permissao, FCM, servico Android, notificacao e abertura do app — e nativa Android/Java.

A interface operacional completa continua sendo a interface React atual dentro do Capacitor/WebView. Isso e intencional para preservar mapa, comandos, cameras, relatorios, usuarios e restante do sistema sem uma reescrita que poderia quebrar funcionalidades.

Portanto esta entrega e **APK Android com camada nativa de push**, e nao uma reescrita de todas as telas em Kotlin/Compose.

## Antes de gerar o APK

### GitHub Secrets

Crie:

```text
SMARTSAT_APP_URL
```

Valor: URL HTTPS real do painel SMARTSAT.

Crie:

```text
GOOGLE_SERVICES_JSON
```

Valor: cole o conteudo completo do `google-services.json` gerado no Firebase para:

```text
br.com.smartsatrastreadores.smartsat
```

Se preferir, pode usar `GOOGLE_SERVICES_JSON_B64` no lugar do JSON bruto.

### Railway Variables

Crie:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
TRACCAR_WEBHOOK_SECRET
PUBLIC_APP_URL
SMARTSAT_PUSH_REGISTRY_FILE=/data/mobile-push-tokens.local.json
```

`FIREBASE_SERVICE_ACCOUNT_JSON` recebe o conteudo completo da Service Account do Firebase. Essa credencial fica somente no backend.

Use Railway Volume persistente montado em `/data`.

### Traccar

Configure a notificacao Web/Webhook para:

```text
https://SEU-DOMINIO-SMARTSAT/api/webhooks/traccar/fcm?secret=SEU_TRACCAR_WEBHOOK_SECRET
```

## Gerar APK

GitHub -> Actions -> `SMARTSAT Android Native Push` -> Run workflow.

Artefato:

```text
smartsat-android-native-push-debug-apk
```

## Primeiro uso

1. Instale o APK.
2. Entre com o usuario normal do Traccar.
3. Autorize notificacoes no Android.
4. Abra Integracoes.
5. Confira `Servidor FCM OK` e `APK nativo detectado`.
6. Toque em `Testar FCM`.
7. Depois teste com o app em segundo plano e removido dos recentes.

## Limite do Android

Nao confundir fechar/remover dos recentes com `Forcar parada` nas Configuracoes do Android. Em estado de forca-parada o proprio Android bloqueia o app ate ele ser aberto novamente. O SMARTSAT nao tenta contornar esse bloqueio do sistema operacional.

## Validacoes executadas nesta entrega

- `server.js`: `node --check` aprovado;
- script de preparacao Android: `node --check` aprovado;
- XML Android: validado;
- JSONs: validados;
- workflow YAML: validado;
- JSX: parser TypeScript sem erro de sintaxe;
- Java nativo: validacao de compilacao sintatica/tipos basicos com stubs aprovada;
- script de preparo testado com `google-services.json` de teste para o package correto;
- Gradle completo nao foi executado localmente porque este ambiente nao consegue resolver `services.gradle.org`; o GitHub Actions e a compilacao final real.
