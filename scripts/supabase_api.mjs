// Tarefas administrativas via Supabase Management API (usado pelo GitHub Actions).
//   node scripts/supabase_api.mjs admin <email>   → garante o administrador inicial
//   node scripts/supabase_api.mjs auth            → ativa login Google e libera a URL do site
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env
if (!token || !ref) { console.error('Faltam SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF'); process.exit(1) }
const api = async (metodo, caminho, corpo) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  })
  const txt = await r.text()
  if (!r.ok) { console.error(`Erro ${r.status}: ${txt}`); process.exit(1) }
  return txt ? JSON.parse(txt) : null
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'admin') {
  const email = String(arg || '').trim().toLowerCase()
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) { console.error('E-mail inválido'); process.exit(1) }
  await api('POST', '/database/query', {
    query: `insert into public.usuarios (email, nome, is_admin, ativo) values ('${email}', 'Administrador', true, true)
            on conflict (email) do update set is_admin = true, ativo = true;`
  })
  console.log('Administrador inicial garantido.')
} else if (cmd === 'auth') {
  const site = process.env.SITE_URL
  const cfg = { site_url: site, uri_allow_list: [site, site.replace(/\/$/, '')].join(',') }
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    Object.assign(cfg, {
      external_google_enabled: true,
      external_google_client_id: process.env.GOOGLE_CLIENT_ID,
      external_google_secret: process.env.GOOGLE_CLIENT_SECRET
    })
  } else {
    console.log('GOOGLE_CLIENT_ID/SECRET não definidos: só a URL do site será configurada.')
  }
  await api('PATCH', '/config/auth', cfg)
  console.log('Login configurado para', site)
} else {
  console.error('Uso: admin <email> | auth'); process.exit(1)
}
