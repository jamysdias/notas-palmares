import { useEffect, useState } from 'react'

/** Roteamento simples por hash: #/diario/12/2 → ['diario','12','2'] */
export function useRota() {
  const ler = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [rota, setRota] = useState(ler)
  useEffect(() => {
    const f = () => setRota(ler())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return rota
}
export const ir = (...partes) => { window.location.hash = '#/' + partes.map(encodeURIComponent).join('/') }

const fmt1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmtN = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
export const media = (v) => (v === null || v === undefined || v === '' ? '' : fmt1.format(Number(v)))
export const num = (v) => (v === null || v === undefined || v === '' ? '' : fmtN.format(Number(v)))
export const pct = (v) => (v === null || v === undefined ? '' : fmtN.format(Number(v) * 100) + '%')

/** Converte texto digitado em nota: número 0–100, "-" (não avaliado) ou vazio. */
export function lerNota(txt) {
  const t = String(txt ?? '').trim()
  if (t === '') return { valor: null, nao_avaliado: false, ok: true }
  if (t === '-') return { valor: null, nao_avaliado: true, ok: true }
  const n = Number(t.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false }
  return { valor: Math.round(n * 100) / 100, nao_avaliado: false, ok: true }
}
export const mostrarNota = (n) => (!n ? '' : n.nao_avaliado ? '-' : num(n.valor))

export const dataBR = (iso) => {
  if (!iso) return ''
  const [, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}`
}
export const dataHoraBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

export const nomeTurma = (serie, numero, totalTurmas) => (totalTurmas > 1 || numero > 1 ? `${serie} – Turma ${numero}` : serie)

export const BLOCOS = {
  B: { nome: 'Prova Bimestral', codigos: ['B1', 'B2', 'B3', 'B4'] },
  C: { nome: 'Contínuas', codigos: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] },
  R: { nome: 'Recuperação', codigos: ['R1', 'R2', 'R3', 'R4'] }
}

export const corMedia = (v) => (v === null || v === undefined ? '' : Number(v) < 50 ? 'abaixo' : 'ok')
