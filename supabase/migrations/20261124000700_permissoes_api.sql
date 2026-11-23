-- =====================================================================
-- Permissões explícitas da API (não depender do "Grant API access" automático do Supabase).
-- O que cada usuário enxerga continua controlado pelas políticas de RLS.
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;

-- leitura (filtrada por RLS) para usuários logados
grant select on all tables in schema public to authenticated;
-- escrita direta só nas tabelas de cadastro do administrador (também filtrada por RLS)
grant insert, update, delete on public.areas, public.series, public.turmas, public.materias, public.periodos,
  public.diarios, public.usuarios, public.atribuicoes, public.coord_series, public.coord_areas to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- service_role (Apps Script de sincronização) usa apenas funções; acesso total como no padrão Supabase
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- anônimo: nada
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.calc_medias(integer[]) from authenticated;
revoke execute on function public.calc_medias_anuais(integer[]) from authenticated;
revoke execute on function public.sync_alunos(integer, jsonb) from authenticated;
revoke execute on function public.importar_diario(integer, text, integer, text, jsonb) from authenticated;
revoke execute on function public.conferir_importacao(integer, integer, jsonb) from authenticated;
