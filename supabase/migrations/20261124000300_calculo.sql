-- =====================================================================
-- Cálculo das médias — reproduz a fórmula das planilhas de 2026
--
-- 1) Nota de cada pacote = média ponderada (pelo peso) das avaliações com nota numérica.
-- 2) Nota do bloco (Bimestral / Contínuas / Recuperação) = Σ(nota do pacote × %) / Σ(% dos pacotes que já têm nota).
-- 3) Média calculada = Bimestral × peso_bimestral + Contínuas × peso_continuas
--    (se só um bloco tiver nota, vale ele).
-- 4) Recuperação: só se média < 50 → máx(média, recuperação), limitado a 50.
-- 5) Conselho (coordenação) substitui o resultado.
-- 6) + Acréscimo do professor (0,1–0,9) + Bônus da coordenação (até 10). Limite 100.
-- Nada é sobrescrito: todas as etapas ficam visíveis.
-- Média anual = média simples dos bimestres com resultado.
-- =====================================================================

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
         round(p.nb, 2), round(p.nc, 2), round(p.nr, 2),
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
    cross join lateral (select case when p.nb is not null and p.nc is not null
                                    then p.nb * d.peso_bimestral + p.nc * d.peso_continuas
                                    else coalesce(p.nb, p.nc) end as mc) x1
    cross join lateral (select case when p.nr is not null and x1.mc < 50
                                    then least(50, greatest(x1.mc, p.nr))
                                    else x1.mc end as ar) x2
    cross join lateral (select coalesce(aj.conselho, x2.ar) as res) x3
    cross join lateral (select case when x3.res is null then null
                                    else least(100, x3.res + coalesce(aj.acrescimo,0) + coalesce(aj.bonus,0)) end as fin) x4
   where d.id = any(p_diarios)
$$;

create or replace function public.calc_medias_anuais(p_diarios integer[])
returns table (
  diario_id integer, aluno_ra text, numero smallint, situacao_matricula text,
  b1 numeric, b2 numeric, b3 numeric, b4 numeric,
  bimestres_com_nota integer, media_anual numeric, parcial boolean, situacao text
)
language sql stable security definer set search_path = public as $$
  select c.diario_id, c.aluno_ra, min(c.numero), min(c.situacao_matricula),
         max(c.media_final) filter (where c.bimestre = 1),
         max(c.media_final) filter (where c.bimestre = 2),
         max(c.media_final) filter (where c.bimestre = 3),
         max(c.media_final) filter (where c.bimestre = 4),
         count(c.media_final)::int,
         round(avg(c.media_final), 2),
         count(c.media_final) < 4,
         case when min(c.situacao_matricula) = 'Transferido' then 'Transferido'
              when count(c.media_final) = 0 then 'Em aberto'
              when avg(c.media_final) < 50 then 'Abaixo da média'
              else 'Na média' end
    from calc_medias(p_diarios) c
   group by c.diario_id, c.aluno_ra
$$;

-- Estas funções só devem ser usadas por dentro das funções com checagem de permissão
revoke execute on function public.calc_medias(integer[]) from public, anon, authenticated;
revoke execute on function public.calc_medias_anuais(integer[]) from public, anon, authenticated;
