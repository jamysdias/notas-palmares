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
  ABA: 'Alunos longo',      // nome da aba com a lista de alunos
  LINHA_INICIAL: 2,         // primeira linha com aluno
  ANO_LETIVO: 2026,         // ano letivo da lista
  // colunas (A=1, B=2, ...)
  COL_NUMERO: 1, COL_RA: 2, COL_NOME: 3, COL_SERIE: 4, COL_TURMA: 5, COL_SITUACAO: 6
};

function lerAlunosDaPlanilha_() {
  var id = PropertiesService.getScriptProperties().getProperty('ALUNOS_PLANILHA_ID');
  if (!id) throw new Error('Defina ALUNOS_PLANILHA_ID nas Propriedades do script.');
  var aba = SpreadsheetApp.openById(id).getSheetByName(ALUNOS.ABA);
  if (!aba) throw new Error('Aba "' + ALUNOS.ABA + '" não encontrada.');
  var n = aba.getLastRow() - ALUNOS.LINHA_INICIAL + 1;
  if (n <= 0) return [];
  var valores = aba.getRange(ALUNOS.LINHA_INICIAL, 1, n, aba.getLastColumn()).getValues();
  return valores
    .filter(function (l) { return String(l[ALUNOS.COL_RA - 1]).trim() && String(l[ALUNOS.COL_NOME - 1]).trim(); })
    .map(function (l) {
      return {
        ra: String(l[ALUNOS.COL_RA - 1]).trim(),
        nome: String(l[ALUNOS.COL_NOME - 1]).trim(),
        serie: String(l[ALUNOS.COL_SERIE - 1]).trim(),
        turma: String(l[ALUNOS.COL_TURMA - 1] || '1').trim(),
        numero: String(l[ALUNOS.COL_NUMERO - 1] || '').trim(),
        situacao: String(l[ALUNOS.COL_SITUACAO - 1] || '').trim()
      };
    });
}

function sincronizarAlunos() {
  var alunos = lerAlunosDaPlanilha_();
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
