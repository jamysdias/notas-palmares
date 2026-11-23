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
 * Respeita o limite de leituras por minuto do Google (espera e tenta de novo).
 */
function comRetentativa_(fn) {
  for (var t = 0; t < 6; t++) {
    try { return fn(); } catch (e) {
      var msg = String(e && e.message);
      if (!/quota|rate|429|limit|Limite|cota|backend|503|500/i.test(msg) || t === 5) throw e;
      Utilities.sleep(Math.min(60000, 5000 * Math.pow(2, t)));
    }
  }
}
function valores_(planilhaId, intervalo) {
  var r = comRetentativa_(function () {
    return Sheets.Spreadsheets.Values.get(planilhaId, intervalo, {
      valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
  });
  return r.values || [];
}
/** Lê várias abas em uma única chamada. Retorna {intervalo: valores}; abas inexistentes ficam de fora. */
function valoresVarios_(planilhaId, intervalos) {
  try {
    var r = comRetentativa_(function () {
      return Sheets.Spreadsheets.Values.batchGet(planilhaId, {
        ranges: intervalos, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
    });
    var out = {};
    (r.valueRanges || []).forEach(function (vr, i) { out[intervalos[i]] = vr.values || []; });
    return out;
  } catch (e) {
    if (!/Unable to parse range|parse/i.test(String(e && e.message))) throw e;
    // alguma aba não existe: lê uma a uma
    var out2 = {};
    intervalos.forEach(function (iv) {
      try { out2[iv] = valores_(planilhaId, iv); } catch (e2) {
        if (!/Unable to parse range|parse/i.test(String(e2 && e2.message))) throw e2;
      }
    });
    return out2;
  }
}
