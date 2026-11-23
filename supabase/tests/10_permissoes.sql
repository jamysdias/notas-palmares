-- (teste local) Testes de permissão. Rodar após importar dados de teste.
-- Uso: psql ... -f supabase/tests/10_permissoes.sql   (cada \echo mostra o resultado esperado)
\set ON_ERROR_STOP 0
set client_min_messages = warning;

insert into usuarios (email, nome, is_admin) values
  ('admin@teste', 'Admin Teste', true),
  ('prof@teste', 'Prof Geografia', false),
  ('cserie@teste', 'Coord 9º ano', false),
  ('carea@teste', 'Coord Matemática', false),
  ('inativo@teste', 'Inativo', false)
on conflict do nothing;
update usuarios set ativo = false where email = 'inativo@teste';
insert into atribuicoes values ('prof@teste', (select d.id from diarios d join turmas t on t.id=d.turma_id join series s on s.id=t.serie_id join materias m on m.id=d.materia_id where s.nome='9º ANO' and m.nome='Geografia')) on conflict do nothing;
insert into atribuicoes values ('inativo@teste', (select diario_id from atribuicoes where email='prof@teste')) on conflict do nothing;
insert into coord_series values ('cserie@teste', (select id from series where nome='9º ANO')) on conflict do nothing;
insert into coord_areas values ('carea@teste', (select id from areas where nome='Matemática')) on conflict do nothing;
select diario_id as geo9 from atribuicoes where email='prof@teste' \gset
select d.id as mat4 from diarios d join turmas t on t.id=d.turma_id join series s on s.id=t.serie_id join materias m on m.id=d.materia_id where s.nome='4º ANO' and m.nome='Matemática' \gset
select mt.aluno_ra as ra from matriculas mt join diarios d on d.turma_id = mt.turma_id where d.id = :geo9 and mt.situacao='Ativo' order by mt.numero limit 1 \gset
select a.id as av from avaliacoes a where a.diario_id = :geo9 and a.bimestre = 4 and a.bloco='C' order by a.id limit 1 \gset
select valor as v_atual from notas where avaliacao_id = :av and aluno_ra = :'ra' \gset

\echo '--- 1. professor: vê só o próprio diário (esperado 1)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
select count(*) as diarios_tabela from diarios;
\echo '--- 2. professor: abrir diário de outra matéria (esperado ERRO sem permissão)'
select carregar_diario(:mat4, 4) is not null;
rollback;

\echo '--- 3. professor: salvar nota no próprio diário (esperado salvos=1)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
select salvar_notas(:geo9, 4, jsonb_build_array(jsonb_build_object('avaliacao_id', :av, 'ra', :'ra', 'valor', 77, 'anterior_valor', :v_atual)));
\echo '--- 4. conflito: anterior desatualizado (esperado conflitos=1, salvos=0)'
select salvar_notas(:geo9, 4, jsonb_build_array(jsonb_build_object('avaliacao_id', :av, 'ra', :'ra', 'valor', 80, 'anterior_valor', :v_atual)));
\echo '--- 5. nota fora de 0-100 (esperado erro na lista)'
select salvar_notas(:geo9, 4, jsonb_build_array(jsonb_build_object('avaliacao_id', :av, 'ra', :'ra', 'valor', 150, 'anterior_valor', 77)))->'erros'->0->>'erro';
\echo '--- 6. acréscimo 0,5 (ok) e 1,0 (ERRO)'
select salvar_ajuste(:geo9, 4, :'ra', 'acrescimo', 0.5);
select salvar_ajuste(:geo9, 4, :'ra', 'acrescimo', 1.0);
rollback;
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
\echo '--- 7. professor tentando bônus (esperado ERRO somente coordenação)'
select salvar_ajuste(:geo9, 4, :'ra', 'bonus', 5, 'Fórum');
rollback;
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
\echo '--- 8. escrita direta na tabela notas (esperado ERRO permission denied)'
update notas set valor = 0 where avaliacao_id = :av;
rollback;

