import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Modo de teste local (nunca usado no site publicado): token fixo, sem login Google.
const devToken = import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN : undefined
export const modoDev = Boolean(devToken)

export const supabase = createClient(modoDev ? window.location.origin : url, anonKey || 'dev', {
  auth: { persistSession: !modoDev, autoRefreshToken: !modoDev, detectSessionInUrl: !modoDev },
  global: modoDev ? { headers: { Authorization: `Bearer ${devToken}` } } : undefined
})

export const configurado = modoDev || Boolean(url && anonKey)
export const dominioGoogle = import.meta.env.VITE_DOMINIO_GOOGLE || 'colegiopalmares.com.br'

/** Chama uma função do banco e devolve os dados (ou lança erro com mensagem amigável). */
export async function rpc(nome, args = {}) {
  const { data, error } = await supabase.rpc(nome, args)
  if (error) {
    const msg = error.message || 'Erro desconhecido'
    throw new Error(msg.includes('JWT') ? 'Sua sessão expirou. Entre novamente.' : msg)
  }
  return data
}

/** Consulta simples a uma tabela (protegida pelas regras do banco). */
export async function tabela(nome, montar = (q) => q) {
  const { data, error } = await montar(supabase.from(nome).select('*'))
  if (error) throw new Error(error.message)
  return data
}

export async function gravar(nome, acao) {
  const { data, error } = await acao(supabase.from(nome))
  if (error) throw new Error(error.message)
  return data
}
