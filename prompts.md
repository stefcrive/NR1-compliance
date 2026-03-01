I want to develop the platform that will handle the data collection, processing, visualization and report creation. The client company will have access to his own account and can monitor the mental health of his company in compliance with nr1 law. It is exclusively for brazilian companies, therefore plan it in brazilian portuguese. The application will be in nextjs, shacnh UI, supabase data storage and auth. At thi stage i need a complete metaprompt that includes all the requirements found in the document, and orient a secondary agent to create the proprer initial prompt for coding impelmentation. Companies must be able to access an account provided by the RN1 compliance company, here the client can insert their data, monitor the DRPS data collection process, see the results and visualize the situation per company´s sector. Than a report is compiled and can be download as pdf. The company can monitor the progress also for the processo continuos to prevent/interveen, manage invoicing etc. Monitor progress trought time, extrapolated helth metrics of overall impact etc. 
Lets focus on what such system would need, how to make it production ready relatively soon, with a 'implement along the way' mentality, what the backend would have to look like etc.

Você é um “Tech Lead + Arquiteto de Produto” especialista em construir portais de coleta anônima de dados e geração automática de relatórios SST/NR-1 (riscos psicossociais), com foco em privacidade verificável, segurança pragmática, e implementação incremental.

OBJETIVO
Construir uma plataforma web onde funcionários respondem um questionário de riscos psicossociais (13 tópicos) sem login e com alta anonimidade. A plataforma compila automaticamente o relatório final (DRPS) no padrão do Excel modelo, incluindo agregações, classificação e plano anual de medidas de controle.

CONTEXTO DO MODELO (Excel)
- Aba “Escala”: lista de perguntas com mapeamento para Tópico 01..13 e regra de pontuação “Direta” ou “Invertida”.
- Aba “Dados do Forms”: estrutura de respostas brutas (timestamp, função/cargo, setor e colunas de perguntas).
- “Resumo por Tópico” / “Dados Gráficos”: agregações por tópico, médias e visualizações.
- “Análise e Avaliação”: relatório técnico (DRPS) com fontes geradoras, matriz etc.
- “Medidas de Controle”: plano anual de ações.

REQUISITOS DE PRIVACIDADE E FLUXO (OBRIGATÓRIOS)
- Sem login / sem verificação de empregado.
- Um link único para todos (por campanha/pesquisa).
- Alta anonimidade: não coletar sinais de identidade (sem email, nome, matrícula, etc).
- Prevenção básica de abuso: bots/spam/repeated blasting.
- Privacidade no relatório: k-anonimato (mínimo de respostas por grupo para exibir recortes).
- Não tentar garantir “1 resposta por empregado” (não usar IP para isso).

FLUXO DE SEGURANÇA (DEVE IMPLEMENTAR)
1) Page load: emitir cookie assinado “form_session” (JWT/HMAC), curto (15–60 min).
   Conteúdo mínimo: sid aleatório, surveyId/campaignId, iat, exp.
   Não incluir IP, user-agent ou qualquer valor identificável.
2) Submit: validar antes de gravar:
   A) assinatura e validade do cookie, e surveyId/campaignId consistente
   B) Turnstile token (Cloudflare) verificado server-side (success, hostname, action opcional)
   C) Rate limit por IP hash: ip_hash = HMAC_SHA256(secret, ip). Não armazenar IP puro.
      Limites recomendados: burst 5/min, sustained 30/h por ip_hash (ajustável).
3) Store: guardar somente o necessário:
   - survey/campaign id, answers, submitted_at
   - opcional: ip_hash e session_id (curta retenção 7–30 dias) apenas para anti-abuso/investigação
   Evitar logs com corpo de request, cookies e tokens.
4) Reporting: aplicar k-anonimato em qualquer breakdown (setor, turno etc). Se count<k, ocultar.

TÓPICOS (13 RISCOS)
1) Assédio de qualquer natureza
2) Falta de suporte/apoio
3) Má gestão de mudanças
4) Baixa clareza de papel
5) Baixas recompensas e reconhecimento
6) Baixo controle/falta de autonomia
7) Baixa justiça organizacional
8) Eventos violentos/traumáticos
9) Baixa demanda (subcarga)
10) Excesso de demanda (sobrecarga)
11) Maus relacionamentos
12) Difícil comunicação
13) Trabalho remoto e isolado

ESCALA E CÁLCULO
- Likert 1..5.
- Direta: corrected = raw
- Invertida: corrected = (max+min - raw) => padrão (6 - raw) para 1..5
- Parametrizar min/max por survey para flexibilidade.
- Questionário deve suportar perguntas associadas a: topic_id e dimensão (gravidade/probabilidade).
- Agregação por tópico: mean_severity e mean_probability (por campanha e opcionalmente por grupo).
- Classificação: definir thresholds (ex.: 1.0–2.3 Baixa, 2.4–3.6 Média, 3.7–5.0 Alta) — justificar e deixar configurável.
- Matriz de risco: combinar classes GxP e mapear para Baixo/Médio/Alto/Crítico — deixar tabela configurável.

ARQUITETURA / STACK (escolha e justifique)
Frontend: Next.js + Tailwind + shadcn/ui
Backend: Next.js route handlers ou FastAPI (escolha 1)
DB: Postgres (preferência Supabase) com migrations
Fila/jobs: para geração de PDF e agregações (ex.: Redis+worker) — sugerir alternativa simples no MVP
Armazenamento: bucket para PDFs (Supabase Storage ou S3-like)

MODELO DE DADOS (REQUISITO)
- Use modelo normalizado (responses + answers), não uma tabela com 90 colunas.
- Também pode persistir answers JSONB para replay/auditoria.
- Entidades mínimas: campaigns/surveys, questions, responses, answers, topic_scores (snapshots), report_instances.
- Incluir RBAC para área admin/técnico (não para respondente).

O QUE VOCÊ DEVE PRODUZIR (ENTREGÁVEL COMPLETO)
A) Arquitetura com componentes e fluxos (incluindo segurança e privacidade)
B) Modelo de dados (tabelas, campos, índices) + migrations SQL
C) API design: endpoints (session, submit, dashboard, report), payloads e validações
D) Algoritmos detalhados:
   - correção Direta/Invertida
   - agregação por tópico (gravidade/probabilidade)
   - classificação e matriz
   - k-anonimato
   - rate limiting por ip_hash
E) UI/UX mínimo: telas (criar campanha, formulário público, dashboard técnico, revisão, gerar relatório)
F) Geração do relatório DRPS (HTML → PDF): template, seções e preenchimento automático + campos editáveis
G) Plano de implementação (MVP → v1) com prioridades e Definition of Done
H) Testes (unit/integration) + dados de teste
I) Checklist operacional: logging seguro, retenção, configurações Turnstile, headers de IP (cf-connecting-ip / x-forwarded-for), e limites de rate

FORMATO
- Use headings e listas objetivas.
- Inclua snippets de código quando necessário (SQL, pseudo-código, exemplos de payload).
- Seja realista e incremental. Evite dependências não essenciais.
- Trate explicitamente das trade-offs de anonimato vs. anti-abuso.

AGORA PRODUZA O ENTREGÁVEL COMPLETO.