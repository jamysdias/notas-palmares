import React, { useMemo, useState } from 'react'
import { rpc, tabela, gravar } from '../supabase.js'
import { useDados, Carregando, Erro, useToast } from '../components/ui.jsx'
import { ir, dataHoraBR, nomeTurma, pct } from '../util.js'

const SECOES = [['usuarios', 'Usuários'], ['atribuicoes', 'Atribuições'], ['periodos', 'Bimestres e prazos'], ['pesos', 'Pesos por diário'], ['ano', 'Ano letivo'], ['importacao', 'Importação'], ['auditoria', 'Auditoria']]

export default function Admin({ secao, perfil, aoMudarPerfil }) {
  return (
    <div>
      <div className="cabecalho-pagina"><h1>Administração</h1></div>
      <div className="abas sub">{SECOES.map(([k, t]) => <a key={k} href={`#/admin/${k}`} className={secao === k ? 'ativa' : ''}>{t}</a>)}</div>
      {secao === 'usuarios' && <Usuarios perfil={perfil} aoMudarPerfil={aoMudarPerfil} />}
      {secao === 'atribuicoes' && <Atribuicoes aoMudarPerfil={aoMudarPerfil} />}
      {secao === 'periodos' && <Periodos />}
      {secao === 'pesos' && <Pesos />}
      {secao === 'ano' && <AnoLetivo />}
      {secao === 'importacao' && <Importacao />}
      {secao === 'auditoria' && <Auditoria />}
    </div>
  )
}

