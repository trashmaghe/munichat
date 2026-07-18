# Estrutura do Código — Elyzian

> Documento em português (pt-BR) descrevendo a organização completa do
> repositório: o que é cada pasta, cada módulo e como as peças se conectam.
> Reflete o estado atual do código (Fases 1–6 completas).

## Visão geral

O Elyzian é uma plataforma de chat corporativo em tempo real, auto-hospedada,
feita para a Prefeitura Municipal de Nova Serrana. Substitui WhatsApp/Spark por
uma ferramenta interna com **login via Active Directory**, **canais por
departamento** (criados automaticamente a partir dos grupos do AD) e **abertura
de chamados no GLPI** direto do chat.

É um **monorepo** gerenciado por *npm workspaces*, com três pacotes:

```
elyzian/
├── apps/
│   ├── api/          # Backend NestJS (API REST + WebSocket)
│   └── web/          # Frontend React (SPA)
├── packages/
│   └── shared/       # Tipos/contratos TypeScript compartilhados (DTOs Zod)
├── docker/           # Docker Compose para desenvolvimento local
├── k8s/              # Manifests Kubernetes para produção
└── docs/             # Documentação
```

O `packages/shared` é a peça-chave da arquitetura: ele define os **contratos**
(schemas Zod e tipos) usados tanto pelo backend quanto pelo frontend, o que
impede que cliente e servidor "briguem" sobre o formato dos dados.

## Fluxo de dados (alto nível)

```
Navegador (React)
   │  HTTP (login, histórico, upload)  ┌──────────────┐
   ├──────────────────────────────────►│  API NestJS  │
   │  WebSocket (mensagens ao vivo)     │              │
   └──────────────────────────────────►│  ┌────────┐  │
                                        │  │Gateway │  │
                                        │  └────────┘  │
                                        └───┬───┬───┬──┘
                          ┌─────────────────┘   │   └──────────────┐
                          ▼                      ▼                  ▼
                    PostgreSQL              Redis (pub/sub,     MinIO (S3)
                    (Prisma)                sessões, presença)  arquivos
                          │                      │
                          │                      └─► BullMQ (filas: link preview)
                          ▼
                    Active Directory (LDAP)  ·  GLPI (REST, chamados)
```

---

## `packages/shared` — Contratos compartilhados

Fonte única de verdade para os formatos de dados. Cada arquivo `*.dto.ts` define
um schema Zod + o tipo TypeScript inferido; os testes `*.dto.test.ts` validam os
schemas.

| Arquivo | Papel |
|---|---|
| `auth.dto.ts` | Requisição de login e resposta com o usuário atual |
| `user.dto.ts` | Representação de usuário (completa e resumida) |
| `channel.dto.ts` | Canal e membros de canal |
| `message.dto.ts` | Mensagem, anexos pendentes, editar/apagar/responder |
| `attachment.dto.ts` | Metadados de anexo e presign de upload |
| `link-preview.dto.ts` | Pré-visualização de links (Open Graph) |
| `ticket-ref.dto.ts` | Referência a um chamado GLPI |
| `rmm.dto.ts` | Inventário de agentes, payload do webhook de alerta e URLs de controle remoto (MeshCentral) do Tactical RMM |
| `socket-events.dto.ts` | **Contrato dos eventos WebSocket** (nomes e payloads) |
| `health.dto.ts` | Resposta do health check |
| `enums.ts` | Espelho dos enums do Prisma (ChannelType, MessageType, etc.) |

O `socket-events.dto.ts` é especialmente importante: o `enum SocketEvent`
(ex.: `message:send`, `message:new`, `presence:update`, `typing:start`) é
consumido pelo gateway no backend **e** pelo cliente socket no frontend, então
os dois lados nunca divergem sobre nomes de evento.

---

## `apps/api` — Backend (NestJS)

NestJS 11 em TypeScript. Ponto de entrada em `src/main.ts`, que configura:
CORS, `cookie-parser`, `ValidationPipe` global (whitelist + transform),
`trust proxy` (para o `req.ip` resolver corretamente atrás do ingress) e o
**adaptador Redis do Socket.IO** (para escalar horizontalmente).

