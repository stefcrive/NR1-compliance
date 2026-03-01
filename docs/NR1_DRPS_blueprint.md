# NR1 Compliance - Blueprint Tecnico (MVP -> v1)

## 0) Premissas validadas no Excel fornecido
- Workbook: `Modelo  NR 01 50P - Atual 13F.xlsx`.
- Abas principais identificadas: `Escala`, `Dados do Forms`, `Resumo por Tópico`, `Dados Gráficos`, `Análise e Avaliação`, `Medidas de Controle`.
- Estrutura da escala confirmada:
1. 50 perguntas totais.
2. 13 tópicos de risco psicossocial.
3. Regras de pontuação balanceadas: 25 `Direta` e 25 `Invertida`.
4. Colunas de perguntas em `Dados do Forms`: de `D` até `BA` (além de metadados como cargo/setor).

## A) Arquitetura com componentes e fluxos

### Escolha de stack
- Frontend: `Next.js + Tailwind + shadcn/ui` (mantido).
- Backend: `Next.js Route Handlers` (escolhido).
- Banco: `Postgres (Supabase)`.
- Auth admin/técnico: `Supabase Auth` + RBAC por organização.
- Armazenamento de PDF: `Supabase Storage` (bucket privado `reports`).
- Jobs:
1. MVP: sem Redis; geração de relatório sob demanda (request assíncrona + polling de status), com persistência em `report_instances`.
2. v1: worker dedicado com `BullMQ + Redis` (ou `pg-boss` se preferir evitar Redis).

### Componentes
1. App público (`/s/[slug]`): coleta anônima sem login.
2. API pública:
   - `POST /api/public/surveys/[slug]/session`
   - `POST /api/public/surveys/[slug]/submit`
3. App admin/técnico (`/admin/*`) com login.
4. API admin:
   - gestão de campanhas/perguntas
   - dashboard e agregações
   - geração/revisão/publicação DRPS
5. Camada de domínio:
   - scoring (direta/invertida)
   - classificação
   - matriz de risco
   - k-anonimato
6. Persistência:
   - respostas normalizadas (`responses` + `answers`)
   - snapshots (`topic_scores`)
   - relatórios (`report_instances`)
7. Storage:
   - PDFs versionados por `report_instance_id`.

### Fluxo de segurança e privacidade (obrigatório)
1. Carregamento da página pública:
   - cliente chama `POST /session`.
   - servidor emite cookie assinado `form_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, TTL 15-60 min).
   - payload mínimo: `{ sid, survey_id, iat, exp }`.
   - sem IP, UA, email, nome, matrícula.
2. Submit:
   - valida cookie (assinatura + exp + survey consistente).
   - valida Turnstile server-side (`success`, `hostname`, `action` opcional).
   - aplica rate limit por `ip_hash = HMAC_SHA256(secret, ip)`.
   - persiste apenas dados necessários.
3. Reporting/dashboard:
   - aplica k-anonimato em qualquer recorte (`setor`, `turno`, `cargo`, etc).
   - se `count < k`, oculta recorte e agrega em “Não exibido por anonimato”.

### Trade-off explícito (anonimato vs anti-abuso)
- Decisão: maximizar anonimato e aceitar mitigação probabilística de abuso.
- Consequência:
1. Não há garantia de “1 resposta por empregado” (requisito).
2. Defesa de abuso via Turnstile + rate limit + sessão curta.
3. `ip_hash` é temporário (7-30 dias), nunca IP puro.
4. k-anonimato reduz granularidade em grupos pequenos.

## B) Modelo de dados + migrations SQL

### Entidades principais
1. `organizations`, `organization_memberships` (RBAC admin/técnico).
2. `surveys` (campanhas/pesquisas).
3. `topics` (13 riscos).
4. `questions` (normalizado, com dimensão e regra de scoring).
5. `responses` (cabeçalho da submissão).
6. `answers` (1 linha por resposta/pergunta).
7. `topic_scores` (snapshots agregados).
8. `report_instances` (estado de geração DRPS).
9. `control_measures` (plano anual).
10. `rate_limit_buckets` + `abuse_events` (anti-abuso).
11. `threshold_profiles`, `threshold_bands`, `risk_matrix_rules` (classificação configurável).

### Migration SQL (base)
```sql
create extension if not exists pgcrypto;

