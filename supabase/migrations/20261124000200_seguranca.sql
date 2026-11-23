-- =====================================================================
-- Segurança: quem é o usuário, o que pode ver e o que pode alterar.
-- Toda regra de permissão é verificada AQUI no banco (não só na tela).
-- =====================================================================

-- E-mail de quem está realmente logado (vem do token do Supabase Auth)
create or replace function public.meu_email() returns text
language sql stable as $$
  select lower(nullif(auth.jwt()->>'email',''))
$$;

create or replace function public.eh_admin_real() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios u
                 where u.email = meu_email() and u.is_admin and u.ativo)
$$;

-- E-mail "efetivo": se um admin ativou o "ver como", passa a valer o perfil escolhido
create or replace function public.email_efetivo() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.alvo_email from ver_como v
      where v.admin_email = meu_email() and eh_admin_real()),
    meu_email())
$$;

create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios u where u.email = email_efetivo() and u.ativo)
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios u
                 where u.email = email_efetivo() and u.is_admin and u.ativo)
$$;

create or replace function public.eh_professor_do(p_diario integer) returns boolean
language sql stable security definer set search_path = public as $$
  select usuario_ativo() and exists (
    select 1 from atribuicoes a where a.email = email_efetivo() and a.diario_id = p_diario)
$$;

create or replace function public.eh_coord_do(p_diario integer) returns boolean
language sql stable security definer set search_path = public as $$
  select usuario_ativo() and exists (
    select 1 from diarios d
      join turmas t on t.id = d.turma_id
      join materias m on m.id = d.materia_id
    where d.id = p_diario
      and (exists (select 1 from coord_series cs where cs.email = email_efetivo() and cs.serie_id = t.serie_id)
        or exists (select 1 from coord_areas ca where ca.email = email_efetivo() and ca.area_id = m.area_id)))
$$;

-- Conjunto de diários visíveis para o usuário (usado nas políticas e telas)
create or replace function public.meus_diarios() returns setof integer
language sql stable security definer set search_path = public as $$
  select d.id from diarios d
   where usuario_ativo() and (
         eh_admin()
      or exists (select 1 from atribuicoes a where a.email = email_efetivo() and a.diario_id = d.id)
      or exists (select 1 from turmas t join coord_series cs on cs.serie_id = t.serie_id
                  where t.id = d.turma_id and cs.email = email_efetivo())
      or exists (select 1 from materias m join coord_areas ca on ca.area_id = m.area_id
                  where m.id = d.materia_id and ca.email = email_efetivo()))
$$;

create or replace function public.pode_ver_diario(p_diario integer) returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin() or eh_professor_do(p_diario) or eh_coord_do(p_diario)
$$;

create or replace function public.pode_coordenar(p_diario integer) returns boolean
language sql stable security definer set search_path = public as $$
  select eh_admin() or eh_coord_do(p_diario)
$$;

create or replace function public.bimestre_fechado(p_diario integer, p_bimestre integer) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.fechado from diarios d join turmas t on t.id = d.turma_id
                     join periodos p on p.ano = t.ano and p.bimestre = p_bimestre
                    where d.id = p_diario), false)
$$;

-- Lançar notas/avaliações/pacotes/acréscimo: professor do diário (bimestre aberto) ou coordenação/admin
create or replace function public.pode_lancar(p_diario integer, p_bimestre integer) returns boolean
language sql stable security definer set search_path = public as $$
  select pode_coordenar(p_diario)
      or (eh_professor_do(p_diario) and not bimestre_fechado(p_diario, p_bimestre))
$$;

-- ---------- Auditoria automática ----------
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chave jsonb := '{}'::jsonb;
  v_row   jsonb := to_jsonb(coalesce(new, old));
  k       text;
begin
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

