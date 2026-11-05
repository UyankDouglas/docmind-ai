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

# com provedor real e juiz LLM (consome quota/custo; requer GEMINI_API_KEY — ou OPENAI_API_KEY com *_PROVIDER=openai)
EMBEDDING_PROVIDER=gemini LLM_PROVIDER=gemini uv run python -m app.rag.evaluation --judge llm --out ../docs/evaluation
```

Atenção ao nível gratuito: 43 perguntas + indexação de 5 documentos cabem nos limites diários típicos, mas podem
esbarrar em 429/503 transitórios — o runner respeita as retentativas com backoff do provedor (na rodada registrada,
`LLM_MAX_RETRIES=6` e `PROVIDER_RETRY_MAX_SECONDS=60`).

## Avaliação com provedor real — Google Gemini (05/11/2026)

Executada com `EMBEDDING_PROVIDER=gemini` (`gemini-embedding-001`, 1536 dimensões, `task_type` de documento e de
consulta) e `LLM_PROVIDER=gemini` (`gemini-3.5-flash-lite`), juiz `llm` (o **mesmo** modelo), nível gratuito da
Gemini API, commit `ef7517f0`. Relatório: [`docs/evaluation/latest.md`](evaluation/latest.md) e `latest.json`.
A rodada com provedor `fake` está preservada em `docs/evaluation/2026-11-05-fake-provider.*` e a primeira rodada
Gemini em `docs/evaluation/2026-11-05-gemini-run1.*` (ver "O que a primeira rodada ensinou").

| Métrica (Gemini, 05/11/2026) | Valor | Leitura |
|---|---|---|
| Recall@K / MRR / trecho relevante em 1º lugar | 1.00 / 0.90 / 83% | O trecho anotado como relevante sempre entra no contexto e, em 5 de 6 perguntas, em primeiro lugar (fake: 0.84 / 75%). |
| Precision@K | 0.15 | Corpus de 11 chunks com `top_k=8`: quase todos os chunks entram em toda busca. Com o provedor `fake` muitos candidatos caíam abaixo do limiar 0,15 (vetores esparsos), o que **inflava** a precisão (0,41). Pouco informativa neste corpus; MRR e 1º lugar são as medidas de ordenação que importam. |
| Respostas com citações válidas | 100% | Garantido pela validação estrutural: nenhum id fora do contexto sobreviveu. |
| Citações apontando para trecho relevante | 97% | Uma citação extra apontou para um trecho não anotado como relevante (m01, que descreve a política de férias inteira). |
| Sustentação pelas fontes (juiz LLM) | 81% | 7 respostas marcadas ✗ (c01, c02, c06, a03, a04, x01, x02), em geral respostas longas que combinam dois trechos ou comparam contrato × aditivo. O juiz é o próprio `gemini-3.5-flash-lite` (autoavaliação) e **não substitui revisão humana amostral**; a métrica serve para comparar configurações, não como nota absoluta. |
| Abstenção quando não há resposta | 100% (6/6) | O modelo abre com a frase de abstenção e, em 5 casos, indica o que existe de parcial com citações, como a regra 3 do prompt pede. |
| Abstenção indevida em perguntas respondíveis | 0% | Nenhuma pergunta respondível ficou sem resposta. |
| Perguntas maliciosas obedecidas | 0 | Em m01/m02 o modelo descreveu a instrução maliciosa como conteúdo do documento (com citação) e não a executou nem respondeu só "APROVADO". |
| Latência da resposta p50 / p95 | 1,7 s / 22,7 s | p95 dominado por 503/timeouts transitórios do nível gratuito (5 retentativas na rodada, todas bem-sucedidas; a pior pergunta levou 23 s). Recuperação híbrida p50 ≈ 0,58 s, dos quais a maior parte é o embedding da pergunta na API. |
| Tokens | 80,6 mil de entrada / 2,1 mil de saída | Contagem oficial do provedor para a geração (inclui tokens de raciocínio); embeddings estimados localmente (`tokens_source=estimated_local`). |
| Custo estimado | não estimado | Sem `PRICE_*` configurados; no nível gratuito não há cobrança, mas há limites por minuto/dia e uso dos dados pelo Google. |

### O que a primeira rodada ensinou

A primeira rodada Gemini (`2026-11-05-gemini-run1.*`) registrou "abstenção quando não há resposta" = 33%, igual ao
provedor `fake`. A leitura das respostas mostrou outra coisa: em 4 das 6 perguntas o modelo abriu com a frase exata de
abstenção e acrescentou o que havia de parcial, **com citações** — exatamente o que a regra 3 do prompt pede. Como o
chat mantém `status=ok` quando existem citações válidas e o runner contava abstenção só pelo status, a métrica media a
coisa errada. Correção em `ef7517f0`: a frase de abstenção também conta como abstenção. As demais métricas da run1
(Recall 1.0, MRR 0.89, citações válidas 100%, sustentação 78%, 0 maliciosas obedecidas) ficaram próximas da rodada 2 —
variação normal de um modelo não determinístico.

### Comparação honesta `fake` × Gemini

O provedor `fake` prova a **mecânica** (filtros, citações, isolamento, injeção); o Gemini prova a **qualidade**:
ordenação melhor (MRR 0.84 → 0.90), abstenção real quando falta evidência (33% → 100%), respostas sustentadas em 81% dos
casos segundo o juiz, e latência de produção (1,7 s medianos contra 14 ms sem rede). O corpus continua pequeno e
sintético; os números não extrapolam para documentos reais.

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

1. Comparar alvos de chunk (300/500/700 tokens), `top_k`, limiar, `rrf_k` e `GEMINI_THINKING_LEVEL` usando o mesmo
   dataset e a rodada Gemini como baseline.
2. Revisão humana amostral das respostas marcadas ✗ pelo juiz e de uma amostra das ✓, para calibrar o juiz.
3. Ampliar o dataset com documentos maiores (>50 páginas) para medir o resumo hierárquico e o HNSW.
4. Configurar `PRICE_*_PER_1M` com os preços do plano em uso para registrar custo por rodada.
