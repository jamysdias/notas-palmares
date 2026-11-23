import React, { useMemo } from 'react'
import { rpc } from '../supabase.js'
import { useDados, Carregando, Erro } from '../components/ui.jsx'
import { ir, media, corMedia, nomeTurma } from '../util.js'

const ABAS = [['1', '1º bim'], ['2', '2º bim'], ['3', '3º bim'], ['4', '4º bim'], ['0', 'Anual']]

export default function MapaTurma({ turmaId, aba }) {
  const diarios = useDados(() => rpc('listar_diarios'), [])
  const turmas = useMemo(() => {
    const m = new Map()
    ;(diarios.dados || []).forEach((d) => { if (!m.has(d.turma_id)) m.set(d.turma_id, d) })
    const lista = [...m.values()]
    const qtd = {}
    lista.forEach((d) => { qtd[`${d.ano}|${d.serie}`] = (qtd[`${d.ano}|${d.serie}`] || 0) + 1 })
    return lista.map((d) => ({ id: d.turma_id, ano: d.ano, nome: nomeTurma(d.serie, d.turma_numero, qtd[`${d.ano}|${d.serie}`]) }))
  }, [diarios.dados])
  const tid = turmaId || turmas[0]?.id
  const mapa = useDados(() => (tid ? rpc('mapa_turma', { p_turma: tid, p_bimestre: Number(aba) }) : Promise.resolve(null)), [tid, aba])

  const valores = useMemo(() => {
    const v = {}
    ;(mapa.dados?.valores || []).forEach(([d, ra, val, origem, extra]) => { v[`${d}|${ra}`] = { val, origem, extra } })
    return v
  }, [mapa.dados])

  if (diarios.carregando) return <Carregando />
  if (diarios.erro) return <Erro erro={diarios.erro} />
  const turma = turmas.find((t) => t.id === tid)

  return (
    <div>
      <div className="cabecalho-pagina">
        <h1>Mapa da turma</h1>
        <div className="filtros">
          <select value={tid || ''} onChange={(e) => ir('turma', e.target.value, aba)}>
            {turmas.map((t) => <option key={t.id} value={t.id}>{t.nome} ({t.ano})</option>)}
          </select>
          <div className="seg">{ABAS.map(([k, t]) => <button key={k} className={k === aba ? 'ativo' : ''} onClick={() => ir('turma', tid, k)}>{t}</button>)}</div>
        </div>
      </div>
      {mapa.carregando ? <Carregando /> : mapa.erro ? <Erro erro={mapa.erro} /> : mapa.dados && (
        <div className="grade-wrap">
          <table className="grade mapa">
            <thead>
              <tr>
                <th className="fixa c-num">Nº</th><th className="fixa c-nome">Aluno – {turma?.nome}</th>
                {mapa.dados.materias.map((m) => (
                  <th key={m.diario_id} className="clicavel vertical" title={`${m.materia} (${m.area})`} onClick={() => ir('diario', m.diario_id, aba === '0' ? 'anual' : aba)}>
                    <span>{m.materia}</span>
                  </th>
                ))}
                <th>Abaixo de 50</th>
              </tr>
            </thead>
            <tbody>
              {(mapa.dados.alunos || []).map((a) => {
                let abaixo = 0
                return (
                  <tr key={a.ra} className={a.situacao !== 'Ativo' ? 'transferido' : ''}>
                    <td className="fixa c-num">{a.numero}</td>
                    <td className="fixa c-nome">{a.nome}</td>
                    {mapa.dados.materias.map((m) => {
                      const x = valores[`${m.diario_id}|${a.ra}`] || {}
                      if (x.val != null && x.val < 50) abaixo++
                      return (
                        <td key={m.diario_id} className={`res ${corMedia(x.val)}`}>
                          {media(x.val)}
                          {x.origem === 'recuperacao' && <span className="origem o-recuperacao">R</span>}
                          {x.origem === 'conselho' && <span className="origem o-conselho">C</span>}
                          {aba !== '0' && x.extra && <span className="origem o-bonus">+</span>}
                          {aba === '0' && x.extra && x.val != null && <small className="parcial">*</small>}
                        </td>
                      )
                    })}
                    <td className={`num ${abaixo ? 'abaixo' : ''}`}>{abaixo || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {aba === '0' && <p className="legenda">* média parcial (nem todos os bimestres têm nota)</p>}
        </div>
      )}
    </div>
  )
}
