# Prompt de implementação — Fase 6 (Polimento)

> Este documento é um **prompt pronto** para dar a um agente de IA (ou usar como
> especificação para você mesmo implementar) as quatro funcionalidades da Fase 6
> que ainda faltam: **busca full-text**, **rate limiting**, **PWA** e
> **notificações do navegador**. A parte de imagens Docker + Kubernetes da Fase 6
> já está pronta.
>
> Copie a seção "Prompt" abaixo (ou o item individual que quiser fazer primeiro)
> e cole no agente. O contexto do repositório está descrito em
> [estrutura-do-codigo.md](estrutura-do-codigo.md).

---

## Contexto que o agente precisa saber

- Monorepo npm workspaces: `apps/api` (NestJS 11 + Prisma/Postgres + Socket.IO +
  Redis + BullMQ), `apps/web` (React 18 + Vite + TanStack Query + Zustand +
  Tailwind/shadcn), `packages/shared` (DTOs Zod compartilhados).
- Autenticação por cookie `httpOnly` (JWT access curto + refresh rotativo).
- Padrão do projeto: **cada mudança acompanha testes** (Jest/Supertest na API,
  Vitest/RTL no web, Vitest para os DTOs). O CI roda lint, typecheck e testes
  contra serviços reais.
- Contratos de socket/DTO ficam em `packages/shared` e são a fonte de verdade
  para os dois lados — qualquer evento/rota novo começa por um DTO lá.

---

## Prompt (cole isto no agente)

> Implemente as quatro funcionalidades restantes da Fase 6 do MuniChat, cada uma
> em seu próprio commit, com testes, seguindo os padrões existentes do repositório
> (leia `docs/estrutura-do-codigo.md` antes de começar). Não quebre o lint, o
> typecheck nem os testes existentes. Detalhes por funcionalidade abaixo.

### 1. Rate limiting (comece por esta — é a de maior valor de segurança)

**Objetivo:** proteger o login contra força bruta e limitar abuso geral da API.

- Instale e configure `@nestjs/throttler` no `app.module.ts` com um limite
  global sensato (ex.: 100 req/min por IP) usando o storage do Redis já existente
  (`RedisService`), para funcionar corretamente com **múltiplas instâncias** da
  API atrás do HPA do Kubernetes.
- Aplique um limite **muito mais estrito** especificamente em `POST /auth/login`
  (ex.: 5 tentativas por minuto por IP) via `@Throttle()`.
- Considere também limitar `POST /auth/refresh` e o endpoint de presign de upload.
- No `main.ts`/config, garanta que o IP real é lido corretamente atrás do
  ingress (trust proxy / `X-Forwarded-For`).
- **Testes:** e2e verificando que a 6ª tentativa de login em 1 min retorna 429.
- **Cuidado:** o gateway WebSocket não passa pelo throttler HTTP; se quiser
  limitar `message:send`, faça um limitador simples baseado em Redis dentro do
  gateway (opcional, deixe documentado se não fizer).

### 2. Busca full-text de mensagens

**Objetivo:** buscar mensagens por texto dentro dos canais que o usuário pode ver.

- Use a busca full-text nativa do **PostgreSQL** (`tsvector`/`tsquery`), não uma
  dependência externa. Configure com dicionário `portuguese`.
- Adicione uma coluna gerada `search_vector tsvector` em `Message` (ou um índice
  GIN sobre `to_tsvector('portuguese', content)`), via **migration Prisma nova**.
  Como o Prisma não modela `tsvector` diretamente, use uma migration SQL manual +
  `queryRaw` no service.
- Novo endpoint: `GET /messages/search?q=...&channelId=...&cursor=...` no
  `messages.controller.ts`. **Regra de autorização crítica:** só retorne
  mensagens de canais em que o usuário é membro (reuse `channelsService.isMember`
  ou filtre por membership). Nunca vaze mensagens de canais alheios.
- Exclua mensagens com `deletedAt` != null dos resultados.
- Paginação por keyset, no mesmo padrão do histórico.
- DTO novo em `packages/shared` (`message-search.dto.ts`) para a query e a
  resposta.
- **Web:** um campo de busca no topo da lista de canais ou do canal, um hook
  `useMessageSearch`, e uma UI de resultados que leva à mensagem. Destaque
  (highlight) opcional do termo.
- **Testes:** service (busca acha/ignora corretamente, respeita membership e
  soft delete) + e2e do endpoint.

### 3. PWA (Progressive Web App)

**Objetivo:** instalável, com ícone, e cache básico de shell offline.

- Use `vite-plugin-pwa` no `apps/web`. Gere `manifest.webmanifest` com nome
  "MuniChat", ícones (reuse/derive do brasão em `docs/assets/brasao-pmns.png`),
  `theme_color`, `display: standalone`.
- Service worker com estratégia sensata: cache do *app shell* (assets do build),
  **network-first** para chamadas de API (nunca sirva mensagens velhas do cache
  de forma enganosa). **Não** faça cache de respostas autenticadas de forma que
  vaze dados entre usuários.
- Adicione um pequeno "install prompt" (opcional) e trate o evento
  `beforeinstallprompt`.
- **Cuidado:** o WebSocket não deve ser interceptado pelo service worker.
- **Testes:** garanta que o build gera o manif_est e o SW; teste unitário do
  componente de install prompt se houver.

### 4. Notificações do navegador

**Objetivo:** avisar o usuário de mensagens novas quando a aba não está em foco.

- Peça permissão (`Notification.requestPermission()`) de forma **não intrusiva**
  (ex.: um botão em `UserMenu`/configurações, não um popup no load).
- No `SocketProvider`/`useChatStore`, ao receber `message:new`:
  - só notifique se `document.visibilityState !== 'visible'` **ou** o canal não
    é o ativo;
  - não notifique mensagens do **próprio usuário**;
  - agrupe/limite (não dispare 20 notificações de uma vez — use `tag` por canal).
- Clicar na notificação foca a aba e abre o canal correto.
- Persista a preferência (ligado/desligado) no `useUIStore` + localStorage.
- **Opcional avançado:** push real via Web Push API + VAPID exige um endpoint no
  backend para guardar *subscriptions* e enviar via `web-push`. Se for fazer,
  crie um módulo `notifications/` na API com uma tabela `PushSubscription`. Se
  não, documente que só há notificação com a aba aberta.
- **Testes:** unit test do helper de decisão "devo notificar?" (mockando
  `Notification` e `visibilityState`).

### Ordem sugerida e entrega

1. Rate limiting → 2. Busca → 3. Notificações → 4. PWA.
2. Um commit por funcionalidade, mensagens no padrão convencional
   (`feat(rate-limit): ...`, `feat(search): ...`).
3. Ao final, **atualize o README** (marque os itens da Fase 6 como concluídos) e
   o `docs/estrutura-do-codigo.md` (documente os módulos novos).
4. Rode `npm run lint && npm run typecheck && npm run test` antes de finalizar.

---

## Checklist de segurança (não pule)

- [ ] Busca respeita membership de canal (sem vazamento entre canais).
- [ ] Busca exclui mensagens deletadas.
- [ ] Rate limiter usa o IP real atrás do ingress e storage Redis compartilhado.
- [ ] Service worker não faz cache de dados autenticados de forma que vaze entre
      usuários.
- [ ] Notificação não dispara para mensagens do próprio autor.
