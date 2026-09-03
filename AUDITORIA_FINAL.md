# Auditoria final — SMARTSAT GPS

Data: 2026-08-30  
Atualização de validação runtime: 2026-09-01  
Escopo: cópia local recebida em `SMARTSAT-GPS-main(2).zip`  
Critério: correções conservadoras, sem deploy, sincronização, credenciais de produção ou alteração de serviço externo.

## 1. Resumo executivo

O projeto foi inspecionado, corrigido e retestado como aplicação React/Vite com BFF Express e wrapper Android Capacitor. Foram encontrados 20 problemas reproduzíveis: 0 críticos, 5 altos, 10 médios e 5 baixos. Todos os 20 foram corrigidos localmente e receberam validação estática, de build, integração ou navegador compatível com o caso.

O pipeline web final passa em instalação limpa, ESLint, análise sintática do servidor, build de produção e 34 verificações explícitas de integração contra um mock isolado do Traccar. As auditorias npm do projeto web e do wrapper Capacitor terminam com 0 vulnerabilidades. O sincronismo Capacitor/Android também passa.

A validação não é declarada como 100%. A revisão visual/runtime local foi concluída posteriormente com navegador liberado e backend Traccar isolado por mock. O Gradle ainda não pôde baixar sua distribuição devido ao bloqueio de rede. Integração com Traccar real, equipamento GPS/câmera, push e assinatura de release dependem de infraestrutura e credenciais externas e não foram simuladas como sucesso.

## 2. Stack identificada

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, React DOM, React Leaflet, Leaflet |
| Build | Vite 7, plugin React |
| Backend/BFF | Node.js, Express 4, Helmet, rate limiting, compression |
| Vídeo | HLS nativo quando disponível e `hls.js` carregado sob demanda |
| PWA | Manifest, service worker e assets locais |
| Mobile | Capacitor 8, projeto Android/Gradle |
| Qualidade | ESLint 9, testes de integração Node sem serviço externo |
| Pacotes | npm com lockfiles na raiz e em `mobile/capacitor` |
| Integração principal | API Traccar 6.14, com sessão preservada no BFF |

O código de aplicação é JavaScript/JSX; não existe configuração TypeScript, portanto typecheck é não aplicável.

## 3. Problemas encontrados

### SS-001 — HIGH — autorização e bypass de comandos

- **Arquivo:** `server.js`, `src/main.jsx`
- **Causa:** o proxy genérico ainda aceitava a rota de envio de comandos, e o endpoint dedicado não confirmava a permissão somente leitura nem se o tipo era suportado pelo dispositivo.
- **Correção aplicada:** remoção da rota sensível da allowlist genérica; bloqueio para usuário/dispositivo somente leitura; validação de ID, atributos e tipo contra os comandos retornados pelo Traccar; UI também desabilita a ação.
- **Teste realizado:** integração verifica envio permitido, tipo incompatível com HTTP 400, proxy bloqueado com HTTP 403 e usuário somente leitura com HTTP 403.
- **Status:** CORRIGIDO.

### SS-002 — HIGH — segredo de webhook exposto em URL

- **Arquivo:** `server.js`
- **Causa:** o segredo podia ser informado por query string, ficando sujeito a histórico, logs e intermediários.
- **Correção aplicada:** aceitação exclusiva pelo cabeçalho `x-smartsat-webhook-secret` e comparação em tempo constante.
- **Teste realizado:** segredo enviado na query é rejeitado com HTTP 401.
- **Status:** CORRIGIDO.

### SS-003 — HIGH — dependências web vulneráveis

- **Arquivo:** `package-lock.json`
- **Causa:** versões transitivas vulneráveis de `ip-address`, `brace-expansion`, `js-yaml` e `nanoid` (4 ocorrências altas na auditoria completa).
- **Correção aplicada:** atualização conservadora do lockfile e inclusão controlada de `hls.js`, sem migração de versão principal da aplicação.
- **Teste realizado:** `npm ci`, `npm audit` e `npm audit --omit=dev`; resultado final 0 vulnerabilidades.
- **Status:** CORRIGIDO.

### SS-004 — HIGH — dependência vulnerável no wrapper mobile

