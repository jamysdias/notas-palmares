"""Gera a migration de estrutura (séries, turmas, matérias, áreas, diários e pesos) a partir
da Planilha Mestre 2026 e do índice. Não inclui nenhum dado pessoal."""
import json, re, sys, openpyxl
idx = json.load(open(sys.argv[1]))
wb = openpyxl.load_workbook(sys.argv[2], data_only=True)
dire = [[c.value for c in r] for r in wb['Diretrizes'].iter_rows(min_row=2) if r[0].value]

AREAS = ['Linguagens','Matemática','Ciência da Natureza','Ciência Humanas','Inglês','Ed. Física','Tecnologia']
SERIES = [('1º ANO','Fundamental I'),('2º ANO','Fundamental I'),('3º ANO','Fundamental I'),('4º ANO','Fundamental I'),
          ('5º ANO','Fundamental I'),('6º ANO','Fundamental II'),('7º ANO','Fundamental II'),('8º ANO','Fundamental II'),
          ('9º ANO','Fundamental II'),('1ª SÉRIE','Ensino Médio'),('2ª SÉRIE','Ensino Médio'),('3ª SÉRIE','Ensino Médio')]
ALIAS = {'Incubadora de projetos': 'Business Lab - Projetos, Mercado e Negócios'}

def serie_turma(label):
    m = re.match(r'(\d)(º ano|ª série)\s*(\d)?', label.strip())
    nome = f"{m.group(1)}{'º ANO' if 'ano' in m.group(2) else 'ª SÉRIE'}"
    return nome, int(m.group(3) or 1)

mat_area = {}
diarios = set()
for r in idx:
    mat_area[r['materia']] = r['area']
    s, t = serie_turma(r['serie']); diarios.add((s, t, r['materia']))

pesos = {}
for serie, turma, mat, pb, pc in dire:
    pesos[(serie.upper(), int(turma), ALIAS.get(mat, mat))] = (pb or 0, pc if pc is not None else 1)

def q(s): return "'" + s.replace("'", "''") + "'"
out = ["-- Estrutura 2026 gerada por scripts/gerar_seed_estrutura.py (sem dados pessoais)",
       "insert into public.areas (nome, ordem) values " + ", ".join(f"({q(a)}, {i})" for i, a in enumerate(AREAS)) + " on conflict (nome) do nothing;",
       "insert into public.series (nome, segmento, ordem) values " + ", ".join(f"({q(s)}, {q(g)}, {i})" for i, (s, g) in enumerate(SERIES)) + " on conflict (nome) do nothing;",
       "insert into public.materias (nome, area_id) values " + ",\n  ".join(f"({q(m)}, (select id from public.areas where nome = {q(a)}))" for m, a in sorted(mat_area.items())) + " on conflict (nome) do nothing;"]
turmas = sorted({(s, t) for s, t, _ in diarios})
out.append("insert into public.turmas (ano, serie_id, numero) values " + ",\n  ".join(f"(2026, (select id from public.series where nome = {q(s)}), {t})" for s, t in turmas) + " on conflict do nothing;")
faltando = []
rows = []
for s, t, m in sorted(diarios):
    p = pesos.get((s, t, m)) or pesos.get((s, 1, m))
    if p is None: faltando.append((s, t, m)); p = (0, 1)
    rows.append(f"((select tu.id from public.turmas tu join public.series se on se.id = tu.serie_id where tu.ano = 2026 and se.nome = {q(s)} and tu.numero = {t}), (select id from public.materias where nome = {q(m)}), {p[0]}, {p[1]})")
out.append("insert into public.diarios (turma_id, materia_id, peso_bimestral, peso_continuas) values\n  " + ",\n  ".join(rows) + "\non conflict (turma_id, materia_id) do nothing;")
out.append("insert into public.periodos (ano, bimestre) select 2026, b from generate_series(1,4) b on conflict do nothing;")
open(sys.argv[3], 'w').write("\n\n".join(out) + "\n")
print('diarios', len(diarios), 'turmas', len(turmas), 'materias', len(mat_area), 'sem peso nas Diretrizes:', faltando)
