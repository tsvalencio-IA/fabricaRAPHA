# SMARTSAT Android — push nativo em segundo plano

Esta versao preserva o painel React/Traccar existente e adiciona uma camada Android nativa para notificacoes via Firebase Cloud Messaging (FCM).

## O que funciona

- notificacao Android com o app em primeiro plano;
- notificacao com o app em segundo plano;
- notificacao com o app removido da tela de apps recentes;
- toque na notificacao abre o SMARTSAT na aba Eventos e seleciona o veiculo quando o Traccar informou `deviceId`;
- permissao `POST_NOTIFICATIONS` em Android 13+;
- canal nativo `smartsat_alerts` com alta importancia;
- token FCM associado ao usuario Traccar autenticado e somente aos dispositivos que esse usuario consegue consultar;
- exclusao do token do backend ao sair da conta;
- teste FCM dentro de Integracoes.

## Limite do Android

"Fechar" ou remover o app dos recentes nao e o mesmo que **Forcar parada**. Se o usuario abrir Configuracoes do Android e tocar em `Forcar parada`, o sistema operacional coloca o app em estado parado e push pode deixar de ser entregue ate o app ser aberto novamente. O SMARTSAT nao tenta burlar esse comportamento do Android.

## Arquitetura

```text
Traccar 6.14
   -> notificacao Web/Webhook
   -> POST /api/webhooks/traccar/fcm
SMARTSAT Express / Railway
   -> verifica segredo
   -> identifica deviceId do evento
   -> seleciona somente Androids de usuarios autorizados ao dispositivo
   -> Firebase Cloud Messaging HTTP v1
Android
   -> FirebaseMessagingService / servico do FCM
   -> notificacao do sistema
```

A chave administrativa do Firebase **nunca entra no APK**. Ela fica somente no backend Railway.

## 1. Firebase — criar o app Android

No Firebase Console:

1. Abra/crie o projeto usado para push SMARTSAT.
2. Adicione um aplicativo Android com package exatamente:

```text
br.com.smartsatrastreadores.smartsat
```

3. Baixe `google-services.json`.
4. Gere uma Service Account para o backend (arquivo JSON com `client_email`, `private_key` e `project_id`).

Nao use a Service Account dentro do Android.

## 2. GitHub Secrets — somente build do APK

No repositorio, abra `Settings -> Secrets and variables -> Actions` e crie:

```text
SMARTSAT_APP_URL
```

Valor: a URL HTTPS publica real do painel SMARTSAT na Railway, por exemplo `https://SEU-DOMINIO.up.railway.app`.

Crie tambem:

```text
GOOGLE_SERVICES_JSON
```

Valor: cole o conteudo completo do arquivo `google-services.json`. Se preferir Base64, use o secret alternativo `GOOGLE_SERVICES_JSON_B64`. O workflow aceita qualquer um dos dois e recria o arquivo somente durante o build.

O script `mobile/capacitor/scripts/prepare-android.mjs` valida que o JSON pertence ao package correto antes de compilar.

## 3. Railway Variables — backend que envia FCM

Adicione ao Web Service SMARTSAT:

```env
FIREBASE_SERVICE_ACCOUNT_JSON=<conteudo completo do service-account.json>
TRACCAR_WEBHOOK_SECRET=<segredo longo e aleatorio>
PUBLIC_APP_URL=https://SEU-DOMINIO-SMARTSAT
SMARTSAT_PUSH_REGISTRY_FILE=/data/mobile-push-tokens.local.json
```

O arquivo de registro de tokens precisa ficar em volume persistente. Monte um Railway Volume em `/data` ou ajuste `SMARTSAT_PUSH_REGISTRY_FILE` para um caminho persistente.

Se o container for recriado sem volume, os tokens registrados serao perdidos e cada usuario tera de abrir o APK novamente para se registrar.

## 4. Traccar — enviar eventos para FCM

Crie/edite uma notificacao Web/Webhook no Traccar para os eventos desejados e use:

```text
https://SEU-DOMINIO-SMARTSAT/api/webhooks/traccar/fcm?secret=SEU_TRACCAR_WEBHOOK_SECRET
```

O backend aceita o payload do evento e usa o `deviceId` para selecionar somente aparelhos de usuarios que tem acesso ao veiculo.

Eventos sem `deviceId` sao enviados somente a Androids registrados por administradores.

## 5. Gerar o APK

Depois de cadastrar os secrets:

1. GitHub -> Actions.
2. Abra `SMARTSAT Android Native Push`.
3. `Run workflow`.
4. Baixe o artefato `smartsat-android-native-push-debug-apk`.
5. Instale `app-debug.apk`.
6. Entre com o mesmo usuario Traccar.
7. Autorize notificacoes quando o Android perguntar.
8. Abra `Integracoes` e clique `Testar FCM`.

## 6. Teste correto de segundo plano

1. Deixe o usuario autenticado no APK.
2. Confirme que `Integracoes` mostra `Servidor FCM OK` e `APK nativo detectado`.
3. Toque em `Testar FCM`.
4. Volte para a tela inicial do Android e teste novamente.
5. Remova o SMARTSAT dos apps recentes e provoque um evento no Traccar.
6. A notificacao deve aparecer na bandeja do Android.
7. Toque nela: o SMARTSAT abre em Eventos e foca o veiculo do alerta quando houver `deviceId`.

Nao use `Forcar parada` nesse teste, pois isso testa um bloqueio do proprio Android, nao o funcionamento normal em background.

## Seguranca

- Service Account: somente Railway, nunca browser ou APK.
- `TRACCAR_WEBHOOK_SECRET`: somente Railway + configuracao do webhook Traccar.
- FCM token: armazenado no backend em arquivo privado mode 600 e associado ao usuario/dispositivos autorizados.
- `google-services.json`: usado pelo build Android; nao concede permissao administrativa ao Firebase.
