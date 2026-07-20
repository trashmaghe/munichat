<div align="center">

<img src="docs/assets/elyzian-mark.svg" width="116" alt="Elyzian" />

# Elyzian

### Plataforma de Comunicação Municipal

**Prefeitura Municipal de Nova Serrana · Minas Gerais**

[English](README.md) · **Português**

<br />

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_18-20232A?logo=react&logoColor=61DAFB)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js_20-5FA04E?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis_7-FF4438?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-1F88C0?logo=caddy&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

![Licença](https://img.shields.io/badge/licen%C3%A7a-Propriet%C3%A1ria-6a7167)
![CI](https://github.com/trashmaghe/elyzian/actions/workflows/ci.yml/badge.svg)

</div>

Uma plataforma de comunicação em tempo real, auto-hospedada, para a prefeitura —
substituindo WhatsApp/Spark por login via **Active Directory**, canais por
secretaria, mídia embutida (imagens, PDF, vídeo e áudios de voz), abertura de
chamados no **GLPI** e alertas de dispositivos do **Tactical RMM**. É entregue
como uma stack em Docker, um **cliente desktop nativo para Windows** e um
**instalador corporativo** de um assistente só, que faz todo o deploy.

## Arquitetura

<div align="center">
  <img src="docs/assets/architecture.png" alt="Como o Elyzian se encaixa — clientes, borda Caddy, web + API, serviços de dados e integrações GLPI/RMM" width="100%" />
</div>

**Como as peças se encaixam**

- **Clientes** — o navegador/PWA, um **cliente desktop** nativo (Tauri + Rust,
  uma casca fina sobre o app web hospedado, que se atualiza sozinho) e o
  **instalador corporativo** que sobe a stack.
- **Borda Caddy** — encerra o TLS com certificados Let's Encrypt automáticos,
  fala HTTP/2 + HTTP/3 e faz o proxy reverso do app e da API.
- **Web** — uma única SPA React 18 (Vite, TanStack Query, Zustand, Tailwind)
  servida pelo nginx. Lê a origem da API em tempo de execução, então uma única
  imagem pré-compilada serve qualquer implantação. Os uploads vão **direto para o
  MinIO** por URLs pré-assinadas.
- **API** — um app NestJS que expõe REST **e** um gateway Socket.IO que
  compartilham o mesmo validador de autenticação; um worker BullMQ trata as
  prévias de link fora do caminho da requisição. Escala horizontalmente pelo
  adaptador Socket.IO do Redis.
- **PostgreSQL** — o sistema de registro (Prisma), com histórico paginado por
  keyset e busca full-text.
- **Redis** — armazém de refresh tokens, presença, o pub/sub do Socket.IO e a
  fila de jobs.
- **MinIO** — armazenamento compatível com S3 para cada anexo.
- **OpenLDAP / Active Directory** — o login se autentica no diretório; os canais
  por secretaria são provisionados a partir dos grupos `memberOf` de cada usuário.
- **GLPI / Tactical RMM** — `/ticket` abre chamados e o status volta por um
  webhook assinado; alertas de dispositivos do RMM são postados em um canal.

## Linguagens & tecnologias

| Área | Feito com |
|---|---|
| **Linguagens** | TypeScript · Rust · SQL · Shell · CSS · HTML |
| **Backend** | Node.js 20, NestJS, Socket.IO, BullMQ, Prisma |
| **Frontend** | React 18, Vite, TanStack Query, Zustand, Tailwind CSS, shadcn/Base UI |
| **Desktop** | Tauri 2 (Rust) — cliente Windows nativo + instalador corporativo |
| **Dados** | PostgreSQL 16, Redis 7, MinIO (S3) |
| **Diretório** | Active Directory / OpenLDAP via `ldapts` |
| **Integrações** | GLPI (chamados), Tactical RMM (monitoramento) |
| **Borda / infra** | Docker Compose, Caddy (TLS automático), manifests Kubernetes |
| **Testes** | Jest, Supertest, Vitest, React Testing Library |

## Software desktop

Dois apps nativos para Windows feitos com Tauri (poucos MB cada, WebView do
sistema — não Chromium), com a marca do asfódelo Elyzian:

- **Elyzian** — o cliente. Uma tela inicial pede o endereço do servidor e então a
  janela vira o app hospedado; ele se atualiza sozinho.
- **Elyzian Enterprise Installer** — um assistente de sete passos que verifica o
  Docker, coleta cada credencial/webhook, **baixa as imagens do app** e faz o
  deploy da stack com o Compose — transmitindo os logs e terminando com um
  health check.

Os instaladores são gerados para **Windows 10+ em x64, x86 (32 bits) e ARM64**.
Máquinas com Windows 7 usam o app hospedado pelo navegador. Veja
**[docs/desktop-apps.md](docs/desktop-apps.md)**.

## Início rápido (desenvolvimento)

```bash
npm install
cp .env.example .env
npm run docker:up          # postgres, redis, minio, openldap
npm run prisma:migrate     # aplica o schema
npm run dev                # shared (watch) + API + web
```

- API — http://localhost:3000 (health em `/health`)
- Web — http://localhost:5173
- Console do MinIO — http://localhost:9001

## Estrutura do projeto

```
elyzian/
├── apps/
│   ├── api/                  # backend NestJS (REST + Socket.IO)
│   ├── web/                  # SPA React (Vite)
│   ├── desktop/              # cliente desktop Tauri
│   └── enterprise-installer/ # assistente de deploy Tauri
├── packages/
│   └── shared/               # DTOs Zod compartilhados + contratos de socket
├── docker/                   # stacks compose (dev, images, edge) + configs
├── k8s/                      # manifests Kubernetes
└── docs/                     # arquitetura, desktop, deploy, docs em pt-BR
```

## Documentação

- **[docs/deploy.md](docs/deploy.md)** — guia de implantação em produção (passo a passo)
- **[docs/architecture.md](docs/architecture.md)** — descrição completa da arquitetura
- **[docs/desktop-apps.md](docs/desktop-apps.md)** — o cliente desktop + instalador corporativo
- **[docs/deploy-edge.md](docs/deploy-edge.md)** — borda de produção Caddy + TLS automático
- **[docs/estrutura-do-codigo.md](docs/estrutura-do-codigo.md)** — passo a passo módulo a módulo (pt-BR)

## Scripts (a partir da raiz)

| Script | O que faz |
|---|---|
| `npm run dev` | Roda shared (watch) + API + web em paralelo |
| `npm run build` / `lint` / `typecheck` / `test` | Em todos os workspaces |
| `npm run docker:up` / `docker:down` / `docker:logs` | Gerencia os serviços de dados locais |
| `npm run prisma:migrate` / `prisma:generate` / `prisma:studio` | Atalhos da CLI do Prisma |

`npm run test:e2e -w apps/api` roda os testes e2e da API (requer os serviços Docker de pé).

## Roadmap

- [x] **Fundação** — monorepo, serviços Docker, schema Prisma, CI
- [x] **Autenticação** — login Active Directory (LDAPS), sessões JWT, sincronização de canais
- [x] **Núcleo do chat** — Socket.IO, histórico, presença, indicadores de digitação
- [x] **Conteúdo rico** — uploads (MinIO), prévias de link, editar/apagar/responder, mídia embutida + áudios, prévia de PDF
- [x] **Integrações** — `/ticket` do GLPI + webhooks, alertas do Tactical RMM
- [x] **Acabamento** — busca full-text, rate limiting, notificações, PWA, selos de não lidas
- [x] **Marca & entrega** — a identidade do asfódelo Elyzian, apps desktop nativos, instalador corporativo auto-implantável
- [ ] **Próximo** — veja [docs/ideias-futuras.md](docs/ideias-futuras.md)

<div align="center">
<br />
<img src="docs/assets/brasao-pmns.png" width="52" alt="Brasão de Nova Serrana" />
<br />
<sub>Feito para a Prefeitura Municipal de Nova Serrana · MG</sub>
</div>
