-- Persist assigned continuous-program evaluation questionnaires and seed online activity templates.

create table if not exists client_program_evaluations (
  evaluation_id uuid primary key,
  client_program_id uuid not null references client_programs(client_program_id) on delete cascade,
  client_id uuid not null references clients(client_id) on delete cascade,
  answers jsonb not null,
  questionnaire_snapshot jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  constraint client_program_evaluations_answers_type_chk
    check (jsonb_typeof(answers) = 'array'),
  constraint client_program_evaluations_answers_len_chk
    check (jsonb_array_length(answers) between 1 and 20),
  constraint client_program_evaluations_questionnaire_snapshot_type_chk
    check (jsonb_typeof(questionnaire_snapshot) = 'array')
);

create index if not exists client_program_evaluations_program_idx
  on client_program_evaluations (client_program_id, submitted_at desc);

create index if not exists client_program_evaluations_client_idx
  on client_program_evaluations (client_id, submitted_at desc);

with risk_topics (topic_id, risk_label) as (
  values
    (1, 'assedio e violencia psicologica'),
    (2, 'falta de suporte e apoio'),
    (3, 'gestao de mudancas'),
    (4, 'clareza de papel'),
    (5, 'reconhecimento'),
    (6, 'autonomia'),
    (7, 'justica organizacional'),
    (8, 'eventos traumaticos'),
    (9, 'subcarga'),
    (10, 'sobrecarga'),
    (11, 'relacionamentos interpessoais'),
    (12, 'comunicacao'),
    (13, 'trabalho remoto e isolamento')
),
activity_templates (activity_order, title_pattern, description_pattern, trigger_threshold) as (
  values
    (
      1,
      'Atividade online - diagnostico pratico de %s',
      'Sprint online de autopercepcao, mapeamento de gatilhos e plano de prevencao para %s.',
      2.10::numeric
    ),
    (
      2,
      'Atividade online - oficina guiada de %s',
      'Oficina online em grupo com tecnicas aplicadas para reduzir exposicao e fortalecer rotina de %s.',
      2.20::numeric
    ),
    (
      3,
      'Atividade online - plano de acao semanal de %s',
      'Ciclo online de micro-acoes, acompanhamento e revisao de indicadores para evolucao em %s.',
      2.30::numeric
    )
),
prepared as (
  select
    rt.topic_id,
    at.activity_order,
    md5(format('nr1-online-activity-%s-%s', rt.topic_id, at.activity_order)) as hash_key,
    format(at.title_pattern, rt.risk_label) as title,
    format(at.description_pattern, rt.risk_label) as description,
    at.trigger_threshold
  from risk_topics rt
  cross join activity_templates at
)
insert into periodic_programs (program_id, title, description, target_risk_topic, trigger_threshold)
select
  (
    substr(p.hash_key, 1, 8) || '-' ||
    substr(p.hash_key, 9, 4) || '-' ||
    substr(p.hash_key, 13, 4) || '-' ||
    substr(p.hash_key, 17, 4) || '-' ||
    substr(p.hash_key, 21, 12)
  )::uuid as program_id,
  p.title,
  p.description,
  p.topic_id as target_risk_topic,
  p.trigger_threshold
from prepared p
on conflict (program_id) do update
set
  title = excluded.title,
  description = excluded.description,
  target_risk_topic = excluded.target_risk_topic,
  trigger_threshold = excluded.trigger_threshold;