O `src/app.module.ts` importa todos os módulos de funcionalidade. Cada
funcionalidade é um módulo NestJS isolado. Abaixo, módulo a módulo.

### Rate limiting (Fase 6)

`ThrottlerModule.forRootAsync` em `app.module.ts`, com storage no **Redis**
(`@nest-lab/throttler-storage-redis`, sobre o mesmo `ioredis`/`REDIS_URL` já
usado no resto do app) e um `ThrottlerGuard` global (`APP_GUARD`). Isso garante
que o limite seja consistente entre **múltiplas instâncias** da API atrás do
HPA do Kubernetes — cada instância não tem seu próprio contador isolado.

- Limite global: 100 req/min por IP.
- `POST /auth/login`: 5/min por IP (`@Throttle` no controller) — o de maior
  valor de segurança, protege contra força bruta.
- `POST /auth/refresh` e `POST /files/presign`: 20/min por IP.
- O gateway WebSocket **não** passa pelo guard HTTP (`message:send` não é
  limitado por aqui); ficou documentado como não-feito, não implementado.

### `prisma/` — Banco de dados

- `schema.prisma` — modelo de dados completo.
- `migrations/` — migrations versionadas (init, campos de auth, índices de chat,
  relação de resposta + status de link preview, índice de ticket).
- `src/prisma/prisma.service.ts` — wrapper do `PrismaClient` como provider
  injetável do Nest.

**Modelos principais:** `User`, `Channel`, `ChannelMember`, `Message`,
`Attachment`, `LinkPreview`, `TicketRef`, `AuditLog`.

Detalhes importantes do schema:
- `User.tokenVersion` — incrementá-lo invalida **todos** os tokens do usuário de
  uma vez (logout global / bloqueio imediato).
- `User.adObjectGuid` — chave estável do usuário no Active Directory (identidade
  não muda mesmo se o login mudar).
- `Message` tem auto-relação `replyTo`/`replies` (respostas) e `deletedAt`
  (soft delete — a mensagem é esvaziada, não removida).
- Índice `@@index([channelId, createdAt, id])` — dá suporte à paginação por
  *keyset* do histórico (mais eficiente que `OFFSET`).

### `auth/` — Autenticação (Fase 2)

O coração da segurança. Login é feito contra o Active Directory via LDAP.

| Arquivo | Papel |
|---|---|
| `ldap.service.ts` | Busca o usuário no AD e verifica a senha (bind LDAP). Escapa valores de filtro contra *LDAP injection*. |
| `auth.service.ts` | Orquestra login/refresh/logout. Emite par de tokens JWT (access + refresh) e faz *upsert* do usuário no banco. |
| `channel-sync.service.ts` | Lê o `memberOf` do AD e sincroniza os canais/departamentos do usuário no banco. |
| `access-token.validator.ts` | **Ponto único** que decide se um access token ainda é válido (usuário ativo + `tokenVersion` bate). Usado pelo HTTP e pelo WebSocket. |
| `auth.controller.ts` | Rotas `POST /auth/login`, `/refresh`, `/logout`. Grava os tokens em cookies `httpOnly`. |
| `strategies/jwt.strategy.ts` | Estratégia Passport que lê o token do cookie e chama o validator. |
| `guards/jwt-auth.guard.ts` | Guard que protege rotas HTTP. |
| `decorators/current-user.decorator.ts` | `@CurrentUser()` — injeta o usuário autenticado no controller. |

**Modelo de tokens:**
- *Access token* curto (900s por padrão), guardado em cookie `httpOnly`.
- *Refresh token* de uso único (rotativo): a cada refresh, o antigo é invalidado.
  O `jti` do refresh fica registrado no Redis; revogar = apagar do Redis.
- Isso garante: se um refresh token vaza e é usado, o legítimo detecta o roubo
  na próxima rotação.

### `channels/` — Canais

- `channels.service.ts` — lista canais do usuário, checa se é membro
  (`isMember`), busca membros.
- `channels.controller.ts` — `GET /channels`, `GET /channels/:id/members`.
- `channel-response.mapper.ts` — converte a entidade do Prisma no DTO do
  `packages/shared`.

Regra de negócio importante: **membros de canal só mudam no login** (via sync do
AD), nunca no meio da sessão. Isso simplifica a lógica de *rooms* do WebSocket.

