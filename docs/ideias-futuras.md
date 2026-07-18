# Ideias futuras — Elyzian

> Candidatos a funcionalidades além da Fase 6. Organizados por área e por
> esforço/impacto, pensando no contexto real: uma prefeitura substituindo
> WhatsApp/Spark por uma ferramenta interna auto-hospedada.

## Como priorizar

Comece pelo que tem **alto impacto e baixo esforço** e que reaproveita a
infraestrutura já existente (Postgres, Redis, Socket.IO, MinIO, BullMQ). Evite,
no começo, coisas que exigem nova infra ou dependências pesadas.

---

## 1. Colaboração no chat (alto impacto, esforço médio)

- **Reações com emoji** — reagir a mensagens (👍 ✅ etc.). Tabela `Reaction`
  (messageId, userId, emoji), evento socket `reaction:add/remove`, contadores na
  UI. Barato e muito requisitado.
- ~~**Recibos de leitura / não lidos**~~ — feito: badge de não lidas por canal
  (`ChannelMember.lastReadAt`/`lastReadMessageId`, evento socket
  `channel:read`). Escopo é por canal (estilo Slack/Discord), não "visto por"
  por mensagem — ver `apps/api/src/chat/chat.gateway.ts`.
- **Mensagens diretas (DMs)** — o `ChannelType.DM` já existe no enum. Falta a UI
  para iniciar conversa 1:1 e a criação do canal DM sob demanda (fora do sync do
  AD).
- **Threads / respostas encadeadas** — já há `replyTo`; evoluir para uma visão de
  thread lateral.
- **Menções (@usuário)** — parsing de `@`, autocomplete no composer, notificação
  direcionada, destaque na mensagem.
- **Fixar mensagens (pin)** — mensagens fixadas por canal (avisos importantes de
  um departamento).
- **Editar indicador "editado"/"apagado"** — já há `editedAt`/`deletedAt`;
  garantir que a UI mostra bem.

## 2. Administração e governança (alto valor para prefeitura)

- **Painel de administração** — o modelo `MemberRole.ADMIN` já existe. Criar um
  painel para: ver canais, gerenciar membros manualmente, desativar usuários
  (`isActive`/`tokenVersion` para logout forçado), ver estatísticas.
- **Auditoria de verdade** — `AuditLog` já é gravado para o controle remoto RMM
  (`apps/api/src/audit/`), mas só ali. Faltam login, criação de ticket,
  mensagens apagadas por admin, mudanças de permissão. Importante para o setor
  público (transparência / LGPD).
- **Retenção e exportação** — política de retenção de mensagens por canal e
  exportação (para atender pedidos de acesso à informação / LGPD).
- **Moderação** — admin poder apagar mensagem de terceiros com registro no
  audit log.

## 3. Confiabilidade e operação (o que falta para "produção séria")

- **Observabilidade** — logs estruturados (pino), métricas Prometheus
  (`/metrics`), tracing. O K8s já tem HPA; falta enxergar o que está acontecendo.
- **Health checks mais completos** — readiness/liveness separados, checando
  Redis, MinIO e LDAP além do Postgres.
- **Rate limiting no WebSocket** — complementa o rate limiting HTTP da Fase 6
  (evitar flood de `message:send`).
- **Testes de carga** — validar quantos usuários simultâneos o gateway aguenta
  antes de um rollout para a prefeitura inteira.
- **Backup automatizado** — job de backup do Postgres e do MinIO.
- **CI → CD** — o CI hoje só faz build das imagens; falta push para um registry e
  deploy automatizado.

## 4. Segurança (endurecer o que já é bom)

- **Proteção CSRF** — auth é por cookie; `POST /auth/refresh` lê o token do
  cookie sem token anti-CSRF (mitigado por `sameSite: lax`, mas não fechado).
  Adicionar double-submit token ou `sameSite: strict` onde der.
- **LDAPS de verdade** — garantir TLS no LDAP em produção (hoje o dev usa
  `ldap://`). Validar certificado.
- **Antivírus em uploads** — escanear arquivos enviados (ex.: ClamAV) antes de
  disponibilizar. Relevante num órgão público.
- **Validação de tipo de arquivo** — checar o *magic number* real do arquivo, não
  só o mime informado pelo cliente.
- **Cabeçalhos de segurança** — `helmet` na API, CSP no frontend.
- **2FA opcional** — segundo fator para contas de administrador.

## 5. Produtividade e conteúdo

- **Formatação Markdown** nas mensagens (negrito, listas, código) com sanitização.
- **Preview de imagens/inline** para anexos de imagem direto no chat.
- ~~**Prévia de PDF no chat**~~ — feito: renderizador de PDF próprio em
  TypeScript puro (sem pdf.js), em `apps/web/src/lib/pdf/`, roda num Web Worker
  e mostra os anexos `application/pdf` como um card com miniatura + visualizador
  em tela cheia. É um MVP: renderiza texto (em fonte de fallback, não nos
  glyphs embutidos), vetores e imagens raster/JPEG; documentos escaneados
  (CCITT/JBIG2) e criptografados caem no download. Ver a seção do módulo em
  `docs/estrutura-do-codigo.md`.
- **Busca avançada** (evolução da busca da Fase 6): filtros por autor, data,
  canal, "só com anexo".
- **Comandos slash adicionais** — além de `/ticket`: `/giphy`, `/poll` (enquete),
  `/shrug`, `/status`. A infra de parsing de `/ticket` já existe.
- **Enquetes (polls)** — votação simples dentro do canal (útil para decisões de
  equipe).
- **Agendamento de mensagens** — reaproveita o BullMQ (fila com `delay`).

## 6. Integrações (o diferencial de estar dentro da prefeitura)

- **Mais integrações GLPI** — listar chamados abertos do usuário, comentar no
  chamado pelo chat, notificar no canal quando um chamado é resolvido.
- **Bots / webhooks de entrada** — permitir que sistemas internos postem em
  canais (ex.: "backup concluído", "novo protocolo aberto").
- **Integração com e-mail** — resumo diário de não lidas por e-mail.
- **Diretório de ramais / contatos** — puxar do AD e mostrar quem é quem, com
  presença.

## 7. Experiência do usuário

- **Tema claro/escuro** — o projeto usa Tailwind + shadcn, então é barato.
- **i18n** — a UI mistura inglês (código) e português (usuário final);
  centralizar as strings de UI em pt-BR. Público é 100% brasileiro.
- **Mobile-first / responsivo** — combinado com a PWA da Fase 6, virar um app
  de celular usável.
- **Acessibilidade (a11y)** — órgão público tem obrigação legal de acessibilidade
  (eMAG/WCAG). Auditar navegação por teclado, leitores de tela, contraste.
- **Onboarding** — tela de boas-vindas / tour na primeira vez.

---

## Sugestão de "próximos 3 passos"

Se fosse escolher só três para depois da Fase 6, na ordem:

1. ~~**Recibos de leitura + não lidos**~~ — feito (badge de não lidas por canal).
2. ~~**Auditoria real (`AuditLog`)**~~ — feito para o fluxo de controle remoto
   RMM (`apps/api/src/audit/`); ainda vale estender para login, criação de
   ticket e moderação, como descrito na seção 2 acima.
3. **Reações com emoji** — vitória rápida, muito visível, engaja os usuários.
