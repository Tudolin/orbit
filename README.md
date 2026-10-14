# NEXUS — Segundo Cérebro

PWA **mobile-first** (com suporte desktop) para agenda unificada, tasks/kanban e base de conhecimento ("Segundo Cérebro") de múltiplos workspaces. Estética **Dark Bauhaus**: OLED `#0D0D0D`, grade rígida, linhas `#222222`, acentos funcionais.

| Cor | Uso |
|---|---|
| 🔴 `#FF3B30` | Alta prioridade / urgente / deadlines |
| 🔵 `#0A84FF` | Reuniões / eventos |
| 🟡 `#FFCC00` | Notas de contexto / Segundo Cérebro |
| 🟢 `#30D158` | Concluído / OK |
| 🟠 `#FF9F0A` | Em andamento / cards Jira |

## Rodar

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build PWA em dist/
npm run preview
```

## Publicar na Vercel + sincronizar (celular ↔ computador)

**1. Supabase (nuvem dos dados, plano gratuito)**
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, cole e rode o conteúdo de [`supabase/schema.sql`](supabase/schema.sql).
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
4. (Opcional) Em **Authentication → Sign In / Providers → Email**, desligue "Confirm email" para não precisar confirmar a conta por e-mail.

**2. Vercel (hospedagem, plano gratuito)**
1. Em [vercel.com](https://vercel.com) → **Add New → Project**, importe este repositório. O preset **Vite** é detectado sozinho.
2. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
3. Clique em **Deploy**. Cada push no branch publicado gera um novo deploy.

**3. Em cada aparelho**
1. Abra a URL da Vercel. No celular, use "Adicionar à tela inicial".
2. Vá em **Config → Sincronização** e crie a conta (no primeiro aparelho) ou entre com ela (nos demais).
3. Informe a `ANTHROPIC_API_KEY` em **um** aparelho e toque em Salvar. Os outros aparelhos a recebem cifrada ao entrar na conta.

> No iPhone, o app da tela inicial e o Safari têm armazenamentos separados: entre na conta nos dois se usar ambos.

> Atualizou o app? Rode `supabase/schema.sql` de novo no SQL Editor. O script pode ser executado várias vezes e libera as tabelas novas.

## Instalar como app no Android (sem navegador)

1. Abra a URL da Vercel no **Chrome** ou no **Samsung Internet**.
2. Toque em **Instalar NEXUS** (banner na Inbox ou em Config). Se o botão não aparecer, use o menu:
   - Chrome: **⋮ → Instalar app**
   - Samsung Internet: **☰ → Adicionar página a → Tela inicial**
3. O Android cria um **WebAPK**: um app instalado de verdade, com ícone na gaveta de apps, tela cheia e sem barra do navegador. Ele aparece no menu Compartilhar e tem atalhos ao segurar o ícone (Captura rápida, Hoje, Busca). Ele também se atualiza sozinho a cada deploy.

**APK para instalar manualmente ou publicar na Play Store (opcional):** em [pwabuilder.com](https://www.pwabuilder.com), informe a URL da Vercel e gere o pacote Android (Trusted Web Activity). Depois, coloque o `assetlinks.json` gerado em `public/.well-known/assetlinks.json` e faça o deploy, para o app abrir sem barra de endereço. A digital continua funcionando, porque o pacote roda sobre o Chrome.

Câmera, microfone e service worker exigem HTTPS (a Vercel já fornece).

## Como funciona

1. **Inbox / Quick Capture**: texto, links, fotos (câmera ou galeria), prints colados com Ctrl+V e áudio. No Android, o NEXUS aparece no menu "Compartilhar" para textos e links.
2. **Engine Claude**: cada captura vai para a Messages API com o system prompt do NEXUS e **structured outputs**, então a resposta sempre segue o schema JSON. O app também envia o contexto do dispositivo (data, fuso, workspaces existentes) para resolver "amanhã às 9h" e sugerir o workspace certo.
3. **Triagem**: cada tarefa e evento recebe **o próprio workspace**, escolhido pelo nome ou pelas **palavras-chave** do workspace (Áreas → Editar). O app valida os nomes devolvidos pela IA (nome desconhecido vira "sem workspace") e recalcula o workspace principal no código: um só workspace, ou `multi`.
   - **≈ prazo / ≈ prioridade / ≈ workspace**: o valor foi inferido pela IA. Toque para confirmar ou edite o campo.
   - **Itens sem workspace** ficam em vermelho e bloqueiam o **Aprovar**.
   - **Dividir por workspace** (só em capturas `multi`): cria uma nota por workspace ("<título> — <workspace>"), todas apontando para a mesma captura, e arquiva a original como `#status/dividida`.
   - Se a IA devolver JSON inválido, o app reprocessa uma vez. Na segunda falha, a captura vira uma nota simples sem tarefas.
   - Prazos são resolvidos a partir do **momento da captura** ("essa semana" → sexta, 18:00), mesmo que você processe depois.