**Não lidas por canal:** `GET /channels` também retorna `unreadCount` por
canal (`ChannelsService.getUnreadCounts`, uma query `count` por canal do
usuário — `lastReadAt` nulo conta todas as mensagens não deletadas; caso
contrário conta `createdAt > lastReadAt`). Marcar como lido é feito via socket
(`channel:read` em `chat.gateway.ts`, não REST — segue o mesmo padrão de
`message:edit`/`message:delete`), e nunca é retransmitido para o resto do
canal: é estado privado do próprio usuário, não um "visto por" público.
Enviar uma mensagem também marca o próprio remetente como tendo lido até ali
(senão a mensagem que a pessoa acabou de mandar apareceria como não lida para
ela mesma). Limitação conhecida: sem *room* por usuário no gateway, marcar
como lido numa aba não propaga em tempo real para outras abas/dispositivos do
mesmo usuário — elas só sincronizam no próximo `GET /channels`.

### `messages/` — Mensagens

- `messages.service.ts` — cria mensagens (inclusive detectando o comando
  `/ticket` e URLs para link preview), busca histórico paginado por keyset,
  edita e faz soft delete. Valida o tamanho real dos anexos contra o MinIO
  antes de persistir. Também tem o método `search` (busca full-text, ver
  abaixo).
- `messages.controller.ts` — `GET /channels/:channelId/messages` (histórico).
- `messages-search.controller.ts` — `GET /messages/search?q&channelId&cursor`
  (Fase 6). Rota separada (não aninhada em `/channels/:id`) porque a busca
  pode cobrir vários canais de uma vez.
- `message-response.mapper.ts` — mapeia entidade → DTO e codifica/decodifica o
  *cursor* de paginação (reaproveitado pela busca também).
- `dto/message-history-query.dto.ts`, `dto/message-search-query.dto.ts` —
  validação dos parâmetros de query.

**Busca full-text (Fase 6):** usa `tsvector`/`tsquery` nativos do Postgres com
dicionário `portuguese`. Como `to_tsvector(regconfig, text)` é `STABLE` (não
`IMMUTABLE`), não dá para indexar a expressão diretamente — a migration
`20260715120000_add_message_search_tsvector` cria uma função SQL
`message_search_vector(content)` marcada `IMMUTABLE` (o padrão documentado do
Postgres para configuração fixa) e um índice GIN sobre ela. Essa migration é
**escrita à mão**, não gerada pelo `prisma migrate dev` — o `schema.prisma`
continua sem nenhuma coluna nova, porque o Prisma não modela `tsvector`.

O serviço só usa `$queryRaw` para a query de busca/ranking (que precisa do
operador `@@`); os ids retornados são então buscados de novo via
`prisma.message.findMany` normal, reaproveitando o mesmo `MESSAGE_INCLUDE` e
`toMessageDto` do histórico — a parte "crua" fica isolada a uma única query
pequena. **Regra de autorização:** só busca em canais dos quais o usuário é
membro (`channelId` explícito é checado com `isMember`; sem `channelId`, a
busca cobre todos os canais retornados por `listForUser`). Mensagens com
`deletedAt` preenchido são sempre excluídas.

### `chat/` — Tempo real (Fase 3)

O gateway WebSocket (Socket.IO) e tudo que sustenta o "ao vivo".

| Arquivo | Papel |
|---|---|
| `chat.gateway.ts` | O `@WebSocketGateway`. Trata `message:send/edit/delete`, `typing:start/stop` e presença. Autentica no *handshake* (via `io.use`). |
| `chat-auth.service.ts` | Autentica o socket lendo o cookie do handshake e chamando o `access-token.validator`. |
| `presence.service.ts` | Presença online/offline no Redis: um contador por usuário (correto com múltiplas abas) + um *Set* de usuários online. |
| `redis-io.adapter.ts` | Adaptador que faz o Socket.IO funcionar entre **várias instâncias** da API via Redis pub/sub. |
| `channel-room.ts` | Helper que gera o nome da *room* de um canal (`channel:{id}`). |

Fluxo: ao conectar, o socket entra na room de cada canal do usuário; ao enviar
mensagem, ela é persistida, retransmitida para a room e confirmada (ack) ao
remetente. Digitação (`typing`) é *stateless* — só repassa, não guarda estado.