create trigger aud_notas      after insert or update or delete on public.notas      for each row execute function tg_auditoria('avaliacao_id','aluno_ra');
create trigger aud_ajustes    after insert or update or delete on public.ajustes    for each row execute function tg_auditoria('diario_id','bimestre','aluno_ra');
create trigger aud_avaliacoes after insert or update or delete on public.avaliacoes for each row execute function tg_auditoria('id','diario_id','bimestre');
create trigger aud_pacotes    after insert or update or delete on public.pacotes    for each row execute function tg_auditoria('diario_id','bimestre','codigo');
create trigger aud_diarios    after update or delete on public.diarios              for each row execute function tg_auditoria('id');
create trigger aud_usuarios   after insert or update or delete on public.usuarios   for each row execute function tg_auditoria('email');
create trigger aud_atrib      after insert or update or delete on public.atribuicoes  for each row execute function tg_auditoria('email','diario_id');
create trigger aud_cserie     after insert or update or delete on public.coord_series for each row execute function tg_auditoria('email','serie_id');
create trigger aud_carea      after insert or update or delete on public.coord_areas  for each row execute function tg_auditoria('email','area_id');
create trigger aud_periodos   after insert or update or delete on public.periodos     for each row execute function tg_auditoria('ano','bimestre');
create trigger aud_ver_como   after insert or update or delete on public.ver_como     for each row execute function tg_auditoria('admin_email');

-- ---------- RLS (Row Level Security) ----------
do $$
declare t text;
begin
  foreach t in array array['areas','series','turmas','materias','diarios','alunos','matriculas',
    'usuarios','atribuicoes','coord_series','coord_areas','ver_como','periodos','pacotes',
    'avaliacoes','notas','ajustes','auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- escrita direta bloqueada por padrão; liberada só onde há política explícita
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- Cadastros básicos: leitura para usuários ativos, escrita só admin
do $$
declare t text;
begin
  foreach t in array array['areas','series','turmas','materias','periodos'] loop
    execute format('create policy leitura on public.%I for select to authenticated using (usuario_ativo())', t);
    execute format('create policy admin_escreve on public.%I for all to authenticated using (eh_admin()) with check (eh_admin())', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy leitura on public.diarios for select to authenticated using (id in (select meus_diarios()));
create policy admin_escreve on public.diarios for all to authenticated using (eh_admin()) with check (eh_admin());
grant insert, update, delete on public.diarios to authenticated;

-- Usuários e atribuições: admin gerencia; cada um vê os próprios vínculos
create policy leitura on public.usuarios for select to authenticated using (eh_admin() or email = email_efetivo() or email = meu_email());
create policy admin_escreve on public.usuarios for all to authenticated using (eh_admin()) with check (eh_admin());
grant insert, update, delete on public.usuarios to authenticated;
do $$
declare t text;
begin
  foreach t in array array['atribuicoes','coord_series','coord_areas'] loop
    execute format('create policy leitura on public.%I for select to authenticated using (eh_admin() or email = email_efetivo())', t);
    execute format('create policy admin_escreve on public.%I for all to authenticated using (eh_admin()) with check (eh_admin())', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy leitura on public.ver_como for select to authenticated using (admin_email = meu_email());

-- Alunos/matrículas: escrita só pela sincronização (service_role). Leitura: admin (demais via funções)
create policy leitura on public.alunos     for select to authenticated using (eh_admin());
create policy leitura on public.matriculas for select to authenticated using (eh_admin());

-- Dados de notas: leitura nos diários visíveis; escrita SOMENTE pelas funções (RPC) validadas
create policy leitura on public.pacotes    for select to authenticated using (diario_id in (select meus_diarios()));
create policy leitura on public.avaliacoes for select to authenticated using (diario_id in (select meus_diarios()));
create policy leitura on public.ajustes    for select to authenticated using (diario_id in (select meus_diarios()));
create policy leitura on public.notas      for select to authenticated using (
  avaliacao_id in (select a.id from avaliacoes a where a.diario_id in (select meus_diarios())));

create policy leitura on public.auditoria for select to authenticated using (eh_admin());

-- Funções auxiliares não precisam ser chamadas por anônimos
revoke execute on all functions in schema public from anon;
