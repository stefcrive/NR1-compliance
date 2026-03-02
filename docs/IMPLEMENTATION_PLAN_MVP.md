# NR1 Compliance - Plano de Implementacao (Primeira Versao Funcional)

## Objetivo desta iteracao
Entregar uma versao funcional ponta a ponta do fluxo publico anonimo com:
1. Sessao curta assinada (`form_session`).
2. Envio de respostas com validacao de Turnstile, rate limit por `ip_hash` e persistencia normalizada.
3. Endpoint tecnico inicial para leitura de agregados por topico.

## Escopo da primeira versao funcional

### Incluido
1. Estrutura base de banco (surveys, topics, questions, responses, answers, rate_limit_buckets).
2. Funcoes SQL para:
   - rate limit (`check_rate_limit`)
   - agregacao por topico (`get_topic_aggregates`)
   - contagem por grupo (`get_group_counts`)
3. APIs publicas:
   - `POST /api/public/surveys/[slug]/session`
   - `POST /api/public/surveys/[slug]/submit`
4. API tecnica inicial:
   - `GET /api/admin/surveys/[slug]/dashboard`
5. UI publica minima:
   - pagina de resposta ` /s/[slug]`
6. Utilitarios de seguranca:
   - assinatura/verificacao de sessao
   - extracao de IP confiavel e hash HMAC
   - verificacao server-side de Turnstile

### Fora de escopo desta iteracao
1. Geracao de PDF DRPS.
2. Area admin completa com telas autenticadas.
3. Filas/workers dedicados.
4. Billing e monitoramento longitudinal avancado.

## Fases e sequencia

## Fase 1 - Base e planejamento
1. Criar este plano e TODO versionados.
2. Definir env vars obrigatorias e convencoes de seguranca.

## Fase 2 - Dados e SQL
1. Criar migration inicial com tabelas e indices do MVP.
2. Criar funcoes SQL para rate limit e agregacoes.
3. Incluir script de seed de topicos e survey exemplo.

## Fase 3 - Backend publico seguro
1. Implementar endpoint de sessao.
2. Implementar endpoint de submit com:
   - validacao de cookie assinado
   - validacao de captcha
   - rate limit por `ip_hash`
   - armazenamento em `responses` + `answers`

## Fase 4 - UI publica
1. Tela minima de questionario por slug.
2. Carregamento de metadados via endpoint de sessao.
3. Submissao com feedback de sucesso/erro.

## Fase 5 - Leitura tecnica inicial
1. Endpoint de dashboard tecnico com medias por topico.
2. Aplicacao de k-anonimato nos recortes por grupo.
3. Classificacao Gravidade/Probabilidade e matriz de risco no backend.

## Fase 6 - Verificacao
1. Lint e validacao de build.
2. Ajustes finais de DX (README/env/example).

## Definition of Done desta iteracao
1. Possivel abrir um link publico de campanha e submeter respostas anonimas sem login.
2. Requisicao invalida (sessao expirada, Turnstile invalido, rate limitado) eh bloqueada.
3. Dados sao gravados de forma normalizada (`responses` + `answers`) sem IP em claro.
4. Endpoint tecnico retorna agregados por topico e oculta recortes com `n < k`.
5. Projeto compila/linta sem erro.