### `files/` — Upload de arquivos (Fase 4)

- `files.s3-client.ts` — cliente S3 apontando para o MinIO.
- `files.service.ts` — gera URLs *presigned* de upload, confere o tamanho real
  do objeto.
- `files.controller.ts` — endpoint para pedir o presign.
- `dto/presign-upload-request.dto.ts` — validação.

O upload vai **direto do navegador para o MinIO** via URL presigned; a API só
assina a URL e depois valida o objeto — ela nunca faz proxy do arquivo.

### `link-preview/` — Pré-visualização de links (Fase 4)

Processada de forma **assíncrona** por uma fila BullMQ para não travar o envio
da mensagem.

| Arquivo | Papel |
|---|---|
| `link-preview.processor.ts` | *Worker* BullMQ que consome os jobs da fila. |
| `link-preview.fetcher.ts` | Faz o fetch da página alvo (com timeout). |
| `link-preview.parser.ts` | Extrai as tags Open Graph (título, descrição, imagem). |
| `link-preview.ssrf-guard.ts` | **Proteção anti-SSRF**: resolve o DNS e recusa IPs privados/reservados, incluindo o endpoint de metadados de nuvem (`169.254.169.254`) e IPv6 mapeado. |

O SSRF guard é uma das partes mais bem-feitas do projeto — é exatamente a classe
de bug que a maioria das implementações de link preview erra.

### `glpi/` — Integração com chamados (Fase 5)

| Arquivo | Papel |
|---|---|
| `glpi.service.ts` | Cria e consulta chamados na API REST do GLPI (com timeout). |
| `glpi.session.ts` | Gerencia a sessão do GLPI (init/kill session tokens). |
| `glpi.status.ts` | Traduz os códigos numéricos de status do GLPI para texto. |
| `glpi-webhook.controller.ts` | Recebe webhooks do GLPI (`POST /webhooks/glpi/tickets`) e atualiza o status do chamado no chat. Verifica a **assinatura HMAC-SHA256** do corpo com comparação de tempo constante. |

Comando de usuário: digitar `/ticket <descrição>` no chat cria um chamado no
GLPI e posta um "card" de ticket no canal. Quando o status muda no GLPI, o
webhook atualiza o card em tempo real via WebSocket.

### `rmm/` — Integração com Tactical RMM (monitoramento/alertas)

| Arquivo | Papel |
|---|---|
| `rmm.service.ts` | Cliente REST do Tactical RMM (autenticação `X-API-KEY`, sem sessão como o GLPI). `listAgents`/`getAgent`/`getMeshControlUrls`. |
| `rmm.controller.ts` | `GET /rmm/agents` e `GET /rmm/agents/:agentId` — inventário de dispositivos, restrito a **membros** do canal de alertas. `GET /rmm/agents/:agentId/remote-control` — inicia uma sessão MeshCentral de controle remoto, restrito a **admins** do mesmo canal (`ChannelsService.isChannelAdmin`). |
| `rmm-webhook.controller.ts` | Recebe o webhook de alerta do Tactical RMM (`POST /webhooks/rmm/alerts`), posta uma mensagem `SYSTEM` no canal configurado (ou abre um chamado GLPI reaproveitando o fluxo `/ticket` para alertas ≥ `RMM_AUTO_TICKET_SEVERITY`) e atualiza a mensagem quando o alerta é resolvido. Autenticado por **token estático via header `Authorization: Bearer`** (comparação de tempo constante) — o Tactical RMM não assina o corpo como o GLPI faz. |

O corpo do webhook do Tactical RMM é um template JSON escrito à mão na UI de
Alert Templates (variáveis `{{agent.hostname}}`, `{{alert.message}}` etc.);
`packages/shared/src/rmm.dto.ts` define o contrato que esse template precisa
produzir. As mensagens de alerta são de autoria de um usuário de sistema fixo
(`rmm-bot`, semeado na migration `20260716140000_add_rmm_alert_ref_and_system_user`),
e o rastreio de resolvido/não-resolvido usa `RmmAlertRef`, espelhando
`TicketRef`.

