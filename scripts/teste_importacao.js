// (teste local) Simula o Apps Script: lê abas exportadas, importa no Postgres local e confere médias.
// uso: node scripts/teste_importacao.js <alunos.json> <arquivo.json:serie:turma:materia> ...
const { execFileSync } = require('child_process');
const fs = require('fs');
const { lerAbaBimestre } = require('../apps-script/ImportarNotas.gs');
const PSQL = ['-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'notas', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars = {}) => {
  const args = [...PSQL];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('psql', [...args, '-c', q], { maxBuffer: 1 << 28 }).toString().trim();
};
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const [alunosFile, ...diarios] = process.argv.slice(2);
const alunos = JSON.parse(fs.readFileSync(alunosFile));
console.log('sync:', sql(`set role service_role; select public.sync_alunos(2026, ${lit(JSON.stringify(alunos))}::jsonb) - 'erros'`));
for (const spec of diarios) {
  const [file, serie, turma, materia] = spec.split(':');
  const abas = JSON.parse(fs.readFileSync(file));
  const bims = ['1ºB', '2ºB', '3ºB', '4ºB'].map((n, i) => abas[n] && lerAbaBimestre(abas[n], i + 1)).filter(Boolean);
  const r = JSON.parse(sql(`set role service_role; select public.importar_diario(2026, ${lit(serie)}, ${turma}::smallint, ${lit(materia)}, ${lit(JSON.stringify({ bimestres: bims }))}::jsonb)`).split('\n').pop());
  console.log(`\n== ${serie} t${turma} ${materia}: diário ${r.diario_id}, ${r.avaliacoes} avaliações, ${r.notas} notas`);
  for (const a of [...r.avisos, ...bims.flatMap(b => b.avisos)]) console.log('   aviso:', a);
  for (const b of bims) {
    const c = JSON.parse(sql(`set role service_role; select public.conferir_importacao(${r.diario_id}, ${b.bimestre}::smallint, ${lit(JSON.stringify(b.finais))}::jsonb)`).split('\n').pop());
    console.log(`   B${b.bimestre}: conferidos ${c.conferidos}, divergências ${c.divergencias.length}`, c.divergencias.length ? JSON.stringify(c.divergencias.slice(0, 5)) : '');
  }
}
