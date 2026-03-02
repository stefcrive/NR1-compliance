# NR1 Compliance Web (MVP)

Implementacao inicial do portal NR1 com foco no fluxo publico anonimo:
1. Emissao de sessao curta assinada (`form_session`).
2. Submit com Turnstile server-side.
3. Rate limit por `ip_hash` (HMAC de IP).
4. Persistencia normalizada (`responses` + `answers`).
5. Endpoint tecnico de agregacao por topico com k-anonimato em recortes.
6. Portal admin com:
   - gestao de campanhas,
   - dashboard visual consolidado,
   - formulario DRPS em etapas com parse e recomendacoes.

## Requisitos
1. Node 20+.
2. Projeto Supabase (Postgres) acessivel.

## Setup local
1. Copie `.env.example` para `.env.local` e preencha os valores.
   - Use `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) para acesso admin server-side.
2. Instale dependencias:
```bash
npm install
```
3. Aplique as migrations SQL no banco Supabase (ordem de timestamp):
   - `supabase/migrations/20260301153000_mvp_init.sql`
   - `supabase/migrations/20260301154000_seed_topics.sql`
   - `supabase/migrations/20260301155000_seed_demo_survey.sql`
   - `supabase/migrations/20260301164000_drps_admin_support.sql`
   - `supabase/migrations/20260301170500_seed_multi_company_drps.sql`
   - `supabase/migrations/20260301173000_seed_b2b_multitenant_compliance.sql`
   - `supabase/migrations/20260301190000_sector_tokens_and_risk_params.sql`
   - `supabase/migrations/20260301201000_manager_client_workspaces.sql`
   - `supabase/migrations/20260302110000_client_sector_onboarding_fields.sql`
   - Opcional via CLI:
```bash
npx supabase db push --db-url "$SUPABASE_DB_URL" --include-all --workdir .
```
4. Rode a aplicacao:
```bash
npm run dev
```

## Rotas principais
1. Landing principal: `GET /`
2. Portal cliente:
   - `GET /portal`
   - `GET /portal/campaigns`
   - `GET /portal/dashboard`
   - `GET /portal/drps/new`
3. Console manager:
   - `GET /manager`
4. Workspace cliente por empresa:
   - `GET /client/:clientSlug` (ex.: `/client/techcorp-brasil`)
5. Formulario publico demo: `GET /s/demo-nr1-2026`
6. APIs publicas:
   - `POST /api/public/surveys/demo-nr1-2026/session`
   - `POST /api/public/surveys/demo-nr1-2026/submit`
7. APIs admin:
   - `GET/POST /api/admin/campaigns`
   - `GET/POST /api/admin/campaigns/:campaignId/sectors`
   - `POST /api/admin/campaigns/:campaignId/sectors/:sectorId/token`
   - `GET/POST /api/admin/drps`
   - `GET/POST /api/admin/clients`
   - `GET/PATCH /api/admin/clients/:clientId`
   - `POST /api/admin/clients/:clientId/assign-drps`
   - `GET/POST /api/admin/clients/:clientId/reports`
   - `GET /api/admin/surveys/demo-nr1-2026/portal`
   - `GET /api/admin/surveys/demo-nr1-2026/dashboard`
8. APIs do portal cliente:
   - `GET /api/client/portal/:clientSlug`
   - `GET/POST /api/client/portal/:clientSlug/campaigns/:campaignId/sectors`
   - `POST /api/client/portal/:clientSlug/campaigns/:campaignId/sectors/:sectorId/token`

## Observacoes de seguranca
1. O sistema nao coleta IP em claro, apenas `ip_hash` HMAC.
2. Turnstile pode ser bypassado localmente com `TURNSTILE_BYPASS=true` (nao usar em producao).
3. Cookie `form_session` contem apenas `sid`, `surveyId`, `iat`, `exp`.
4. O MVP atual usa todas as 50 perguntas da planilha como dimensao `severity`.
   - A dimensao `probability` fica habilitada no modelo, mas depende de adicionar perguntas dessa dimensao.
5. Quando uma campanha possui setores ativos cadastrados em `survey_sectors`, o endpoint de sessao publica exige token setorial (`?token=...`) e fixa o setor no submit.
5. Endpoints `/api/admin/*`:
   - Em desenvolvimento: liberados sem `ADMIN_API_KEY`.
   - Em producao: configure `ADMIN_API_KEY` e envie no header `x-admin-api-key`.

## Seeds multiempresa para teste de DRPS
1. A migration `20260301170500_seed_multi_company_drps.sql` adiciona campanhas ativas com respostas e snapshots DRPS para:
   - `techcorp-brasil-2026-q1`
   - `industria-alfa-2026-q1`
   - `varejo-horizonte-2026-q1`
2. Esses slugs podem ser usados nos endpoints de dashboard/portal para validar geracao de relatorios em contexto multi-tenant.

## Seeds B2B multi-tenant (schema de compliance)
1. A migration `20260301173000_seed_b2b_multitenant_compliance.sql` cria e popula as tabelas:
   - `clients`
   - `invoices`
   - `drps_campaigns`
   - `employee_responses`
   - `periodic_programs`
   - `client_programs`
2. O seed inclui 4 empresas, campanhas DRPS Q1/2026 (incluindo campanhas concluídas), respostas por setor/topico e recomendacoes de programas automaticas por threshold.

## Proximos passos (v1)
1. Autenticacao Supabase completa no admin com RBAC por organizacao.
2. Tela de dashboard tecnico no frontend.
3. Pipeline DRPS HTML -> PDF com storage e versionamento.
4. Testes automatizados unitarios e de integracao.