`getMeshControlUrls` chama `GET /agents/{id}/meshcentral/` do próprio Tactical
RMM, que já medeia uma sessão MeshCentral ("Take Control") sem que o Elyzian
precise de credenciais separadas do MeshCentral. A URL retornada carrega um
token de login **de uso único** — é tratada como uma credencial ao portador:
nunca persistida, nunca postada numa mensagem de chat, devolvida só na
resposta HTTP direta para quem pediu. Cada emissão é registrada via
`AuditService` (`rmm.remote_control.requested`). Não existe hoje um endpoint
de promoção a admin de canal — o primeiro operador de RMM precisa ser
promovido diretamente no banco (ver `apps/api/src/rmm/README.md`). Os
endpoints de execução de script do Tactical RMM continuam deliberadamente não
usados — controle remoto interativo e execução arbitrária de código são
perfis de risco diferentes.

### `health/`, `redis/`, `queue/`, `users/`, `audit/`

- `health/` — `GET /health`, faz um round-trip real Prisma → Postgres via
  `@nestjs/terminus`.
- `redis/redis.service.ts` — wrapper do `ioredis` (tokens de refresh, presença).
- `queue/` — configuração de conexão do BullMQ e nomes de filas.
- `users/` — serviço/controller de usuários e *mappers* de resposta.
- `audit/audit.service.ts` — primeiro escritor real do modelo `AuditLog`
  (existia no schema desde a Fase 1, sem nenhum código usando-o). Um método,
  `log(action, { userId?, metadata?, ip? })`, best-effort — uma falha de
  escrita nunca bloqueia a ação sendo auditada. Primeiro consumidor:
  `RmmController.getRemoteControl`. Ainda não há endpoint de leitura/consulta.

### `test/` — Testes end-to-end

`auth`, `chat`, `glpi`, `health`, `rich-content`, `rmm`, `rmm-webhook` — testes
Supertest rodando contra Postgres, Redis, LDAP e MinIO **reais** (não mocks),
tanto localmente quanto no CI.

---

## `apps/web` — Frontend (React + Vite)

SPA React 18. Estado de servidor com **TanStack Query**, estado de UI com
**Zustand**, estilo com **Tailwind + shadcn/ui**.

```
apps/web/src/
├── main.tsx              # bootstrap do React
├── App.tsx              # provê QueryClient + Router
├── router.tsx           # rotas (react-router)
├── pages/
│   └── LoginPage.tsx    # tela de login
├── components/
│   ├── ProtectedRoute.tsx   # bloqueia rotas se não autenticado
│   ├── chat/                # toda a UI do chat (ver abaixo)
│   └── ui/                  # componentes base do shadcn/ui
├── providers/
│   └── SocketProvider.tsx   # dona a conexão socket.io única do app
├── hooks/                   # hooks de dados (canais, mensagens, membros, usuário)
├── stores/
│   ├── useChatStore.ts      # estado ao vivo (presença, digitação) via Zustand
│   └── useUIStore.ts        # estado de UI
└── lib/                     # clientes de API, socket, cache, utilidades
```

### Componentes de chat (`components/chat/`)

| Componente | Papel |
|---|---|
| `ChatLayout.tsx` | Layout principal (sidebar + área da conversa). |
| `ChannelSidebar.tsx` / `ChannelListItem.tsx` | Lista de canais. |
| `ChannelPage.tsx` | Página de um canal. |
| `MessageList.tsx` / `MessageItem.tsx` | Lista e item de mensagem (com resposta, edição, anexo, card de ticket). |
| `MessageComposer.tsx` | Caixa de escrever/enviar (dispara `typing`, upload, `/ticket`). |
| `TypingIndicator.tsx` | "Fulano está digitando…". |
| `PresenceDot.tsx` | Bolinha verde de online. |
| `MessageSearch.tsx` | Campo de busca (Fase 6) no topo da sidebar — *debounced*, mostra resultados com o termo destacado, cada resultado leva ao canal da mensagem. |
| `InstallPrompt.tsx` | Prompt de instalação da PWA (Fase 6) — só aparece depois que o navegador dispara `beforeinstallprompt`; fica invisível (`null`) até lá. |
| `UserMenu.tsx` | Menu do usuário: logout e o botão de ligar/desligar notificações do navegador (Fase 6). |
| `NoChannelSelected.tsx` | Estado vazio. |

