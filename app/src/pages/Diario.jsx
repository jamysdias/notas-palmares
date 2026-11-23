import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rpc } from '../supabase.js'
import { useDados, Carregando, Erro, Modal, useToast } from '../components/ui.jsx'
import { media, num, pct, lerNota, mostrarNota, dataBR, dataHoraBR, BLOCOS, corMedia } from '../util.js'

const ABAS = [['1', '1º bim'], ['2', '2º bim'], ['3', '3º bim'], ['4', '4º bim'], ['anual', 'Média anual']]

export default function Diario({ diarioId, aba }) {
  return (
    <div>
      {aba === 'anual'
        ? <Anual diarioId={diarioId} />
        : <Bimestre diarioId={diarioId} bimestre={Number(aba)} />}
    </div>
  )
}

function Cabecalho({ d, aba, diarioId, extra }) {
  return (
    <div className="cabecalho-diario">
      <div>
        <a className="voltar" href="#/">← Meus diários</a>
        <h1>{d.materia} <span className="sub">· {d.serie}{d.turmas_na_serie > 1 ? ` – Turma ${d.turma_numero}` : ''} · {d.ano}</span></h1>
        <div className="meta">
          {d.area} · Professor(es): {d.professores.length ? d.professores.join(', ') : '—'} ·
          Pesos: Prova bimestral {pct(d.peso_bimestral)} / Contínuas {pct(d.peso_continuas)}
        </div>
      </div>
      <div className="abas">
        {ABAS.map(([k, t]) => (
          <a key={k} className={aba === k ? 'ativa' : ''} href={`#/diario/${diarioId}/${k}`}
             onClick={(e) => { if (extra?.sujo && !window.confirm('Há notas não salvas. Sair mesmo assim?')) e.preventDefault() }}>{t}</a>
        ))}
      </div>
    </div>
  )
}