- **Arquivo:** `mobile/capacitor/package-lock.json`
- **Causa:** versão transitiva vulnerável de `brace-expansion`.
- **Correção aplicada:** atualização do lockfile Capacitor dentro da faixa compatível.
- **Teste realizado:** `npm ci`, `npm audit` e `npm audit --omit=dev` no wrapper; resultado final 0 vulnerabilidades.
- **Status:** CORRIGIDO.

### SS-005 — HIGH — resposta antiga sobrescrevendo estado atual

- **Arquivo:** `src/main.jsx`
- **Causa:** polling e troca rápida de contexto podiam manter requisições anteriores ativas e aplicar dados fora de ordem.
- **Correção aplicada:** suporte a `AbortSignal` no cliente HTTP, cancelamento do snapshot anterior e cleanup em logout/desmontagem.
- **Teste realizado:** ESLint, build de produção e inspeção do ciclo de vida; o teste de integração cobre respostas de bootstrap/snapshot.
- **Status:** CORRIGIDO.

### SS-006 — MEDIUM — buffering sem limite em streams

- **Arquivo:** `server.js`
- **Causa:** playlist e conteúdo de stream podiam ser acumulados sem teto explícito na memória do BFF.
- **Correção aplicada:** limites de 1 MiB para playlists e 24 MiB para segmentos, com aborto controlado da leitura.
- **Teste realizado:** análise sintática, lint, build e reprodução de playlist HLS no teste de integração.
- **Status:** CORRIGIDO.

### SS-007 — MEDIUM — vídeo HLS incompatível com parte dos navegadores

- **Arquivo:** `src/main.jsx`, `package.json`, `package-lock.json`
- **Causa:** a implementação dependia apenas do suporte HLS nativo do elemento de vídeo.
- **Correção aplicada:** fallback com `hls.js`, importação dinâmica, destruição da instância e cancelamento ao fechar/trocar canal.
- **Teste realizado:** ESLint e build; o bundle mostra chunk HLS separado, sem aumentar o chunk principal.
- **Status:** CORRIGIDO.

### SS-008 — MEDIUM — modal de câmera demorava a fechar

- **Arquivo:** `src/main.jsx`
- **Causa:** a interface aguardava a chamada remota de encerramento, sujeita ao timeout de rede.
- **Correção aplicada:** fechamento local imediato, cleanup de mídia e encerramento remoto em melhor esforço; tecla Escape e rótulo acessível adicionados.
- **Teste realizado:** ESLint, build e revisão do fluxo assíncrono.
- **Status:** CORRIGIDO.

### SS-009 — MEDIUM — tipos de comando obsoletos ou artificiais

- **Arquivo:** `src/main.jsx`
- **Causa:** a seleção podia reter o tipo do veículo anterior e sempre expunha a opção `custom`, mesmo sem suporte retornado.
- **Correção aplicada:** reset por veículo, exibição somente de tipos suportados e confirmação antes do envio.
- **Teste realizado:** teste de integração dos tipos válidos/inválidos e build.
- **Status:** CORRIGIDO.

### SS-010 — MEDIUM — submits duplicados

- **Arquivo:** `src/main.jsx`
- **Causa:** login, perfil, relatórios e comandos não possuíam trava consistente durante requisição.
- **Correção aplicada:** flags de execução, botões desabilitados e limites/validações antes do envio.
- **Teste realizado:** lint, build e integração de login, perfil, relatório e comando.
- **Status:** CORRIGIDO.

### SS-011 — MEDIUM — configuração local sem normalização

- **Arquivo:** `server.js`
- **Causa:** porta, intervalos, TTL, prioridade e URL do Traccar podiam aceitar valores inválidos ou inseguros.
- **Correção aplicada:** parsing, limites mínimos/máximos e normalização da URL para HTTP/HTTPS sem credenciais embutidas.
- **Teste realizado:** servidor iniciado com diretório de dados temporário e integração completa.
- **Status:** CORRIGIDO.

### SS-012 — MEDIUM — cookie malformado causava exceção

- **Arquivo:** `server.js`
- **Causa:** decodificação direta de cookie podia lançar erro em percent-encoding inválido.
- **Correção aplicada:** decodificação defensiva e resposta de não autenticado.
- **Teste realizado:** cookie malformado retorna HTTP 401, sem HTTP 500.
- **Status:** CORRIGIDO.