create type survey_status as enum ('draft', 'live', 'closed', 'archived');
create type app_role as enum ('org_admin', 'tech_analyst', 'report_reviewer', 'billing');
create type question_dimension as enum ('severity', 'probability');
create type scoring_rule as enum ('direct', 'inverted');
create type report_status as enum ('queued', 'processing', 'ready', 'failed');
create type scope_type as enum ('global', 'sector', 'role', 'shift');
create type class_level as enum ('low', 'medium', 'high');
create type risk_level as enum ('low', 'medium', 'high', 'critical');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  cnpj text,
  created_at timestamptz not null default now()
);

create table organization_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id, role)
);

create table threshold_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  threshold_profile_id uuid references threshold_profiles(id),
  name text not null,
  public_slug text not null unique,
  status survey_status not null default 'draft',
  likert_min smallint not null default 1,
  likert_max smallint not null default 5,
  k_anonymity_min smallint not null default 5 check (k_anonymity_min >= 3),
  session_ttl_minutes smallint not null default 30 check (session_ttl_minutes between 15 and 60),
  turnstile_site_key text not null,
  turnstile_expected_hostname text not null,
  starts_at timestamptz,
  closes_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table topics (
  id smallint primary key check (id between 1 and 13),
  code text unique not null,
  name text not null
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  topic_id smallint not null references topics(id),
  question_code text not null,
  position int not null,
  prompt text not null,
  dimension question_dimension not null,
  scoring_rule scoring_rule not null,
  weight numeric(8,4) not null default 1.0,
  is_active boolean not null default true,
  source_excel_col text,
  created_at timestamptz not null default now(),
  unique (survey_id, question_code),
  unique (survey_id, position)
);

create table survey_group_dimensions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  key text not null,
  label text not null,
  is_required boolean not null default false,
  allow_free_text boolean not null default false,
  unique (survey_id, key)
);

create table survey_group_options (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references survey_group_dimensions(id) on delete cascade,
  value text not null,
  label text not null,
  sort_order int not null default 0,
  unique (dimension_id, value)
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  session_sid uuid,
  ip_hash bytea,
  group_values jsonb not null default '{}'::jsonb,
  answers_json jsonb not null,
  check (jsonb_typeof(group_values) = 'object'),
  check (jsonb_typeof(answers_json) = 'array')
);

create table answers (
  response_id uuid not null references responses(id) on delete cascade,
  question_id uuid not null references questions(id) on delete restrict,
  raw_value numeric(8,4) not null check (raw_value >= 0),
  corrected_value numeric(8,4) not null check (corrected_value >= 0),
  created_at timestamptz not null default now(),
  primary key (response_id, question_id)
);

create table threshold_bands (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references threshold_profiles(id) on delete cascade,
  dimension question_dimension not null,
  class class_level not null,
  min_value numeric(8,4) not null,
  max_value numeric(8,4) not null,
  check (min_value <= max_value),
  unique (profile_id, dimension, class)
);

create table risk_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references threshold_profiles(id) on delete cascade,
  severity_class class_level not null,
  probability_class class_level not null,
  risk risk_level not null,
  unique (profile_id, severity_class, probability_class)
);

