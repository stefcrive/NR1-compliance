insert into topics (id, code, name) values
  (1, 'T01', 'Assedio de qualquer natureza'),
  (2, 'T02', 'Falta de suporte/apoio'),
  (3, 'T03', 'Ma gestao de mudancas'),
  (4, 'T04', 'Baixa clareza de papel'),
  (5, 'T05', 'Baixas recompensas e reconhecimento'),
  (6, 'T06', 'Baixo controle/falta de autonomia'),
  (7, 'T07', 'Baixa justica organizacional'),
  (8, 'T08', 'Eventos violentos/traumaticos'),
  (9, 'T09', 'Baixa demanda (subcarga)'),
  (10, 'T10', 'Excesso de demanda (sobrecarga)'),
  (11, 'T11', 'Maus relacionamentos'),
  (12, 'T12', 'Dificil comunicacao'),
  (13, 'T13', 'Trabalho remoto e isolado')
on conflict (id) do update
set
  code = excluded.code,
  name = excluded.name;
