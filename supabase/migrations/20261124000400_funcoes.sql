-- =====================================================================
-- Funções chamadas pelo app (RPC). Toda gravação passa por aqui,
-- com checagem de permissão, validação e controle de conflito.
-- =====================================================================

-- ---------- Perfil ----------
create or replace function public.meu_perfil() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email',          meu_email(),
    'email_efetivo',  email_efetivo(),
    'cadastrado',     exists (select 1 from usuarios where email = meu_email()),
    'ativo',          usuario_ativo(),
    'admin_real',     eh_admin_real(),
    'admin',          eh_admin(),
    'nome',           (select nome from usuarios where email = email_efetivo()),
    'ver_como',       (select alvo_email from ver_como where admin_email = meu_email() and eh_admin_real()),
    'professor_em',   (select count(*) from atribuicoes where email = email_efetivo()),
    'coord_series',   coalesce((select jsonb_agg(s.nome order by s.ordem) from coord_series cs join series s on s.id = cs.serie_id where cs.email = email_efetivo()), '[]'),
    'coord_areas',    coalesce((select jsonb_agg(a.nome order by a.ordem) from coord_areas ca join areas a on a.id = ca.area_id where ca.email = email_efetivo()), '[]')
  )
$$;

-- ---------- Lista de diários visíveis ----------
create or replace function public.listar_diarios(p_ano integer default null)
returns table (
  diario_id integer, ano smallint, turma_id integer, serie text, serie_ordem smallint, segmento text,
  turma_numero smallint, materia text, area text, peso_bimestral numeric, peso_continuas numeric,
  professores jsonb, sou_professor boolean, sou_coordenador boolean
)
language sql stable security definer set search_path = public as $$
  select d.id, t.ano, t.id, s.nome, s.ordem, s.segmento, t.numero, m.nome, a.nome,
         d.peso_bimestral, d.peso_continuas,
         coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'nome', u.nome) order by u.nome)
                     from atribuicoes at join usuarios u on u.email = at.email where at.diario_id = d.id), '[]'),
         eh_professor_do(d.id), eh_coord_do(d.id)
    from diarios d
    join turmas t on t.id = d.turma_id
    join series s on s.id = t.serie_id
    join materias m on m.id = d.materia_id
    join areas a on a.id = m.area_id
   where d.id in (select meus_diarios())
     and (p_ano is null or t.ano = p_ano)
   order by t.ano desc, s.ordem, t.numero, a.ordem, m.nome
$$;

-- ---------- Carregar um diário/bimestre (tudo em uma chamada) ----------
create or replace function public.carregar_diario(p_diario integer, p_bimestre integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not pode_ver_diario(p_diario) then
    raise exception 'Sem permissão para este diário' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'diario', (select jsonb_build_object(
                 'id', d.id, 'ano', t.ano, 'serie', s.nome, 'turma_numero', t.numero, 'turma_id', t.id,
                 'turmas_na_serie', (select count(*) from turmas t2 where t2.ano = t.ano and t2.serie_id = t.serie_id),
                 'materia', m.nome, 'area', a.nome,
                 'peso_bimestral', d.peso_bimestral, 'peso_continuas', d.peso_continuas,
                 'bimestre', p_bimestre,
                 'fechado', bimestre_fechado(d.id, p_bimestre),
                 'prazo_lancamento', (select pr.prazo_lancamento from periodos pr where pr.ano = t.ano and pr.bimestre = p_bimestre),
                 'pode_lancar', pode_lancar(d.id, p_bimestre),
                 'pode_coordenar', pode_coordenar(d.id),
                 'sou_professor', eh_professor_do(d.id),
                 'professores', coalesce((select jsonb_agg(coalesce(u.nome, u.email)) from atribuicoes at join usuarios u on u.email = at.email where at.diario_id = d.id), '[]'))
               from diarios d join turmas t on t.id = d.turma_id join series s on s.id = t.serie_id
               join materias m on m.id = d.materia_id join areas a on a.id = m.area_id
              where d.id = p_diario),
    'alunos', coalesce((select jsonb_agg(jsonb_build_object('ra', al.ra, 'nome', al.nome, 'numero', mt.numero, 'situacao', mt.situacao)
                                         order by mt.numero nulls last, al.nome)
                          from diarios d join turmas t on t.id = d.turma_id
                          join matriculas mt on mt.turma_id = t.id and mt.ano = t.ano
                          join alunos al on al.ra = mt.aluno_ra
                         where d.id = p_diario), '[]'),
    'pacotes', coalesce((select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'descricao', p.descricao, 'percentual', p.percentual) order by p.codigo)
                           from pacotes p where p.diario_id = p_diario and p.bimestre = p_bimestre), '[]'),
    'avaliacoes', coalesce((select jsonb_agg(jsonb_build_object('id', av.id, 'pacote', av.pacote, 'bloco', av.bloco, 'nome', av.nome,
                                                                'data', av.data, 'peso', av.peso, 'ordem', av.ordem)
                                             order by av.bloco, av.ordem, av.data nulls last, av.id)
                              from avaliacoes av where av.diario_id = p_diario and av.bimestre = p_bimestre), '[]'),
    'notas', coalesce((select jsonb_agg(jsonb_build_array(n.avaliacao_id, n.aluno_ra, n.valor, n.nao_avaliado))
                         from notas n join avaliacoes av on av.id = n.avaliacao_id
                        where av.diario_id = p_diario and av.bimestre = p_bimestre), '[]'),
    'ajustes', coalesce((select jsonb_agg(to_jsonb(aj) - 'diario_id' - 'bimestre')
                           from ajustes aj where aj.diario_id = p_diario and aj.bimestre = p_bimestre), '[]'),
    'medias', coalesce((select jsonb_agg(to_jsonb(c) - 'diario_id' - 'bimestre')
                          from calc_medias(array[p_diario]) c where c.bimestre = p_bimestre), '[]')
  ) into v;
  return v;
