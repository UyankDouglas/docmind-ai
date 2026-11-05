# E2E — DocMind AI (Playwright)

Testes de ponta a ponta contra uma **stack em execução** (frontend + API + worker + banco). Eles não sobem
servidores: use o Docker Compose do repositório. Cada teste cria o próprio usuário (`e2e-<timestamp>@example.com`)
e envia os documentos fictícios de `samples/`, por isso são independentes e podem rodar em qualquer ordem.

## Rodando localmente

```bash
# na raiz do repositório
cp .env.example .env         # EMBEDDING_PROVIDER=fake e LLM_PROVIDER=fake bastam para os E2E
docker compose up -d --build

cd e2e
pnpm install
pnpm install-browsers        # baixa o Chromium do Playwright
pnpm test                    # suíte funcional (projeto "chromium")
pnpm test:headed             # com navegador visível
pnpm report                  # abre o último relatório HTML (quando gerado)
```

Variáveis:

| Variável | Padrão | Uso |
|---|---|---|
| `E2E_BASE_URL` | `http://127.0.0.1:5173` | URL do frontend. No Windows use `127.0.0.1` (o mapeamento de portas do Docker é só IPv4). |
| `CI` | — | Ativa 1 retry e relatório HTML. |

## Suíte

| Arquivo | Cobre |
|---|---|
| `auth.spec.ts` | cadastro → dashboard; logout → login; credenciais inválidas |
| `rag-flow.spec.ts` | **fluxo principal**: upload do PDF → "Pronto" via polling → pergunta → resposta com `[1]` e Fontes → clique na fonte abre o PDF.js lado a lado (canvas renderizado) → histórico |
| `library.spec.ts` | upload múltiplo DOCX+TXT → coleção → mover → filtrar → visualizador de texto por seções |
| `search-and-admin.spec.ts` | pesquisa híbrida com destaque e scores; área `/admin`, convite com link de aceite, uso e auditoria |
| `no-evidence.spec.ts` | pergunta fora do domínio → aviso "Sem evidência suficiente" sem fontes |
| `screenshots.spec.ts` | gera as imagens de `docs/screenshots/` (projeto `screenshots`, não roda em `pnpm test`) |

Esperas usam `expect(...).toBeVisible()` / `expect.poll()` com timeouts; a única espera fixa é a do cadastro
quando o backend responde com o limite de cadastros por minuto (`RATE_LIMIT_LOGIN_PER_MINUTE`, padrão 10 por IP):
o helper aguarda a janela de 60 s e reenvia. Para rodadas locais repetidas sem essa espera, aumente o limite no
`.env` (por exemplo `RATE_LIMIT_LOGIN_PER_MINUTE=100`) e recrie a API (`docker compose up -d api`).
O processamento dos documentos é real (worker Celery + pgvector), com provedores de IA determinísticos.

## Screenshots da documentação

```bash
pnpm screenshots
```

Gera `docs/screenshots/01-login.png` … `10-configuracoes.png` em 1440×900, tema escuro, com dados criados
na hora (conta de demonstração, documentos de `samples/`, uma conversa com citação, uma comparação).

## CI

O workflow `.github/workflows/ci.yml` tem o job `e2e`: sobe a stack com `docker compose up -d --build`
(provedores `fake`), aguarda `GET /api/v1/health` e `GET /`, instala o Chromium com `--with-deps` e roda
`pnpm test`. Em falha, publica o relatório HTML como artefato e imprime os logs da API, do worker e do web.
