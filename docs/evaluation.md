# Avaliação do RAG

> Estado: **Fase 1**. Existe a infraestrutura mínima (documentos sintéticos com fatos em páginas
> conhecidas, provedores determinísticos, métricas de recuperação) e testes automatizados que
> verificam recuperação, citação e abstenção. O conjunto completo de avaliação (≥ 30 perguntas,
> métricas agregadas e relatório reproduzível) é entregue na **Fase 6**. Nenhuma nota de qualidade
> é publicada antes disso.

## O que já é verificado automaticamente (pytest)

| Verificação | Teste | Como |
|---|---|---|
| Recuperação aponta para a página correta | `test_search_returns_correct_page` | Pergunta sobre prazo de cancelamento → trecho da página 4 do contrato sintético. |
| Resposta cita trecho real e a citação resolve para o chunk/página corretos | `test_ask_answers_with_valid_citation_to_correct_page` | A citação `[1]` resolve via `GET /chunks/{id}` para um trecho que contém o fato e cobre a página 4. |
| Abstenção quando não há evidência | `test_question_without_evidence_abstains` | Pergunta fora do domínio → `status = no_evidence`, sem citações. |
| Citações inventadas são removidas | `test_invalid_citations_from_model_are_removed` | LLM roteirizado emite `[42]`; o backend remove e mantém só `[1]`. |
| Documento malicioso é tratado como dado | `test_prompt_injection_in_document_is_treated_as_data` | Texto "ignore as instruções…" chega ao modelo apenas dentro de `<trecho>`; nenhuma ação é executada. |
| Isolamento vetorial entre workspaces | `test_cross_workspace_vector_search_returns_nothing` | Workspace B não recupera embeddings de A. |
| Escopo por documento | `test_document_scope_filters_retrieval` | Citações só do documento selecionado. |

Esses testes usam o `FakeEmbeddingProvider` (hash de palavras) e o `FakeLLMProvider`; eles
comprovam a **mecânica** do pipeline (filtros, metadados, citações), não a qualidade semântica de
um modelo real.

## Métricas disponíveis (`rag/evaluation/metrics.py`)

- `recall_at_k`, `precision_at_k`, `reciprocal_rank` — usadas pelos testes e pelo futuro runner.

## Plano para a Fase 6

1. **Dataset**: ≥ 30 perguntas sobre os documentos sintéticos (`samples/`), com `relevant_chunks`
   anotados por página/trecho e `expected_answer`/`should_abstain`. Tipos: diretas, por página,
   cruzando documentos, nomes semelhantes, sem resposta, contraditórias, maliciosas.
2. **Métricas**: Recall@K e Precision@K da recuperação; % de respostas com citações válidas;
   % de respostas sustentadas pelas fontes (julgamento por modelo, com método e limitações
   declarados); taxa de abstenção correta; latência; tokens; custo estimado (quando houver preço).
3. **Reprodutibilidade**: cada execução registra versão do pipeline, modelo, parâmetros de chunking e
   recuperação e hash do dataset. Suíte opcional com provedor real executada só com credenciais e
   orçamento configurados.
4. **Uso**: comparar alvos de chunk (300/500/700 tokens), `top_k`, limiar de similaridade e busca
   híbrida (Fase 3) antes de alterar padrões.
