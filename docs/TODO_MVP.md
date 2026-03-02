# NR1 Compliance - TODO da Primeira Versao Funcional

## Legenda
- [ ] Pendente
- [x] Concluido
- [~] Em andamento

## 1) Planejamento e organizacao
- [x] Criar plano de implementacao versionado em `docs/IMPLEMENTATION_PLAN_MVP.md`
- [x] Criar e manter TODO desta iteracao em `docs/TODO_MVP.md`

## 2) Banco de dados (MVP)
- [x] Criar migration SQL inicial com tabelas principais do fluxo publico
- [x] Criar indices para respostas, perguntas e anti-abuso
- [x] Criar funcao SQL `check_rate_limit`
- [x] Criar funcao SQL `get_topic_aggregates`
- [x] Criar funcao SQL `get_group_counts`
- [x] Seed de topicos (13) e estrutura base de survey

## 3) Backend - utilitarios de seguranca
- [x] Definir modulo de env vars obrigatorias
- [x] Implementar assinatura/verificacao de `form_session` (HMAC)
- [x] Implementar extracao de IP confiavel e hash HMAC (`ip_hash`)
- [x] Implementar verificacao server-side do Cloudflare Turnstile
- [x] Criar cliente Supabase admin (service role)

## 4) Backend - APIs publicas
- [x] `POST /api/public/surveys/[slug]/session`
- [x] `POST /api/public/surveys/[slug]/submit`
- [x] Validacoes de payload (tipos, range Likert, perguntas duplicadas, completude)
- [x] Persistencia normalizada em `responses` e `answers`
- [x] Respostas de erro padronizadas (400/401/404/429/500)

## 5) Frontend publico
- [x] Criar rota `src/app/s/[slug]/page.tsx`
- [x] Consumir endpoint de sessao e renderizar perguntas
- [x] Integrar submit com token Turnstile (MVP com fallback de dev)
- [x] Exibir estados de carregamento, erro e sucesso
- [x] Atualizar home page com links de navegacao para teste

## 6) Backend tecnico inicial
- [x] `GET /api/admin/surveys/[slug]/dashboard`
- [x] Aplicar k-anonimato por grupo (`count < k` ocultar)
- [x] Classificacao por thresholds configuraveis e matriz de risco

## 7) Operacao e validacao
- [x] Criar `.env.example` com variaveis necessarias
- [x] Documentar setup e fluxo de seed no README
- [x] Rodar `npm run lint`
- [x] Ajustar erros de tipagem/lint ate ficar limpo

## 8) Fechamento da iteracao
- [x] Marcar itens finalizados nesta lista
- [x] Registrar gaps conhecidos para a proxima iteracao

## Gaps conhecidos para proxima iteracao
- [ ] Implementar autenticacao admin com Supabase Auth + RBAC por organizacao.
- [x] Criar telas admin completas (campanhas, dashboard visual, revisão DRPS).
- [ ] Adicionar testes automatizados (unit + integration).
- [ ] Implementar geracao DRPS HTML -> PDF com armazenamento e versionamento.

## Iteracao 2 - Portal e DRPS
- [x] Criar landing page moderna com contexto de compliance, beneficios e riscos de autuacao/multa.
- [x] Adicionar CTA para dashboard pessoal do cliente.
- [x] Implementar area portal com navegacao (`/portal`).
- [x] Implementar gestao de campanhas (`/portal/campaigns`) com criacao e clonagem de estrutura.
- [x] Implementar dashboard visual (`/portal/dashboard`) com cards, distribuicao de risco, serie temporal e recorte por setor.
- [x] Implementar formulario DRPS multi-etapa com barra de progresso (`/portal/drps/new`).
- [x] Persistir DRPS no banco com parse e recomendacoes automaticas.
- [x] Compilar resultados DRPS e quantitativos no portal via endpoint consolidado.
