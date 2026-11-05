# Avaliação do RAG

> **Resultado mais recente**: [`docs/evaluation/latest.md`](evaluation/latest.md) (e `latest.json`), gerado pelo
> runner reproduzível descrito abaixo. **Leia a seção "Como interpretar"**: os números atuais foram obtidos com o
> provedor determinístico `fake` e medem a mecânica do pipeline, não a qualidade de um modelo real.

## O que é medido

O módulo `backend/app/rag/evaluation/` contém:

- **Dataset** (`dataset.py`, versão `2026-11-05.1`, 43 perguntas) sobre 5 documentos sintéticos (`samples/`): contrato
  (5 páginas), aditivo que **altera** valores do contrato (3 páginas), política de férias com **instrução maliciosa**,
  manual DOCX (seções) e política TXT (seções). Tipos: diretas, por página específica, cruzando documentos,
  nomes semelhantes (contrato × aditivo; política de férias × política de segurança), contradições (45 × 60 dias),
  sem resposta (5) e maliciosas (2), além de perguntas com escopo restrito. Cada pergunta anota a localização
  relevante (página ou seção), palavras-chave esperadas e se o sistema deve se abster. O hash do dataset vai no relatório.
- **Runner** (`runner.py`): cria um workspace isolado, indexa os documentos pelo pipeline real, e para cada pergunta
  executa a recuperação (vetorial e híbrida, para benchmark) e a resposta pelo mesmo serviço do chat.
- **Métricas**: Recall@K, Precision@K e MRR da recuperação (por localização anotada → chunks); % de respostas com
  citações válidas; % de citações apontando para trechos relevantes; sustentação pelas fontes (juiz); abstenção correta
  (geral, quando não há resposta, e abstenção indevida); perguntas maliciosas obedecidas; latência p50/p95; tokens;
  custo estimado (só com `PRICE_*` configurados); benchmark de recuperação e indexação.
- **Juízes de sustentação**: `keyword-proxy` (determinístico: palavras-chave esperadas na resposta **e** nos trechos
  citados — um proxy lexical) e `llm` (pergunta ao modelo configurado se a resposta é sustentada; estimativa automática).
  O relatório sempre declara qual juiz foi usado.

## Como executar

```bash
cd backend
# contra o PostgreSQL do Compose, provedores fake (reprodutível, sem custo)
DATABASE_URL=postgresql+psycopg://docmind:docmind@localhost:5432/docmind STORAGE_BACKEND=memory \
EMBEDDING_PROVIDER=fake LLM_PROVIDER=fake uv run python -m app.rag.evaluation --out ../docs/evaluation

# com provedor real e juiz LLM (gera custo; requer OPENAI_API_KEY)
EMBEDDING_PROVIDER=openai LLM_PROVIDER=openai uv run python -m app.rag.evaluation --judge llm --out ../docs/evaluation
```

O relatório registra versão do pipeline, commit, dataset (versão + hash), provedores/modelos, parâmetros de
recuperação e chunking, juiz, documentos, benchmark, métricas agregadas, limitações e a tabela por pergunta.
O teste `tests/test_evaluation.py` roda um subconjunto no CI para garantir que o runner continua funcionando.

## Como interpretar o resultado atual (provedor `fake`)

| Métrica (fake, 05/11/2026) | Valor | Leitura |
|---|---|---|
| Recall@K / Precision@K / MRR | 1.00 / 0.41 / 0.84 | Com a busca textual (AND, e OR como fallback) o trecho relevante é sempre recuperado; a precisão reflete os `top_k=8` candidatos em documentos de poucos chunks. O embedding `fake` (hash de palavras) contribui pouco. |
| Trecho relevante em 1º lugar | 75% | Ordenação pela fusão RRF com os dois sinais. |
| Respostas com citações válidas | 100% | Por construção: só ids do contexto; 86% das citações apontam para o trecho anotado como relevante. |
| Sustentação pelas fontes (`keyword-proxy`) | 46% | O provedor `fake` ecoa o primeiro trecho; quando a palavra-chave está noutro trecho citado, o proxy marca ✗. Métrica significativa só com LLM real. |
| Abstenção indevida em perguntas respondíveis | 0% | Nenhuma pergunta respondível ficou sem evidência. |
| Abstenção quando não há resposta | 33% (2/6) | Limite do provedor `fake`: ele responde sempre que algum trecho é recuperado; abster-se com evidência fraca é papel do LLM real (o prompt exige isso). |
| Perguntas maliciosas obedecidas | 0 | O texto malicioso chega ao modelo apenas como evidência delimitada; citar/descrever o pedido não conta como obedecer. |
| Latência p50/p95 | 14 / ~20 ms | Sem rede; com provedor real a latência é dominada pelo LLM. |

Conclusão honesta: a avaliação prova que **recuperação, filtros, citações, abstenção e defesa contra injeção
funcionam como projetados**; a qualidade semântica só pode ser medida com um provedor real. Nenhuma "nota" é
publicada antes dessa execução.

## Próximos passos

1. Executar com provedor real (`--judge llm`) e registrar o relatório no repositório, com custo.
2. Comparar alvos de chunk (300/500/700 tokens), `top_k`, limiar e `rrf_k` usando o mesmo dataset.
3. Ampliar o dataset com documentos maiores (>50 páginas) para medir o resumo hierárquico e o HNSW.
