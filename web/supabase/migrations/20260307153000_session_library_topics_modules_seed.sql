alter table if exists public.continuous_program_session_library
  add column if not exists module_order smallint not null default 999;

alter table if exists public.continuous_program_session_library
  add column if not exists module_title text not null default 'Modulo Livre';

alter table if exists public.continuous_program_session_library
  add column if not exists topic_order smallint not null default 999;

alter table if exists public.continuous_program_session_library
  add column if not exists topic_title text not null default 'Sessao Personalizada';

alter table if exists public.continuous_program_session_library
  drop constraint if exists continuous_program_session_library_module_title_len;

alter table if exists public.continuous_program_session_library
  add constraint continuous_program_session_library_module_title_len
  check (char_length(btrim(module_title)) between 1 and 240);

alter table if exists public.continuous_program_session_library
  drop constraint if exists continuous_program_session_library_topic_title_len;

alter table if exists public.continuous_program_session_library
  add constraint continuous_program_session_library_topic_title_len
  check (char_length(btrim(topic_title)) between 1 and 240);

create index if not exists continuous_program_session_library_module_topic_idx
  on public.continuous_program_session_library (module_order, topic_order);

create index if not exists continuous_program_session_library_topic_order_idx
  on public.continuous_program_session_library (topic_order);

-- Recreate the library as a topic-centric catalog grouped by training modules.
delete from public.continuous_program_session_library;

