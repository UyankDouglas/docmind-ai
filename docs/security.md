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

## Autorização e isolamento

- Papéis por workspace: `admin`, `editor`, `viewer`. Upload/reprocessamento exigem admin/editor;
  exclusão por editor só dos próprios documentos.
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

### Limitações conhecidas (Fase 1)

- Sem criptografia em repouso própria (depende do volume/MinIO).
- Política de retenção e exclusão de conversas antigas ainda manual (Fase 5).
- Recuperação de senha, 2FA e convites de membros ainda não implementados.
- TLS depende do proxy (Caddy) em produção; em desenvolvimento os cookies não são `Secure`.