### SS-013 — MEDIUM — perfil aceitava valores fora de faixa

- **Arquivo:** `server.js`, `src/main.jsx`
- **Causa:** latitude, longitude, zoom, textos e atributos não tinham limites uniformes.
- **Correção aplicada:** validação server-side de faixas/tamanhos e restrições correspondentes nos campos.
- **Teste realizado:** perfil válido persiste no diretório temporário; latitude inválida retorna HTTP 400.
- **Status:** CORRIGIDO.

### SS-014 — MEDIUM — branding e upload insuficientemente validados

- **Arquivo:** `src/main.jsx`
- **Causa:** URLs, valores persistidos e imagem de marca não possuíam esquema, formato e tamanho estritos.
- **Correção aplicada:** sanitização do schema no `localStorage`, URLs apenas HTTP(S)/data de imagem segura e upload restrito a JPEG/PNG/WebP de até 2 MiB, com mensagens amigáveis.
- **Teste realizado:** ESLint, build e inspeção dos assets existentes.
- **Status:** CORRIGIDO.

### SS-015 — MEDIUM — configuração Android permissiva

- **Arquivo:** `mobile/capacitor/android/app/src/main/AndroidManifest.xml`
- **Causa:** backup do app e tráfego HTTP claro não estavam explicitamente bloqueados.
- **Correção aplicada:** `android:allowBackup="false"` e `android:usesCleartextTraffic="false"`.
- **Teste realizado:** sincronismo Capacitor passa e o manifesto gerado permanece válido.
- **Status:** CORRIGIDO.

### SS-016 — LOW — acessibilidade e movimento

- **Arquivo:** `src/main.jsx`, `src/styles.css`
- **Causa:** foco visível, semântica de tabs, estado desabilitado, alvo de fechar e preferência de movimento eram incompletos.
- **Correção aplicada:** `:focus-visible`, ARIA em tabs/modal, estados desabilitados e `prefers-reduced-motion`.
- **Teste realizado:** ESLint, build e revisão estática de semântica/estilos.
- **Status:** CORRIGIDO.

### SS-017 — LOW — arraste dependia de mouse

- **Arquivo:** `src/main.jsx`, `src/styles.css`
- **Causa:** o painel flutuante usava eventos exclusivos de mouse.
- **Correção aplicada:** migração para Pointer Events, captura do ponteiro, cleanup de listeners e `touch-action` apropriado.
- **Teste realizado:** ESLint e build.
- **Status:** CORRIGIDO.

### SS-018 — LOW — ergonomia em telas pequenas

- **Arquivo:** `src/styles.css`
- **Causa:** alvos touch, viewport de baixa altura, teclado virtual e safe area podiam limitar o acesso a controles.
- **Correção aplicada:** alvos mínimos de 44 px, scroll no cartão de login, unidades dinâmicas/safe areas e ajustes para baixa altura.
- **Teste realizado:** inspeção dos breakpoints, build e execução gráfica em 320, 360, 375, 390, 412, 430, 768, 1024 e 1440 px.
- **Status:** CORRIGIDO.

### SS-019 — LOW — cache PWA e scripts de operação

- **Arquivo:** `public/sw.js`, `git-sync.sh`, `install-smartsat-final.sh`, `testar-local.sh`, `mobile/capacitor/android/gradlew`
- **Causa:** versão de cache não distinguia o pacote corrigido e scripts necessários não estavam executáveis na cópia recebida.
- **Correção aplicada:** incremento do cache para `v5` e permissões executáveis restauradas.
- **Teste realizado:** `node --check public/sw.js`, inspeção de permissões e sincronismo Capacitor.
- **Status:** CORRIGIDO.

### SS-020 — LOW — animação do mapa sobrevivia à troca de módulo

- **Arquivo:** `src/MapViewportController.jsx`
- **Causa:** o enquadramento inicial animado do Leaflet podia manter um frame de pan ativo quando o dashboard era desmontado imediatamente, causando de forma intermitente `Cannot read properties of undefined (reading '_leaflet_pos')`.
- **Correção aplicada:** o enquadramento inicial da frota passou a ser atômico (`animate: false`), preservando centro, padding e zoom sem deixar animação pendente durante a troca de módulo.
- **Teste realizado:** reprodução no navegador em viewport mobile, build e matriz runtime de nove viewports com trocas repetidas entre Dashboard, Veículos, Relatórios e Comandos.
- **Status:** CORRIGIDO.

