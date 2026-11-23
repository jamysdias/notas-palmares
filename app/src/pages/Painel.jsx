import React, { useMemo, useState } from 'react'
import { rpc } from '../supabase.js'
import { useDados, Carregando, Erro } from '../components/ui.jsx'
import { ir, dataHoraBR } from '../util.js'

export default function Painel({ bimestre }) {
  const anos = useDados(() => rpc('listar_diarios').then((l) => [...new Set(l.map((d) => d.ano))].sort((a, b) => b - a)), [])
  const [ano, setAno] = useState(null)
  const anoSel = ano || anos.dados?.[0]
  const bim = bimestre || 1
  const { dados, erro, carregando, recarregar } = useDados(
    () => (anoSel ? rpc('painel', { p_ano: anoSel, p_bimestre: bim }) : Promise.resolve([])), [anoSel, bim])
  const [filtroSerie, setFiltroSerie] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)

  const series = useMemo(() => [...new Set((dados || []).map((d) => d.serie))], [dados])
  const areas = useMemo(() => [...new Set((dados || []).map((d) => d.area))].sort(), [dados])
  const lista = useMemo(() => (dados || []).filter((d) =>
    (!filtroSerie || d.serie === filtroSerie) && (!filtroArea || d.area === filtroArea) &&
    (!soPendentes || d.notas_esperadas === 0 || d.notas_lancadas < d.notas_esperadas)), [dados, filtroSerie, filtroArea, soPendentes])

  const tot = lista.reduce((t, d) => ({
    l: t.l + d.notas_lancadas, e: t.e + d.notas_esperadas, ab: t.ab + d.abaixo_media,
    sem: t.sem + (d.avaliacoes === 0 ? 1 : 0), rec: t.rec + d.com_recuperacao, cons: t.cons + d.com_conselho, bon: t.bon + d.com_bonus
  }), { l: 0, e: 0, ab: 0, sem: 0, rec: 0, cons: 0, bon: 0 })

  if (anos.carregando) return <Carregando />
  return (
    <div>
      <div className="cabecalho-pagina">
        <h1>Painel da coordenação</h1>
        <div className="filtros">
          {anos.dados?.length > 1 && <select value={anoSel} onChange={(e) => setAno(Number(e.target.value))}>{anos.dados.map((a) => <option key={a}>{a}</option>)}</select>}
          <div className="seg">
            {[1, 2, 3, 4].map((b) => <button key={b} className={b === bim ? 'ativo' : ''} onClick={() => ir('painel', b)}>{b}º bim</button>)}
          </div>
          <select value={filtroSerie} onChange={(e) => setFiltroSerie(e.target.value)}><option value="">Todas as séries</option>{series.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}><option value="">Todas as áreas</option>{areas.map((s) => <option key={s}>{s}</option>)}</select>
          <label className="check"><input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> só com pendências</label>
        </div>
      </div>

      {carregando ? <Carregando /> : erro ? <Erro erro={erro} onTentar={recarregar} /> : (
        <>
          <div className="indicadores">
            <Ind rotulo="Diários" valor={lista.length} />
            <Ind rotulo="Notas lançadas" valor={tot.e ? `${Math.round((tot.l / tot.e) * 100)}%` : '—'} sub={`${tot.l.toLocaleString('pt-BR')} de ${tot.e.toLocaleString('pt-BR')}`} />
            <Ind rotulo="Diários sem avaliação" valor={tot.sem} alerta={tot.sem > 0} />
            <Ind rotulo="Médias abaixo de 50" valor={tot.ab} alerta={tot.ab > 0} />
            <Ind rotulo="Recuperações aplicadas" valor={tot.rec} />
            <Ind rotulo="Conselho / bônus" valor={`${tot.cons} / ${tot.bon}`} />
          </div>
          <div className="grade-wrap">
            <table className="tabela">
              <thead><tr><th>Turma</th><th>Matéria</th><th>Professor(es)</th><th>Avaliações</th><th style={{ minWidth: 160 }}>Lançamento</th><th>Abaixo de 50</th><th>Recup.</th><th>Conselho</th><th>Bônus</th><th>Última alteração</th></tr></thead>
              <tbody>
                {lista.map((d) => {
                  const p = d.notas_esperadas ? d.notas_lancadas / d.notas_esperadas : 0
                  return (
                    <tr key={d.diario_id} className="clicavel" onClick={() => ir('diario', d.diario_id, bim)}>
                      <td>{d.serie}{series.length && dados.filter((x) => x.serie === d.serie && x.turma_numero !== d.turma_numero).length ? ` – T${d.turma_numero}` : ''}</td>
                      <td>{d.materia}<small className="cinza"> · {d.area}</small></td>
                      <td>{d.professores.map((x) => x.nome || x.email).join(', ') || <i className="cinza">—</i>}</td>
                      <td className="num">{d.avaliacoes || <span className="selo alerta">nenhuma</span>}</td>
                      <td><div className="barra"><div style={{ width: `${Math.min(100, p * 100)}%` }} className={p >= 0.999 ? 'cheia' : ''} /></div><small>{d.notas_esperadas ? `${Math.round(p * 100)}%` : '—'}</small></td>
                      <td className={`num ${d.abaixo_media ? 'abaixo' : ''}`}>{d.abaixo_media || ''}</td>
                      <td className="num">{d.com_recuperacao || ''}</td>
                      <td className="num">{d.com_conselho || ''}</td>
                      <td className="num">{d.com_bonus || ''}</td>
                      <td><small>{dataHoraBR(d.ultima_alteracao)}</small></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Ind({ rotulo, valor, sub, alerta }) {
  return <div className={`indicador ${alerta ? 'alerta' : ''}`}><div className="ind-valor">{valor}</div><div className="ind-rotulo">{rotulo}</div>{sub && <small>{sub}</small>}</div>
}
