/**
 * Notas Palmares — conexão com o Supabase.
 *
 * Configure UMA vez em: Configurações do projeto (engrenagem) → Propriedades do script
 *   SUPABASE_URL          ex.: https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  chave "service_role" (Supabase → Project Settings → API).
 * Essa chave dá acesso total ao banco: nunca coloque no código nem compartilhe.
 */
function supabaseRpc_(funcao, args) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_KEY nas Propriedades do script.');
  }
  var resp = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + funcao, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code >= 300) throw new Error('Supabase ' + funcao + ' (' + code + '): ' + body);
  return body ? JSON.parse(body) : null;
}

/**
 * Leitura de planilhas SOMENTE pela API do Google Sheets com permissão de leitura
 * (spreadsheets.readonly). O SpreadsheetApp não é usado porque exigiria permissão de edição.
 */
function valores_(planilhaId, intervalo) {
  var r = Sheets.Spreadsheets.Values.get(planilhaId, intervalo, {
    valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return r.values || [];
}
