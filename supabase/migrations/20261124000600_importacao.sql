-- =====================================================================
-- Importação das planilhas de notas (usada pelo Apps Script, só service_role).
-- Reimportar um diário substitui os dados dele.
-- =====================================================================

-- Permite desligar a auditoria durante importações em massa
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chave jsonb := '{}'::jsonb;
  v_row   jsonb := to_jsonb(coalesce(new, old));
  k       text;
begin
  if current_setting('app.sem_auditoria', true) = '1' then
    return coalesce(new, old);
  end if;
  foreach k in array tg_argv loop
    v_chave := v_chave || jsonb_build_object(k, v_row->k);
  end loop;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;
  insert into auditoria (usuario, como, tabela, operacao, chave, antes, depois)
  values (coalesce(meu_email(), current_user), email_efetivo(), tg_table_name, tg_op, v_chave,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- p_dados: {bimestres: [{bimestre, pacotes:[{codigo,descricao,percentual}],
--            avaliacoes:[{pacote,nome,data,peso,notas:{RA: número | "-"}}],
--            ajustes:[{ra, acrescimo, conselho}]}]}
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
     where (x->>'percentual')::numeric > 0 or coalesce(x->>'descricao','') not in ('', 'sem desc.');

    v_ordem := 0;
    for av in select * from jsonb_array_elements(b->'avaliacoes') loop
      v_ordem := v_ordem + 1;
      insert into avaliacoes (diario_id, bimestre, pacote, nome, data, peso, ordem, criado_por)
      values (v_diario, v_bim, av->>'pacote', coalesce(nullif(trim(av->>'nome'),''), 'Avaliação ' || v_ordem),
              nullif(av->>'data','')::date, coalesce(nullif(av->>'peso','')::numeric, 0), v_ordem, 'importação 2026')
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
      if v_ac is not null and v_ac > 10 then
        v_avisos := v_avisos || to_jsonb(format('B%s: arredondamento %s ignorado (RA %s)', v_bim, v_ac, aj->>'ra'));
        v_ac := null;
      end if;
      if v_ac is null and nullif(aj->>'conselho','') is null then continue; end if;
      insert into ajustes (diario_id, bimestre, aluno_ra, acrescimo, bonus, bonus_justificativa,
                           conselho, conselho_justificativa, atualizado_por)
      values (v_diario, v_bim, aj->>'ra',
              case when v_ac <= 0.9 then v_ac end,
              case when v_ac > 0.9 then v_ac end,
              case when v_ac > 0.9 then 'Importado da coluna Arredondamento da planilha 2026' end,
              nullif(aj->>'conselho','')::numeric,
              case when nullif(aj->>'conselho','') is not null then 'Importado da planilha 2026' end,
              'importação 2026');
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
grant execute on function public.importar_diario(integer, text, integer, text, jsonb) to service_role;

-- Confere as médias calculadas pelo sistema com as da planilha (coluna "Média Final")
-- p_finais: {RA: número}
create or replace function public.conferir_importacao(p_diario integer, p_bimestre integer, p_finais jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select key as ra, (value)::text::numeric as planilha from jsonb_each(p_finais)
              where jsonb_typeof(value) = 'number'),
  c as (select aluno_ra, media_final from calc_medias(array[p_diario]) where bimestre = p_bimestre)
  select jsonb_build_object(
    'conferidos', count(*),
    'divergencias', coalesce(jsonb_agg(jsonb_build_object('ra', f.ra, 'planilha', round(f.planilha, 2), 'sistema', c.media_final))
                      filter (where c.media_final is null or abs(c.media_final - least(f.planilha, 100)) > 0.05), '[]'))
  from f left join c on c.aluno_ra = f.ra
$$;
revoke execute on function public.conferir_importacao(integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.conferir_importacao(integer, integer, jsonb) to service_role;
