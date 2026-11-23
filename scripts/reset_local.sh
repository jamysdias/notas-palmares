#!/bin/bash
# (teste local) recria o banco local e aplica stub + migrations
set -e
pkill -f "postgrest /tmp/pgrst.conf" 2>/dev/null || true
P="psql -h /tmp -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists notas" -c "create database notas"
$P -d notas -f "$(dirname $0)/../supabase/tests/00_stub_supabase.sql"
for f in "$(dirname $0)"/../supabase/migrations/*.sql; do $P -d notas -f "$f"; done
echo "banco local recriado"
