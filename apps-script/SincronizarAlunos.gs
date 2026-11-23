/**
 * Notas Palmares — sincronização da base de alunos (planilha → sistema).
 *
 * Projeto Apps Script SEPARADO (script.google.com → Novo projeto), não vinculado a nenhuma planilha.
 * O arquivo appsscript.json limita o script a LEITURA de planilhas: ele não consegue alterar
 * nenhuma planilha, nem a de alunos nem as de notas.
 *
 * Propriedades do script (Configurações do projeto → Propriedades do script):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, ALUNOS_PLANILHA_ID
 * Rode "sincronizarAlunos" uma vez e depois "instalarRotinaDiaria".
 */
var ALUNOS = {
  ABA: 'Alunos',            // aba da Base Escolar
  LINHA_INICIAL: 2,         // primeira linha com aluno
  ANO_LETIVO: 2026,         // ano letivo da lista
  // colunas (A=1, B=2, ...): RA | Nome_Aluno | Turma (ex.: "6º ANO A") | Segmento | Email_Aluno | Ativo (SIM/NÃO)
  COL_RA: 1, COL_NOME: 2, COL_TURMA: 3, COL_ATIVO: 6
};

/** "6º ANO A" → {serie: "6º ANO", turma: 1};  "2ª SÉRIE B" → {serie: "2ª SÉRIE", turma: 2} */
function separarTurma_(txt) {
  var m = String(txt || '').trim().toUpperCase().match(/^(\d+\s*[ºª°]\s*(ANO|SÉRIE|SERIE))\s*([A-Z]|\d+)?$/);
  if (!m) return null;
  var serie = m[1].replace(/\s+/g, ' ').replace('°', 'º').replace(/(\d)\s*([ºª])/, '$1$2').replace('SERIE', 'SÉRIE');
  var t = m[3] || 'A';
  return { serie: serie, turma: /\d/.test(t) ? Number(t) : t.charCodeAt(0) - 64 };
}

function lerAlunosDaPlanilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('ALUNOS_PLANILHA_ID');
  if (!id) throw new Error('Defina ALUNOS_PLANILHA_ID nas Propriedades do script.');
  // lê só as colunas necessárias (RA até Ativo) — dados de responsáveis não são lidos
  var valores = valores_(id, "'" + ALUNOS.ABA + "'!A" + ALUNOS.LINHA_INICIAL + ':F');
  var lista = [];
  valores.forEach(function (l) {
    var ra = String(l[ALUNOS.COL_RA - 1] || '').trim(), nome = String(l[ALUNOS.COL_NOME - 1] || '').trim();
    if (!ra || !nome) return;
    var t = separarTurma_(l[ALUNOS.COL_TURMA - 1]) || { serie: String(l[ALUNOS.COL_TURMA - 1]), turma: 1 };
    var ativo = String(l[ALUNOS.COL_ATIVO - 1] || '').trim().toUpperCase();
    lista.push({ ra: ra, nome: nome, serie: t.serie, turma: String(t.turma), numero: '',
                 situacao: ativo === 'NÃO' || ativo === 'NAO' ? 'Transferido' : 'Ativo' });
  });
  return lista;
}

/**
 * (Somente teste/apresentação) Fundamental I (1º ao 5º ano) vindo da Planilha Mestre 2026,
 * aba "Alunos longo" (nº | RA | nome | série | turma | situação). Só LEITURA.
 * Ativado quando a propriedade MESTRE_ID está preenchida.
 */
function lerFundamentalIMestre_() {
  var id = PropertiesService.getScriptProperties().getProperty('MESTRE_ID');
  if (!id) return [];
  return valores_(id, "'Alunos longo'!A2:F")
    .filter(function (l) { return String(l[1] || '').trim() && String(l[2] || '').trim() && /^[1-5]º ANO$/i.test(String(l[3] || '').trim()); })
    .map(function (l) {
      return { ra: String(l[1]).trim(), nome: String(l[2]).trim(), serie: String(l[3]).trim().toUpperCase(),
               turma: String(l[4] || '1').trim(), numero: String(l[0] || '').trim(),
               situacao: /transferid/i.test(String(l[5] || '')) ? 'Transferido' : 'Ativo' };
    });
}

function sincronizarAlunos() {
  var alunos = lerAlunosDaPlanilha_().concat(lerFundamentalIMestre_());
  var r = supabaseRpc_('sync_alunos', { p_ano: ALUNOS.ANO_LETIVO, p_alunos: alunos });
  supabaseRpc_('registrar_importacao', { p: { tipo: 'alunos', avaliacoes: null, notas: r.processados,
    avisos: r.erros.map(function (e) { return e.erro + ' (' + (e.item.nome || e.item.ra) + ')'; }).concat(r.turmas_novas.map(function (t) { return 'Turma criada: ' + t; })) } });
  console.log('Alunos processados: ' + r.processados + ' | no sistema: ' + r.total_no_banco + ' | problemas: ' + r.erros.length);
  return r;
}

/** Sincroniza todo dia de madrugada (também mantém o banco gratuito ativo nas férias). */
function instalarRotinaDiaria() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sincronizarAlunos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizarAlunos').timeBased().everyDays(1).atHour(5).create();
  console.log('Sincronização diária ativada (todo dia por volta das 5h).');
}

if (typeof module !== 'undefined') module.exports = { separarTurma_: separarTurma_ };
