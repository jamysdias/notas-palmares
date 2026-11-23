import React, { useMemo, useState } from 'react'
import { rpc } from '../supabase.js'
import { useDados, Carregando, Erro } from '../components/ui.jsx'
import { nomeTurma } from '../util.js'

export default function Inicio({ perfil }) {
  const { dados, erro, carregando, recarregar } = useDados(() => rpc('listar_diarios'), [perfil.email_efetivo])
  const [busca, setBusca] = useState('')
  const [ano, setAno] = useState(null)

  const anos = useMemo(() => [...new Set((dados || []).map((d) => d.ano))].sort((a, b) => b - a), [dados])
  const anoSel = ano || anos[0]
  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase()
    return (dados || []).filter((d) => d.ano === anoSel && (!b ||
      `${d.serie} ${d.materia} ${d.area} ${d.professores.map((p) => p.nome || p.email).join(' ')}`.toLowerCase().includes(b)))
  }, [dados, busca, anoSel])

  const turmasPorSerie = useMemo(() => {
    const m = {}
    ;(dados || []).filter((d) => d.ano === anoSel).forEach((d) => { (m[d.serie] ||= new Set()).add(d.turma_numero) })
    return m
  }, [dados, anoSel])

  const grupos = useMemo(() => {
    const g = new Map()
    lista.forEach((d) => {
      const k = `${d.serie_ordem}|${d.turma_numero}`
      if (!g.has(k)) g.set(k, { titulo: nomeTurma(d.serie, d.turma_numero, turmasPorSerie[d.serie]?.size), segmento: d.segmento, turma_id: d.turma_id, itens: [] })
      g.get(k).itens.push(d)
    })
    return [...g.values()]
  }, [lista, turmasPorSerie])

  if (carregando) return <Carregando />
  if (erro) return <Erro erro={erro} onTentar={recarregar} />

  const meus = lista.filter((d) => d.sou_professor)
  const ehCoord = perfil.admin || perfil.coord_series.length || perfil.coord_areas.length

  return (
    <div>
      <div className="cabecalho-pagina">
        <h1>Olá{perfil.nome ? `, ${perfil.nome.split(' ')[0]}` : ''}</h1>
        <div className="filtros">
          {anos.length > 1 && (
            <select value={anoSel || ''} onChange={(e) => setAno(Number(e.target.value))}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <input type="search" placeholder="Buscar série, matéria ou professor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {!dados.length && (
        <div className="vazio">
          Você ainda não tem diários atribuídos. {perfil.admin ? 'Cadastre as atribuições em Administração.' : 'Fale com a coordenação.'}
        </div>
      )}

      {meus.length > 0 && ehCoord ? (
        <section>
          <h2>Minhas turmas como professor</h2>
          <div className="cartoes">{meus.map((d) => <Cartao key={d.diario_id} d={d} turmasPorSerie={turmasPorSerie} mostrarTurma />)}</div>
        </section>
      ) : null}

      {grupos.map((g) => (
        <section key={g.titulo} className="grupo-turma">
          <h2>
            {g.titulo} <small>{g.segmento}</small>
            {ehCoord ? <a className="link-pequeno" href={`#/turma/${g.turma_id}`}>ver mapa da turma →</a> : null}
          </h2>
          <div className="cartoes">{g.itens.map((d) => <Cartao key={d.diario_id} d={d} turmasPorSerie={turmasPorSerie} />)}</div>
        </section>
      ))}
    </div>
  )
}

function Cartao({ d, mostrarTurma, turmasPorSerie }) {
  return (
    <a className="cartao" href={`#/diario/${d.diario_id}/1`}>
      <div className="cartao-area">{d.area}</div>
      <div className="cartao-titulo">{d.materia}</div>
      {mostrarTurma && <div className="cartao-sub">{nomeTurma(d.serie, d.turma_numero, turmasPorSerie[d.serie]?.size)}</div>}
      <div className="cartao-rodape">
        {d.professores.length ? d.professores.map((p) => p.nome || p.email).join(', ') : <i>sem professor atribuído</i>}
        {d.sou_professor && <span className="selo">meu</span>}
      </div>
    </a>
  )
}
