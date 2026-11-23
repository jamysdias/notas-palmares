"""(teste local) Converte abas de planilhas exportadas em matrizes de valores, como getValues() do Apps Script."""
import sys, json, datetime, openpyxl
src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)
out = {}
for ws in wb.worksheets:
    if 'ºB' not in ws.title and ws.title != 'Alunos': continue
    rows = []
    for r in ws.iter_rows(min_row=1, max_row=max(ws.max_row, 86), max_col=73):
        row = []
        for c in r:
            v = c.value
            if isinstance(v, (datetime.datetime, datetime.date)): v = v.strftime('%Y-%m-%d')
            row.append('' if v is None else v)
        rows.append(row)
    out[ws.title] = rows
json.dump(out, open(dst, 'w'), ensure_ascii=False)
