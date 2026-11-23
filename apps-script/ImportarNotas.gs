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

/** Detecta onde está cada parte da aba (algumas planilhas tiveram colunas apagadas). */
function layoutAba_(v) {
  var txt = function (l, c) { return String((v[l] && v[l][c]) || '').trim().toUpperCase(); };
  var linha2 = v[1] || [], ini = {};
  for (var c = 0; c < Math.max(linha2.length, 80); c++) {
    var t = txt(1, c);
    if (t.indexOf('AVALIAÇÕES BIMESTRAIS') === 0) ini.B = c;
    else if (t.indexOf('AVALIAÇÕES CONTÍNUAS') === 0) ini.C = c;
    else if (t.indexOf('RECUPERAÇÃO') === 0) ini.R = c;
  }
  if (ini.B === undefined) ini.B = 13;
  if (ini.C === undefined) ini.C = 18;
  if (ini.R === undefined) ini.R = 69;
  // colunas de resultado pelo título da linha 3 (algumas planilhas não têm "Arredondamento")
  var nomes = { 'MÉDIA FINAL': 'G', 'PROVA BIMESTRAL': 'H', 'CONTÍNUAS': 'I', 'RECUPERAÇÃO': 'J', 'ARREDONDAMENTO': 'K', 'CONSELHO': 'L' };
  var col = {};
  for (var c2 = 0; c2 < 14; c2++) { var n = nomes[txt(2, c2)]; if (n && col[n] === undefined) col[n] = c2; }
  if (col.G === undefined) col = { G: 6, H: 7, I: 8, J: 9, K: 10, L: 11 };
  ['H', 'I', 'J', 'K', 'L'].forEach(function (k) { if (col[k] === undefined) col[k] = -1; });
  var faixas = {}, fimAlunos = 51;
  for (var l = 40; l < v.length; l++) {
    var b = txt(l, 1);
    if (b === 'PACOTES' && fimAlunos === 51) fimAlunos = l - 2;
    if (b === 'BIMESTRAL') faixas.B = l + 1;
    if (b === 'CONTÍNUAS') faixas.C = l + 1;
    if (b === 'RECUPERAÇÃO') faixas.R = l + 1;
  }
  return {
    colunas: { B: intervalo_(ini.B, ini.B + 3), C: intervalo_(ini.C, ini.R - 2), R: intervalo_(ini.R, ini.R + 3) },
    col: col, fimAlunos: fimAlunos,
    faixasPacotes: [[faixas.B || 61, 4], [faixas.C || 70, 6], [faixas.R || 80, 4]]
  };
}

/** Nota de um bloco igual à fórmula da planilha (média ponderada por pacote, renormalizada). */
function notaBloco_(avaliacoes, pacotes, bloco, ra) {
  var pct = {}; pacotes.forEach(function (p) { pct[p.codigo] = p.percentual; });
  var porPac = {};
  avaliacoes.forEach(function (a) {
    if (a.pacote.charAt(0) !== bloco) return;
    var x = a.notas[ra];
    if (typeof x !== 'number') return;
    var g = porPac[a.pacote] || (porPac[a.pacote] = { p: 0, n: 0 });
    g.p += a.peso; g.n += x * a.peso;
  });
  var num = 0, den = 0;
  Object.keys(porPac).forEach(function (k) {
    var g = porPac[k];
    if (g.p > 0) { num += (g.n / g.p) * (pct[k] || 0); den += (pct[k] || 0); }
  });
  return den > 0 ? num / den : null;
}

/**
 * @param {Array<Array<*>>} v valores da aba A1:BU86 (API do Sheets, sem formatação)
 * @param {number} bimestre 1–4
 */
function lerAbaBimestre(v, bimestre) {
  var avisos = [];
  var cel = function (l, c) { return (v[l] && v[l][c] !== undefined) ? v[l][c] : null; };
  var lay = layoutAba_(v);

  // Pacotes
  var pacotes = [];
  lay.faixasPacotes.forEach(function (f) {
    intervalo_(f[0], f[0] + f[1] - 1).forEach(function (l) {
      var cod = String(cel(l, 1) || '').trim(), pct = cel(l, 3), desc = String(cel(l, 2) || '').trim();
      if (CODIGO_PACOTE.test(cod) && typeof pct === 'number') {
        pacotes.push({ codigo: cod, descricao: desc === 'sem desc.' ? '' : desc, percentual: pct });
      }
    });
  });

  // Alunos
  var linhas = intervalo_(7, lay.fimAlunos).filter(function (l) { return !vazio_(cel(l, 2)); });
  var ra = function (l) { return String(cel(l, 2)).trim(); };

  // Avaliações
  var avaliacoes = [];
  lay.colunas.B.concat(lay.colunas.C, lay.colunas.R).forEach(function (c) {
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

  // Ajustes, notas de bloco digitadas por cima da fórmula e média final (para conferência)
  var ajustes = [], finais = {}, informadas = 0;
  linhas.forEach(function (l) {
    var r = ra(l), aj = { ra: r };
    var k = cel(l, lay.col.K), cons = cel(l, lay.col.L), g = cel(l, lay.col.G);
    if (typeof k === 'number') aj.acrescimo = k;
    if (typeof cons === 'number') aj.conselho = cons;
    var ignorados = '';
    [['B', 'H', 'bimestral_informada'], ['C', 'I', 'continuas_informada'], ['R', 'J', 'recuperacao_informada']].forEach(function (x) {
      var naPlanilha = cel(l, lay.col[x[1]]);
      if (typeof naPlanilha === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(naPlanilha)) naPlanilha = Number(naPlanilha.replace(',', '.'));
      var calculado = notaBloco_(avaliacoes, pacotes, x[0], r);
      if (typeof naPlanilha !== 'number') {
        // bloco vazio na planilha, mas com notas lançadas: a planilha não considerou esse bloco
        if (calculado !== null && typeof g === 'number') { ignorados += x[0]; informadas++; }
        return;
      }
      if (calculado === null || Math.abs(calculado - naPlanilha) > 0.005) { aj[x[2]] = naPlanilha; informadas++; }
    });
    if (ignorados) aj.blocos_ignorados = ignorados;
    if (Object.keys(aj).length > 1) ajustes.push(aj);
    if (typeof g === 'number') finais[r] = g;
  });
  if (informadas) avisos.push('B' + bimestre + ': ' + informadas + ' nota(s) de bloco estavam digitadas direto na coluna de média — mantidas como "valor informado na planilha"');

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
      var intervalos = IMPORTACAO.ABAS_BIMESTRE.map(function (nome) { return "'" + nome + "'!A1:BU86"; });
      var lidos = valoresVarios_(d.id, intervalos);
      var bimestres = [];
      intervalos.forEach(function (iv, idx) { if (lidos[iv]) bimestres.push(lerAbaBimestre(lidos[iv], idx + 1)); });
      if (!bimestres.length) throw new Error('Nenhuma aba de bimestre encontrada na planilha (nada foi alterado no sistema)');
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
