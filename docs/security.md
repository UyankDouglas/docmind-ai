# Segurança e privacidade

## Autenticação e sessão

- Senhas com **Argon2id** (`time_cost=3`, `memory_cost=64 MiB`, `parallelism=4`), com *rehash*
  transparente quando os parâmetros mudam.
- Sessões persistidas no servidor (`user_sessions`): o cookie `docmind_session` é **HttpOnly,
  SameSite=Lax** e contém um token aleatório de 256 bits; só o **SHA-256** do token é armazenado.
- Expiração configurável (`SESSION_TTL_HOURS`), revogação no logout, registro de IP/user-agent.
- Login e cadastro com **rate limiting** por IP e por e-mail (Redis; fallback em memória).
- Resposta idêntica para e-mail inexistente e senha incorreta.

## CSRF

Double submit **validado no servidor**: o cookie legível `docmind_csrf` deve coincidir com o header
`X-CSRF-Token` **e** com o token gravado na sessão. Toda rota `POST/PUT/PATCH/DELETE` exige isso.

## Conta (Fase 5)

- **Recuperação de senha**: token aleatório de uso único, com expiração curta (`PASSWORD_RESET_TTL_MINUTES`),
  armazenado apenas como hash; resposta sempre 202 para não revelar e-mails existentes; redefinir a senha revoga
  todas as sessões. Sem SMTP configurado o link é registrado no log do servidor (desenvolvimento).
- **Alteração de senha** exige a senha atual e revoga as demais sessões.
- **Sessões ativas**: o usuário vê dispositivo/IP/última atividade e pode revogar sessões individualmente ou todas as outras.
- **Convites**: token aleatório com hash, expiração (`INVITATION_TTL_DAYS`), aceite restrito ao e-mail convidado;
  remover um membro revoga imediatamente as sessões dele naquele workspace.

## Autorização e isolamento

- Papéis por workspace: `admin`, `editor`, `viewer`. Matriz completa em `docs/api-contract.md` (Fase 5):
  upload/reprocessamento/coleções exigem admin/editor; exclusão de documentos por editor só dos próprios;
  membros, convites, configurações (recuperação, IA, limites, retenção), auditoria e uso por usuário são
  exclusivos de admin; o último administrador não pode ser rebaixado nem removido.
- Um usuário pode pertencer a vários workspaces; o workspace ativo fica na sessão do servidor e só muda via
  `POST /workspaces/switch` após verificar a associação.
- O workspace ativo vem da sessão. IDs enviados pelo cliente (documentos, conversas, chunks) são
  sempre consultados com filtro de workspace; fora dele a resposta é 404 (não revela existência).
- A busca vetorial filtra `workspace_id` nas três tabelas envolvidas e só retorna documentos
  prontos e não excluídos. Testes automatizados garantem que o workspace B não recupera nada do A.

## Upload seguro

- Extensão **e** assinatura (`%PDF-`) verificadas; outros formatos → 415.
- Tamanho máximo aplicado em streaming (`MAX_UPLOAD_MB`) e no middleware (`Content-Length`).
- Limite de páginas, rejeição de PDFs criptografados, detecção de PDFs sem texto.
- Nome interno aleatório no MinIO (`<workspace>/<32 hex>.pdf`); nome original só no banco.
- Download autenticado, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `no-store`.
- Deduplicação por SHA-256 dentro do workspace.
- Worker com limite de memória (compose), `task_time_limit`, `max-tasks-per-child`.
- Nenhum script, macro ou link do documento é executado ou seguido.

## Prompt injection

Documentos são **dados não confiáveis**:

1. Instruções do sistema e evidências ficam em mensagens/seções distintas.
2. Trechos são delimitados por `<trecho id="n">`; tentativas de fechar/abrir a tag no conteúdo são
   neutralizadas.
3. O prompt instrui explicitamente a tratar comandos nos trechos como texto citável.
4. **O modelo não possui ferramentas**: não executa código, não faz HTTP, não envia e-mails. A única
   saída do LLM é texto, que passa por validação de citações antes de ser persistido.
5. O backend nunca executa ações a partir do conteúdo de documentos; o teste
   `test_prompt_injection_in_document_is_treated_as_data` cobre o cenário com documento malicioso.

Defesas por prompt são complementares; a segurança depende das restrições do backend.

## Privacidade e LGPD

- Arquivos privados (bucket não público), acesso só via API autenticada.
- Apenas **trechos relevantes** (não o arquivo inteiro) são enviados ao provedor de IA, e somente
  quando `external_ai_enabled` está ativo no workspace. A interface exibe o aviso retornado por
  `GET /settings/ai`.
- Exclusão de documento remove chunks e embeddings imediatamente (cascade) e o objeto no MinIO;
  citações antigas ficam com `chunk_id/document_id = NULL` (histórico redigido) e o download passa a
  responder 404.
- Logs e auditoria (`audit_logs`) registram ações e metadados, nunca conteúdo.
- Chaves de API só no servidor (variáveis de ambiente); `GET /settings/ai` expõe apenas nomes de
  provedor/modelo.

## Controle de uso e custos (Fase 5)

- Limites por workspace (`limits`): orçamento mensal de tokens, teto mensal de custo estimado (só efetivo com
  preços configurados), máximo de documentos e de armazenamento. Quando atingidos, perguntas, pesquisas, análises
  e uploads são recusados com 429 **antes** de persistir qualquer coisa.
- `GET /admin/usage` agrega consumo por usuário e por dia; `GET /audit` lista a trilha de auditoria com filtros e
  exportação CSV/JSON (sem conteúdo de documentos).

## Retenção (Fase 5)

Política por workspace (`retention`): conversas, análises e histórico de pesquisas mais antigos que N dias são
removidos; documentos excluídos (soft delete) são purgados do banco **e do MinIO** após N dias. Executa diariamente
no Celery beat (`maintenance.apply_retention`) ou sob demanda por um administrador; cada execução é auditada.

### Limitações conhecidas

- Sem criptografia em repouso própria (depende do volume/MinIO).
- 2FA ainda não implementado.
- Sem SMTP configurado, links de recuperação/convite só aparecem no log do servidor.
- TLS depende do proxy (Caddy) em produção; em desenvolvimento os cookies não são `Secure`.