create table report_instances (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status report_status not null default 'queued',
  params jsonb not null default '{}'::jsonb,
  snapshot_at timestamptz,
  drps_payload jsonb,
  pdf_storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table topic_scores (
  id bigserial primary key,
  survey_id uuid not null references surveys(id) on delete cascade,
  report_instance_id uuid references report_instances(id) on delete cascade,
  scope_type scope_type not null default 'global',
  scope_key text not null default 'all',
  topic_id smallint not null references topics(id),
  n_responses int not null,
  n_severity_answers int not null,
  n_probability_answers int not null,
  mean_severity numeric(8,4),
  mean_probability numeric(8,4),
  severity_class class_level,
  probability_class class_level,
  risk risk_level,
  k_anonymous boolean not null,
  calculated_at timestamptz not null default now()
);

create table control_measures (
  id uuid primary key default gen_random_uuid(),
  report_instance_id uuid not null references report_instances(id) on delete cascade,
  topic_id smallint references topics(id),
  action_text text not null,
  responsible text,
  due_month smallint check (due_month between 1 and 12),
  priority smallint check (priority between 1 and 3),
  status text not null default 'planned',
  notes text
);

create table rate_limit_buckets (
  survey_id uuid not null references surveys(id) on delete cascade,
  ip_hash bytea not null,
  bucket_start timestamptz not null,
  window_seconds int not null check (window_seconds in (60, 3600)),
  hit_count int not null default 0,
  primary key (survey_id, ip_hash, window_seconds, bucket_start)
);

create table abuse_events (
  id bigserial primary key,
  survey_id uuid not null references surveys(id) on delete cascade,
  session_sid uuid,
  ip_hash bytea,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index responses_survey_submitted_idx on responses (survey_id, submitted_at desc);
create index responses_group_values_gin_idx on responses using gin (group_values);
create index answers_question_idx on answers (question_id);
create index questions_survey_topic_dim_idx on questions (survey_id, topic_id, dimension);
create index report_instances_survey_idx on report_instances (survey_id, created_at desc);
create index topic_scores_lookup_idx on topic_scores (survey_id, scope_type, scope_key, topic_id, calculated_at desc);
create index rate_limit_lookup_idx on rate_limit_buckets (survey_id, ip_hash, bucket_start desc);
create index abuse_events_exp_idx on abuse_events (expires_at);
```

### Seed mínimo (tópicos + thresholds + matriz)
```sql
insert into topics (id, code, name) values
  (1,  'T01', 'Assédio de qualquer natureza'),
  (2,  'T02', 'Falta de suporte/apoio'),
  (3,  'T03', 'Má gestão de mudanças'),
  (4,  'T04', 'Baixa clareza de papel'),
  (5,  'T05', 'Baixas recompensas e reconhecimento'),
  (6,  'T06', 'Baixo controle/falta de autonomia'),
  (7,  'T07', 'Baixa justiça organizacional'),
  (8,  'T08', 'Eventos violentos/traumáticos'),
  (9,  'T09', 'Baixa demanda (subcarga)'),
  (10, 'T10', 'Excesso de demanda (sobrecarga)'),
  (11, 'T11', 'Maus relacionamentos'),
  (12, 'T12', 'Difícil comunicação'),
  (13, 'T13', 'Trabalho remoto e isolado');
```

## C) API design (payloads e validações)

### Público (anônimo)
1. `POST /api/public/surveys/[slug]/session`
   - efeito: seta cookie `form_session`.
   - response:
```json
{
  "surveyId": "uuid",
  "title": "DRPS 2026",
  "likert": { "min": 1, "max": 5 },
  "turnstileSiteKey": "site_key",
  "questions": [
    { "id": "uuid", "topicId": 1, "dimension": "severity", "prompt": "..." }
  ],
  "groups": {
    "sector": ["Operações", "Comercial", "Administrativo"],
    "shift": ["Manhã", "Tarde", "Noite"]
  }
}
```
2. `POST /api/public/surveys/[slug]/submit`
   - request:
```json
{
  "campaignId": "uuid",
  "turnstileToken": "0.xxx",
  "answers": [
    { "questionId": "uuid", "value": 4 },
    { "questionId": "uuid", "value": 2 }
  ],
  "groups": {
    "sector": "operacoes",
    "shift": "noite"
  }
}
```
   - validações:
1. cookie assinado válido e `survey_id` igual ao slug/campaign.
2. Turnstile válido (`success=true`, `hostname` esperado).
3. rate limit por `ip_hash`.
4. resposta completa ou política de parcial definida por survey.
5. sem perguntas duplicadas.
6. valores dentro de `likert_min..likert_max`.
7. grupos dentro de opções válidas (sem texto livre no MVP).

### Admin/técnico (com RBAC)
1. `POST /api/admin/surveys`
2. `POST /api/admin/surveys/[id]/questions/import`
3. `GET /api/admin/surveys/[id]/dashboard?groupBy=sector`
4. `POST /api/admin/surveys/[id]/reports`
5. `GET /api/admin/reports/[reportId]`
6. `PATCH /api/admin/reports/[reportId]` (campos editáveis)
7. `POST /api/admin/reports/[reportId]/finalize` (gera PDF final)
8. `GET /api/admin/reports/[reportId]/download`

## D) Algoritmos detalhados

### 1) Correção Direta/Invertida
```ts
function correctedScore(raw: number, rule: "direct" | "inverted", min: number, max: number): number {
  if (rule === "direct") return raw;
  return min + max - raw; // para 1..5: 6 - raw
}
```

### 2) Agregação por tópico (gravidade/probabilidade)
```sql
-- visão base por campanha e escopo
with scoped as (
  select r.id as response_id, r.survey_id, r.group_values
  from responses r
  where r.survey_id = :survey_id
),
agg as (
  select
    q.topic_id,
    q.dimension,
    avg(a.corrected_value) as mean_value,
    count(*) as answer_count,
    count(distinct a.response_id) as response_count
  from answers a
  join questions q on q.id = a.question_id
  join scoped s on s.response_id = a.response_id
  where q.survey_id = :survey_id
  group by q.topic_id, q.dimension
)
select * from agg;
```

### 3) Classificação (configurável)
```sql
-- classifica média usando bandas de threshold da campanha
select tb.class
from threshold_bands tb
where tb.profile_id = :profile_id
  and tb.dimension = :dimension
  and :mean_value between tb.min_value and tb.max_value
limit 1;
```

### 4) Matriz de risco (G x P)
```sql
select rmr.risk
from risk_matrix_rules rmr
where rmr.profile_id = :profile_id
  and rmr.severity_class = :sev_class
  and rmr.probability_class = :prob_class
limit 1;
```

### 5) k-anonimato
Regra: só exibir recorte quando `n_responses >= k`.
```sql
with group_counts as (
  select
    r.group_values->>:group_key as group_value,
    count(distinct r.id) as n
  from responses r
  where r.survey_id = :survey_id
  group by 1
)
select
  group_value,
  n,
  (n >= :k) as can_show
from group_counts;
```
Se `can_show = false`, UI mostra “Oculto por anonimato (n < k)”.

### 6) Rate limiting por `ip_hash`
Pseudocódigo:
```ts
ip = extractTrustedIp(headers); // cf-connecting-ip > x-forwarded-for > socket
ipHash = HMAC_SHA256(RATE_LIMIT_SECRET, ip);

minuteBucket = dateTruncMinute(now);
hourStart = now - 1h;

upsert(rate_limit_buckets, surveyId, ipHash, minuteBucket, 60, +1);
minuteCount = current minute hit_count;
hourCount = sum(hit_count where bucket_start >= hourStart and window_seconds = 60);

if (minuteCount > 5 || hourCount > 30) reject 429;
```

## E) UI/UX mínimo (MVP)

### 1. Criar campanha (`/admin/surveys/new`)
1. Dados gerais: nome, período, slug público.
2. Privacidade: `k`, TTL sessão, retenção de `ip_hash/session_sid`.
3. Grupos: setor/turno/cargo (listas fechadas).
4. Escala: importação da planilha (ou JSON) de perguntas/tópicos.
5. Publicar link.

### 2. Formulário público (`/s/[slug]`)
1. Cabeçalho de anonimato (claro e curto).
2. Perguntas por blocos.
3. Captcha Turnstile no final.
4. Confirmação sem exibir qualquer dado sensível.

### 3. Dashboard técnico (`/admin/surveys/[id]/dashboard`)
1. Total de respostas.
2. Médias G/P por tópico.
3. Heatmap da matriz.
4. Recortes por grupo com supressão por k-anonimato.

### 4. Revisão DRPS (`/admin/reports/[id]/review`)
1. Campos auto preenchidos.
2. Campos editáveis técnicos (fontes geradoras, observações, plano anual).
3. Controle de versão.

### 5. Geração/Download (`/admin/reports/[id]`)
1. Status (`queued/processing/ready/failed`).
2. Download PDF final.

## F) Geração DRPS (HTML -> PDF)

### Pipeline
1. Congelar snapshot (`topic_scores`) para consistência.
2. Montar `drps_payload` (JSON) com:
   - identificação
   - metodologia
   - tabela por tópico (G/P/classes/matriz)
   - matriz consolidada
   - medidas de controle (editable)
3. Renderizar template HTML (React server template).
4. Converter para PDF (Playwright/Puppeteer em worker).
5. Salvar em `Supabase Storage` e registrar `pdf_storage_path`.

### Seções do template (alinhadas ao Excel)
1. Identificação.
2. Metodologia e critérios.
3. Resumo por tópico.
4. Análise e avaliação (DRPS).
5. Plano anual de medidas de controle.
6. Monitoramento.

## G) Plano de implementação (MVP -> v1) e DoD

### Fase 1 - Fundamentos (semana 1-2)
1. Supabase Auth + RBAC admin/técnico.
2. Entidades base e migrations.
3. CRUD de campanhas e perguntas.
DoD:
1. Admin cria campanha publicada com link público.
2. Permissões por organização funcionando.

### Fase 2 - Coleta anônima segura (semana 2-3)
1. Endpoint de sessão com cookie assinado.
2. Submit com Turnstile + rate limit `ip_hash`.
3. Persistência `responses` + `answers`.
DoD:
1. Fluxo público completo sem login.
2. Rejeita submit inválido (captcha/sessão/rate).

### Fase 3 - Cálculo e dashboard (semana 3-4)
1. Scoring direta/invertida.
2. Agregação G/P por tópico.
3. Classificação + matriz configurável.
4. k-anonimato em recortes.
DoD:
1. Dashboard com números consistentes para dataset teste.
2. Recorte com `n < k` não aparece.

### Fase 4 - DRPS e PDF (semana 4-5)
1. `report_instances` + revisão técnica.
2. HTML -> PDF + storage.
3. Download e versionamento de relatório.
DoD:
1. Relatório completo gerado com 1 clique.
2. Campos editáveis persistem e entram no PDF final.

### v1 (pós-MVP)
1. Worker dedicado (fila robusta).
2. Auditoria de alterações em relatório.
3. Monitoramento operacional e alertas.
4. Módulo de faturamento/contratos (se escopo comercial exigir).

## H) Testes + dados de teste

### Unit tests
1. `correctedScore` (direta/invertida, min/max variáveis).
2. `classifyByThreshold`.
3. `resolveRiskMatrix`.
4. `applyKAnonymity`.
5. `extractTrustedIp` + hash HMAC.

### Integration tests (API)
1. `POST /session` gera cookie válido.
2. `POST /submit`:
   - sucesso com captcha mock ok.
   - 400/401 para cookie inválido.
   - 429 para rate limit excedido.
3. dashboard oculta grupo com `n < k`.
4. geração de relatório cria registro + arquivo.

### Dados de teste
1. Seed com 13 tópicos e 50 perguntas.
2. 500 respostas sintéticas distribuídas em 4 setores.
3. Cenário de grupo pequeno (`n=3`) para validar supressão.

## I) Checklist operacional

### Segurança e privacidade
1. Redação de logs:
   - nunca logar body completo de submit.
   - nunca logar `form_session` ou `turnstileToken`.
2. Retenção:
   - `ip_hash/session_sid`: 7-30 dias.
   - job diário para limpeza:
```sql
update responses
set ip_hash = null, session_sid = null
where submitted_at < now() - interval '30 days';

delete from rate_limit_buckets
where bucket_start < now() - interval '2 days';

delete from abuse_events
where expires_at < now();
```
3. Turnstile:
   - validar `success` e `hostname`.
   - segredos em env vars rotacionáveis.
4. Headers de IP:
   - priorizar `cf-connecting-ip` (quando Cloudflare ativo).
   - fallback `x-forwarded-for` (primeiro IP).
   - fallback final `request.ip`.
5. Rate limits padrão:
   - burst: `5/min` por `ip_hash`.
   - sustentado: `30/h` por `ip_hash`.
   - thresholds em config por campanha.

### Governança técnica
1. Versionar threshold profiles e matriz.
2. Snapshot de score por relatório (reprodutibilidade).
3. Auditoria de edição manual no DRPS.
4. Backup e restore testado para Postgres + Storage.

## Padrão inicial recomendado de classificação
- Gravidade/Probabilidade (Likert 1..5, configurável):
1. `Low`: 1.00 - 2.30
2. `Medium`: 2.31 - 3.60
3. `High`: 3.61 - 5.00
- Matriz (3x3 -> 4 níveis):
1. `low+low`, `low+medium`, `medium+low` -> `low`
2. `low+high`, `medium+medium`, `high+low` -> `medium`
3. `medium+high`, `high+medium` -> `high`
4. `high+high` -> `critical`

## Decisões pragmáticas para MVP
1. Sem tentativa de “1 resposta por empregado”.
2. Sem texto livre no formulário público (reduz risco de identificação indireta).
3. Respostas normalizadas + JSONB para replay.
4. k-anonimato aplicado em toda visualização segmentada.
5. Fila robusta pode entrar após MVP; manter fluxo simples primeiro.