## 4. Correções funcionais

- Sessão, login, logout e cookies passaram a falhar de forma controlada.
- Bootstrap, snapshot, perfil, relatórios, comandos e câmera receberam validação de erros e concorrência.
- Envio de comandos respeita permissões e recursos reais retornados pelo Traccar.
- Usuários/dispositivos somente leitura podem consultar stream existente, mas não acionam comandos remotos.
- Modais e requisições podem ser cancelados sem deixar loading permanente.
- Testes usam `SMARTSAT_DATA_DIR` temporário, sem contaminar `data/` do projeto.

## 5. Correções mobile

- Alvos principais ajustados para pelo menos 44 px em mobile.
- Login pode rolar em viewport baixa ou com teclado virtual e respeita safe areas.
- Painel arrastável usa mouse, toque e caneta via Pointer Events.
- Controles de câmera, canais e popups receberam ajustes touch.
- Manifesto Android bloqueia backup e cleartext.
- Assets web e configuração foram sincronizados para o projeto Android com `npm run android:sync`.

Revisão estática e inspeção runtime cobrem 320, 360, 375, 390, 412, 430, 768, 1024 e 1440 px, incluindo tablet em landscape e regras de safe area.

## 6. Correções visuais

- Estados de foco, tabs, botões desabilitados e redução de movimento foram padronizados.
- O cartão de login ganhou contenção para baixa altura e teclado virtual.
- Logos claro/escuro e backgrounds desktop/mobile foram inspecionados localmente: proporção e contraste são coerentes e não há asset quebrado.
- O branding SMARTSAT e a estrutura visual existente foram preservados.

Validação visual: **PASS no escopo local**. Login e dashboard foram capturados em todos os nove viewports; Veículos, modal de câmera/fechamento por Escape, Relatórios e Comandos foram exercitados. Não houve overflow global ou quebra visual crítica nas capturas inspecionadas.

## 7. Segurança

- 0 vulnerabilidades em `npm audit` na raiz e no Capacitor.
- Rota genérica não pode enviar comandos.
- Read-only é aplicado no servidor, não apenas na interface.
- Segredo de webhook fica fora da URL e usa comparação em tempo constante.
- Cookies malformados, IDs, tipos, perfil, atributos, branding e upload recebem validação.
- Sessões em memória têm expiração, limpeza e teto de 10.000 entradas.
- Streams e notificações externas têm limites/timeouts.
- Android não permite backup do app nem cleartext.
- Varredura final não encontrou credenciais, arquivos locais de configuração ou `google-services.json` real no pacote.

## 8. Performance

- `hls.js` é carregado apenas quando necessário e ficou em chunk separado.
- Polling anterior é cancelado para evitar trabalho duplicado e atualização fora de ordem.
- Listeners, HLS, timers e requests adicionados possuem cleanup.
- Limites de buffer impedem consumo de memória sem teto no proxy de mídia.
- Build final não emitiu warning de tamanho de chunk.

## 9. Dependências

| Projeto | Instalação limpa | Auditoria produção | Auditoria completa |
|---|---:|---:|---:|
| Web/BFF | PASS | 0 vulnerabilidades | 0 vulnerabilidades |
| Capacitor | PASS | 0 vulnerabilidades | 0 vulnerabilidades |

Foi adicionada somente a dependência funcional `hls.js`. Não foram feitas atualizações agressivas de framework.

## 10. Testes executados