/* ------------------------------ Usuários ------------------------------ */
function Usuarios({ perfil, aoMudarPerfil }) {
  const avisar = useToast()
  const u = useDados(() => Promise.all([tabela('usuarios', (q) => q.order('nome')), tabela('atribuicoes'), tabela('coord_series'), tabela('coord_areas')]), [])
  const [novo, setNovo] = useState({ email: '', nome: '', is_admin: false })
  const [busca, setBusca] = useState('')
  if (u.carregando) return <Carregando />
  if (u.erro) return <Erro erro={u.erro} />
  const [usuarios, atr, cs, ca] = u.dados
  const conta = (lista, email) => lista.filter((x) => x.email === email).length

  const adicionar = async (e) => {
    e.preventDefault()
    const emails = novo.email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    if (!emails.length) return
    try {
      await gravar('usuarios', (t) => t.insert(emails.map((email) => ({ email, nome: emails.length === 1 ? novo.nome.trim() || null : null, is_admin: novo.is_admin }))))
      avisar(`${emails.length} usuário(s) cadastrado(s).`, 'ok'); setNovo({ email: '', nome: '', is_admin: false }); u.recarregar()
    } catch (err) { avisar(err.message.includes('duplicate') ? 'E-mail já cadastrado.' : err.message, 'erro') }
  }
  const atualizar = async (email, campos) => {
    if (email === perfil.email && (campos.is_admin === false || campos.ativo === false) && !window.confirm('Você vai remover seu próprio acesso de administrador. Continuar?')) return
    try { await gravar('usuarios', (t) => t.update(campos).eq('email', email)); u.recarregar(); if (email === perfil.email) aoMudarPerfil() } catch (err) { avisar(err.message, 'erro') }
  }
  const excluir = async (email) => {
    if (!window.confirm(`Excluir ${email} e todas as atribuições dele? (as notas lançadas continuam no histórico)`)) return
    try { await gravar('usuarios', (t) => t.delete().eq('email', email)); u.recarregar() } catch (err) { avisar(err.message, 'erro') }
  }
  const b = busca.toLowerCase()
  const lista = usuarios.filter((x) => !b || `${x.email} ${x.nome || ''}`.toLowerCase().includes(b))

  return (
    <div>
      <form className="form linha" onSubmit={adicionar}>
        <input placeholder="e-mail(s) @colegiopalmares.com.br — vários separados por vírgula" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} style={{ flex: 2 }} />
        <input placeholder="Nome (opcional)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
        <label className="check"><input type="checkbox" checked={novo.is_admin} onChange={(e) => setNovo({ ...novo, is_admin: e.target.checked })} /> administrador</label>
        <button className="btn primario">Cadastrar</button>
      </form>
      <div className="filtros"><input type="search" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} /><small className="cinza">{usuarios.length} usuários</small></div>
      <table className="tabela">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Diários</th><th>Coord. séries</th><th>Coord. áreas</th><th>Admin</th><th>Ativo</th><th></th></tr></thead>
        <tbody>
          {lista.map((x) => (
            <tr key={x.email} className={x.ativo ? '' : 'transferido'}>
              <td><input className="inline" defaultValue={x.nome || ''} onBlur={(e) => e.target.value !== (x.nome || '') && atualizar(x.email, { nome: e.target.value || null })} /></td>
              <td>{x.email}</td>
              <td className="num">{conta(atr, x.email) || ''}</td>
              <td className="num">{conta(cs, x.email) || ''}</td>
              <td className="num">{conta(ca, x.email) || ''}</td>
              <td><input type="checkbox" checked={x.is_admin} onChange={(e) => atualizar(x.email, { is_admin: e.target.checked })} /></td>
              <td><input type="checkbox" checked={x.ativo} onChange={(e) => atualizar(x.email, { ativo: e.target.checked })} /></td>
              <td className="acoes"><button className="btn pequeno" onClick={() => ir('admin', 'atribuicoes', x.email)}>Atribuições</button><button className="btn pequeno perigo" onClick={() => excluir(x.email)}>Excluir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------ Atribuições ------------------------------ */
function Atribuicoes({ aoMudarPerfil }) {
  const avisar = useToast()
  const emailUrl = decodeURIComponent((window.location.hash.split('/')[3] || ''))
  const base = useDados(() => Promise.all([tabela('usuarios', (q) => q.order('nome')), rpc('listar_diarios'), tabela('series', (q) => q.order('ordem')), tabela('areas', (q) => q.order('ordem'))]), [])
  const [email, setEmail] = useState(emailUrl)
  const vinc = useDados(() => (email ? Promise.all([
    tabela('atribuicoes', (q) => q.eq('email', email)), tabela('coord_series', (q) => q.eq('email', email)), tabela('coord_areas', (q) => q.eq('email', email))
  ]) : Promise.resolve(null)), [email])
  const [ano, setAno] = useState(null)

  const [usuarios, diarios, series, areas] = base.dados || [[], [], [], []]
  const anos = useMemo(() => [...new Set(diarios.map((d) => d.ano))].sort((a, b) => b - a), [diarios])
  const anoSel = ano || anos[0]
  const porTurma = useMemo(() => {
    const qtd = {}
    diarios.filter((d) => d.ano === anoSel).forEach((d) => { (qtd[d.serie] ||= new Set()).add(d.turma_numero) })
    const g = new Map()
    diarios.filter((d) => d.ano === anoSel).forEach((d) => {
      const k = d.turma_id
      if (!g.has(k)) g.set(k, { nome: nomeTurma(d.serie, d.turma_numero, qtd[d.serie].size), itens: [] })
      g.get(k).itens.push(d)
    })
    return [...g.values()]
  }, [diarios, anoSel])

  if (base.carregando) return <Carregando />
  if (base.erro) return <Erro erro={base.erro} />

  const [atr, cs, ca] = vinc.dados || [[], [], []]
  const temD = new Set(atr.map((x) => x.diario_id)), temS = new Set(cs.map((x) => x.serie_id)), temA = new Set(ca.map((x) => x.area_id))

  const alternar = async (tab, campo, id, marcado) => {
    try {
      if (marcado) await gravar(tab, (t) => t.insert({ email, [campo]: id }))
      else await gravar(tab, (t) => t.delete().eq('email', email).eq(campo, id))
      vinc.recarregar(); aoMudarPerfil()
    } catch (e) { avisar(e.message, 'erro') }
  }
  const alternarTurma = async (itens, marcar) => {
    try {
      const ids = itens.map((d) => d.diario_id).filter((id) => marcar ? !temD.has(id) : temD.has(id))
      if (!ids.length) return
      if (marcar) await gravar('atribuicoes', (t) => t.insert(ids.map((id) => ({ email, diario_id: id }))))
      else await gravar('atribuicoes', (t) => t.delete().eq('email', email).in('diario_id', ids))
      vinc.recarregar()
    } catch (e) { avisar(e.message, 'erro') }
  }

  return (
    <div>
      <div className="filtros">
        <select value={email} onChange={(e) => { setEmail(e.target.value); ir('admin', 'atribuicoes', e.target.value) }}>
          <option value="">Escolha um usuário…</option>
          {usuarios.filter((x) => x.ativo).map((x) => <option key={x.email} value={x.email}>{x.nome ? `${x.nome} (${x.email})` : x.email}</option>)}
        </select>
        {anos.length > 1 && <select value={anoSel} onChange={(e) => setAno(Number(e.target.value))}>{anos.map((a) => <option key={a}>{a}</option>)}</select>}
      </div>
      {!email ? <p className="ajuda">Escolha um usuário para definir em quais diários ele é professor e o que ele coordena.</p> : vinc.carregando ? <Carregando /> : (
        <div className="atrib-layout">
          <div>
            <h3>Professor em ({temD.size} diários)</h3>
            {porTurma.map((g) => (
              <div key={g.nome} className="atrib-turma">
                <div className="atrib-turma-nome">
                  {g.nome}
                  <button className="link-pequeno" onClick={() => alternarTurma(g.itens, true)}>todas</button>
                  <button className="link-pequeno" onClick={() => alternarTurma(g.itens, false)}>nenhuma</button>
                </div>
                <div className="atrib-itens">
                  {g.itens.map((d) => (
                    <label key={d.diario_id} className={`chip ${temD.has(d.diario_id) ? 'on' : ''}`}>
                      <input type="checkbox" checked={temD.has(d.diario_id)} onChange={(e) => alternar('atribuicoes', 'diario_id', d.diario_id, e.target.checked)} />
                      {d.materia}
                      {d.professores.filter((p) => p.email !== email).length > 0 && <small> ({d.professores.filter((p) => p.email !== email).map((p) => (p.nome || p.email).split(' ')[0]).join(', ')})</small>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3>Coordenador de série</h3>
            <p className="ajuda">Vê e corrige todas as matérias das séries marcadas.</p>
            <div className="atrib-itens">
              {series.map((s) => (
                <label key={s.id} className={`chip ${temS.has(s.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={temS.has(s.id)} onChange={(e) => alternar('coord_series', 'serie_id', s.id, e.target.checked)} />{s.nome}
                </label>
              ))}
            </div>
            <h3>Coordenador de área</h3>
            <p className="ajuda">Vê e corrige as matérias da área em todas as séries.</p>
            <div className="atrib-itens">
              {areas.map((a) => (
                <label key={a.id} className={`chip ${temA.has(a.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={temA.has(a.id)} onChange={(e) => alternar('coord_areas', 'area_id', a.id, e.target.checked)} />{a.nome}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Períodos ------------------------------ */
function Periodos() {
  const avisar = useToast()
  const p = useDados(() => tabela('periodos', (q) => q.order('ano', { ascending: false }).order('bimestre')), [])
  if (p.carregando) return <Carregando />
  if (p.erro) return <Erro erro={p.erro} />
  const salvar = async (x, campos) => {
    try { await gravar('periodos', (t) => t.update(campos).eq('ano', x.ano).eq('bimestre', x.bimestre)); p.recarregar() } catch (e) { avisar(e.message, 'erro') }
  }
  return (
    <div>
      <p className="ajuda">Bimestre <b>fechado</b>: professores só visualizam; coordenação e administração ainda podem corrigir.</p>
      <table className="tabela">
        <thead><tr><th>Ano</th><th>Bimestre</th><th>Início</th><th>Fim</th><th>Prazo de lançamento</th><th>Fechado</th></tr></thead>
        <tbody>
          {p.dados.map((x) => (
            <tr key={`${x.ano}-${x.bimestre}`}>
              <td>{x.ano}</td><td>{x.bimestre}º</td>
              {['inicio', 'fim', 'prazo_lancamento'].map((c) => (
                <td key={c}><input type="date" defaultValue={x[c] || ''} onBlur={(e) => (e.target.value || null) !== x[c] && salvar(x, { [c]: e.target.value || null })} /></td>
              ))}
              <td><label className="check"><input type="checkbox" checked={x.fechado} onChange={(e) => salvar(x, { fechado: e.target.checked })} /> {x.fechado ? 'fechado' : 'aberto'}</label></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------ Pesos ------------------------------ */
function Pesos() {
  const avisar = useToast()
  const d = useDados(() => rpc('listar_diarios'), [])
  const [ano, setAno] = useState(null)
  if (d.carregando) return <Carregando />
  if (d.erro) return <Erro erro={d.erro} />
  const anos = [...new Set(d.dados.map((x) => x.ano))].sort((a, b) => b - a)
  const anoSel = ano || anos[0]
  const salvar = async (x, pb) => {
    try { await gravar('diarios', (t) => t.update({ peso_bimestral: pb, peso_continuas: Math.round((1 - pb) * 1000) / 1000 }).eq('id', x.diario_id)); d.recarregar() } catch (e) { avisar(e.message, 'erro') }
  }
  const opcoes = [0, 0.3, 0.35, 0.4, 0.5]
  return (
    <div>
      <div className="filtros">{anos.length > 1 && <select value={anoSel} onChange={(e) => setAno(Number(e.target.value))}>{anos.map((a) => <option key={a}>{a}</option>)}</select>}</div>
      <p className="ajuda">Peso da prova bimestral × contínuas em cada diário (vindo das Diretrizes de 2026).</p>
      <table className="tabela">
        <thead><tr><th>Série</th><th>Turma</th><th>Matéria</th><th>Prova bimestral</th><th>Contínuas</th></tr></thead>
        <tbody>
          {d.dados.filter((x) => x.ano === anoSel).map((x) => (
            <tr key={x.diario_id}>
              <td>{x.serie}</td><td>{x.turma_numero}</td><td>{x.materia}</td>
              <td><select value={Number(x.peso_bimestral)} onChange={(e) => salvar(x, Number(e.target.value))}>
                {[...new Set([...opcoes, Number(x.peso_bimestral)])].sort().map((o) => <option key={o} value={o}>{pct(o)}</option>)}
              </select></td>
              <td>{pct(x.peso_continuas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------ Ano letivo ------------------------------ */
function AnoLetivo() {
  const avisar = useToast()
  const atual = new Date().getFullYear()
  const [de, setDe] = useState(atual)
  const [para, setPara] = useState(atual + 1)
  const copiar = async () => {
    if (!window.confirm(`Criar as turmas e diários de ${para} copiando a estrutura de ${de}? (não copia notas nem atribuições)`)) return
    try { const r = await rpc('admin_copiar_estrutura', { p_de: de, p_para: para }); avisar(`${r.turmas_criadas} turmas e ${r.diarios_criados} diários criados para ${para}.`, 'ok') } catch (e) { avisar(e.message, 'erro') }
  }
  return (
    <div className="cartao-form">
      <h3>Preparar novo ano letivo</h3>
      <p className="ajuda">Copia séries/turmas, matérias e pesos de um ano para o outro. Depois, cadastre as atribuições dos professores e mude o ano letivo na planilha de alunos.</p>
      <div className="form linha">
        <label>De<input type="number" value={de} onChange={(e) => setDe(Number(e.target.value))} /></label>
        <label>Para<input type="number" value={para} onChange={(e) => setPara(Number(e.target.value))} /></label>
        <button className="btn primario" onClick={copiar}>Copiar estrutura</button>
      </div>
    </div>
  )
}

/* ------------------------------ Auditoria ------------------------------ */
function Auditoria() {
  const [filtro, setFiltro] = useState('')
  const a = useDados(() => tabela('auditoria', (q) => {
    let r = q.order('em', { ascending: false }).limit(300)
    if (filtro) r = r.eq('tabela', filtro)
    return r
  }), [filtro])
  return (
    <div>
      <div className="filtros">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas as alterações</option>
          {['notas', 'ajustes', 'avaliacoes', 'pacotes', 'usuarios', 'atribuicoes', 'coord_series', 'coord_areas', 'periodos', 'diarios', 'ver_como'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <small className="cinza">últimas 300</small>
      </div>
      {a.carregando ? <Carregando /> : a.erro ? <Erro erro={a.erro} /> : (
        <table className="tabela auditoria">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Como</th><th>Tabela</th><th>Operação</th><th>Chave</th><th>Antes → Depois</th></tr></thead>
          <tbody>
            {a.dados.map((x) => (
              <tr key={x.id}>
                <td>{dataHoraBR(x.em)}</td><td>{x.usuario}</td><td>{x.como !== x.usuario ? x.como : ''}</td><td>{x.tabela}</td><td>{x.operacao}</td>
                <td><code>{JSON.stringify(x.chave)}</code></td>
                <td><code>{resumo(x.antes, x.depois)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
function resumo(antes, depois) {
  if (!antes) return JSON.stringify(depois)?.slice(0, 160)
  if (!depois) return 'excluído: ' + JSON.stringify(antes).slice(0, 140)
  const mud = Object.keys(depois).filter((k) => !/atualizado_em|criado_em/.test(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
  return mud.map((k) => `${k}: ${JSON.stringify(antes[k])} → ${JSON.stringify(depois[k])}`).join('; ')
}

/* ------------------------------ Importação ------------------------------ */
function Importacao() {
  const r = useDados(() => tabela('importacoes', (q) => q.order('em', { ascending: false }).limit(500)), [])
  if (r.carregando) return <Carregando />
  if (r.erro) return <Erro erro={r.erro} />
  // última importação de cada diário (reimportações substituem as anteriores)
  const vistos = new Set()
  const notas = r.dados.filter((x) => x.tipo === 'notas').filter((x) => {
    const k = `${x.serie}|${x.turma}|${x.materia}`
    if (vistos.has(k)) return false
    vistos.add(k); return true
  })
  const div = notas.reduce((s, x) => s + (x.divergencias?.length || 0), 0)
  const conf = notas.reduce((s, x) => s + (x.conferidos || 0), 0)
  return (
    <div>
      <p className="ajuda">Registro das cópias feitas pelo Apps Script. As planilhas originais são apenas lidas.</p>
      {notas.length > 0 && (
        <div className="indicadores">
          <div className="indicador"><div className="ind-valor">{notas.length}</div><div className="ind-rotulo">Diários importados</div></div>
          <div className="indicador"><div className="ind-valor">{conf.toLocaleString('pt-BR')}</div><div className="ind-rotulo">Médias conferidas com a planilha</div></div>
          <div className={`indicador ${div ? 'alerta' : ''}`}><div className="ind-valor">{div}</div><div className="ind-rotulo">Divergências</div></div>
          <div className={`indicador ${notas.some((x) => x.erro) ? 'alerta' : ''}`}><div className="ind-valor">{notas.filter((x) => x.erro).length}</div><div className="ind-rotulo">Erros</div></div>
        </div>
      )}
      <table className="tabela">
        <thead><tr><th>Quando</th><th>Tipo</th><th>Diário</th><th>Avaliações</th><th>Notas/alunos</th><th>Conferidos</th><th>Divergências</th><th>Avisos / erro</th></tr></thead>
        <tbody>
          {[...notas, ...r.dados.filter((x) => x.tipo !== 'notas')].sort((a, b) => (b.divergencias?.length || 0) - (a.divergencias?.length || 0) || (b.em > a.em ? 1 : -1)).map((x) => (
            <tr key={x.id}>
              <td>{dataHoraBR(x.em)}</td><td>{x.tipo}</td>
              <td>{x.serie ? `${x.serie}${x.turma > 1 ? ' T' + x.turma : ''} – ${x.materia}` : ''}</td>
              <td className="num">{x.avaliacoes ?? ''}</td><td className="num">{x.notas ?? ''}</td><td className="num">{x.conferidos ?? ''}</td>
              <td className={`num ${x.divergencias?.length ? 'abaixo' : ''}`}>{x.divergencias?.length || ''}{x.divergencias?.length ? <small title={x.divergencias.join('\n')}> ver</small> : null}</td>
              <td><small>{x.erro ? <b className="abaixo">ERRO: {x.erro}</b> : (x.avisos || []).slice(0, 3).join(' · ')}{(x.avisos || []).length > 3 ? ` (+${x.avisos.length - 3})` : ''}</small></td>
            </tr>
          ))}
          {!r.dados.length && <tr><td colSpan={8} className="vazio">Nenhuma importação registrada ainda.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
