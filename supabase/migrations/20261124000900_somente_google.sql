-- Defesa extra: só aceita identidades autenticadas pelo Google (login por e-mail/senha fica sem acesso
-- mesmo que seja reativado por engano no painel do Supabase).
create or replace function public.meu_email() returns text
language sql stable as $$
  select case
    when coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
      or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google'
    then lower(nullif(auth.jwt()->>'email', ''))
  end
$$;