| Validação | Resultado | Evidência/escopo |
|---|---|---|
| `npm ci` (raiz) | PASS | instalação a partir do lockfile |
| `npm ci` (Capacitor) | PASS | instalação a partir do lockfile |
| `npm test` | PASS | ESLint + sintaxe do servidor + build + integração |
| ESLint | PASS | 0 erros e 0 warnings |
| `node --check server.js` | PASS | análise sintática |
| `node --check public/sw.js` | PASS | service worker |
| Build Vite | PASS | produção, 1.624 módulos transformados |
| Integração BFF/Traccar mock | PASS | 34 verificações explícitas; auth, perfil, relatórios, comandos, câmera, HLS, read-only e logout |
| `npm audit` (raiz) | PASS | 0 vulnerabilidades |
| `npm audit --omit=dev` (raiz) | PASS | 0 vulnerabilidades |
| `npm audit` (Capacitor) | PASS | 0 vulnerabilidades |
| `npm audit --omit=dev` (Capacitor) | PASS | 0 vulnerabilidades |
| `npm run android:sync` | PASS | assets/config/plugins sincronizados |
| Ausência de dados locais após testes | PASS | nenhum `config.local.json` criado no projeto |
| Gradle unit/build | NÃO EXECUTADO | download do Gradle bloqueado pela rede do ambiente |
| Browser/console/network gráfico | PASS | 9 viewports; login, dashboard e módulos principais; 0 exceções JS e 0 falhas inesperadas de rede |
| Traccar e equipamento reais | NÃO EXECUTADO | requer credenciais, serviço e hardware externos |

Os testes automatizados não enviam comando a equipamento real: todo o tráfego usa um mock local descartável.

## 11. Resultado do build

Build de produção: **PASS**.

```text
dist/index.html                     1.11 kB (gzip 0.52 kB)
dist/assets/index-*.css            88.38 kB (gzip 20.60 kB)
dist/assets/index-*.js            455.02 kB (gzip 139.28 kB)
dist/assets/hls-*.js              591.68 kB (gzip 185.19 kB, lazy)
```

Não houve erro de import, asset, bundling ou warning de tamanho de chunk. `dist/` foi usado apenas para validação e não integra o ZIP final.

## 12. Problemas eventualmente não solucionáveis localmente

1. **URL pública mobile:** `mobile/capacitor/capacitor.config.json` contém `https://seu-dominio-smartsat.example.com`. Ela precisa ser substituída pela URL HTTPS pública do frontend antes de uma build de loja; não foi inventado um domínio.
2. **Gradle:** o wrapper tentou obter a distribuição Gradle 8.14.3, mas a rede do ambiente recusou a conexão. Não havia Gradle pré-instalado.
3. **Integrações reais:** Traccar de produção, comandos JT808/JT1078, câmera, GPS físico, Firebase/push, assinatura e publicação de loja exigem serviços, hardware ou credenciais não fornecidos.
4. **Escala horizontal:** sessões continuam em memória por compatibilidade arquitetural; produção com múltiplas instâncias deve usar armazenamento compartilhado, como Redis.

Esses itens são pré-requisitos operacionais externos; não representam falha reproduzível no build/teste local entregue.

## 13. Estado final

| Área | Estado |
|---|---|
| Build | PASS |
| Lint/análise estática | PASS |
| Typecheck | N/A — projeto JavaScript |
| Testes automatizados | PASS |
| Segurança | PASS |
| Performance | PASS |
| Mobile | PARCIAL — código e sync aprovados; runtime/Gradle limitado pelo ambiente |
| Auditoria visual | PASS — matriz runtime em 9 viewports e fluxos principais |

**Contagem final:** 20 encontrados, 20 corrigidos, 0 defeitos reproduzíveis conhecidos restantes no escopo local. Existem 4 pré-requisitos/limitações externas documentados acima.

### Checklist final

- [x] instalação web e mobile funciona
- [x] build web funciona
- [x] lint e análise estática validados
- [x] testes automatizados passam
- [x] erros críticos/altos reproduzíveis corrigidos
- [x] login, logout, sessão, perfil, relatórios, comandos e câmera revisados por integração
- [x] mapas, navegação, formulários e estados assíncronos revisados no código
- [x] acessibilidade básica, performance e segurança revisadas
- [x] regressões e dependências retestadas
- [x] relatório final criado
- [x] projeto final limpo e compactado
- [x] console/network no navegador gráfico — sem exceções JS ou falhas inesperadas
- [x] execução visual dos viewports 320–430 px, tablet e desktop
- [ ] Gradle/APK — download externo bloqueado
- [ ] Traccar, câmera, GPS, push e assinatura reais — dependências externas