4. **Visões**: Hoje (timeline + prioridades + entregas), Semana (matriz workspace × dia com volume por cor), Workspaces (Agenda, Kanban, Cérebro) e Busca (palavras-chave + `#tags` + filtro por workspace).

## Dados e sincronização

Cada aparelho guarda tudo no **IndexedDB** (Dexie), então o app abre e funciona offline. Com a sincronização ligada, a nuvem Supabase vira o ponto de encontro:

- **Envio**: toda criação, edição ou exclusão é carimbada (`updatedAt`) e sobe em ~1,5 s. Exclusões viram *tombstones*.
- **Recebimento**: o Supabase Realtime avisa os outros aparelhos na hora. Também há sincronização ao abrir o app, ao voltar a conexão e a cada 2 min.
- **Conflitos**: vence a última edição (*last-write-wins* por registro). Um trigger no banco recusa versões mais antigas.
- **Segurança**: Row Level Security, ou seja, cada conta só lê e grava os próprios registros.
- **Chaves de API e preferências da engine**: sincronizadas com **criptografia de ponta a ponta**. A chave AES-256-GCM é derivada da senha da conta (PBKDF2, 310 mil iterações) em cada aparelho e nunca sai dele. Na nuvem fica só o texto cifrado.
- **O que não sincroniza**: PIN, digital e bloqueio (são de cada aparelho) e a configuração do Supabase.

O **Exportar/Importar backup** (JSON) continua disponível como cópia extra.

## Segurança

- **Bloqueio do app**: no primeiro acesso, cada aparelho cria um **PIN** de 4 a 8 dígitos. Nada do app aparece antes do desbloqueio.
- **Digital / biometria** (WebAuthn, autenticador da plataforma): leitor de digital do Samsung e de outros Androids, Face ID / Touch ID e Windows Hello. A assinatura é verificada no próprio app contra a chave pública cadastrada.
- **Bloqueio automático** ao sair do app ou após 1, 5 ou 15 minutos em segundo plano, além do botão 🔒 na barra superior.
- **PIN** guardado só como hash PBKDF2-SHA256 com salt. Depois de 5 erros, há uma espera obrigatória que dobra a cada nova tentativa errada.
- **Esqueci o PIN**: apaga os dados e a sessão da nuvem deste aparelho. Para recuperar, crie um PIN novo e entre na conta de sincronização com a senha.
- **Cabeçalhos HTTP** (vercel.json): HSTS, `X-Frame-Options: DENY`, `nosniff` e `Permissions-Policy`.

O bloqueio protege o acesso pelo aparelho. Os dados na nuvem são protegidos pela conta Supabase (RLS).

## Configuração

- **ANTHROPIC_API_KEY**: inserida em Config e enviada direto do navegador para `api.anthropic.com`. Com a sincronização ligada, ela vai cifrada para os outros aparelhos. Se você trocar a senha da conta, salve a chave de novo para regravar o cofre. Use uma chave dedicada com limite de gasto.
- **Modelo**: Claude Opus 5.5 (padrão), Sonnet 5.5 ou Haiku 5.5. Esforço padrão: médio.
- **Fallback em recusas**: Opus e Sonnet usam `fallbacks: "default"` (server-side), para que uma recusa falso-positiva seja refeita em outro modelo.
- **Áudio**: transcrição ao vivo pela Web Speech API (Chrome/Edge/Safari). Opcionalmente, com uma chave OpenAI, o áudio gravado vai para o Whisper (`whisper-1`).

## Estrutura

```
src/
  db.ts              schema IndexedDB, distribuição de capturas, backup
  engine.ts          chamada Claude (system prompt, schema zod, erros)
  config.ts          modelos e níveis de esforço
  pipeline.ts        fila Inbox → engine → revisão (timeout, cancelamento, retry de JSON inválido)
  triage.ts          rascunho da triagem, validação de workspaces, principal/multi, divisão
  media.ts           redimensionamento de imagem, gravação, Web Speech, Whisper
  lock.ts            PIN (PBKDF2), biometria WebAuthn, redefinição do aparelho
  sync.ts            sincronização Supabase (push/pull, realtime, auth)
  vault.ts           cofre cifrado (AES-GCM) das chaves de API, sincronizado
  install.ts         convite de instalação do app (WebAPK)
  syncStatus.ts      estado da sincronização para a interface
  dates.ts           utilitários de data (semana ISO, fuso local)
  components/ui.tsx  blocos visuais e editores
  views/             Inbox, Dashboard (Hoje/Semana), Workspaces, Search, Settings, Triage, SyncPanel, SecurityPanel, LockScreen, InstallPanel
supabase/schema.sql  tabela, RLS, trigger last-write-wins e realtime
```

## Schema da engine

O prompt da engine segue a especificação "Prompt de processamento de captura" (tarefas com workspace individual, `workspace_principal`, flags `*_inferido`/`*_incerto`, `sugerir_divisao`). Campos a mais: `agenda_eventos` (com workspace por evento), `recorrencia`, `decisoes_tomadas` e `participantes`.
