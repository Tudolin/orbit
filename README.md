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

`dist/` é estático: pode ser publicado em qualquer host HTTPS (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Para instalar no celular, abra a URL e use "Adicionar à tela inicial". Câmera, microfone e service worker exigem HTTPS (ou `localhost`).

## Como funciona

1. **Inbox / Quick Capture**: texto, links, fotos (câmera ou galeria), prints colados com Ctrl+V e áudio. No Android, o NEXUS aparece no menu "Compartilhar" para textos e links.
2. **Engine Claude**: cada captura vai para a Messages API com o system prompt do NEXUS e **structured outputs**, então a resposta sempre segue o schema JSON. O app também envia o contexto do dispositivo (data, fuso, workspaces existentes) para resolver "amanhã às 9h" e sugerir o workspace certo.
3. **Revisão (Modelo 1)**: você confere o workspace sugerido (ou cria um novo), desmarca o que não quer e envia. Eventos, tarefas e a nota de contexto vão para o workspace.
4. **Visões**: Hoje (timeline + prioridades + entregas), Semana (matriz workspace × dia com volume por cor), Workspaces (Agenda, Kanban, Cérebro) e Busca (palavras-chave + `#tags` + filtro por workspace).

## Dados (local-first)

Tudo fica no **IndexedDB** do navegador (Dexie): `workspaces`, `captures`, `events`, `tasks`, `notes`, `settings`. Não há servidor próprio. Use **Config → Exportar/Importar backup** (JSON) para mover os dados entre celular e computador.

## Configuração

- **ANTHROPIC_API_KEY**: inserida em Config e enviada direto do navegador para `api.anthropic.com`. Ela fica guardada no IndexedDB deste dispositivo. Use uma chave dedicada com limite de gasto.
- **Modelo**: Claude Opus 5.5 (padrão), Sonnet 5.5 ou Haiku 5.5. Esforço padrão: médio.
- **Fallback em recusas**: Opus e Sonnet usam `fallbacks: "default"` (server-side), para que uma recusa falso-positiva seja refeita em outro modelo.
- **Áudio**: transcrição ao vivo pela Web Speech API (Chrome/Edge/Safari). Opcionalmente, com uma chave OpenAI, o áudio gravado vai para o Whisper (`whisper-1`).

## Estrutura

```
src/
  db.ts              schema IndexedDB, distribuição de capturas, backup
  engine.ts          chamada Claude (system prompt, schema zod, erros)
  config.ts          modelos e níveis de esforço
  pipeline.ts        fila Inbox → engine → revisão (carrega o SDK sob demanda)
  media.ts           redimensionamento de imagem, gravação, Web Speech, Whisper
  dates.ts           utilitários de data (semana ISO, fuso local)
  components/ui.tsx  blocos visuais e editores
  views/             Inbox, Dashboard (Hoje/Semana), Workspaces, Search, Settings
```

## Desvios do schema original

- `origem` aceita também `"texto"` para notas digitadas.
- `data_fim` pode ser `null` quando o evento não tem fim explícito.
