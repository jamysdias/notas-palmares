-- =====================================================================
-- Importação 2026: ajustes encontrados ao importar todas as planilhas
--  * pesos de avaliação acima de 9 (ex.: Música usou peso 35)
--  * notas de bloco (Prova bimestral / Contínuas / Recuperação) digitadas direto na coluna
--    de média, por cima da fórmula: guardadas como "valor informado na planilha" e usadas no
--    lugar do cálculo, para o resultado ficar igual ao de 2026.
-- =====================================================================
alter table public.avaliacoes drop constraint if exists avaliacoes_peso_check;
alter table public.avaliacoes add constraint avaliacoes_peso_check check (peso between 0 and 100);
alter table public.avaliacoes alter column peso type numeric(5,1);

alter table public.ajustes
  add column bimestral_informada   numeric(7,3) check (bimestral_informada between 0 and 100),
  add column continuas_informada   numeric(7,3) check (continuas_informada between 0 and 100),
  add column recuperacao_informada numeric(7,3) check (recuperacao_informada between 0 and 100);

-- cálculo: valor informado tem prioridade sobre o calculado
create or replace function public.calc_medias(p_diarios integer[])
returns table (
  diario_id          integer,
  bimestre           smallint,
  aluno_ra           text,
  numero             smallint,
  situacao_matricula text,
  nota_bimestral     numeric,
  nota_continuas     numeric,
  nota_recuperacao   numeric,
  media_calculada    numeric,
  apos_recuperacao   numeric,
  conselho           numeric,
  acrescimo          numeric,
  bonus              numeric,
  media_final        numeric,
  origem             text,
  situacao           text
)
language sql stable security definer set search_path = public as $$
  with pac as (
    select a.diario_id, a.bimestre, a.bloco, a.pacote, n.aluno_ra,
           sum(a.peso)           as soma_p,
           sum(n.valor * a.peso) as soma_n
      from avaliacoes a
      join notas n on n.avaliacao_id = a.id and n.valor is not null
     where a.diario_id = any(p_diarios)
     group by 1,2,3,4,5
  ),
  blocos as (
    select pa.diario_id, pa.bimestre, pa.aluno_ra, pa.bloco,
           case when sum(coalesce(pc.percentual,0)) > 0
                then sum(pa.soma_n / pa.soma_p * coalesce(pc.percentual,0)) / sum(coalesce(pc.percentual,0))
           end as nota
      from pac pa
      left join pacotes pc on pc.diario_id = pa.diario_id and pc.bimestre = pa.bimestre and pc.codigo = pa.pacote
     where pa.soma_p > 0
     group by 1,2,3,4
  ),
  pivot as (
    select b.diario_id, b.bimestre, b.aluno_ra,
           max(b.nota) filter (where b.bloco = 'B') as nb,
           max(b.nota) filter (where b.bloco = 'C') as nc,
           max(b.nota) filter (where b.bloco = 'R') as nr
      from blocos b group by 1,2,3
  )
  select d.id, bm.b::smallint, m.aluno_ra, m.numero, m.situacao,
         round(x0.nb, 2), round(x0.nc, 2), round(x0.nr, 2),
         round(x1.mc, 2), round(x2.ar, 2),
         aj.conselho, aj.acrescimo, aj.bonus,
         round(x4.fin, 2),
         case when aj.conselho is not null then 'conselho'
              when x2.ar is distinct from x1.mc then 'recuperacao'
              when x1.mc is not null then 'calculada' end,
         case when m.situacao = 'Transferido' then 'Transferido'
              when x4.fin is null then 'Em aberto'
              when x4.fin < 50 then 'Abaixo da média'
              else 'Na média' end
    from diarios d
    join turmas t on t.id = d.turma_id
    join matriculas m on m.turma_id = t.id and m.ano = t.ano
    cross join generate_series(1,4) bm(b)
    left join pivot p on p.diario_id = d.id and p.bimestre = bm.b and p.aluno_ra = m.aluno_ra
    left join ajustes aj on aj.diario_id = d.id and aj.bimestre = bm.b and aj.aluno_ra = m.aluno_ra
    cross join lateral (select coalesce(aj.bimestral_informada, p.nb) as nb,
                               coalesce(aj.continuas_informada, p.nc) as nc,
                               coalesce(aj.recuperacao_informada, p.nr) as nr) x0
    cross join lateral (select case when x0.nb is not null and x0.nc is not null
                                    then x0.nb * d.peso_bimestral + x0.nc * d.peso_continuas
                                    else coalesce(x0.nb, x0.nc) end as mc) x1
    cross join lateral (select case when x0.nr is not null and x1.mc < 50
                                    then least(50, greatest(x1.mc, x0.nr))
                                    else x1.mc end as ar) x2
    cross join lateral (select coalesce(aj.conselho, x2.ar) as res) x3
    cross join lateral (select case when x3.res is null then null
                                    else least(100, x3.res + coalesce(aj.acrescimo,0) + coalesce(aj.bonus,0)) end as fin) x4
   where d.id = any(p_diarios)
