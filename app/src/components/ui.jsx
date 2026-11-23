import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [itens, setItens] = useState([])
  const avisar = useCallback((texto, tipo = 'info') => {
    const id = Math.random()
    setItens((l) => [...l, { id, texto, tipo }])
    setTimeout(() => setItens((l) => l.filter((x) => x.id !== id)), tipo === 'erro' ? 8000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="toasts">
        {itens.map((t) => <div key={t.id} className={`toast ${t.tipo}`}>{t.texto}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

export function Modal({ titulo, onFechar, children, rodape, largo }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onFechar])
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`modal ${largo ? 'largo' : ''}`} role="dialog" aria-label={titulo}>
        <div className="modal-topo">
          <h3>{titulo}</h3>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  )
}

export function Carregando({ texto = 'Carregando…' }) {
  return <div className="carregando"><span className="spinner" /> {texto}</div>
}

export function Erro({ erro, onTentar }) {
  if (!erro) return null
  return (
    <div className="erro-caixa">
      {String(erro.message || erro)}
      {onTentar && <button className="btn" onClick={onTentar}>Tentar de novo</button>}
    </div>
  )
}

/** Hook para carregar dados assíncronos com recarga. */
export function useDados(fn, deps) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    let vivo = true
    setEstado((e) => ({ ...e, carregando: true, erro: null }))
    fn().then((dados) => vivo && setEstado({ dados, erro: null, carregando: false }))
        .catch((erro) => vivo && setEstado({ dados: null, erro, carregando: false }))
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { ...estado, recarregar: () => setN((x) => x + 1), setDados: (d) => setEstado((e) => ({ ...e, dados: typeof d === 'function' ? d(e.dados) : d })) }
}
