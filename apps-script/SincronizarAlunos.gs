/**
 * Notas Palmares — sincronização da base de alunos (planilha → sistema).
 * A planilha continua sendo a fonte oficial: cadastre e altere alunos nela.
 *
 * Instale este script NA PLANILHA DE ALUNOS (Extensões → Apps Script).
 * Depois rode "instalarRotinaDiaria" uma vez para sincronizar automaticamente todo dia.
 */
var ALUNOS = {
  ABA: 'Alunos longo',      // nome da aba com a lista de alunos
  LINHA_INICIAL: 2,         // primeira linha com aluno
  ANO_LETIVO: 2026,         // ano letivo da lista
  // colunas (A=1, B=2, ...)
  COL_NUMERO: 1, COL_RA: 2, COL_NOME: 3, COL_SERIE: 4, COL_TURMA: 5, COL_SITUACAO: 6
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Notas Palmares')
    .addItem('Sincronizar alunos agora', 'sincronizarAlunos')
    .addItem('Ativar sincronização diária', 'instalarRotinaDiaria')
    .addToUi();
}

function lerAlunosDaPlanilha_() {
  var aba = SpreadsheetApp.getActive().getSheetByName(ALUNOS.ABA);
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
  var msg = 'Alunos processados: ' + r.processados + ' | no sistema: ' + r.total_no_banco +
            (r.turmas_novas.length ? '\nTurmas criadas: ' + r.turmas_novas.join(', ') : '') +
            (r.erros.length ? '\nProblemas (' + r.erros.length + '):\n' +
              r.erros.slice(0, 15).map(function (e) { return '- ' + e.erro + ' (' + (e.item.nome || e.item.ra) + ')'; }).join('\n') : '');
  console.log(msg);
  try { SpreadsheetApp.getUi().alert('Sincronização concluída', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* execução automática */ }
  return r;
}

/** Sincroniza todo dia de madrugada (também mantém o banco gratuito ativo nas férias). */
function instalarRotinaDiaria() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sincronizarAlunos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizarAlunos').timeBased().everyDays(1).atHour(5).create();
  try { SpreadsheetApp.getUi().alert('Sincronização diária ativada (todo dia por volta das 5h).'); } catch (e) {}
}