$$;
revoke execute on function public.calc_medias(integer[]) from public, anon, authenticated;

-- importação: grava também os valores informados
create or replace function public.importar_diario(p_ano integer, p_serie text, p_turma integer,
                                                  p_materia text, p_dados jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_diario int; b jsonb; av jsonb; aj jsonb; v_av bigint; nota record; v_bim smallint;
  v_avisos jsonb := '[]'; v_nav int := 0; v_nnotas int := 0; v_ac numeric; v_ordem int;
begin
  select d.id into v_diario
    from diarios d join turmas t on t.id = d.turma_id join series s on s.id = t.serie_id
    join materias m on m.id = d.materia_id
   where t.ano = p_ano and upper(s.nome) = upper(p_serie) and t.numero = p_turma
     and (m.nome = p_materia or (p_materia = 'Incubadora de projetos' and m.nome like 'Business Lab%'));
  if v_diario is null then
    raise exception 'Diário não encontrado: % / turma % / %', p_serie, p_turma, p_materia;
  end if;

  perform set_config('app.sem_auditoria', '1', true);
  delete from avaliacoes where diario_id = v_diario;
  delete from pacotes    where diario_id = v_diario;
  delete from ajustes    where diario_id = v_diario;

  for b in select * from jsonb_array_elements(p_dados->'bimestres') loop
    v_bim := (b->>'bimestre')::smallint;
    insert into pacotes (diario_id, bimestre, codigo, descricao, percentual)
    select v_diario, v_bim, x->>'codigo', nullif(x->>'descricao',''), (x->>'percentual')::numeric
      from jsonb_array_elements(b->'pacotes') x
     where (x->>'percentual')::numeric > 0 or coalesce(x->>'descricao','') not in ('', 'sem desc.')
    on conflict do nothing;

    v_ordem := 0;
    for av in select * from jsonb_array_elements(b->'avaliacoes') loop
      v_ordem := v_ordem + 1;
      insert into avaliacoes (diario_id, bimestre, pacote, nome, data, peso, ordem, criado_por)
      values (v_diario, v_bim, av->>'pacote', coalesce(nullif(trim(av->>'nome'),''), 'Avaliação ' || v_ordem),
              nullif(av->>'data','')::date, least(100, greatest(0, coalesce(nullif(av->>'peso','')::numeric, 0))), v_ordem, 'importação 2026')
      returning id into v_av;
      v_nav := v_nav + 1;
      for nota in select key as ra, value as v from jsonb_each(av->'notas') loop
        if not exists (select 1 from alunos where ra = nota.ra) then
          v_avisos := v_avisos || to_jsonb(format('B%s: RA %s não encontrado na base de alunos', v_bim, nota.ra));
          continue;
        end if;
        if jsonb_typeof(nota.v) = 'number' then
          if (nota.v)::numeric between 0 and 100 then
            insert into notas (avaliacao_id, aluno_ra, valor, atualizado_por) values (v_av, nota.ra, (nota.v)::numeric, 'importação 2026');
            v_nnotas := v_nnotas + 1;
          else
            v_avisos := v_avisos || to_jsonb(format('B%s: nota %s fora de 0–100 ignorada (RA %s, %s)', v_bim, nota.v, nota.ra, av->>'nome'));
          end if;
        else
          insert into notas (avaliacao_id, aluno_ra, nao_avaliado, atualizado_por) values (v_av, nota.ra, true, 'importação 2026');
          v_nnotas := v_nnotas + 1;
        end if;
      end loop;
    end loop;

    for aj in select * from jsonb_array_elements(b->'ajustes') loop
      if not exists (select 1 from alunos where ra = aj->>'ra') then continue; end if;
      v_ac := nullif(aj->>'acrescimo','')::numeric;
      if v_ac is not null and (v_ac > 10 or v_ac < 0) then
        v_avisos := v_avisos || to_jsonb(format('B%s: arredondamento %s ignorado (RA %s)', v_bim, v_ac, aj->>'ra'));
        v_ac := null;
      end if;
      if v_ac = 0 then v_ac := null; end if;
      if v_ac is null and nullif(aj->>'conselho','') is null and nullif(aj->>'bimestral_informada','') is null
         and nullif(aj->>'continuas_informada','') is null and nullif(aj->>'recuperacao_informada','') is null then
        continue;
      end if;
      insert into ajustes (diario_id, bimestre, aluno_ra, acrescimo, bonus, bonus_justificativa,
                           conselho, conselho_justificativa,
                           bimestral_informada, continuas_informada, recuperacao_informada, atualizado_por)
      values (v_diario, v_bim, aj->>'ra',
              case when v_ac <= 0.9 then v_ac end,
              case when v_ac > 0.9 then v_ac end,
              case when v_ac > 0.9 then 'Importado da coluna Arredondamento da planilha 2026' end,
              nullif(aj->>'conselho','')::numeric,
              case when nullif(aj->>'conselho','') is not null then 'Importado da planilha 2026' end,
              nullif(aj->>'bimestral_informada','')::numeric,
              nullif(aj->>'continuas_informada','')::numeric,
              nullif(aj->>'recuperacao_informada','')::numeric,
              'importação 2026')
      on conflict (diario_id, bimestre, aluno_ra) do nothing;
      if v_ac > 0.9 then
        v_avisos := v_avisos || to_jsonb(format('B%s: arredondamento %s (acima de 0,9) importado como bônus (RA %s)', v_bim, v_ac, aj->>'ra'));
      end if;
    end loop;
  end loop;

  insert into auditoria (usuario, como, tabela, operacao, chave, depois)
  values ('importação', 'importação', 'diarios', 'IMPORT', jsonb_build_object('id', v_diario),
          jsonb_build_object('avaliacoes', v_nav, 'notas', v_nnotas));
  return jsonb_build_object('diario_id', v_diario, 'avaliacoes', v_nav, 'notas', v_nnotas, 'avisos', v_avisos);
end $$;
revoke execute on function public.importar_diario(integer, text, integer, text, jsonb) from public, anon, authenticated;

-- conferência: só alunos que existem na base (os ausentes já aparecem nos avisos)
create or replace function public.conferir_importacao(p_diario integer, p_bimestre integer, p_finais jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select key as ra, (value)::text::numeric as planilha from jsonb_each(p_finais)
              where jsonb_typeof(value) = 'number' and exists (select 1 from alunos a where a.ra = key)),
  c as (select aluno_ra, media_final from calc_medias(array[p_diario]) where bimestre = p_bimestre)
  select jsonb_build_object(
    'conferidos', count(*),
    'divergencias', coalesce(jsonb_agg(jsonb_build_object('ra', f.ra, 'planilha', round(f.planilha, 2), 'sistema', c.media_final))
                      filter (where c.media_final is null or abs(c.media_final - least(f.planilha, 100)) > 0.05), '[]'))
  from f left join c on c.aluno_ra = f.ra
$$;
revoke execute on function public.conferir_importacao(integer, integer, jsonb) from public, anon, authenticated;

-- ajustes: não apagar a linha se ainda houver valor informado
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
     and acrescimo is null and conselho is null and bonus is null
     and bimestral_informada is null and continuas_informada is null and recuperacao_informada is null;
end $$;

-- limpa o registro da primeira importação de teste (será refeita com o leitor corrigido)
delete from public.importacoes where tipo = 'notas';
