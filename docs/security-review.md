# Revisão de segurança — Fase 6 (05/11/2026)

Revisão manual do código e da configuração, orientada pelo OWASP ASVS (níveis 1–2) e pelo OWASP Top 10
para LLM. Para cada item: estado encontrado, ação tomada nesta fase e pendências.

## Resumo

| Área | Estado | Ação na Fase 6 |
|---|---|---|
| Autenticação e sessões | Argon2id, sessões no servidor, cookies HttpOnly/SameSite, revogação, reset com token hash | — (verificado) |
| CSRF | double-submit validado contra a sessão em toda mutação; cobre também o endpoint SSE | — (testado) |
| Autorização / multi-tenant | `workspace_id` sempre da sessão; filtros em todas as tabelas, inclusive vetores e FTS; testes de isolamento A/B em documentos, chunks, busca, conversas, análises, coleções, convites | — (testado) |
| Upload | extensão + assinatura por tipo, limite por streaming e por `Content-Length`, nomes aleatórios, download autenticado, `nosniff`, dedupe SHA-256, limites por workspace | — |
| Injeção de prompt | evidências delimitadas e neutralizadas, sem ferramentas para o modelo, validação estrutural de citações, dataset adversarial na avaliação | **+ perguntas maliciosas na avaliação (m01/m02)** |
| Segredos | só variáveis de ambiente; `/settings/ai` sem chaves; `.env` ignorado | **+ API recusa `SECRET_KEY` padrão em produção** |
| Cabeçalhos HTTP | API: nosniff, DENY, Referrer-Policy, no-store | **+ Caddy: CSP restritiva (sem scripts externos), Permissions-Policy, remoção de `Server`** |
| Logs e auditoria | sem conteúdo de documentos/perguntas; auditoria sem payloads | — (verificado) |
| Dependências | — | **+ `pip-audit` e `pnpm audit` no CI** |
| Convites | token hash + expiração | **+ e-mail mascarado na página pública do convite** |
| Rate limiting | login/cadastro/forgot-password por IP e e-mail | — |
| Disponibilidade / abuso | limites de perguntas/uploads por hora, orçamento mensal, `task_time_limit`, memória do worker | — |

## Achados e correções

1. **Página pública do convite expunha o e-mail completo** a qualquer pessoa com o link. Corrigido: e-mail mascarado
   (`br***@example.com`); o aceite continua exigindo login com o e-mail exato.
2. **`SECRET_KEY` padrão poderia subir em produção.** Corrigido: a API falha no startup com `APP_ENV=production` e
   chave padrão; `COOKIE_SECURE=false` em produção gera aviso no log.
3. **Frontend sem CSP.** Corrigido no Caddy de produção (CSP com `script-src 'self'`, workers/blobs para o PDF.js,
   fontes do Google Fonts, `frame-ancestors 'none'`). Em desenvolvimento o Vite não aplica CSP.
4. **Sem verificação automática de vulnerabilidades em dependências.** Corrigido: job `security` no CI com
   `pip-audit` (via `uv tool`) e `pnpm audit --audit-level high`; falhas bloqueiam o pipeline.

## Verificações realizadas (sem alteração necessária)

- Nenhum uso de `eval`, `pickle`, `subprocess` com entrada do usuário ou `yaml.load` no backend (o único
  `subprocess` lê o SHA do git na avaliação, sem entrada externa).
- Downloads/exportações usam `Content-Disposition: attachment` com nome codificado (`filename*`) e `no-store`.
- Mensagens de erro não ecoam valores de entrada (validação sanitizada), nem distinguem e-mail inexistente de senha
  errada; `forgot-password` responde 202 sempre.
- Documentos excluídos saem imediatamente dos índices (chunks/embeddings) e o objeto é removido do storage;
  a retenção purga o restante.
- Queries SQL são todas parametrizadas via SQLAlchemy; o FTS usa `websearch_to_tsquery` (sem operadores injetáveis).
- O worker não expõe portas; MinIO/Postgres/Redis não publicam portas no `docker-compose.prod.yml`.

## Pendências (fora do escopo desta fase)

- Autenticação em dois fatores e políticas de senha mais rígidas (dicionário/senhas vazadas).
- CSP também em desenvolvimento e relatório `report-to`.
- Rotação automática de segredos e criptografia em repouso própria (hoje depende do volume/MinIO).
- Antivírus/sandbox para uploads (hoje: validação de formato + limites de recursos).
- Teste de intrusão externo antes de uma demo pública com dados sensíveis (a demo prevista usa apenas documentos fictícios).