end $$;

create or replace function public.carregar_anual(p_diario integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pode_ver_diario(p_diario) then
    raise exception 'Sem permissão para este diário' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(c) - 'diario_id' order by c.numero nulls last)
                     from calc_medias_anuais(array[p_diario]) c), '[]');
end $$;

-- ---------- Salvar notas (lote) com detecção de conflito ----------
-- p_itens: [{avaliacao_id, ra, valor (num|null), nao_avaliado (bool),
--            anterior_valor (num|null), anterior_nao_avaliado (bool)}]
create or replace function public.salvar_notas(p_diario integer, p_bimestre integer, p_itens jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; av record; atual record;
  v_valor numeric; v_na boolean; v_ant_valor numeric; v_ant_na boolean;
  v_salvos int := 0; v_conflitos jsonb := '[]'; v_erros jsonb := '[]';
  v_pct numeric; v_peso_bloco numeric;
begin
  if not pode_lancar(p_diario, p_bimestre) then
    raise exception 'Sem permissão para lançar notas neste diário/bimestre' using errcode = '42501';
  end if;

  for it in select * from jsonb_array_elements(p_itens) loop
    select a.*, d.peso_bimestral, d.peso_continuas, d.turma_id
      into av from avaliacoes a join diarios d on d.id = a.diario_id
     where a.id = (it->>'avaliacao_id')::bigint;
    if av is null or av.diario_id <> p_diario or av.bimestre <> p_bimestre then
      v_erros := v_erros || jsonb_build_object('item', it, 'erro', 'Avaliação não pertence a este diário/bimestre');
      continue;
    end if;

    if not exists (select 1 from matriculas mt join turmas t on t.id = mt.turma_id
                    where mt.turma_id = av.turma_id and mt.ano = t.ano
                      and mt.aluno_ra = it->>'ra' and mt.situacao = 'Ativo') then
      v_erros := v_erros || jsonb_build_object('item', it, 'erro', 'Aluno não está ativo nesta turma');
      continue;
    end if;

    -- bloco precisa estar configurado (pacotes somando 100% e peso do bloco > 0)
    select coalesce(sum(percentual), 0) into v_pct from pacotes
     where diario_id = p_diario and bimestre = p_bimestre and left(codigo,1) = av.bloco;
    v_peso_bloco := case av.bloco when 'B' then av.peso_bimestral when 'C' then av.peso_continuas else 1 end;
    if v_pct <> 1 or v_peso_bloco = 0 then
      v_erros := v_erros || jsonb_build_object('item', it, 'erro',
        case when v_peso_bloco = 0 then 'Este bloco tem peso 0 neste diário'
             else 'Os pacotes deste bloco precisam somar 100% antes do lançamento' end);
      continue;
    end if;

    v_valor := nullif(it->>'valor','')::numeric;
    v_na := coalesce((it->>'nao_avaliado')::boolean, false);
    v_ant_valor := nullif(it->>'anterior_valor','')::numeric;
    v_ant_na := coalesce((it->>'anterior_nao_avaliado')::boolean, false);

    if v_valor is not null and (v_valor < 0 or v_valor > 100) then
      v_erros := v_erros || jsonb_build_object('item', it, 'erro', 'Nota deve estar entre 0 e 100');
      continue;
    end if;

    -- conflito: alguém alterou esta célula depois que a tela foi carregada
    select n.valor, n.nao_avaliado, n.atualizado_por, n.atualizado_em into atual
      from notas n where n.avaliacao_id = av.id and n.aluno_ra = it->>'ra' for update;
    if (atual.valor is distinct from v_ant_valor) or (coalesce(atual.nao_avaliado,false) <> v_ant_na) then
      v_conflitos := v_conflitos || jsonb_build_object(
        'avaliacao_id', av.id, 'ra', it->>'ra',
        'valor_atual', atual.valor, 'nao_avaliado_atual', coalesce(atual.nao_avaliado,false),
        'por', atual.atualizado_por, 'em', atual.atualizado_em);
      continue;
    end if;

    if v_valor is null and not v_na then
      delete from notas where avaliacao_id = av.id and aluno_ra = it->>'ra';
    else
      insert into notas (avaliacao_id, aluno_ra, valor, nao_avaliado, atualizado_por, atualizado_em)
      values (av.id, it->>'ra', v_valor, v_na, email_efetivo(), now())
      on conflict (avaliacao_id, aluno_ra) do update
        set valor = excluded.valor, nao_avaliado = excluded.nao_avaliado,
            atualizado_por = excluded.atualizado_por, atualizado_em = now();
    end if;
    v_salvos := v_salvos + 1;
  end loop;

  return jsonb_build_object('salvos', v_salvos, 'conflitos', v_conflitos, 'erros', v_erros);
end $$;

-- ---------- Avaliações ----------
create or replace function public.salvar_avaliacao(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id','')::bigint; v_diario int; v_bim smallint;
begin
  if v_id is not null then
    select diario_id, bimestre into v_diario, v_bim from avaliacoes where id = v_id;
  else
    v_diario := (p->>'diario_id')::int; v_bim := (p->>'bimestre')::smallint;
  end if;
  if v_diario is null or not pode_lancar(v_diario, v_bim) then
    raise exception 'Sem permissão para alterar avaliações deste diário' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'nome'),'') = '' then raise exception 'Informe o nome da avaliação'; end if;

  if v_id is null then
    insert into avaliacoes (diario_id, bimestre, pacote, nome, data, peso, ordem, criado_por)
    values (v_diario, v_bim, p->>'pacote', trim(p->>'nome'), nullif(p->>'data','')::date,
            coalesce(nullif(p->>'peso','')::numeric, 1),
            coalesce(nullif(p->>'ordem','')::int,
                     (select coalesce(max(ordem),0)+1 from avaliacoes where diario_id = v_diario and bimestre = v_bim)),
            email_efetivo())
    returning id into v_id;
  else
    update avaliacoes set pacote = coalesce(p->>'pacote', pacote), nome = trim(p->>'nome'),
           data = nullif(p->>'data','')::date, peso = coalesce(nullif(p->>'peso','')::numeric, peso),
           ordem = coalesce(nullif(p->>'ordem','')::int, ordem)
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.excluir_avaliacao(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_diario int; v_bim smallint;
begin
  select diario_id, bimestre into v_diario, v_bim from avaliacoes where id = p_id;
  if v_diario is null or not pode_lancar(v_diario, v_bim) then
    raise exception 'Sem permissão para excluir esta avaliação' using errcode = '42501';
  end if;
  delete from avaliacoes where id = p_id;   -- notas são excluídas junto (ficam na auditoria)
end $$;

-- ---------- Pacotes ----------
-- p_pacotes: [{codigo, descricao, percentual (0–1)}] — substitui a configuração do bimestre
create or replace function public.salvar_pacotes(p_diario integer, p_bimestre integer, p_pacotes jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_bloco text;
begin
  if not pode_lancar(p_diario, p_bimestre) then
    raise exception 'Sem permissão para configurar pacotes deste diário' using errcode = '42501';
  end if;
  for v_bloco in select unnest(array['B','C','R']) loop
    if (select coalesce(sum((x->>'percentual')::numeric),0) from jsonb_array_elements(p_pacotes) x
         where left(x->>'codigo',1) = v_bloco) > 1.00001 then
      raise exception 'Os pacotes do bloco % somam mais de 100%%', v_bloco;
    end if;
  end loop;
  delete from pacotes where diario_id = p_diario and bimestre = p_bimestre
     and codigo not in (select x->>'codigo' from jsonb_array_elements(p_pacotes) x);
  insert into pacotes (diario_id, bimestre, codigo, descricao, percentual)
  select p_diario, p_bimestre, x->>'codigo', nullif(trim(x->>'descricao'),''), coalesce((x->>'percentual')::numeric, 0)
    from jsonb_array_elements(p_pacotes) x
  on conflict (diario_id, bimestre, codigo) do update
    set descricao = excluded.descricao, percentual = excluded.percentual;
end $$;

-- ---------- Ajustes: acréscimo (professor), conselho e bônus (coordenação) ----------
create or replace function public.salvar_ajuste(p_diario integer, p_bimestre integer, p_ra text,
                                                p_campo text, p_valor numeric, p_justificativa text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_campo not in ('acrescimo','conselho','bonus') then raise exception 'Campo inválido'; end if;
  if p_campo = 'acrescimo' then
    if not pode_lancar(p_diario, p_bimestre) then
      raise exception 'Sem permissão para lançar acréscimo' using errcode = '42501';
    end if;
    if p_valor is not null and (p_valor < 0 or p_valor > 0.9) then
      raise exception 'Acréscimo deve ser entre 0,1 e 0,9';
    end if;
  else
    if not pode_coordenar(p_diario) then
      raise exception 'Somente a coordenação pode lançar % ', p_campo using errcode = '42501';
    end if;
    if p_valor is not null and coalesce(trim(p_justificativa),'') = '' then
      raise exception 'Justificativa obrigatória para %', p_campo;
    end if;
    if p_campo = 'bonus' and p_valor is not null and (p_valor < 0 or p_valor > 10) then
      raise exception 'Bônus deve ser entre 0 e 10';
    end if;
    if p_campo = 'conselho' and p_valor is not null and (p_valor < 0 or p_valor > 100) then
      raise exception 'Nota de conselho deve ser entre 0 e 100';
    end if;
  end if;
  if not exists (select 1 from matriculas mt join turmas t on t.id = mt.turma_id join diarios d on d.turma_id = t.id
                  where d.id = p_diario and mt.ano = t.ano and mt.aluno_ra = p_ra) then
    raise exception 'Aluno não pertence a esta turma';
  end if;

  insert into ajustes (diario_id, bimestre, aluno_ra, atualizado_por) values (p_diario, p_bimestre, p_ra, email_efetivo())
  on conflict do nothing;
  execute format('update ajustes set %I = $1, atualizado_por = $2, atualizado_em = now() %s
                   where diario_id = $3 and bimestre = $4 and aluno_ra = $5',
                 p_campo, case when p_campo <> 'acrescimo' then format(', %I = $6', p_campo || '_justificativa') else '' end)
    using p_valor, email_efetivo(), p_diario, p_bimestre, p_ra, nullif(trim(p_justificativa),'');
  delete from ajustes where diario_id = p_diario and bimestre = p_bimestre and aluno_ra = p_ra
     and acrescimo is null and conselho is null and bonus is null;
end $$;

-- ---------- Histórico de um aluno no diário (coordenação vê a nota original) ----------
create or replace function public.historico_aluno(p_diario integer, p_bimestre integer, p_ra text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pode_ver_diario(p_diario) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('em', au.em, 'usuario', au.usuario, 'como', au.como,
                                        'tabela', au.tabela, 'operacao', au.operacao,
                                        'avaliacao', (select nome from avaliacoes where id = (au.chave->>'avaliacao_id')::bigint),
                                        'antes', au.antes, 'depois', au.depois) order by au.em desc)
      from auditoria au
     where au.chave->>'aluno_ra' = p_ra
       and ((au.tabela = 'ajustes' and (au.chave->>'diario_id')::int = p_diario and (au.chave->>'bimestre')::int = p_bimestre)
         or (au.tabela = 'notas' and (au.chave->>'avaliacao_id')::bigint in
              (select id from avaliacoes where diario_id = p_diario and bimestre = p_bimestre)))
  ), '[]');
end $$;

-- ---------- Painel da coordenação ----------
create or replace function public.painel(p_ano integer, p_bimestre integer)
returns table (
  diario_id integer, serie text, serie_ordem smallint, turma_numero smallint, materia text, area text,
  professores jsonb, alunos_ativos integer, avaliacoes integer, notas_lancadas integer, notas_esperadas integer,
  abaixo_media integer, com_recuperacao integer, com_conselho integer, com_bonus integer, ultima_alteracao timestamptz
)
language sql stable security definer set search_path = public as $$
  with ds as (select ld.* from listar_diarios(p_ano) ld),
  c as (select c.diario_id,
               count(*) filter (where c.situacao_matricula = 'Ativo')       as ativos,
               count(*) filter (where c.situacao = 'Abaixo da média')       as abaixo,
               count(*) filter (where c.origem = 'recuperacao')             as rec,
               count(*) filter (where c.conselho is not null)               as cons,
               count(*) filter (where c.bonus is not null)                  as bon
          from calc_medias(array(select ds.diario_id from ds)) c
         where c.bimestre = p_bimestre
         group by c.diario_id),
  av as (select a.diario_id,
                count(distinct a.id)                                        as qtd,
                count(distinct a.id) filter (where a.bloco <> 'R')          as qtd_sem_rec,
                count(n.aluno_ra) filter (where a.bloco <> 'R')             as lancadas,
                max(n.atualizado_em)                                        as ultima
           from avaliacoes a left join notas n on n.avaliacao_id = a.id
          where a.bimestre = p_bimestre and a.diario_id in (select ds.diario_id from ds)
          group by a.diario_id)
  select ds.diario_id, ds.serie, ds.serie_ordem, ds.turma_numero, ds.materia, ds.area, ds.professores,
         coalesce(c.ativos,0)::int, coalesce(av.qtd,0)::int, coalesce(av.lancadas,0)::int,
         (coalesce(av.qtd_sem_rec,0) * coalesce(c.ativos,0))::int,
         coalesce(c.abaixo,0)::int, coalesce(c.rec,0)::int, coalesce(c.cons,0)::int, coalesce(c.bon,0)::int,
         av.ultima
    from ds left join c on c.diario_id = ds.diario_id left join av on av.diario_id = ds.diario_id
   order by ds.serie_ordem, ds.turma_numero, ds.area, ds.materia
$$;

-- ---------- Mapa da turma (aluno × matéria). p_bimestre = 0 → média anual ----------
create or replace function public.mapa_turma(p_turma integer, p_bimestre integer)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_diarios int[];
begin
  select array_agg(d.id) into v_diarios from diarios d
   where d.turma_id = p_turma and d.id in (select meus_diarios());
  if v_diarios is null then raise exception 'Sem permissão para esta turma' using errcode = '42501'; end if;
  return jsonb_build_object(
    'materias', (select jsonb_agg(jsonb_build_object('diario_id', d.id, 'materia', m.nome, 'area', a.nome) order by a.ordem, m.nome)
                   from diarios d join materias m on m.id = d.materia_id join areas a on a.id = m.area_id
                  where d.id = any(v_diarios)),
    'alunos', (select jsonb_agg(jsonb_build_object('ra', al.ra, 'nome', al.nome, 'numero', mt.numero, 'situacao', mt.situacao)
                                order by mt.numero nulls last, al.nome)
                 from matriculas mt join turmas t on t.id = mt.turma_id and mt.ano = t.ano join alunos al on al.ra = mt.aluno_ra
                where t.id = p_turma),
    'valores', case when p_bimestre = 0 then
                 (select jsonb_agg(jsonb_build_array(c.diario_id, c.aluno_ra, c.media_anual, null, c.parcial)) from calc_medias_anuais(v_diarios) c)
               else
                 (select jsonb_agg(jsonb_build_array(c.diario_id, c.aluno_ra, c.media_final, c.origem, c.bonus is not null))
                    from calc_medias(v_diarios) c where c.bimestre = p_bimestre)
               end);
end $$;

-- ---------- "Ver como" (somente admin) ----------
create or replace function public.ver_como_iniciar(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin_real() then raise exception 'Somente administradores' using errcode = '42501'; end if;
  if not exists (select 1 from usuarios where email = lower(p_email)) then raise exception 'Usuário não cadastrado'; end if;
  insert into ver_como (admin_email, alvo_email) values (meu_email(), lower(p_email))
  on conflict (admin_email) do update set alvo_email = excluded.alvo_email, desde = now();
end $$;

create or replace function public.ver_como_parar() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from ver_como where admin_email = meu_email();
end $$;

create or replace function public.ver_como_opcoes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_admin_real() then raise exception 'Somente administradores' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'email', u.email, 'nome', u.nome, 'admin', u.is_admin,
            'papel', concat_ws(' · ',
               case when exists (select 1 from atribuicoes a where a.email = u.email) then 'Professor' end,
               case when exists (select 1 from coord_series c where c.email = u.email) then 'Coord. série' end,
               case when exists (select 1 from coord_areas c where c.email = u.email) then 'Coord. área' end,
               case when u.is_admin then 'Admin' end)) order by u.nome nulls last, u.email)
           from usuarios u where u.ativo), '[]');
