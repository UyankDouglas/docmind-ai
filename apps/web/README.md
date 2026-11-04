# DocMind AI — Frontend

Interface web do DocMind AI (React 19 + TypeScript + Vite + Tailwind CSS v4 + componentes no estilo shadcn/ui).

## Executar

```bash
pnpm install
pnpm dev          # http://localhost:5173 — proxy de /api para VITE_PROXY_TARGET (padrão http://localhost:8000)
```

Variáveis:

| Variável | Padrão | Uso |
|---|---|---|
| `VITE_API_URL` | `/api/v1` | base das chamadas da API |
| `VITE_PROXY_TARGET` | `http://localhost:8000` | destino do proxy `/api` no dev server |

## Scripts

| Script | Descrição |
|---|---|
| `pnpm dev` | servidor de desenvolvimento |
| `pnpm build` | `tsc -b` + bundle de produção em `dist/` |
| `pnpm preview` | serve o bundle |
| `pnpm typecheck` | verificação de tipos |
| `pnpm lint` | ESLint (flat config) |
| `pnpm test` / `pnpm test:watch` | Vitest + Testing Library (jsdom) |
| `pnpm format` | Prettier |

## Estrutura

```
src/
├── app/            router, providers, query client
├── components/     compartilhados (Logo, EmptyState, StatusBadge, Skeletons…) e ui/ (shadcn-like)
├── features/
│   ├── auth/       login, cadastro, guardas de rota
│   ├── documents/  biblioteca, upload, polling de status, visualizador PDF.js (pdf/)
│   ├── chat/       conversas, mensagens, citações, feedback, markdown leve
│   ├── search/     pesquisa semântica
│   └── settings/   status da IA, uso, workspace
├── hooks/          tema, media query, localStorage
├── layouts/        AppLayout (sidebar recolhível + topbar), AuthLayout
├── pages/          uma página por rota
├── services/       api.ts (fetch com cookies, CSRF e erros padronizados)
├── test/           setup e utilitários de teste
└── types/          tipos do contrato (docs/api-contract.md)
```

## Decisões

- **Sessão por cookie HttpOnly** + CSRF *double submit*: o cliente lê `docmind_csrf` e envia `X-CSRF-Token` em mutações; se o cookie não existir, chama `GET /auth/csrf` uma vez.
- **Status real de processamento**: `useDocumentStatus` faz polling de `/documents/{id}/status` a cada 2,5 s somente enquanto o documento está em estado de processamento. Nenhum percentual é simulado.
- **Citações**: os marcadores `[n]` só viram chips quando existe `citations[].index === n`; marcadores sem fonte permanecem como texto.
- **Destaque no PDF**: só destaca correspondência exata (após normalização de espaços) no text layer do PDF.js; se não localizar, mostra o trecho no painel lateral com aviso explícito.
- **Tema**: escuro por padrão (`class="dark"` no `<html>`), claro opcional, persistido em `localStorage`.