insert into public.continuous_program_session_library (
  title,
  notes,
  preparation_required,
  materials,
  module_order,
  module_title,
  topic_order,
  topic_title
)
values
  ('O Cenario da Saude Mental no Trabalho', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 1, 'O Cenario da Saude Mental no Trabalho'),
  ('Os 13 Fatores de Risco da NR-01', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 2, 'Os 13 Fatores de Risco da NR-01'),
  ('Desmistificando o Sofrimento Psiquico', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 3, 'Desmistificando o Sofrimento Psiquico'),
  ('Conflito Vida-Trabalho', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 4, 'Conflito Vida-Trabalho'),
  ('Ergonomia Psicologica: Desenhando Ambientes Mentalmente Saudaveis', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 5, 'Ergonomia Psicologica: Desenhando Ambientes Mentalmente Saudaveis'),
  ('Saude Mental e Seguranca do Trabalho: A Interface Obrigatoria', null, null, '[]'::jsonb, 1, 'Modulo 1 - Conscientizacao e Fundamentos (Foco na NR-01)', 6, 'Saude Mental e Seguranca do Trabalho: A Interface Obrigatoria'),
  ('O Modelo ABC das Emocoes', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 7, 'O Modelo ABC das Emocoes'),
  ('Reestruturacao Cognitiva', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 8, 'Reestruturacao Cognitiva'),
  ('Terapia de Resolucao de Problemas', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 9, 'Terapia de Resolucao de Problemas'),
  ('Definicao de Metas SMART', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 10, 'Definicao de Metas SMART'),
  ('Comunicacao Nao-Violenta (CNV) como Ferramenta Cognitiva', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 11, 'Comunicacao Nao-Violenta (CNV) como Ferramenta Cognitiva'),
  ('Autocompaixao e Autocritica no Ambiente Profissional', null, null, '[]'::jsonb, 2, 'Modulo 2 - Terapia Cognitivo-Comportamental (TCC) Aplicada ao Trabalho', 12, 'Autocompaixao e Autocritica no Ambiente Profissional'),
  ('Desenvolvendo Flexibilidade Psicologica', null, null, '[]'::jsonb, 3, 'Modulo 3 - Terapia de Aceitacao e Compromisso (ACT) e Engajamento', 13, 'Desenvolvendo Flexibilidade Psicologica'),
  ('Esclarecimento de Valores Profissionais', null, null, '[]'::jsonb, 3, 'Modulo 3 - Terapia de Aceitacao e Compromisso (ACT) e Engajamento', 14, 'Esclarecimento de Valores Profissionais'),
  ('Modelagem do Trabalho (Job Crafting)', null, null, '[]'::jsonb, 3, 'Modulo 3 - Terapia de Aceitacao e Compromisso (ACT) e Engajamento', 15, 'Modelagem do Trabalho (Job Crafting)'),
  ('Desfusao Cognitiva: Libertando-se da Tirania dos Pensamentos', null, null, '[]'::jsonb, 3, 'Modulo 3 - Terapia de Aceitacao e Compromisso (ACT) e Engajamento', 16, 'Desfusao Cognitiva: Libertando-se da Tirania dos Pensamentos'),
  ('Psicologia Positiva Aplicada: Forcas e Engajamento', null, null, '[]'::jsonb, 3, 'Modulo 3 - Terapia de Aceitacao e Compromisso (ACT) e Engajamento', 17, 'Psicologia Positiva Aplicada: Forcas e Engajamento'),
  ('Eficacia Interpessoal e o Metodo DEAR MAN', null, null, '[]'::jsonb, 4, 'Modulo 4 - Terapia Comportamental Dialetica (DBT) para Relacionamentos e Crises', 18, 'Eficacia Interpessoal e o Metodo DEAR MAN'),
  ('Regulacao Emocional', null, null, '[]'::jsonb, 4, 'Modulo 4 - Terapia Comportamental Dialetica (DBT) para Relacionamentos e Crises', 19, 'Regulacao Emocional'),
  ('Tolerancia ao Mal-Estar e Aceitacao Radical', null, null, '[]'::jsonb, 4, 'Modulo 4 - Terapia Comportamental Dialetica (DBT) para Relacionamentos e Crises', 20, 'Tolerancia ao Mal-Estar e Aceitacao Radical'),
  ('Atencao Plena (Mindfulness) no Trabalho', null, null, '[]'::jsonb, 4, 'Modulo 4 - Terapia Comportamental Dialetica (DBT) para Relacionamentos e Crises', 21, 'Atencao Plena (Mindfulness) no Trabalho'),
  ('Habilidades de Relacionamento: GIVE e FAST', null, null, '[]'::jsonb, 4, 'Modulo 4 - Terapia Comportamental Dialetica (DBT) para Relacionamentos e Crises', 22, 'Habilidades de Relacionamento: GIVE e FAST'),
  ('Justica Organizacional', null, null, '[]'::jsonb, 5, 'Modulo 5 - Lideranca e Cultura Organizacional', 23, 'Justica Organizacional'),
  ('Seguranca Psicologica', null, null, '[]'::jsonb, 5, 'Modulo 5 - Lideranca e Cultura Organizacional', 24, 'Seguranca Psicologica'),
  ('Lideranca Compassiva e Neurolideranca', null, null, '[]'::jsonb, 5, 'Modulo 5 - Lideranca e Cultura Organizacional', 25, 'Lideranca Compassiva e Neurolideranca'),
  ('Prevencao e Manejo do Assedio Moral e Sexual', null, null, '[]'::jsonb, 5, 'Modulo 5 - Lideranca e Cultura Organizacional', 26, 'Prevencao e Manejo do Assedio Moral e Sexual'),
  ('Comunicacao em Tempos de Crise e Mudanca Organizacional', null, null, '[]'::jsonb, 5, 'Modulo 5 - Lideranca e Cultura Organizacional', 27, 'Comunicacao em Tempos de Crise e Mudanca Organizacional'),
  ('Neurociencia do Estresse: O que Acontece no Cerebro sob Pressao', null, null, '[]'::jsonb, 6, 'Modulo 6 - Neurociencia e Performance Mental', 28, 'Neurociencia do Estresse: O que Acontece no Cerebro sob Pressao'),
  ('Sono, Cognicao e Saude Mental no Trabalho', null, null, '[]'::jsonb, 6, 'Modulo 6 - Neurociencia e Performance Mental', 29, 'Sono, Cognicao e Saude Mental no Trabalho'),
  ('Fadiga por Compaixao e Burnout em Equipes de Suporte', null, null, '[]'::jsonb, 6, 'Modulo 6 - Neurociencia e Performance Mental', 30, 'Fadiga por Compaixao e Burnout em Equipes de Suporte'),
  ('Neurociencia da Motivacao e Recompensa', null, null, '[]'::jsonb, 6, 'Modulo 6 - Neurociencia e Performance Mental', 31, 'Neurociencia da Motivacao e Recompensa'),
  ('Construindo Resiliencia Psicologica', null, null, '[]'::jsonb, 7, 'Modulo 7 - Resiliencia e Crescimento Pos-Traumatico', 32, 'Construindo Resiliencia Psicologica'),
  ('Crescimento Pos-Traumatico no Contexto Profissional', null, null, '[]'::jsonb, 7, 'Modulo 7 - Resiliencia e Crescimento Pos-Traumatico', 33, 'Crescimento Pos-Traumatico no Contexto Profissional'),
  ('Gestao do Luto Profissional: Perdas, Transicoes e Recomecos', null, null, '[]'::jsonb, 7, 'Modulo 7 - Resiliencia e Crescimento Pos-Traumatico', 34, 'Gestao do Luto Profissional: Perdas, Transicoes e Recomecos'),
  ('Autoeficacia e Confianca no Trabalho', null, null, '[]'::jsonb, 7, 'Modulo 7 - Resiliencia e Crescimento Pos-Traumatico', 35, 'Autoeficacia e Confianca no Trabalho'),
  ('Saude Mental no Trabalho Remoto e Hibrido', null, null, '[]'::jsonb, 8, 'Modulo 8 - Trabalho Remoto, Hibrido e Cultura Digital', 36, 'Saude Mental no Trabalho Remoto e Hibrido'),
  ('Hiperconectividade, Dopamina e Saude Mental Digital', null, null, '[]'::jsonb, 8, 'Modulo 8 - Trabalho Remoto, Hibrido e Cultura Digital', 37, 'Hiperconectividade, Dopamina e Saude Mental Digital'),
  ('Microagressoes e Saude Mental: O Impacto do Cotidiano', null, null, '[]'::jsonb, 9, 'Modulo 9 - Diversidade, Equidade e Inclusao (DEI) como Dimensao de Saude Mental', 38, 'Microagressoes e Saude Mental: O Impacto do Cotidiano'),
  ('Pertencimento e Saude Mental: A Necessidade de Ser Visto', null, null, '[]'::jsonb, 9, 'Modulo 9 - Diversidade, Equidade e Inclusao (DEI) como Dimensao de Saude Mental', 39, 'Pertencimento e Saude Mental: A Necessidade de Ser Visto'),
  ('Saude Mental e Identidade: Raca, Genero e Orientacao no Trabalho', null, null, '[]'::jsonb, 9, 'Modulo 9 - Diversidade, Equidade e Inclusao (DEI) como Dimensao de Saude Mental', 40, 'Saude Mental e Identidade: Raca, Genero e Orientacao no Trabalho'),
  ('Primeiros Socorros Psicologicos no Trabalho', null, null, '[]'::jsonb, 10, 'Modulo 10 - Gestao de Crises, Primeiros Socorros Psicologicos e Suporte', 41, 'Primeiros Socorros Psicologicos no Trabalho'),
  ('Prevencao ao Suicidio no Ambiente de Trabalho', null, null, '[]'::jsonb, 10, 'Modulo 10 - Gestao de Crises, Primeiros Socorros Psicologicos e Suporte', 42, 'Prevencao ao Suicidio no Ambiente de Trabalho'),
  ('Programa de Assistencia ao Empregado (PAE/EAP): Implementacao e Uso', null, null, '[]'::jsonb, 10, 'Modulo 10 - Gestao de Crises, Primeiros Socorros Psicologicos e Suporte', 43, 'Programa de Assistencia ao Empregado (PAE/EAP): Implementacao e Uso');