\echo '--- 9. bimestre fechado: professor não lança (esperado ERRO), coordenação lança'
update periodos set fechado = true where ano = 2026 and bimestre = 4;
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
select salvar_notas(:geo9, 4, '[]'::jsonb);
rollback;
begin; set local role authenticated; set local request.jwt.claims = '{"email":"cserie@teste","app_metadata":{"provider":"google"}}';
select salvar_notas(:geo9, 4, '[]'::jsonb);
rollback;
update periodos set fechado = false where ano = 2026 and bimestre = 4;

\echo '--- 10. coord. série 9º: vê 11 diários; bônus sem justificativa (ERRO) e com justificativa (ok)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"cserie@teste","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
select salvar_ajuste(:geo9, 4, :'ra', 'bonus', 5, '');
rollback;
begin; set local role authenticated; set local request.jwt.claims = '{"email":"cserie@teste","app_metadata":{"provider":"google"}}';
select salvar_ajuste(:geo9, 4, :'ra', 'bonus', 5, 'Participação no Fórum de debates');
select media_calculada, bonus, media_final, origem from jsonb_to_recordset(carregar_diario(:geo9, 4)->'medias') as x(aluno_ra text, media_calculada numeric, bonus numeric, media_final numeric, origem text) where aluno_ra = :'ra';
rollback;

\echo '--- 11. coord. área Matemática: vê diários de Matemática (esperado 24) e não Geografia'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"carea@teste","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
select pode_ver_diario(:geo9) as ve_geografia;
rollback;

\echo '--- 12. usuário inativo e não cadastrado: nada (esperado 0, 0)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"inativo@teste","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
set local request.jwt.claims = '{"email":"estranho@gmail.com","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
rollback;

\echo '--- 13. anônimo (esperado ERRO permission denied)'
begin; set local role anon;
select listar_diarios();
rollback;

\echo '--- 14. admin: ver como professor (esperado 176 → 1 → 176)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"admin@teste","app_metadata":{"provider":"google"}}';
select count(*) from listar_diarios();
select ver_como_iniciar('prof@teste');
select count(*) from listar_diarios();
select (meu_perfil()->>'email') as real, (meu_perfil()->>'email_efetivo') as efetivo;
select ver_como_parar();
select count(*) from listar_diarios();
rollback;

\echo '--- 15. professor não consegue usar ver como (esperado ERRO)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
select ver_como_iniciar('admin@teste');
rollback;

\echo '--- 16. auditoria: alteração registrada com nota antiga (esperado 1 linha UPDATE)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"prof@teste","app_metadata":{"provider":"google"}}';
select salvar_notas(:geo9, 4, jsonb_build_array(jsonb_build_object('avaliacao_id', :av, 'ra', :'ra', 'valor', 12, 'anterior_valor', :v_atual)));
select jsonb_array_length(historico_aluno(:geo9, 4, :'ra')) as historico,
       historico_aluno(:geo9, 4, :'ra')->0->'antes'->>'valor' as antes,
       historico_aluno(:geo9, 4, :'ra')->0->'depois'->>'valor' as depois;
rollback;

\echo '--- 17. desempenho: carregar diário, painel e mapa da turma'
\timing on
begin; set local role authenticated; set local request.jwt.claims = '{"email":"admin@teste","app_metadata":{"provider":"google"}}';
select length(carregar_diario(:geo9, 2)::text) as bytes;
select count(*) from painel(2026, 2);
select length(mapa_turma((select turma_id from diarios where id = :geo9), 0)::text) as bytes_mapa;
rollback;
\timing off

\echo '--- 18. login por e-mail/senha (não Google) com e-mail de admin: nada (esperado 0)'
begin; set local role authenticated; set local request.jwt.claims = '{"email":"admin@teste","app_metadata":{"provider":"email"}}';
select count(*) from listar_diarios();
rollback;