### Camada `lib/`

- `api-client.ts` — cliente HTTP base (credenciais/cookies, tratamento de 401).
- `auth-api.ts`, `chat-api.ts`, `files-api.ts` — chamadas específicas (inclui
  `fetchMessageSearch`, Fase 6).
- `socket.ts` — cria/gerencia a conexão socket.io-client.
- `message-cache.ts` — insere mensagens ao vivo no cache do React Query.
- `queryClient.ts` — configuração do TanStack Query.
- `notifications.ts` (Fase 6) — `shouldNotify()`, uma função pura (fácil de
  testar sem mockar `Notification`/`document` globais) que decide se uma
  notificação deve disparar, e `showMessageNotification()`, que efetivamente
  cria a notificação do navegador.
- `pdf/` — **renderizador de PDF próprio, em TypeScript puro** (sem pdf.js nem
  biblioteca externa). Ver seção abaixo.

### Renderizador de PDF (`lib/pdf/`)

Prévia inline de anexos PDF direto no chat, sem depender de pdf.js. Escrito do
zero, camada por camada, cada uma testável isoladamente:

- `lexer.ts` / `parser.ts` — tokeniza os bytes do PDF e monta o modelo de
  objetos (`types.ts`): dicionários, arrays, referências indiretas, streams.
- `filters.ts` — decodifica streams: `FlateDecode` (via `DecompressionStream`
  nativo, sem inflate à mão) + preditores PNG/TIFF, ASCII85/Hex, LZW,
  RunLength; filtros de imagem (DCT/JPX/CCITT) são repassados para a camada de
  imagem.
- `document.ts` — resolve a *cross-reference* nas três formas modernas (tabela
  `xref` clássica, *xref streams* e *object streams*), segue `/Prev`, monta a
  árvore de páginas, e cai num modo de recuperação (varre o arquivo por
  `N G obj`) se a estrutura estiver corrompida.
- `fonts.ts` / `encodings.ts` — larguras de avanço e decodificação
  bytes→Unicode (WinAnsi, `/Differences`, CMaps `/ToUnicode`, CID/Type0). **Não**
  rasteriza os glyphs embutidos — o texto é desenhado numa fonte de fallback
  (a limitação assumida do MVP).
- `content-interpreter.ts` — executa os operadores do content stream contra uma
  interface `CanvasLike` (injetável, então é testável com um mock que grava as
  chamadas): estado gráfico, caminhos, preenchimento/traço, recorte, cor
  (cinza/RGB/CMYK), texto e XObjects (forms + imagens).
- `images.ts` — imagens raster (Flate) via `putImageData` e JPEG (`DCTDecode`)
  via `createImageBitmap`. Escaneados (CCITT/JBIG2/CMYK-JPEG) ficam de fora.
- `render.ts` + `pdf.worker.ts` + `pdf-client.ts` — a rasterização roda **num
  Web Worker** (num `OffscreenCanvas`, devolvendo `ImageBitmap` por transfer,
  zero-copy) pra não travar a UI do chat; `pdf-client.ts` é a API na main
  thread que correlaciona requisições por id.

Na UI, `MessageItem.tsx` renderiza anexos `application/pdf` como
`PdfAttachmentCard` (miniatura da página 1, carregada só quando entra na tela)
que abre o `PdfViewerDialog` (visualizador em tela cheia com zoom e páginas
renderizadas sob demanda via `IntersectionObserver`). PDFs criptografados ou
que falham no parse caem no link de download simples de antes.

Detalhe de arquitetura: o `SocketProvider` é montado **dentro** do layout
autenticado, então a rota `/login` nunca abre um socket. Um `connect_error` do
socket limpa o usuário em cache do mesmo jeito que um 401 REST, então o
`ProtectedRoute` redireciona igual nos dois casos.

### Notificações do navegador (Fase 6)

