/**
 * Notas Palmares — importação das planilhas de notas de 2026 (opcional, para testes e histórico).
 * Lê o índice "Acesso às Planilhas de Notas", abre cada planilha (somente leitura),
 * envia avaliações, notas, pacotes e ajustes para o sistema e confere se as médias batem.
 *
 * As planilhas são apenas LIDAS (o appsscript.json só permite leitura): o sistema recebe uma CÓPIA dos dados.
 * Rode "importarNotas2026". Se passar de ~5 minutos, ele agenda a continuação sozinho.
 * O relatório fica no próprio sistema (Administração → Importação).
 */
var IMPORTACAO = {
  // ID da planilha "Acesso às Planilhas de Notas" (defina a propriedade INDICE_ID nas Propriedades do script)
  INDICE_ID: (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('INDICE_ID')) || '',
  ANO: 2026,
  ABAS_BIMESTRE: ['1ºB', '2ºB', '3ºB', '4ºB'],
  LIMITE_MS: 5 * 60 * 1000
};

/* ---------------- Leitura de uma aba de bimestre (função pura, testável) ---------------- */
var CODIGO_PACOTE = /^(B[1-4]|C[1-6]|R[1-4])$/;

function intervalo_(de, ate) { var r = []; for (var i = de; i <= ate; i++) r.push(i); return r; }
function vazio_(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
function dataIso_(v) {
  if (vazio_(v)) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return null;
}

/**
 * @param {Array<Array<*>>} v valores da aba A1:BU86 (API do Sheets, sem formatação)
 * @param {number} bimestre 1–4
 */
function lerAbaBimestre(v, bimestre) {
  var avisos = [];
  var cel = function (l, c) { return (v[l] && v[l][c] !== undefined) ? v[l][c] : null; };

  // Pacotes (B62:D65, B71:D76, B81:D84)
  var pacotes = [];
  [[61, 64], [70, 75], [80, 83]].forEach(function (faixa) {
    intervalo_(faixa[0], faixa[1]).forEach(function (l) {
      var cod = String(cel(l, 1) || '').trim(), pct = cel(l, 3), desc = String(cel(l, 2) || '').trim();
      if (CODIGO_PACOTE.test(cod) && typeof pct === 'number') {
        pacotes.push({ codigo: cod, descricao: desc === 'sem desc.' ? '' : desc, percentual: pct });
      }
    });
  });

  // Alunos (linhas 8 a 52)
  var linhas = intervalo_(7, 51).filter(function (l) { return !vazio_(cel(l, 2)); });
  var ra = function (l) { return String(cel(l, 2)).trim(); };

  // Avaliações: N:Q (bimestral), S:BP (contínuas), BR:BU (recuperação)
  var avaliacoes = [];
  intervalo_(13, 16).concat(intervalo_(18, 67), intervalo_(69, 72)).forEach(function (c) {
    var cod = String(cel(4, c) || '').trim(), nome = String(cel(2, c) || '').trim();
    var notas = {}, qtd = 0;
    linhas.forEach(function (l) {
      var x = cel(l, c);
      if (vazio_(x)) return;
      if (typeof x === 'number') { notas[ra(l)] = x; }
      else {
        if (/^\s*\d+([.,]\d+)?\s*$/.test(String(x))) {
          avisos.push('B' + bimestre + ': nota digitada como texto ("' + x + '") em "' + nome + '" — tratada como não avaliado, igual à planilha');
        }
        notas[ra(l)] = '-';
      }
      qtd++;
    });
    if (!CODIGO_PACOTE.test(cod)) {
      if (qtd) avisos.push('B' + bimestre + ': coluna "' + (nome || c) + '" tem ' + qtd + ' notas mas não tem pacote — ignorada (a planilha também não conta)');
      return;
    }
    if (!qtd && !nome) return;
    var peso = cel(5, c);
    avaliacoes.push({ pacote: cod, nome: nome, data: dataIso_(cel(3, c)),
                      peso: typeof peso === 'number' ? peso : 0, notas: notas });
  });

  // Notas digitadas direto nas colunas H (Bimestral), I (Contínuas) ou J (Recuperação), por cima da fórmula:
  // vira uma avaliação própria, para o resultado ficar igual ao da planilha.
  [['B', 7, 'Prova Bimestral'], ['C', 8, 'Contínuas'], ['R', 9, 'Recuperação']].forEach(function (cfg) {
    var bloco = cfg[0], col = cfg[1];
    var comNota = {};
    avaliacoes.forEach(function (a) {
      if (a.pacote.charAt(0) !== bloco || !a.peso) return;
      Object.keys(a.notas).forEach(function (r) { if (typeof a.notas[r] === 'number') comNota[r] = true; });
    });
    var notas = {}, qtd = 0;
    linhas.forEach(function (l) {
      var x = cel(l, col);
      if (typeof x === 'number' && !comNota[ra(l)]) { notas[ra(l)] = x; qtd++; }
    });
    if (!qtd) return;
    var pac = pacotes.filter(function (p) { return p.codigo.charAt(0) === bloco && p.percentual > 0; })[0];
    if (!pac) { pac = { codigo: bloco + '1', descricao: cfg[2], percentual: 1 }; pacotes.push(pac); }
    avaliacoes.push({ pacote: pac.codigo, nome: cfg[2] + ' (digitada direto na coluna de média)', data: null, peso: 1, notas: notas });
    avisos.push('B' + bimestre + ': ' + qtd + ' notas de ' + cfg[2] + ' estavam digitadas direto na coluna de média — importadas como avaliação separada');
  });

  // Ajustes: K = Arredondamento, L = Conselho. G = Média Final (para conferência)
  var ajustes = [], finais = {};
  linhas.forEach(function (l) {
    var k = cel(l, 10), cons = cel(l, 11), g = cel(l, 6);
    if (typeof k === 'number' || typeof cons === 'number') {
      ajustes.push({ ra: ra(l), acrescimo: typeof k === 'number' ? k : null, conselho: typeof cons === 'number' ? cons : null });
    }
    if (typeof g === 'number') finais[ra(l)] = g;
  });

  return { bimestre: bimestre, pacotes: pacotes, avaliacoes: avaliacoes, ajustes: ajustes, finais: finais, avisos: avisos };
}

/* ---------------- Execução no Google ---------------- */
function lerIndice_() {
  if (!IMPORTACAO.INDICE_ID) throw new Error('Defina INDICE_ID nas Propriedades do script.');
  // série (B), matéria (C) e o link do arquivo (F) — só leitura, pela API do Sheets
  var r = Sheets.Spreadsheets.get(IMPORTACAO.INDICE_ID, {
    ranges: ['A1:F400'], fields: 'sheets(data(rowData(values(formattedValue,hyperlink))))'
  });
  var linhas = (((r.sheets || [])[0] || {}).data || [])[0];
  linhas = (linhas && linhas.rowData) || [];
  var vistos = {}, lista = [];
  for (var i = 1; i < linhas.length; i++) {
    var c = linhas[i].values || [];
    var url = c[5] && c[5].hyperlink;
    var id = url && (url.match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || vistos[id]) continue;
    vistos[id] = true;
    var m = String((c[1] && c[1].formattedValue) || '').match(/(\d)(º ano|ª série)\s*(\d)?/i);
    if (!m) continue;
    lista.push({ id: id, serie: m[1] + (/ano/i.test(m[2]) ? 'º ANO' : 'ª SÉRIE'), turma: Number(m[3] || 1),
                 materia: String((c[2] && c[2].formattedValue) || '').trim() });
  }
  return lista;
}

function importarNotas2026() {
  var inicio = Date.now();
  var props = PropertiesService.getScriptProperties();
  var feitos = JSON.parse(props.getProperty('IMPORTACAO_FEITOS') || '{}');
  var lista = lerIndice_();

  for (var i = 0; i < lista.length; i++) {
    var d = lista[i];
    if (feitos[d.id]) continue;
    if (Date.now() - inicio > IMPORTACAO.LIMITE_MS) { agendarContinuacao_(); return; }
    try {
      var bimestres = [];
      IMPORTACAO.ABAS_BIMESTRE.forEach(function (nome, idx) {
        var v;
        try { v = valores_(d.id, "'" + nome + "'!A1:BU86"); } catch (e) { return; }  // aba inexistente
        bimestres.push(lerAbaBimestre(v, idx + 1));
      });
      var r = supabaseRpc_('importar_diario', { p_ano: IMPORTACAO.ANO, p_serie: d.serie, p_turma: d.turma, p_materia: d.materia,
                                                p_dados: { bimestres: bimestres } });
      var conferidos = 0, divergencias = [];
      bimestres.forEach(function (b) {
        var c = supabaseRpc_('conferir_importacao', { p_diario: r.diario_id, p_bimestre: b.bimestre, p_finais: b.finais });
        conferidos += c.conferidos;
        c.divergencias.forEach(function (x) { divergencias.push('B' + b.bimestre + ' RA ' + x.ra + ': planilha ' + x.planilha + ' / sistema ' + x.sistema); });
      });
      var avisos = [].concat.apply(r.avisos || [], bimestres.map(function (b) { return b.avisos; }));
      supabaseRpc_('registrar_importacao', { p: { tipo: 'notas', serie: d.serie, turma: d.turma, materia: d.materia,
        avaliacoes: r.avaliacoes, notas: r.notas, conferidos: conferidos, divergencias: divergencias, avisos: avisos } });
      feitos[d.id] = true;
      props.setProperty('IMPORTACAO_FEITOS', JSON.stringify(feitos));
    } catch (e) {
      supabaseRpc_('registrar_importacao', { p: { tipo: 'notas', serie: d.serie, turma: d.turma, materia: d.materia, erro: e.message } });
      feitos[d.id] = true;
      props.setProperty('IMPORTACAO_FEITOS', JSON.stringify(feitos));
    }
  }
  removerContinuacao_();
  console.log('Importação concluída.');
}

/** Para reimportar tudo do zero. */
function reiniciarImportacao() { PropertiesService.getScriptProperties().deleteProperty('IMPORTACAO_FEITOS'); }

function agendarContinuacao_() {
  removerContinuacao_();
  ScriptApp.newTrigger('importarNotas2026').timeBased().after(60 * 1000).create();
}
function removerContinuacao_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'importarNotas2026'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

if (typeof module !== 'undefined') module.exports = { lerAbaBimestre: lerAbaBimestre };
