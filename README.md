# Notas Palmares

Sistema de lançamento de notas do Colégio Palmares.

## Tecnologias

- **Banco e login:** Supabase (Postgres + login Google).
- **Site:** React, publicado no GitHub Pages.
- **Alunos:** continuam na planilha Google. Um Apps Script sincroniza a planilha com o banco.

Nenhum dado de aluno ou nota fica neste repositório. Todas as permissões são verificadas no banco, pelas regras de RLS e pelas funções em `supabase/migrations`.

## Perfis

| Perfil | Vê | Pode alterar |
|---|---|---|
| Professor | Os diários atribuídos a ele | Notas, avaliações, pacotes e acréscimo (0,1–0,9), só com o bimestre aberto |
| Coordenador de série | Todas as matérias das suas séries | Tudo o que o professor pode, mesmo com o bimestre fechado, e também conselho e bônus (até 10, com justificativa) |
| Coordenador de área | As matérias da sua área em todas as séries | O mesmo que o coordenador de série |
| Administrador | Tudo | Tudo, mais usuários, atribuições, prazos, pesos e "ver como" (demonstração) |

## Cálculo (igual ao das planilhas de 2026)

1. **Pacote:** média ponderada, pelo peso, das avaliações do pacote.
2. **Bloco:** Σ(nota do pacote × %) ÷ Σ(% dos pacotes que já têm nota).
3. **Média calculada:** Bimestral × peso + Contínuas × peso.
4. **Recuperação:** só vale se a média for menor que 50. O resultado é o maior valor entre a média e a recuperação, com limite de 50.
5. **Conselho:** substitui o resultado.
6. **Acréscimo e bônus:** são somados ao resultado, com limite de 100.
7. **Média anual:** média simples dos bimestres.

Nenhuma etapa apaga a anterior. A coordenação vê a composição completa e o histórico de cada nota.

Validação feita: o cálculo foi conferido contra 4 planilhas reais de 2026, num total de 15 bimestres e 529 médias de alunos, sem nenhuma divergência.

## Publicação

Cada `push` na branch `main` dispara o workflow **Publicar**, que:

1. aplica as migrations no Supabase;
2. garante o administrador inicial;
3. gera o site e publica no GitHub Pages.

A URL do projeto e a anon key (públicas por natureza) ficam em `app/.env.production`.

Secrets necessários no repositório (Settings → Secrets and variables → Actions):

| Secret | O que é |
|---|---|
| `SUPABASE_PROJECT_REF` | Código do projeto (o trecho XXXX da URL do painel) |
| `SUPABASE_DB_PASSWORD` | Senha do banco |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens |
| `ADMIN_EMAIL` | Seu e-mail, que vira o primeiro administrador |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credencial do login Google (passo a passo abaixo) |

### Login com Google

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto, com a conta da escola.
2. Em **APIs e serviços → Tela de consentimento OAuth**, escolha o tipo **Interno**. Assim, só contas @colegiopalmares.com.br conseguem entrar.
3. Em **Credenciais → Criar credenciais → ID do cliente OAuth**:
   - tipo **Aplicativo da Web**;
   - em URI de redirecionamento autorizado, use `https://XXXX.supabase.co/auth/v1/callback`.
4. Cadastre `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` nos secrets do repositório.
5. Na aba **Actions**, rode o workflow **Configurar login Google**. Ele ativa o Google no Supabase e libera a URL do site.

## Apps Script (alunos e importação de 2026)

Crie um projeto **separado** em script.google.com → Novo projeto. Ele não fica vinculado a nenhuma planilha.

1. Copie os arquivos da pasta `apps-script/` para o projeto, incluindo o `appsscript.json`. Para editar o `appsscript.json`, ative em Configurações do projeto → "Mostrar arquivo de manifesto".
2. Esse manifesto limita o script a **somente leitura** de planilhas. O Google não deixa o script alterar nenhuma planilha.
3. Em Configurações do projeto → Propriedades do script, cadastre:

| Propriedade | Valor |
|---|---|
| `SUPABASE_URL` | A Project URL |
| `SUPABASE_SERVICE_KEY` | A chave `service_role`. Ela dá acesso total ao banco: nunca a compartilhe. |
| `ALUNOS_PLANILHA_ID` | O ID da planilha "Base Escolar — Colégio Palmares" (aba Alunos) |
| `INDICE_ID` | O ID da planilha "Acesso às Planilhas de Notas" (só para importar 2026) |
| `MESTRE_ID` | (Opcional, teste) O ID da "Planilha Mestre_2026": traz o Fundamental I, que não está na Base Escolar |

Uso:

- **`sincronizarAlunos`:** copia os alunos para o sistema.
- **`instalarRotinaDiaria`:** sincroniza todo dia às 5h. Isso também mantém o banco gratuito ativo.
- **`importarNotas2026`:** copia as notas de 2026 e confere cada média com a planilha. O relatório aparece em Administração → Importação.

## Testes locais

```bash
./scripts/reset_local.sh                       # recria o banco local (Postgres 16)
node scripts/teste_importacao.js ...           # importa planilhas exportadas e confere médias
psql ... -f supabase/tests/10_permissoes.sql   # testes de permissão
```
