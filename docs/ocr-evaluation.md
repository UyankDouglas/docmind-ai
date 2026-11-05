# Avaliação técnica — OCR opcional

Resumo da decisão: **OCR disponível, desligado por padrão, ativável por workspace somente quando o
servidor tem o Tesseract instalado.** O texto obtido por OCR é marcado como tal e o usuário é avisado
de que pode conter erros de leitura. Nenhuma página é tratada como "lida" quando o OCR não rodou.

## Opções consideradas

| Opção | Licença | Instalação | Qualidade pt-BR | Custo | Risco |
|---|---|---|---|---|---|
| **Tesseract 5 (pytesseract)** | Apache-2.0 | binário do sistema + `tessdata` `por` | boa em digitalizações limpas; cai em fotos/tabelas | zero (local) | processa imagens não confiáveis (ver mitigação) |
| OCR em nuvem (Google Vision, AWS Textract, Azure) | proprietária | chave de API | muito boa, inclusive tabelas | por página | envia o documento inteiro a terceiros — conflita com a política de privacidade do projeto |
| OCR por LLM multimodal | proprietária | chave | boa | alto por página | mesmo problema de privacidade + alucinação de texto inexistente |
| EasyOCR / PaddleOCR | Apache-2.0 | PyTorch (~1 GB) | boa | zero | imagem Docker grande; GPU recomendada |

Escolha: Tesseract. É local (nada sai do servidor), tem licença compatível e a dependência Python é
opcional (`uv sync --extra ocr`). A qualidade é suficiente para digitalizações de texto corrido, que é o caso
de uso declarado (contratos e relatórios escaneados).

## Como está implementado

- `backend/app/providers/ocr.py`: interface `OcrProvider`, `TesseractOcrProvider` e `FakeOcrProvider` (testes).
- As imagens são extraídas de cada página com `pypdf` (`page.images`), sem rasterizar o PDF inteiro, e processadas
  em escala de cinza. Limites: no máximo 4 imagens por página e 40 megapixels por imagem (proteção contra bombas de
  descompressão); páginas além de `MAX_PDF_PAGES` não são processadas.
- Só roda quando (1) o PDF não tem camada de texto suficiente, (2) `OCR_ENABLED=true` no servidor com binário e
  idioma presentes (`ocr_available`) e (3) o administrador ativou `ai.ocr_enabled` no workspace.
- O documento recebe os metadados `ocr_engine`/`ocr_language` e o aviso "Texto obtido por OCR…"; páginas em que
  o OCR falhou continuam vazias e são sinalizadas.

## Segurança

- Imagens vêm de arquivos enviados por usuários: o processamento ocorre no worker (memória limitada, `task_time_limit`),
  nunca na API. Pillow é configurado com `MAX_IMAGE_PIXELS`.
- Nenhum binário externo além do `tesseract` é invocado; sem rede.
- O texto de OCR passa pela mesma normalização e pelos mesmos delimitadores de evidência; continua sendo dado,
  nunca instrução.

## Habilitando

```bash
# imagem/servidor com Tesseract e idioma português
apt-get install -y tesseract-ocr tesseract-ocr-por
cd backend && uv sync --extra ocr
# .env
OCR_ENABLED=true
OCR_LANGUAGE=por
```

Depois, em Administração → Provedores de IA, ative "OCR para PDFs digitalizados" no workspace.

## Limitações conhecidas

- PDFs digitalizados cujas páginas não são imagens embutidas simples (por exemplo, com máscaras ou várias camadas)
  podem não ter imagens extraíveis pelo `pypdf`; nesses casos o documento continua "sem texto" e o aviso de OCR
  necessário é mantido. Um rasterizador (pdfium/poppler) é a evolução natural se houver demanda.
- Não há correção ortográfica pós-OCR; a qualidade da recuperação depende da qualidade da digitalização.
- A imagem Docker padrão **não** inclui o Tesseract (para manter o tamanho e a superfície de ataque menores).
