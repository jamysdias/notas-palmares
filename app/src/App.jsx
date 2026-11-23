import React, { useCallback, useEffect, useState } from 'react'
import { supabase, rpc, configurado, modoDev, dominioGoogle } from './supabase.js'
import { useRota, ir } from './util.js'
import { ToastProvider, Carregando, Erro, useToast } from './components/ui.jsx'
import Inicio from './pages/Inicio.jsx'
import Diario from './pages/Diario.jsx'
import Painel from './pages/Painel.jsx'
import MapaTurma from './pages/MapaTurma.jsx'
import Admin from './pages/Admin.jsx'

export default function App() {
  return <ToastProvider><Raiz /></ToastProvider>
}

function Raiz() {
  const [sessao, setSessao] = useState(modoDev ? { dev: true } : undefined)

  useEffect(() => {
    if (modoDev || !configurado) return
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configurado) return <Aviso titulo="Sistema não configurado">Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.</Aviso>
  if (sessao === undefined) return <Carregando />
  if (!sessao) return <Login />
  return <AppLogado />
}

function Login() {
  const [erro, setErro] = useState(null)
  const entrar = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { hd: dominioGoogle, prompt: 'select_account' }
      }
    })
    if (error) setErro(error)
  }
  return (
    <div className="login">
      <div className="login-caixa">
        <div className="marca grande">Notas <b>Palmares</b></div>
        <p>Lançamento e acompanhamento de notas</p>
        <button className="btn primario grande" onClick={entrar}>Entrar com Google</button>
        <small>Use seu e-mail @{dominioGoogle}</small>
        <Erro erro={erro} />
      </div>
    </div>
  )
}

function Aviso({ titulo, children, acao }) {
  return (
    <div className="login">
      <div className="login-caixa">
        <div className="marca grande">Notas <b>Palmares</b></div>
        <h2>{titulo}</h2>
        <div>{children}</div>
        {acao}
      </div>
    </div>
  )
}

function AppLogado() {
  const [perfil, setPerfil] = useState(null)
  const [erro, setErro] = useState(null)
  const rota = useRota()
  const carregar = useCallback(() => rpc('meu_perfil').then(setPerfil).catch(setErro), [])
  useEffect(() => { carregar() }, [carregar])

  const sair = async () => { await supabase.auth.signOut(); window.location.hash = '' }

  if (erro) return <Aviso titulo="Não foi possível entrar"><Erro erro={erro} /></Aviso>
  if (!perfil) return <Carregando />
  if (!perfil.cadastrado || !perfil.ativo) {
    return (
      <Aviso titulo="Acesso não liberado" acao={<button className="btn" onClick={sair}>Sair</button>}>
        <p>O e-mail <b>{perfil.email}</b> ainda não tem acesso ao sistema.</p>
        <p>Peça ao administrador para cadastrar você.</p>
      </Aviso>
    )
  }

  const ehCoord = perfil.admin || perfil.coord_series.length > 0 || perfil.coord_areas.length > 0
  const [pagina, ...params] = rota
  let conteudo
  if (pagina === 'diario') conteudo = <Diario key={params.join('/')} diarioId={Number(params[0])} aba={params[1] || '1'} perfil={perfil} />
  else if (pagina === 'painel' && ehCoord) conteudo = <Painel bimestre={Number(params[0]) || null} />
  else if (pagina === 'turma' && ehCoord) conteudo = <MapaTurma turmaId={params[0] ? Number(params[0]) : null} aba={params[1] || '0'} />
  else if (pagina === 'admin' && perfil.admin) conteudo = <Admin secao={params[0] || 'usuarios'} perfil={perfil} aoMudarPerfil={carregar} />
  else conteudo = <Inicio perfil={perfil} />

  return (
    <div className="app">
      <Topo perfil={perfil} ehCoord={ehCoord} pagina={pagina} sair={sair} aoMudar={carregar} />
      {perfil.ver_como && (
        <div className="faixa-ver-como">
          Você está vendo o sistema como <b>{perfil.nome || perfil.email_efetivo}</b> ({perfil.email_efetivo}).
          Tudo o que fizer será registrado em seu nome ({perfil.email}).
          <BotaoParar aoMudar={carregar} />
        </div>
      )}
      <main className="conteudo">{conteudo}</main>
    </div>
  )
}

function BotaoParar({ aoMudar }) {
  return <button className="btn pequeno" onClick={() => rpc('ver_como_parar').then(aoMudar).then(() => ir())}>Voltar ao meu perfil</button>
}

function Topo({ perfil, ehCoord, pagina, sair, aoMudar }) {
  const papeis = [
    perfil.admin && 'Administrador',
    perfil.coord_series.length > 0 && `Coord. ${perfil.coord_series.join(', ')}`,
    perfil.coord_areas.length > 0 && `Coord. ${perfil.coord_areas.join(', ')}`,
    perfil.professor_em > 0 && 'Professor'
  ].filter(Boolean)
  const link = (alvo, txt) => <a href={`#/${alvo}`} className={pagina === alvo || (!pagina && alvo === '') ? 'ativo' : ''}>{txt}</a>
  return (
    <header className="topo">
      <a className="marca" href="#/">Notas <b>Palmares</b></a>
      <nav>
        {link('', 'Meus diários')}
        {ehCoord && link('painel', 'Painel')}
        {ehCoord && link('turma', 'Mapa da turma')}
        {perfil.admin && link('admin', 'Administração')}
      </nav>
      <div className="topo-dir">
        {perfil.admin_real && <VerComo perfil={perfil} aoMudar={aoMudar} />}
        <div className="usuario">
          <span>{perfil.nome || perfil.email_efetivo}</span>
          <small>{papeis.join(' · ') || 'Sem atribuições'}</small>
        </div>
        {!modoDev && <button className="btn pequeno" onClick={sair}>Sair</button>}
      </div>
    </header>
  )
}

function VerComo({ perfil, aoMudar }) {
  const [opcoes, setOpcoes] = useState(null)
  const avisar = useToast()
  const abrir = () => !opcoes && rpc('ver_como_opcoes').then(setOpcoes).catch((e) => avisar(e.message, 'erro'))
  const mudar = async (email) => {
    try {
      if (!email || email === perfil.email) await rpc('ver_como_parar')
      else await rpc('ver_como_iniciar', { p_email: email })
      await aoMudar()
      ir()
    } catch (e) { avisar(e.message, 'erro') }
  }
  return (
    <label className="ver-como" title="Modo demonstração: veja o sistema como outro usuário">
      Ver como
      <select value={perfil.ver_como || ''} onFocus={abrir} onMouseDown={abrir} onChange={(e) => mudar(e.target.value)}>
        <option value="">Eu mesmo</option>
        {perfil.ver_como && !opcoes && <option value={perfil.ver_como}>{perfil.ver_como}</option>}
        {(opcoes || []).filter((o) => o.email !== perfil.email).map((o) => (
          <option key={o.email} value={o.email}>{(o.nome || o.email) + (o.papel ? ` — ${o.papel}` : '')}</option>
        ))}
      </select>
    </label>
  )
}