`SocketProvider.tsx` chama `shouldNotify()` a cada `message:new`. A decisão
combina: preferência do usuário (`useUIStore.notificationsEnabled`, persistida
em `localStorage`, independente da permissão do navegador — que o JS não
consegue revogar sozinho), permissão real (`Notification.permission`), se a
mensagem é do próprio usuário, e se a aba está visível **e** no canal daquela
mensagem (só notifica quando pelo menos uma das duas condições falha).
Notificações usam `tag: channel-{id}` para agrupar em vez de empilhar; clicar
foca a aba e navega para o canal via `router.navigate()` (o `router` do
`react-router-dom` é importado diretamente, fora de um componente). O botão de
permissão fica no `UserMenu` — só chama `Notification.requestPermission()`
quando o usuário clica, nunca automaticamente. Push real (Web Push/VAPID, para
notificar com a aba fechada) não foi implementado.

### PWA (Fase 6)

`vite-plugin-pwa` (modo `generateSW`) em `vite.config.ts`. Manifesto
(`manifest.webmanifest`, gerado no build) com ícones derivados do brasão de
Nova Serrana (`docs/assets/brasao-pmns.png`, redimensionado para
`apps/web/public/pwa-192x192.png` / `pwa-512x512.png` / `apple-touch-icon.png`).
O service worker faz *precache* só do *app shell* (JS/CSS/fontes/imagens do
build) — **nenhuma** rota da API é colocada em `runtimeCaching`, de propósito:
toda chamada é autenticada e pode carregar dado específico do usuário, então
tem que sempre ir para a rede, nunca ficar em cache reaproveitável entre
sessões/usuários. WebSocket não é interceptável por *service worker* de jeito
nenhum (não é evento `fetch`), então não precisou de exclusão explícita.

---

## Infraestrutura

### `docker/`

- `docker-compose.yml` — sobe Postgres, Redis, MinIO e OpenLDAP para
  desenvolvimento local.
- `ldap/bootstrap.ldif` — dados iniciais do diretório LDAP (usuários, grupos).
- `ldap/memberof-override.ldif` — reconfigura o *overlay* `memberOf` do OpenLDAP
  para o schema `groupOfNames/member` (igual ao AD real).

### `apps/api/Dockerfile` e `apps/web/Dockerfile`

Imagens de produção multi-stage. O `Dockerfile` da API tem um *target* `build`
reaproveitado como imagem de migração (roda as migrations no Kubernetes).

### `k8s/` — Kubernetes (produção)

| Arquivo | Papel |
|---|---|
| `namespace.yaml` | Namespace da aplicação. |
| `configmap.yaml` / `secret.example.yaml` | Configuração e segredos. |
| `api-deployment.yaml` / `api-service.yaml` / `api-hpa.yaml` | Deploy da API + autoscaling horizontal. |
| `api-migrate-job.yaml` | Job que roda as migrations do Prisma. |
| `web-deployment.yaml` / `web-service.yaml` | Deploy do frontend. |
| `ingress.yaml` | Entrada HTTP externa. |

### `.github/workflows/ci.yml`

CI que roda lint, typecheck, testes unitários, testes e2e (com Postgres, Redis,
OpenLDAP e MinIO de verdade) e valida o build das imagens Docker.

---

## Configuração (`.env`)

Toda a configuração vive em **um único `.env` na raiz** (copiado de
`.env.example`). Docker Compose, o `ConfigModule` do Nest, o Vite e o Prisma CLI
leem desse mesmo arquivo. Grupos de variáveis: Postgres, Redis, MinIO, LDAP,
JWT, API e GLPI. As variáveis do frontend precisam do prefixo `VITE_`.

---

## Estado atual vs. Roadmap

| Fase | Status | Observação |
|---|---|---|
| 1 — Fundação | ✅ Completa | Monorepo, Docker, schema, health check, CI. |
| 2 — Autenticação | ✅ Completa | Login AD/LDAP, JWT, sync de canais. |
| 3 — Chat | ✅ Completa | Gateway Socket.IO, histórico, presença, digitação. |
| 4 — Conteúdo rico | ✅ Completa | Uploads, link preview, editar/apagar/responder. |
| 5 — GLPI | ✅ Completa | `/ticket`, cards, webhook de status. |
| 6 — Polimento | ✅ Completa | Imagens Docker + Kubernetes, busca full-text, rate limiting, PWA, notificações do navegador. |
| 7 — Futuro | ⬜ Planejamento | Ver [ideias-futuras.md](ideias-futuras.md). |
