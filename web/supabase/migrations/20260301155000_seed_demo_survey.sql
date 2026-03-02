insert into surveys (id, name, public_slug, status, likert_min, likert_max, k_anonymity_min, session_ttl_minutes, turnstile_site_key, turnstile_expected_hostname)
values (
  '11111111-1111-1111-1111-111111111001',
  'Campanha Demo NR1 2026',
  'demo-nr1-2026',
  'live',
  1,
  5,
  5,
  30,
  '1x00000000000000000000AA',
  'localhost'
)
on conflict (id) do update set
  name = excluded.name,
  public_slug = excluded.public_slug,
  status = excluded.status,
  likert_min = excluded.likert_min,
  likert_max = excluded.likert_max,
  k_anonymity_min = excluded.k_anonymity_min,
  session_ttl_minutes = excluded.session_ttl_minutes,
  turnstile_site_key = excluded.turnstile_site_key,
  turnstile_expected_hostname = excluded.turnstile_expected_hostname,
  updated_at = now();

insert into survey_group_dimensions (id, survey_id, key, label, is_required)
values
  ('11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111001', 'sector', 'Setor', true),
  ('11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111001', 'role', 'Cargo/Fun??o', false)
on conflict (id) do update set
  key = excluded.key,
  label = excluded.label,
  is_required = excluded.is_required;

insert into survey_group_options (dimension_id, value, label, sort_order)
values
  ('11111111-1111-1111-1111-111111111101', 'operacoes', 'Opera??es', 1),
  ('11111111-1111-1111-1111-111111111101', 'comercial', 'Comercial', 2),
  ('11111111-1111-1111-1111-111111111101', 'administrativo', 'Administrativo', 3),
  ('11111111-1111-1111-1111-111111111101', 'ti', 'TI', 4),
  ('11111111-1111-1111-1111-111111111102', 'analista', 'Analista', 1),
  ('11111111-1111-1111-1111-111111111102', 'lideranca', 'Lideran?a', 2),
  ('11111111-1111-1111-1111-111111111102', 'administrativo', 'Administrativo', 3),
  ('11111111-1111-1111-1111-111111111102', 'operacional', 'Operacional', 4)
on conflict (dimension_id, value) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