/* ============================== BIMESTRE ============================== */
function Bimestre({ diarioId, bimestre }) {
  const avisar = useToast()
  const { dados, erro, carregando, recarregar, setDados } = useDados(
    () => rpc('carregar_diario', { p_diario: diarioId, p_bimestre: bimestre }), [diarioId, bimestre])
  const [edicoes, setEdicoes] = useState({})          // {ra: {avId: texto}}
  const [conflitos, setConflitos] = useState({})      // {`${av}|${ra}`: info}
  const [salvando, setSalvando] = useState(false)
  const [modal, setModal] = useState(null)

  const qtdEdicoes = useMemo(() => Object.values(edicoes).reduce((s, l) => s + Object.keys(l).length, 0), [edicoes])

  useEffect(() => {
    const f = (e) => { if (qtdEdicoes) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [qtdEdicoes])

  const est = useMemo(() => {
    if (!dados) return null
    const notas = {}
    dados.notas.forEach(([av, ra, valor, na]) => { (notas[ra] ||= {})[av] = { valor, nao_avaliado: na } })
    const medias = Object.fromEntries(dados.medias.map((m) => [m.aluno_ra, m]))
    const ajustes = Object.fromEntries(dados.ajustes.map((a) => [a.aluno_ra, a]))
    const pac = Object.fromEntries(dados.pacotes.map((p) => [p.codigo, p]))
    const somaBloco = { B: 0, C: 0, R: 0 }
    dados.pacotes.forEach((p) => { somaBloco[p.codigo[0]] += Number(p.percentual) })
    const pesoBloco = { B: Number(dados.diario.peso_bimestral), C: Number(dados.diario.peso_continuas), R: 1 }
    const blocoOk = Object.fromEntries(['B', 'C', 'R'].map((b) => [b, Math.abs(somaBloco[b] - 1) < 0.0001 && pesoBloco[b] > 0]))
    const blocosVisiveis = ['B', 'C', 'R'].filter((b) => pesoBloco[b] > 0 || dados.avaliacoes.some((a) => a.bloco === b))
    const colunas = blocosVisiveis.flatMap((b) => dados.avaliacoes.filter((a) => a.bloco === b))
    return { notas, medias, ajustes, pac, somaBloco, pesoBloco, blocoOk, blocosVisiveis, colunas }
  }, [dados])

  const editar = useCallback((ra, av, texto) => {
    setEdicoes((ed) => {
      const linha = { ...(ed[ra] || {}) }
      const orig = mostrarNota(est?.notas[ra]?.[av])
      if (texto === orig) delete linha[av]; else linha[av] = texto
      const novo = { ...ed }
      if (Object.keys(linha).length) novo[ra] = linha; else delete novo[ra]
      return novo
    })
  }, [est])

  const salvar = useCallback(async () => {
    if (!qtdEdicoes || salvando) return
    const itens = [], invalidas = []
    Object.entries(edicoes).forEach(([ra, linha]) => Object.entries(linha).forEach(([av, texto]) => {
      const n = lerNota(texto)
      if (!n.ok) { invalidas.push(texto); return }
      const k = `${av}|${ra}`
      const ant = conflitos[k] ? { valor: conflitos[k].valor_atual, nao_avaliado: conflitos[k].nao_avaliado_atual } : (est.notas[ra]?.[av] || { valor: null, nao_avaliado: false })
      itens.push({ avaliacao_id: Number(av), ra, valor: n.valor, nao_avaliado: n.nao_avaliado,
                   anterior_valor: ant.valor, anterior_nao_avaliado: ant.nao_avaliado })
    }))
    if (invalidas.length) { avisar(`Corrija as notas inválidas (use 0 a 100 ou "-"): ${invalidas.slice(0, 5).join(', ')}`, 'erro'); return }
    setSalvando(true)
    try {
      const r = await rpc('salvar_notas', { p_diario: diarioId, p_bimestre: bimestre, p_itens: itens })
      const novosConf = {}
      r.conflitos.forEach((c) => { novosConf[`${c.avaliacao_id}|${c.ra}`] = c })
      const manter = {}
      Object.entries(edicoes).forEach(([ra, linha]) => Object.entries(linha).forEach(([av, t]) => {
        const k = `${av}|${ra}`
        if (novosConf[k] || r.erros.some((e) => String(e.item.avaliacao_id) === av && e.item.ra === ra)) (manter[ra] ||= {})[av] = t
      }))
      const novo = await rpc('carregar_diario', { p_diario: diarioId, p_bimestre: bimestre })
      setDados(novo)
      setEdicoes(manter)
      setConflitos(novosConf)
      if (r.salvos) avisar(`${r.salvos} nota(s) salva(s).`, 'ok')
      if (r.conflitos.length) avisar(`${r.conflitos.length} nota(s) foram alteradas por outra pessoa enquanto você editava. Confira as células em laranja e salve de novo para manter a sua.`, 'erro')
      if (r.erros.length) avisar(r.erros.map((e) => e.erro).filter((v, i, a) => a.indexOf(v) === i).join(' · '), 'erro')
    } catch (e) {
      avisar(e.message, 'erro')
    } finally {
      setSalvando(false)
    }
  }, [qtdEdicoes, salvando, edicoes, conflitos, est, diarioId, bimestre, avisar, setDados])

  useEffect(() => {
    const f = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); salvar() } }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [salvar])

  if (carregando && !dados) return <Carregando />
  if (erro) return <Erro erro={erro} onTentar={recarregar} />
  const d = dados.diario
  const podeLancar = d.pode_lancar
  const recarregarTudo = () => { setEdicoes({}); setConflitos({}); recarregar() }

  return (
    <div>
      <Cabecalho d={d} aba={String(bimestre)} diarioId={diarioId} extra={{ sujo: qtdEdicoes > 0 }} />

      {d.fechado && <div className="faixa info">Bimestre fechado. {d.pode_lancar ? 'Como coordenação, você ainda pode corrigir notas.' : 'Somente visualização.'}</div>}
      {!d.fechado && d.prazo_lancamento && <div className="faixa leve">Prazo de lançamento: {new Date(d.prazo_lancamento + 'T12:00').toLocaleDateString('pt-BR')}</div>}

      <div className="barra-acoes">
        {podeLancar && <button className="btn" onClick={() => setModal({ tipo: 'pacotes' })}>Pacotes e percentuais</button>}
        {podeLancar && <button className="btn" onClick={() => setModal({ tipo: 'avaliacao', av: null })}>+ Nova avaliação</button>}
        <button className="btn" onClick={() => exportarCsv(dados, est)}>Exportar CSV</button>
        <span className="espaco" />
        {qtdEdicoes > 0 && <span className="pendentes">{qtdEdicoes} alteração(ões) não salva(s)</span>}
        {qtdEdicoes > 0 && <button className="btn" onClick={() => { if (window.confirm('Descartar alterações não salvas?')) { setEdicoes({}); setConflitos({}) } }}>Descartar</button>}
        {podeLancar && <button className="btn primario" disabled={!qtdEdicoes || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar (Ctrl+S)'}</button>}
      </div>

      <AvisosBlocos est={est} podeLancar={podeLancar} abrir={() => setModal({ tipo: 'pacotes' })} />

      <Grade dados={dados} est={est} edicoes={edicoes} conflitos={conflitos} editar={editar} podeLancar={podeLancar}
             abrirAv={(av) => podeLancar && setModal({ tipo: 'avaliacao', av })}
             abrirAjuste={(ra, campo) => setModal({ tipo: 'ajuste', ra, campo })}
             abrirDetalhe={(ra) => setModal({ tipo: 'detalhe', ra })}
             salvarAcrescimo={async (ra, v) => {
               try { await rpc('salvar_ajuste', { p_diario: diarioId, p_bimestre: bimestre, p_ra: ra, p_campo: 'acrescimo', p_valor: v }); setDados(await rpc('carregar_diario', { p_diario: diarioId, p_bimestre: bimestre })) }
               catch (e) { avisar(e.message, 'erro') }
             }}
             sujo={qtdEdicoes > 0} />

      <Legenda />

      {modal?.tipo === 'pacotes' && <ModalPacotes dados={dados} diarioId={diarioId} bimestre={bimestre} fechar={() => setModal(null)} aoSalvar={recarregarTudo} />}
      {modal?.tipo === 'avaliacao' && <ModalAvaliacao dados={dados} est={est} av={modal.av} diarioId={diarioId} bimestre={bimestre} fechar={() => setModal(null)} aoSalvar={recarregarTudo} />}
      {modal?.tipo === 'ajuste' && <ModalAjuste dados={dados} est={est} ra={modal.ra} campo={modal.campo} diarioId={diarioId} bimestre={bimestre} fechar={() => setModal(null)} aoSalvar={async () => setDados(await rpc('carregar_diario', { p_diario: diarioId, p_bimestre: bimestre }))} />}
      {modal?.tipo === 'detalhe' && <ModalDetalhe dados={dados} est={est} ra={modal.ra} diarioId={diarioId} bimestre={bimestre} fechar={() => setModal(null)} />}
    </div>
  )
}

function AvisosBlocos({ est, podeLancar, abrir }) {
  const problemas = est.blocosVisiveis.filter((b) => est.pesoBloco[b] > 0 && !est.blocoOk[b])
  if (!problemas.length) return null
  return (
    <div className="faixa alerta">
      {problemas.map((b) => `${BLOCOS[b].nome}: pacotes somam ${num(est.somaBloco[b] * 100)}% (precisa 100%)`).join(' · ')}
      . O lançamento nesses blocos fica bloqueado até ajustar.
      {podeLancar && <button className="btn pequeno" onClick={abrir}>Ajustar pacotes</button>}
    </div>
  )
}

/* ------------------------------ Grade ------------------------------ */
function Grade({ dados, est, edicoes, conflitos, editar, podeLancar, abrirAv, abrirAjuste, abrirDetalhe, salvarAcrescimo, sujo }) {
  const ref = useRef(null)
  const { colunas } = est
  const alunos = dados.alunos
  const podeCoord = dados.diario.pode_coordenar

  const focar = (l, c) => {
    const el = ref.current?.querySelector(`[data-l="${l}"][data-c="${c}"]`)
    if (el) { el.focus(); el.select?.() }
  }
  const aoTeclar = (e, l, c) => {
    const k = e.key
    const fim = e.target.selectionStart === e.target.value.length
    const inicio = e.target.selectionEnd === 0
    const tudo = e.target.selectionStart === 0 && e.target.selectionEnd === e.target.value.length
    if (k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); focar(l + 1, c) }
    else if (k === 'ArrowUp') { e.preventDefault(); focar(l - 1, c) }
    else if (k === 'ArrowRight' && (fim || tudo)) { e.preventDefault(); focar(l, c + 1) }
    else if (k === 'ArrowLeft' && (inicio || tudo)) { e.preventDefault(); focar(l, c - 1) }
  }
  const aoColar = (e, l, c) => {
    const txt = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(txt.trim())) return
    e.preventDefault()
    txt.replace(/\r/g, '').split('\n').filter((x, i, a) => x !== '' || i < a.length - 1).forEach((linha, i) => {
      linha.split('\t').forEach((v, j) => {
        const al = alunos[l + i], av = colunas[c + j]
        if (al && av && al.situacao === 'Ativo' && est.blocoOk[av.bloco]) editar(al.ra, String(av.id), v.trim())
      })
    })
  }

  const grupos = est.blocosVisiveis.map((b) => ({ b, n: colunas.filter((a) => a.bloco === b).length }))

  return (
    <div className="grade-wrap" ref={ref}>
      <table className="grade">
        <thead>
          <tr>
            <th className="fixa c-num" rowSpan={2}>Nº</th>
            <th className="fixa c-nome" rowSpan={2}>Aluno</th>
            {grupos.map(({ b, n }) => (
              <th key={b} colSpan={Math.max(n, 1)} className={`grupo g-${b}`}>
                {BLOCOS[b].nome} {b !== 'R' && <small>({pct(est.pesoBloco[b])})</small>}
              </th>
            ))}
            <th colSpan={8} className="grupo g-res">Resultado do bimestre {sujo && <small className="desatualizado">· salve para atualizar</small>}</th>
          </tr>
          <tr>
            {grupos.map(({ b, n }) => n === 0
              ? <th key={b} className={`av vazio-col g-${b}`}><small>sem avaliações</small></th>
              : colunas.filter((a) => a.bloco === b).map((a) => (
                <th key={a.id} className={`av g-${b} ${podeLancar ? 'clicavel' : ''}`} onClick={() => abrirAv(a)}
                    title={`${a.nome}\nPacote ${a.pacote}${est.pac[a.pacote]?.descricao ? ' – ' + est.pac[a.pacote].descricao : ''}\nPeso ${num(a.peso)}${a.data ? '\nData ' + dataBR(a.data) : ''}`}>
                  <div className="av-nome">{a.nome}</div>
                  <div className="av-meta">{a.pacote}{Number(a.peso) !== 1 ? ` · p${num(a.peso)}` : ''}{a.data ? ` · ${dataBR(a.data)}` : ''}</div>
                </th>
              )))}
            <th className="res">Prova bim.</th>
            <th className="res">Contínuas</th>
            <th className="res">Recup.</th>
            <th className="res">Calculada</th>
            <th className="res" title="Acréscimo do professor (0,1 a 0,9)">Acrésc.</th>
            <th className="res" title="Nota do conselho (coordenação)">Conselho</th>
            <th className="res" title="Bônus da coordenação (até 10)">Bônus</th>
            <th className="res final">Final</th>
          </tr>
        </thead>
        <tbody>
          {alunos.map((al, l) => (
            <Linha key={al.ra} l={l} al={al} colunas={colunas} grupos={grupos} notas={est.notas[al.ra]} ed={edicoes[al.ra]}
                   conflitos={conflitos} m={est.medias[al.ra]} aj={est.ajustes[al.ra]} blocoOk={est.blocoOk} podeLancar={podeLancar} podeCoord={podeCoord}
                   editar={editar} aoTeclar={aoTeclar} aoColar={aoColar}
                   abrirAjuste={abrirAjuste} abrirDetalhe={abrirDetalhe} salvarAcrescimo={salvarAcrescimo} />
          ))}
          {!alunos.length && <tr><td colSpan={99} className="vazio">Nenhum aluno nesta turma. Verifique a sincronização da planilha de alunos.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

const ORIGEM = { recuperacao: ['R', 'Recuperação aplicada'], conselho: ['C', 'Nota do conselho'] }

const Inf = () => <span className="origem o-inf" title="Valor digitado direto na planilha de 2026 (por cima da fórmula)">i</span>

const Linha = memo(function Linha({ l, al, colunas, grupos, notas, ed, conflitos, m, aj, blocoOk, podeLancar, podeCoord, editar, aoTeclar, aoColar, abrirAjuste, abrirDetalhe, salvarAcrescimo }) {
  const transferido = al.situacao !== 'Ativo'
  let c = -1
  return (
    <tr className={transferido ? 'transferido' : ''}>
      <td className="fixa c-num">{al.numero ?? ''}</td>
      <td className="fixa c-nome" title={al.ra}>{al.nome}{transferido && <span className="selo cinza">Transferido</span>}</td>
      {grupos.map(({ b, n }) => n === 0
        ? <td key={b} className="vazio-col" />
        : colunas.filter((a) => a.bloco === b).map((a) => {
          c++
          const k = String(a.id)
          const editado = ed && k in ed
          const texto = editado ? ed[k] : mostrarNota(notas?.[a.id])
          const invalido = editado && !lerNota(texto).ok
          const conf = conflitos[`${a.id}|${al.ra}`]
          const bloqueado = !podeLancar || transferido || !blocoOk[a.bloco]
          const cc = c
          return (
            <td key={a.id} className={`nota ${editado ? 'editado' : ''} ${invalido ? 'invalido' : ''} ${conf ? 'conflito' : ''}`}
                title={conf ? `Alterado por ${conf.por} em ${dataHoraBR(conf.em)} para ${conf.nao_avaliado_atual ? '-' : num(conf.valor_atual)}. Salve de novo para manter a sua nota.` : undefined}>
              <input value={texto} disabled={bloqueado} data-l={l} data-c={cc} inputMode="decimal"
                     onChange={(e) => editar(al.ra, k, e.target.value)}
                     onFocus={(e) => e.target.select()}
                     onKeyDown={(e) => aoTeclar(e, l, cc)} onPaste={(e) => aoColar(e, l, cc)} />
            </td>
          )
        }))}
      <td className="res">{media(m?.nota_bimestral)}{aj?.bimestral_informada != null && <Inf />}</td>
      <td className="res">{media(m?.nota_continuas)}{aj?.continuas_informada != null && <Inf />}</td>
      <td className="res">{media(m?.nota_recuperacao)}{aj?.recuperacao_informada != null && <Inf />}</td>
      <td className={`res ${corMedia(m?.media_calculada)}`}>{media(m?.media_calculada)}</td>
      <td className="res">
        {podeLancar && !transferido ? (
          <select className="acrescimo" value={m?.acrescimo ?? ''} onChange={(e) => salvarAcrescimo(al.ra, e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">–</option>
            {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((v) => <option key={v} value={v}>{num(v)}</option>)}
          </select>
        ) : num(m?.acrescimo)}
      </td>
      <td className={`res ${podeCoord && !transferido ? 'clicavel' : ''}`} onClick={() => podeCoord && !transferido && abrirAjuste(al.ra, 'conselho')}>{num(m?.conselho) || (podeCoord && !transferido ? <span className="mais">+</span> : '')}</td>
      <td className={`res ${podeCoord && !transferido ? 'clicavel' : ''}`} onClick={() => podeCoord && !transferido && abrirAjuste(al.ra, 'bonus')}>{num(m?.bonus) || (podeCoord && !transferido ? <span className="mais">+</span> : '')}</td>
      <td className={`res final clicavel ${corMedia(m?.media_final)}`} onClick={() => abrirDetalhe(al.ra)} title="Ver composição e histórico">
        {media(m?.media_final)}
        {ORIGEM[m?.origem] && <span className={`origem o-${m.origem}`} title={ORIGEM[m.origem][1]}>{ORIGEM[m.origem][0]}</span>}
        {m?.bonus != null && <span className="origem o-bonus" title="Com bônus">+</span>}
      </td>
    </tr>
  )
})

function Legenda() {
  return (
    <div className="legenda">
      Digite notas de 0 a 100 · "-" = não avaliado · Enter/setas navegam · cole colunas do Excel/Planilhas ·
      <span className="origem o-recuperacao">R</span> recuperação aplicada ·
      <span className="origem o-conselho">C</span> nota do conselho ·
      <span className="origem o-bonus">+</span> com bônus ·
      <span className="origem o-inf">i</span> valor digitado direto na planilha 2026 · clique na nota final para ver a composição e o histórico
    </div>
  )
}

/* ------------------------------ Modais ------------------------------ */
function ModalPacotes({ dados, diarioId, bimestre, fechar, aoSalvar }) {
  const avisar = useToast()
  const inicial = () => {
    const m = Object.fromEntries(dados.pacotes.map((p) => [p.codigo, { descricao: p.descricao || '', pct: num(Number(p.percentual) * 100) }]))
    return m
  }
  const [form, setForm] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const pesoBloco = { B: Number(dados.diario.peso_bimestral), C: Number(dados.diario.peso_continuas), R: 1 }
  const blocos = ['B', 'C', 'R'].filter((b) => pesoBloco[b] > 0)
  const soma = (b) => BLOCOS[b].codigos.reduce((s, c) => s + (Number(String(form[c]?.pct || '0').replace(',', '.')) || 0), 0)
  const set = (c, campo, v) => setForm((f) => ({ ...f, [c]: { ...(f[c] || { descricao: '', pct: '' }), [campo]: v } }))

  const copiarAnterior = async () => {
    try {
      const ant = await rpc('carregar_diario', { p_diario: diarioId, p_bimestre: bimestre - 1 })
      if (!ant.pacotes.length) return avisar('O bimestre anterior não tem pacotes configurados.', 'erro')
      setForm(Object.fromEntries(ant.pacotes.map((p) => [p.codigo, { descricao: p.descricao || '', pct: num(Number(p.percentual) * 100) }])))
    } catch (e) { avisar(e.message, 'erro') }
  }
  const salvar = async () => {
    for (const b of blocos) if (soma(b) > 100.0001) return avisar(`${BLOCOS[b].nome}: soma passa de 100%.`, 'erro')
    const lista = Object.entries(form)
      .map(([codigo, v]) => ({ codigo, descricao: v.descricao, percentual: (Number(String(v.pct).replace(',', '.')) || 0) / 100 }))
      .filter((p) => p.percentual > 0 || p.descricao.trim())
    setSalvando(true)
    try { await rpc('salvar_pacotes', { p_diario: diarioId, p_bimestre: bimestre, p_pacotes: lista }); avisar('Pacotes salvos.', 'ok'); fechar(); aoSalvar() }
    catch (e) { avisar(e.message, 'erro') } finally { setSalvando(false) }
  }
  return (
    <Modal titulo={`Pacotes do ${bimestre}º bimestre`} onFechar={fechar} largo
           rodape={<>
             {bimestre > 1 && <button className="btn" onClick={copiarAnterior}>Copiar do {bimestre - 1}º bimestre</button>}
             <span className="espaco" />
             <button className="btn" onClick={fechar}>Cancelar</button>
             <button className="btn primario" disabled={salvando} onClick={salvar}>Salvar</button>
           </>}>
      <p className="ajuda">Os pacotes são combinados entre professor e coordenação. Em cada bloco, os percentuais precisam somar 100% para liberar o lançamento.</p>
      <div className="pacotes-grid">
        {blocos.map((b) => {
          const s = soma(b)
          return (
            <div key={b} className="pacote-bloco">
              <h4>{BLOCOS[b].nome} <span className={Math.abs(s - 100) < 0.001 ? 'soma ok' : 'soma'}>{num(s)}%</span></h4>
              {BLOCOS[b].codigos.map((c) => (
                <div key={c} className="pacote-linha">
                  <b>{c}</b>
                  <input placeholder="Descrição" value={form[c]?.descricao || ''} onChange={(e) => set(c, 'descricao', e.target.value)} />
                  <input className="pct" placeholder="%" inputMode="decimal" value={form[c]?.pct || ''} onChange={(e) => set(c, 'pct', e.target.value)} />%
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function ModalAvaliacao({ dados, est, av, diarioId, bimestre, fechar, aoSalvar }) {
  const avisar = useToast()
  const opcoes = ['B', 'C', 'R'].filter((b) => est.pesoBloco[b] > 0).flatMap((b) => BLOCOS[b].codigos.map((c) => ({ c, b, desc: est.pac[c]?.descricao, pct: est.pac[c]?.percentual })))
  const primeiro = opcoes.find((o) => Number(o.pct) > 0)?.c || 'C1'
  const [f, setF] = useState(av ? { nome: av.nome, data: av.data || '', pacote: av.pacote, peso: String(av.peso) } : { nome: '', data: new Date().toISOString().slice(0, 10), pacote: primeiro, peso: '1' })
  const qtdNotas = av ? dados.notas.filter((n) => n[0] === av.id).length : 0
  const salvar = async () => {
    try {
      await rpc('salvar_avaliacao', { p: { id: av?.id, diario_id: diarioId, bimestre, ...f, peso: Number(f.peso) } })
      avisar('Avaliação salva.', 'ok'); fechar(); aoSalvar()
    } catch (e) { avisar(e.message, 'erro') }
  }
  const excluir = async () => {
    if (!window.confirm(`Excluir "${av.nome}"${qtdNotas ? ` e as ${qtdNotas} notas lançadas nela` : ''}? (fica registrado no histórico)`)) return
    try { await rpc('excluir_avaliacao', { p_id: av.id }); avisar('Avaliação excluída.', 'ok'); fechar(); aoSalvar() } catch (e) { avisar(e.message, 'erro') }
  }
  return (
    <Modal titulo={av ? 'Editar avaliação' : 'Nova avaliação'} onFechar={fechar}
           rodape={<>{av && <button className="btn perigo" onClick={excluir}>Excluir</button>}<span className="espaco" /><button className="btn" onClick={fechar}>Cancelar</button><button className="btn primario" onClick={salvar}>Salvar</button></>}>
      <div className="form">
        <label>Nome<input autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Prova mensal" /></label>
        <label>Data<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
        <label>Pacote
          <select value={f.pacote} onChange={(e) => setF({ ...f, pacote: e.target.value })}>
            {['B', 'C', 'R'].filter((b) => est.pesoBloco[b] > 0).map((b) => (
              <optgroup key={b} label={BLOCOS[b].nome}>
                {opcoes.filter((o) => o.b === b).map((o) => <option key={o.c} value={o.c}>{o.c}{o.desc ? ` – ${o.desc}` : ''}{o.pct ? ` (${pct(o.pct)})` : ' (sem %)'}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Peso dentro do pacote
          <select value={f.peso} onChange={(e) => setF({ ...f, peso: e.target.value })}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => <option key={p} value={p}>{p}{p === 0 ? ' (registra sem contar na média)' : ''}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  )
}

function ModalAjuste({ dados, est, ra, campo, diarioId, bimestre, fechar, aoSalvar }) {
  const avisar = useToast()
  const al = dados.alunos.find((a) => a.ra === ra)
  const aj = est.ajustes[ra] || {}
  const m = est.medias[ra] || {}
  const [valor, setValor] = useState(aj[campo] != null ? num(aj[campo]) : '')
  const [just, setJust] = useState(aj[campo + '_justificativa'] || '')
  const titulo = campo === 'bonus' ? 'Bônus da coordenação' : 'Nota do conselho'
  const enviar = async (v) => {
    try {
      await rpc('salvar_ajuste', { p_diario: diarioId, p_bimestre: bimestre, p_ra: ra, p_campo: campo, p_valor: v, p_justificativa: just })
      avisar(v === null ? 'Removido.' : 'Salvo.', 'ok'); fechar(); aoSalvar()
    } catch (e) { avisar(e.message, 'erro') }
  }
  const salvar = () => {
    const v = Number(String(valor).replace(',', '.'))
    if (!Number.isFinite(v)) return avisar('Informe um número.', 'erro')
    enviar(v)
  }
  return (
    <Modal titulo={`${titulo} – ${al?.nome}`} onFechar={fechar}
           rodape={<>{aj[campo] != null && <button className="btn perigo" onClick={() => enviar(null)}>Remover</button>}<span className="espaco" /><button className="btn" onClick={fechar}>Cancelar</button><button className="btn primario" onClick={salvar}>Salvar</button></>}>
      <p className="ajuda">
        Média calculada: <b>{media(m.media_calculada) || '—'}</b>
        {m.apos_recuperacao != null && m.apos_recuperacao !== m.media_calculada && <> · após recuperação: <b>{media(m.apos_recuperacao)}</b></>}
        <br />
        {campo === 'bonus'
          ? 'O bônus (até 10 pontos) é somado no final, a pedido do professor — por exemplo, participação no Fórum de debates.'
          : 'A nota do conselho substitui o resultado do bimestre. A nota calculada continua guardada e visível para a coordenação.'}
      </p>
      <div className="form">
        <label>{campo === 'bonus' ? 'Pontos (0 a 10)' : 'Nota (0 a 100)'}<input autoFocus inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <label>Justificativa (obrigatória)<textarea rows={3} value={just} onChange={(e) => setJust(e.target.value)} placeholder={campo === 'bonus' ? 'Ex.: participação no Fórum de debates (pedido do prof. …)' : 'Ex.: decisão do conselho de classe de …'} /></label>
      </div>
    </Modal>
  )
}

function ModalDetalhe({ dados, est, ra, diarioId, bimestre, fechar }) {
  const al = dados.alunos.find((a) => a.ra === ra)
  const m = est.medias[ra] || {}
  const aj = est.ajustes[ra] || {}
  const d = dados.diario
  const hist = useDados(() => rpc('historico_aluno', { p_diario: diarioId, p_bimestre: bimestre, p_ra: ra }), [ra])
  const linha = (rotulo, valor, extra, destaque) => (
    <tr className={destaque ? 'destaque' : ''}><td>{rotulo}</td><td className="num">{valor}</td><td className="extra">{extra}</td></tr>
  )
  return (
    <Modal titulo={`${al?.nome} – ${bimestre}º bimestre`} onFechar={fechar} largo>
      <table className="composicao">
        <tbody>
          {linha('Prova bimestral', media(m.nota_bimestral) || '—', `peso ${pct(d.peso_bimestral)}${aj.bimestral_informada != null ? ' · valor informado na planilha 2026' : ''}`)}
          {linha('Contínuas', media(m.nota_continuas) || '—', `peso ${pct(d.peso_continuas)}${aj.continuas_informada != null ? ' · valor informado na planilha 2026' : ''}`)}
          {linha('Média calculada', media(m.media_calculada) || '—', '', true)}
          {linha('Recuperação', media(m.nota_recuperacao) || '—', m.nota_recuperacao != null ? `resultado após recuperação: ${media(m.apos_recuperacao)} (só vale se a média < 50, limite 50)` : '')}
          {linha('Conselho', num(m.conselho) || '—', aj.conselho_justificativa ? `“${aj.conselho_justificativa}”` : 'substitui o resultado')}
          {linha('Acréscimo (professor)', num(m.acrescimo) || '—', '')}
          {linha('Bônus (coordenação)', num(m.bonus) || '—', aj.bonus_justificativa ? `“${aj.bonus_justificativa}”` : '')}
          {linha('Nota final', media(m.media_final) || '—', m.situacao, true)}
        </tbody>
      </table>
      <h4>Histórico de alterações</h4>
      {hist.carregando ? <Carregando /> : hist.erro ? <Erro erro={hist.erro} /> : !hist.dados.length ? <p className="ajuda">Nenhuma alteração registrada para este aluno neste bimestre.</p> : (
        <table className="historico">
          <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Antes</th><th>Depois</th></tr></thead>
          <tbody>
            {hist.dados.map((h, i) => (
              <tr key={i}>
                <td>{dataHoraBR(h.em)}</td>
                <td>{h.usuario}{h.como && h.como !== h.usuario ? <small> (como {h.como})</small> : null}</td>
                <td>{h.tabela === 'notas' ? (h.avaliacao || 'avaliação excluída') : 'Ajustes'}</td>
                <td>{descreverHist(h.tabela, h.antes)}</td>
                <td>{descreverHist(h.tabela, h.depois)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

function descreverHist(tabela, x) {
  if (!x) return '—'
  if (tabela === 'notas') return x.nao_avaliado ? '-' : num(x.valor)
  return ['acrescimo', 'conselho', 'bonus'].filter((k) => x[k] != null).map((k) => `${k === 'acrescimo' ? 'acrésc.' : k} ${num(x[k])}`).join(', ') || '—'
}

function exportarCsv(dados, est) {
  const cab = ['Nº', 'RA', 'Aluno', 'Situação', ...est.colunas.map((a) => `${a.nome} [${a.pacote}]`), 'Prova bim.', 'Contínuas', 'Recup.', 'Calculada', 'Acréscimo', 'Conselho', 'Bônus', 'Final']
  const linhas = dados.alunos.map((al) => {
    const m = est.medias[al.ra] || {}
    return [al.numero, al.ra, al.nome, al.situacao, ...est.colunas.map((a) => mostrarNota(est.notas[al.ra]?.[a.id])),
            media(m.nota_bimestral), media(m.nota_continuas), media(m.nota_recuperacao), media(m.media_calculada), num(m.acrescimo), num(m.conselho), num(m.bonus), media(m.media_final)]
  })
  const csv = [cab, ...linhas].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${dados.diario.materia}_${dados.diario.serie}_T${dados.diario.turma_numero}_${dados.diario.bimestre}bim.csv`.replace(/[^\wºª.-]+/g, '_')
  a.click()
}

/* ============================== ANUAL ============================== */
function Anual({ diarioId }) {
  const info = useDados(() => rpc('carregar_diario', { p_diario: diarioId, p_bimestre: 1 }), [diarioId])
  const anual = useDados(() => rpc('carregar_anual', { p_diario: diarioId }), [diarioId])
  if (info.carregando || anual.carregando) return <Carregando />
  if (info.erro || anual.erro) return <Erro erro={info.erro || anual.erro} />
  const nomes = Object.fromEntries(info.dados.alunos.map((a) => [a.ra, a.nome]))
  return (
    <div>
      <Cabecalho d={info.dados.diario} aba="anual" diarioId={diarioId} />
      <div className="faixa leve">Média anual = média simples dos bimestres com nota final. A regra de recuperação final ainda será definida.</div>
      <div className="grade-wrap">
        <table className="grade anual">
          <thead><tr><th className="fixa c-num">Nº</th><th className="fixa c-nome">Aluno</th><th>1º bim</th><th>2º bim</th><th>3º bim</th><th>4º bim</th><th className="final">Média anual</th><th>Situação</th></tr></thead>
          <tbody>
            {anual.dados.map((a) => (
              <tr key={a.aluno_ra} className={a.situacao_matricula !== 'Ativo' ? 'transferido' : ''}>
                <td className="fixa c-num">{a.numero}</td>
                <td className="fixa c-nome">{nomes[a.aluno_ra]}</td>
                {[a.b1, a.b2, a.b3, a.b4].map((v, i) => <td key={i} className={`res ${corMedia(v)}`}>{media(v)}</td>)}
                <td className={`res final ${corMedia(a.media_anual)}`}>{media(a.media_anual)}{a.parcial && a.bimestres_com_nota > 0 ? <small className="parcial"> parcial</small> : null}</td>
                <td>{a.situacao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