end $$;

-- ---------- Admin: copiar estrutura de um ano para o outro ----------
create or replace function public.admin_copiar_estrutura(p_de integer, p_para integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t int; v_d int;
begin
  if not eh_admin() then raise exception 'Somente administradores' using errcode = '42501'; end if;
  insert into turmas (ano, serie_id, numero)
  select p_para, serie_id, numero from turmas where ano = p_de
  on conflict do nothing;
  get diagnostics v_t = row_count;
  insert into diarios (turma_id, materia_id, peso_bimestral, peso_continuas)
  select tn.id, d.materia_id, d.peso_bimestral, d.peso_continuas
    from diarios d join turmas t on t.id = d.turma_id
    join turmas tn on tn.ano = p_para and tn.serie_id = t.serie_id and tn.numero = t.numero
   where t.ano = p_de
  on conflict do nothing;
  get diagnostics v_d = row_count;
  insert into periodos (ano, bimestre) select p_para, b from generate_series(1,4) b on conflict do nothing;
  return jsonb_build_object('turmas_criadas', v_t, 'diarios_criados', v_d);
end $$;

-- ---------- Sincronização de alunos (chamada pelo Apps Script da planilha) ----------
-- p_alunos: [{ra, nome, serie, turma, numero, situacao}]  — somente service_role
create or replace function public.sync_alunos(p_ano integer, p_alunos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_serie smallint; v_turma int; v_ok int := 0; v_err jsonb := '[]'; v_novas jsonb := '[]';
begin
  for it in select * from jsonb_array_elements(p_alunos) loop
    if coalesce(trim(it->>'ra'),'') = '' or coalesce(trim(it->>'nome'),'') = '' then
      v_err := v_err || jsonb_build_object('item', it, 'erro', 'RA ou nome vazio'); continue;
    end if;
    select id into v_serie from series where upper(nome) = upper(trim(it->>'serie'));
    if v_serie is null then
      v_err := v_err || jsonb_build_object('item', it, 'erro', 'Série não cadastrada: ' || coalesce(it->>'serie','')); continue;
    end if;
    select id into v_turma from turmas where ano = p_ano and serie_id = v_serie
       and numero = coalesce(nullif(it->>'turma','')::numeric::smallint, 1);
    if v_turma is null then
      insert into turmas (ano, serie_id, numero) values (p_ano, v_serie, coalesce(nullif(it->>'turma','')::numeric::smallint, 1))
      returning id into v_turma;
      v_novas := v_novas || to_jsonb(trim(it->>'serie') || ' / turma ' || coalesce(it->>'turma','1'));
    end if;
    insert into alunos (ra, nome, atualizado_em) values (trim(it->>'ra'), trim(it->>'nome'), now())
    on conflict (ra) do update set nome = excluded.nome, atualizado_em = now()
      where alunos.nome is distinct from excluded.nome;
    insert into matriculas (ano, aluno_ra, turma_id, numero, situacao, atualizado_em)
    values (p_ano, trim(it->>'ra'), v_turma, nullif(it->>'numero','')::numeric::smallint,
            case when it->>'situacao' ilike 'transferid%' then 'Transferido' else 'Ativo' end, now())
    on conflict (ano, aluno_ra, turma_id) do update
      set numero = excluded.numero, situacao = excluded.situacao, atualizado_em = now()
      where (matriculas.numero, matriculas.situacao) is distinct from (excluded.numero, excluded.situacao);
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('processados', v_ok, 'erros', v_err, 'turmas_novas', v_novas,
                            'total_no_banco', (select count(*) from matriculas where ano = p_ano));
end $$;

-- ---------- Permissões de execução ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.calc_medias(integer[]) from authenticated;
revoke execute on function public.calc_medias_anuais(integer[]) from authenticated;
revoke execute on function public.sync_alunos(integer, jsonb) from authenticated;
revoke execute on function public.tg_auditoria() from authenticated;