insert into questions (survey_id, topic_id, question_code, position, prompt, dimension, scoring_rule, is_required, source_excel_col)
values
  ('11111111-1111-1111-1111-111111111001', 1, 'Q01', 1, 'Você já presenciou ou sofreu comentários ofensivos, piadas ou insinuações inadequadas no ambiente de trabalho?', 'severity', 'direct', true, 'D'),
  ('11111111-1111-1111-1111-111111111001', 1, 'Q02', 2, 'Você se sente à vontade para relatar situações de assédio moral ou sexual na empresa sem medo de represálias?', 'severity', 'inverted', true, 'E'),
  ('11111111-1111-1111-1111-111111111001', 1, 'Q03', 3, 'Existe um canal seguro e sigiloso para denunciar assédio na empresa?', 'severity', 'inverted', true, 'F'),
  ('11111111-1111-1111-1111-111111111001', 1, 'Q04', 4, 'Há casos conhecidos de assédio moral ou sexual que não foram devidamente investigados ou punidos?', 'severity', 'direct', true, 'G'),
  ('11111111-1111-1111-1111-111111111001', 1, 'Q05', 5, 'O RH e os gestores demonstram comprometimento real com a prevenção do assédio?', 'severity', 'inverted', true, 'H'),
  ('11111111-1111-1111-1111-111111111001', 2, 'Q06', 6, 'Você sente que pode contar com seus colegas em momentos de dificuldade?', 'severity', 'inverted', true, 'I'),
  ('11111111-1111-1111-1111-111111111001', 2, 'Q07', 7, 'Existe apoio da liderança para lidar com desafios relacionados ao trabalho?', 'severity', 'inverted', true, 'J'),
  ('11111111-1111-1111-1111-111111111001', 2, 'Q08', 8, 'O RH está presente e atuante quando surgem conflitos ou dificuldades no trabalho?', 'severity', 'inverted', true, 'K'),
  ('11111111-1111-1111-1111-111111111001', 2, 'Q09', 9, 'Os gestores promovem um ambiente saudável e respeitoso?', 'severity', 'inverted', true, 'L'),
  ('11111111-1111-1111-1111-111111111001', 2, 'Q10', 10, 'Você sente que pode expressar suas dificuldades no trabalho sem ser julgado(a)?', 'severity', 'inverted', true, 'M'),
  ('11111111-1111-1111-1111-111111111001', 3, 'Q11', 11, 'Mudanças organizacionais impactaram negativamente seu sentimento de segurança no trabalho?', 'severity', 'direct', true, 'N'),
  ('11111111-1111-1111-1111-111111111001', 3, 'Q12', 12, 'Há comunicação clara sobre mudanças que afetam a empresa ou os trabalhadores?', 'severity', 'inverted', true, 'O'),
  ('11111111-1111-1111-1111-111111111001', 3, 'Q13', 13, 'Você já sentiu que seu emprego estava ameaçado sem explicações claras durante períodos de mudança?', 'severity', 'direct', true, 'P'),
  ('11111111-1111-1111-1111-111111111001', 3, 'Q14', 14, 'Existe transparência na comunicação da empresa durante processos de mudança?', 'severity', 'inverted', true, 'Q'),
  ('11111111-1111-1111-1111-111111111001', 4, 'Q15', 15, 'Você recebe instruções claras sobre suas responsabilidades no trabalho?', 'severity', 'inverted', true, 'R'),
  ('11111111-1111-1111-1111-111111111001', 4, 'Q16', 16, 'A comunicação da empresa ajuda você a entender o que é esperado do seu trabalho?', 'severity', 'inverted', true, 'S'),
  ('11111111-1111-1111-1111-111111111001', 4, 'Q17', 17, 'A comunicação entre equipes e setores contribui para a clareza das suas tarefas?', 'severity', 'inverted', true, 'T'),
  ('11111111-1111-1111-1111-111111111001', 4, 'Q18', 18, 'Você se sente confortável para pedir esclarecimentos quando não entende suas funções ou prioridades?', 'severity', 'inverted', true, 'U'),
  ('11111111-1111-1111-1111-111111111001', 5, 'Q19', 19, 'Você sente que seu esforço e desempenho são reconhecidos pela liderança?', 'severity', 'inverted', true, 'V'),
  ('11111111-1111-1111-1111-111111111001', 5, 'Q20', 20, 'Você recebe feedback construtivo sobre o seu trabalho com regularidade?', 'severity', 'inverted', true, 'W'),
  ('11111111-1111-1111-1111-111111111001', 5, 'Q21', 21, 'Você já se sentiu desmotivado(a) por falta de reconhecimento no trabalho?', 'severity', 'direct', true, 'X'),
  ('11111111-1111-1111-1111-111111111001', 6, 'Q22', 22, 'Você tem liberdade para tomar decisões sobre como executar suas tarefas diárias?', 'severity', 'inverted', true, 'Y'),
  ('11111111-1111-1111-1111-111111111001', 6, 'Q23', 23, 'A empresa confia na sua capacidade de organizar e gerenciar o próprio trabalho?', 'severity', 'inverted', true, 'Z'),
  ('11111111-1111-1111-1111-111111111001', 6, 'Q24', 24, 'O excesso de controle ou burocracia interfere no seu desempenho?', 'severity', 'direct', true, 'AA'),
  ('11111111-1111-1111-1111-111111111001', 6, 'Q25', 25, 'Existe excesso de supervisão que impacte negativamente sua produtividade ou bem-estar?', 'severity', 'direct', true, 'AB'),
  ('11111111-1111-1111-1111-111111111001', 7, 'Q26', 26, 'Você acha justas e claras as formas que a empresa usa para avaliar o seu trabalho?', 'severity', 'inverted', true, 'AC'),
  ('11111111-1111-1111-1111-111111111001', 7, 'Q27', 27, 'Você sente que há igualdade no reconhecimento entre diferentes áreas ou equipes?', 'severity', 'inverted', true, 'AD'),
  ('11111111-1111-1111-1111-111111111001', 7, 'Q28', 28, 'Você sente que há transparência nas decisões de desligamento na empresa?', 'severity', 'inverted', true, 'AE'),
  ('11111111-1111-1111-1111-111111111001', 7, 'Q29', 29, 'Você já presenciou casos de demissões injustas?', 'severity', 'direct', true, 'AF'),
  ('11111111-1111-1111-1111-111111111001', 8, 'Q30', 30, 'Você já vivenciou ou presenciou alguma situação de violência grave no trabalho (como agressão física, ameaça séria ou ataque verbal intenso)?', 'severity', 'direct', true, 'AG'),
  ('11111111-1111-1111-1111-111111111001', 8, 'Q31', 31, 'Você já passou por algum evento grave no trabalho (como acidente sério, situação de risco extremo ou episódio muito impactante)?', 'severity', 'direct', true, 'AH'),
  ('11111111-1111-1111-1111-111111111001', 8, 'Q32', 32, 'Alguma situação vivida no trabalho já foi tão marcante que deixou medo, choque ou forte abalo emocional?', 'severity', 'direct', true, 'AI'),
  ('11111111-1111-1111-1111-111111111001', 9, 'Q33', 33, 'Você sente que, na maior parte do tempo, tem pouco trabalho a realizar durante sua jornada?', 'severity', 'direct', true, 'AJ'),
  ('11111111-1111-1111-1111-111111111001', 9, 'Q34', 34, 'Você costuma ficar com tempo ocioso no trabalho por falta de tarefas ou demandas claras?', 'severity', 'direct', true, 'AK'),
  ('11111111-1111-1111-1111-111111111001', 9, 'Q35', 35, 'Você sente que suas habilidades ou conhecimentos são pouco utilizados no seu trabalho?', 'severity', 'direct', true, 'AL'),
  ('11111111-1111-1111-1111-111111111001', 9, 'Q36', 36, 'Seu trabalho costuma ser pouco desafiador ou repetitivo a ponto de gerar desânimo?', 'severity', 'direct', true, 'AM'),
  ('11111111-1111-1111-1111-111111111001', 10, 'Q37', 37, 'Você sente que sua carga de trabalho diária é maior do que consegue realizar dentro do horário normal?', 'severity', 'direct', true, 'AN'),
  ('11111111-1111-1111-1111-111111111001', 10, 'Q38', 38, 'Você frequentemente precisa fazer horas extras ou levar trabalho para casa?', 'severity', 'direct', true, 'AO'),
  ('11111111-1111-1111-1111-111111111001', 10, 'Q39', 39, 'Você já teve sintomas físicos ou emocionais (como exaustão, ansiedade ou insônia) devido ao excesso de trabalho?', 'severity', 'direct', true, 'AP'),
  ('11111111-1111-1111-1111-111111111001', 10, 'Q40', 40, 'A equipe é dimensionada corretamente para a demanda de trabalho existente?', 'severity', 'inverted', true, 'AQ'),
  ('11111111-1111-1111-1111-111111111001', 11, 'Q41', 41, 'Você já evitou colegas ou superiores por causa de desentendimentos frequentes?', 'severity', 'direct', true, 'AR'),
  ('11111111-1111-1111-1111-111111111001', 11, 'Q42', 42, 'Você percebe rivalidade excessiva ou desnecessária entre colegas ou setores?', 'severity', 'direct', true, 'AS'),
  ('11111111-1111-1111-1111-111111111001', 11, 'Q43', 43, 'Conflitos no trabalho costumam ser resolvidos de forma justa?', 'severity', 'inverted', true, 'AT'),
  ('11111111-1111-1111-1111-111111111001', 12, 'Q44', 44, 'Você trabalha em condições (como turnos diferentes, trabalho externo ou distância física) que dificultam a comunicação no trabalho?', 'severity', 'direct', true, 'AU'),
  ('11111111-1111-1111-1111-111111111001', 12, 'Q45', 45, 'A distância física entre você e sua equipe ou liderança dificulta a troca de informações?', 'severity', 'direct', true, 'AV'),
  ('11111111-1111-1111-1111-111111111001', 12, 'Q46', 46, 'Você já teve dificuldade para receber informações importantes no momento certo por causa da organização do trabalho?', 'severity', 'direct', true, 'AW'),
  ('11111111-1111-1111-1111-111111111001', 12, 'Q47', 47, 'Você tem acesso fácil aos meios necessários para se comunicar com colegas e liderança durante o trabalho?', 'severity', 'inverted', true, 'AX'),
  ('11111111-1111-1111-1111-111111111001', 13, 'Q48', 48, 'Você trabalha grande parte do tempo de forma remota ou sozinho(a), com pouco contato presencial com colegas ou liderança?', 'severity', 'direct', true, 'AY'),
  ('11111111-1111-1111-1111-111111111001', 13, 'Q49', 49, 'Você sente que o trabalho remoto ou isolado faz com que se sinta distante da equipe ou da empresa?', 'severity', 'direct', true, 'AZ'),
  ('11111111-1111-1111-1111-111111111001', 13, 'Q50', 50, 'Se Você trabalha de forma remota ou isolada, você sente que recebe apoio e acompanhamento adequados da empresa?', 'severity', 'inverted', true, 'BA')
on conflict (survey_id, question_code) do update set
  topic_id = excluded.topic_id,
  position = excluded.position,
  prompt = excluded.prompt,
  dimension = excluded.dimension,
  scoring_rule = excluded.scoring_rule,
  is_required = excluded.is_required,
  source_excel_col = excluded.source_excel_col;