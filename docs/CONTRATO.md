# Contrato de implementação (fase 2: persistência, backend e recursos)

Documento de trabalho: define as interfaces entre módulos para que partes diferentes sejam
implementadas em paralelo sem se desencontrar. Em caso de dúvida, o código já existente em `js/`
(`ids.js`, `sincronia.js`, `progresso.js`, `repositorio.js`, `dados.js`, `layout.js`) é a fonte da verdade.

## Regras gerais

- JavaScript puro com ES modules (`"type": "module"`), Node 22+. A **única** dependência de runtime é `express` (v5).
  Nada de TypeScript, build, bibliotecas de teste nem de UI. Testes com `node:test` + `node:assert/strict`.
- Código em português (identificadores, comentários e mensagens ao usuário), no mesmo estilo dos módulos existentes:
  comentários curtos que explicam o **porquê**, sem enfeite.
- Módulos em `js/` marcados como **puros** não acessam DOM, rede nem disco; funcionam no navegador e no Node.
- DOM sempre com `createElement`/`textContent`; nunca `innerHTML` com conteúdo vindo de dados.
- Nenhum agente edita arquivo fora da sua lista de propriedade. Se precisar de algo de outro módulo, diga no relatório final.
- Rode `node --test` antes de terminar; só entregue com tudo passando.

## Modelos de dados

**Roadmap** (já existente; `validarRoadmap` em `js/dados.js` devolve a cópia limpa):
`{ raiz, titulo?, descricao?, grafos: { [grafoId]: { titulo, nos: [{id, titulo, resumo, exemplo, links:[[texto,url]], filho?}], arestas: [[de, para]] } } }`
`tituloDoRoadmap(roadmap)` devolve `roadmap.titulo` ou o título do grafo raiz.

**Registro de progresso:** `{ status: 'novo'|'estudando'|'dominado', intervalo, proxima, atualizado }` (ms).
**Progresso de um roadmap:** `{ resetEm, registros: { "grafoId/noId": registro } }`; mesclagem em `js/sincronia.js`
(`mesclarProgresso`, `normalizarProgresso`). Os instantes vêm sempre do relógio do cliente; o servidor não gera nenhum.

**Id de roadmap:** slug `^[a-z0-9]+(-[a-z0-9]+)*$`, até 64 caracteres, fora de `IDS_RESERVADOS` (`js/ids.js`: `idDeRoadmapValido`).

## API HTTP (servidor Express)

Tudo em JSON, prefixo `/api`. Erros: `{ "erro": "mensagem em português", "avisos"?: [...] }` com o status certo.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/saude` | – | `200 { ok: true }` |
| `GET /api/roadmaps` | – | `200 [{ id, titulo, descricao?, topicos, grafos, atualizadoEm }]` (`topicos` = nós dos grafos alcançáveis da raiz; ordem por `titulo`) |
| `GET /api/roadmaps/:id` | – | `200 { id, roadmap, atualizadoEm }` · `404` |
| `POST /api/roadmaps` | `{ id?, roadmap }` | `201 { id, roadmap, atualizadoEm, avisos }` + `Location`. Sem `id`: gera de `tituloDoRoadmap` com `gerarIdDeRoadmap`. `400` se inválido, `409` se o id já existe |
| `PUT /api/roadmaps/:id` | `{ roadmap, baseadoEm? }` | `200 { id, roadmap, atualizadoEm, avisos }`. `404` se não existe. **`409`** se `baseadoEm` foi enviado e difere do `atualizadoEm` atual (edição concorrente); o corpo do 409 traz `{ erro, atualizadoEm }` |
| `DELETE /api/roadmaps/:id` | – | `204`; apaga também o progresso. `404` se não existe |
| `GET /api/roadmaps/:id/progresso` | – | `200 { resetEm, registros }` (vazio se nunca houve) · `404` se o roadmap não existe |
| `POST /api/roadmaps/:id/progresso` | `{ resetEm?, registros }` | **Mescla** (`mesclarProgresso`) com o guardado, persiste e devolve `200` o resultado mesclado. É o único jeito de escrever progresso: marcar um card envia 1 registro; "Zerar" envia `{ resetEm, registros: {} }` |

- `atualizadoEm`: ISO string gerada pelo servidor a cada gravação do roadmap (só serve para detectar edição concorrente).
- O roadmap é sempre gravado como a cópia limpa de `validarRoadmap(corpo.roadmap)`; os `avisos` voltam na resposta.
  `validarRoadmap` lança `Error` quando a estrutura é irrecuperável: responda `400` com a mensagem.
- Corpo grande demais: `413`. JSON malformado: `400`. Rota `/api/*` desconhecida: `404` em JSON (nunca HTML).

## Rotas do navegador (hash)

`""`/`#`/`#/` → tela inicial · `#revisao` → fila de revisão · `#<roadmapId>[/<grafoId>...]` → roadmap.
Num roadmap, o caminho de grafos é `[raiz, ...segmentos]` (o grafo raiz não aparece na URL).

## Módulos puros a criar (`js/`)

### `js/edicao.js` — edição imutável de roadmaps

Todas as funções recebem um roadmap limpo e devolvem um **novo** roadmap (nunca mutam a entrada). Em operação inválida
lançam `ErroEdicao` (`class ErroEdicao extends Error`, mensagem em português pronta para mostrar ao usuário).
O id de um nó/grafo é imutável depois de criado (a chave de progresso depende dele).

- `gerarIdNo(roadmap, grafoId, titulo)` / `gerarIdGrafo(roadmap, titulo)` → id único (use `gerarIdUnico` de `ids.js`; ids de grafo nunca contêm `/`).
- `adicionarNo(roadmap, grafoId, dados, origens = [])` → `{ roadmap, noId }`. `dados`: `{ titulo (obrigatório, não vazio), resumo?, exemplo?, links?, filho?, id? }`.
  `origens` = ids de nós do mesmo grafo que passam a apontar para o novo nó. `filho` precisa existir. Sem `id`, gera de `titulo`.
- `atualizarNo(roadmap, grafoId, noId, mudancas)` → roadmap. `mudancas` parcial: `{ titulo?, resumo?, exemplo?, links?, filho? }`; `filho: null` (ou `''`) remove o filho. Links inválidos (não http/https) lançam erro.
- `definirOrigens(roadmap, grafoId, noId, origens)` → roadmap com **exatamente** estas arestas de entrada no nó. Erro se alguma origem não existe, se é o próprio nó, ou se o resultado teria ciclo (`temCiclo` de `layout.js`).
- `adicionarAresta(roadmap, grafoId, de, para)` / `removerAresta(roadmap, grafoId, de, para)` → roadmap (duplicata é ignorada; ciclo, laço ou nó inexistente lançam erro).
- `removerNo(roadmap, grafoId, noId, { podar = true } = {})` → `{ roadmap, removidos: { nos: [{ grafoId, noId }], grafos: [grafoId] } }`.
  Remove o nó e suas arestas. Com `podar`, remove também os grafos que deixaram de ser alcançáveis a partir da raiz (e seus nós entram em `removidos.nos`, para a UI zerar o progresso deles). O nó removido também entra em `removidos.nos`.
- `criarGrafo(roadmap, titulo)` → `{ roadmap, grafoId }` (grafo vazio, ainda sem nó pai).
- `renomearGrafo(roadmap, grafoId, titulo)` → roadmap.
- `atualizarRoadmap(roadmap, { titulo?, descricao? })` → roadmap (string vazia remove o campo).
- `grafosOrfaos(roadmap)` → ids dos grafos não alcançáveis da raiz (use `grafosAlcancaveis`).
- O grafo raiz não pode ser removido; só existe `removerNo`, que nunca remove a raiz.
- Toda função devolve um roadmap que passa em `validarRoadmap(...)` **sem avisos**.

### `js/revisao.js` — fila de revisão

- `caminhoAteGrafo(roadmap, grafoId)` → `[raiz, ..., grafoId]` (menor caminho seguindo `filho`) ou `null` se inalcançável.
- `filaDeRevisao(entradas, agora)` onde `entradas = [{ id, roadmap, registros }]` (`registros` = mapa `"grafo/no" -> registro`) →
  itens `{ roadmapId, roadmapTitulo, grafoId, caminho, trilha, noId, noTitulo, proxima, intervalo }` só dos cards com `statusExibido === 'revisar'`
  em grafos alcançáveis; `trilha` = títulos dos grafos do `caminho`. Ordem: `proxima` crescente (mais atrasado primeiro), depois roadmapId, grafoId, noId.
- `contarRevisoes(entradas, agora)` → número de itens.

### `js/pacote.js` — exportar/importar

- `FORMATO = 'grafos-de-estudo'`, `VERSAO = 1`.
- `criarPacote({ id, roadmap, progresso, agora })` → `{ formato, versao, exportadoEm: <ISO de agora>, id, roadmap, progresso }`.
- `nomeDoArquivo(id, agora)` → `"<id>-AAAA-MM-DD.json"` (data em UTC).
- `lerPacote(entrada, { nomeArquivo } = {})` → `{ id, roadmap, progresso, avisos }`. `entrada` é texto JSON ou objeto. Aceita (a) pacote completo e
  (b) roadmap puro `{ raiz, grafos }` (progresso `null`). Valida com `validarRoadmap`; `progresso` é normalizado com `normalizarProgresso`
  e só mantém chaves de nós que existem no roadmap. `id`: o do pacote se for `idDeRoadmapValido`, senão derivado de `nomeArquivo` (sem extensão) ou de `tituloDoRoadmap`.
  Qualquer problema irrecuperável (JSON inválido, formato/versão desconhecidos, sem raiz) lança `ErroPacote` (`class ErroPacote extends Error`, mensagem em português).
  Versão maior que `VERSAO` → erro pedindo para atualizar o app.

## Servidor (`server/`)

- `server/armazenamento.js`: `criarArmazenamento({ arquivo, sementes })`. Um único arquivo JSON (`{ versao: 1, roadmaps: { [id]: { roadmap, atualizadoEm } }, progresso: { [id]: { resetEm, registros } } }`).
  Estado em memória, gravação **atômica** (arquivo temporário no mesmo diretório + `rename`) e **serializada** (fila de promessas: duas requisições simultâneas nunca se atropelam).
  Falha de gravação não pode deixar o estado em memória diferente do disco (aplique a mudança a uma cópia, grave, e só então troque).
  Na primeira execução (arquivo inexistente) semeia os roadmaps de `data/*.json` (id = nome do arquivo sem `.json`, só se `idDeRoadmapValido`); depois disso **nunca** ressemeia.
  Arquivo corrompido: não sobrescreva; mova para `<arquivo>.corrompido-<timestamp>` e inicie vazio, avisando no console.
- `server/app.js`: `criarApp({ armazenamento, diretorioPublico })` → `express()` configurado (sem `listen`), para os testes.
  Arquivos estáticos **somente** `index.html`, `css/`, `js/` e `data/` (lista explícita; nunca `server/`, `node_modules`, `package.json`, `.git`, o arquivo de dados).
  Cabeçalhos: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, e uma `Content-Security-Policy` compatível com o app
  (`default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`).
  `app.disable('x-powered-by')`. Limite de corpo JSON de 2 MB.
- `server/index.js`: lê `PORT` (padrão 3000), `HOST` (padrão **`127.0.0.1`**, porque não há login), `DB_FILE` (padrão `armazenamento/dados.json`), sobe o servidor,
  imprime a URL e encerra com elegância em SIGINT/SIGTERM (espera a fila de gravação esvaziar). Se `HOST` não for local, imprime um aviso de que a API não tem autenticação.

## Propriedade de arquivos

- Backend: `server/**`, `test/servidor.test.js`, `.gitignore`, `package.json` (só os `scripts`).
- Módulos puros: `js/edicao.js`, `js/revisao.js`, `js/pacote.js`, `test/edicao.test.js`, `test/revisao.test.js`, `test/pacote.test.js`.
- Núcleo do frontend (o líder): todo o resto de `js/`, `css/`, `index.html`, `README.md`, `docs/`.

---

# Parte 2: UI dos recursos (editor, fila de revisão, importar/exportar)

O núcleo do frontend já existe: `main.js` (orquestra), `tela-inicio.js`, `tela-roadmap.js`, `render.js`, `rotas.js`, `api.js`, `fonte.js`,
`sync.js`, `repositorio.js`, `dialogo.js` (modais sobre `<dialog>`: `criarDialogo`, `botaoDialogo`, `confirmar`) e `dom.js` (`el`, `botao`).
**Leia todos antes de começar** e imite o estilo (DOM só com `createElement`/`textContent`; sem `innerHTML`; strings em português).
Cada recurso fica em arquivo(s) próprio(s); `main.js`, `tela-*.js`, `render.js`, `index.html` e `css/estilos.css` **não são seus**: se achar um defeito
ou precisar de uma mudança neles, NÃO edite; descreva no relatório (arquivo, trecho, correção sugerida).

## Contexto compartilhado (`ctx`, criado em `main.js`)

`fonte` (`modo`, `editavel`, `listar`, `obter`, `criar`, `salvar`, `excluir`, `progresso`) · `repo` (`repo.escopo(id)` → `{ ler(), progresso(), mesclar(parte), definir(grafoId, noId, registro), limpar(agora) }`;
`repo.progresso(id)`, `repo.mesclar(id, parte)`, `repo.descartar(id)`) · `sync` (`agendar(id)`, `sincronizarTodos(ids)`, `estado`) · `principal` (o `<main>`) ·
`rotas` (`ir(rota)`, `substituir(rota, notificar)`, `rota()`; construtores em `rotas.js`: `rotaDoRoadmap(id, caminho)`, `hashDaRota`, `ROTA_INICIO`) ·
`avisar(mensagem, 'info'|'erro')` (região `aria-live`) · `mostrarErro(msg)` · `atualizarContagemRevisao()` · `entradas()` (async, todos os roadmaps `{ id, roadmap, atualizadoEm }`) ·
`guardar(dados)` / `esquecer(id)` (cache de `entradas`) · `primeiraCarga` (boolean: `false` quando a tela foi aberta por navegação, caso em que o `<h1>` deve receber o foco).
Erros de rede/servidor chegam como `ErroApi` (`js/api.js`: `.status`, `.message` em português; `status === 409` = edição concorrente).
Instantes de progresso usam `Date.now()` do navegador. Registros novos nascem de `marcarStatus`/`registrarRevisao` (`progresso.js`) e são gravados com `repo.escopo(id).definir(...)`,
seguido de `ctx.sync.agendar(id)`.

## `js/editor.js` — modo de edição

`export function criarEditor(sessao)` → `{ novoNo(grafoId), editarNo(grafoId, noId), removerNo(grafoId, noId), renomearGrafo(grafoId), editarRoadmap() }`; todos `async` (resolvem quando o diálogo fecha).
`sessao` (montada em `tela-roadmap.js`): `{ roadmapId, ctx, obterRoadmap(), grafoAtual(), aplicar(novoRoadmap, { removidos }) (async; lança ErroApi), recarregar() (async), focarNo(noId) }`.
`aplicar` grava no servidor com controle de concorrência, redesenha a tela e zera o progresso dos nós em `removidos.nos`; **chame-a uma única vez por ação do usuário** (gravação atômica).

- Formulário de tópico (novo e edição), num `<dialog>` via `criarDialogo`: Título* (obrigatório), Resumo, Exemplo de código (textarea monoespaçada), Links (linhas dinâmicas texto + URL, cada uma com botão "Remover link N", e botão "Adicionar link"),
  Subgrafo (select: "Nenhum", cada grafo existente com seu título, e "Criar novo subgrafo…", que cria um grafo vazio com o título do tópico via `criarGrafo`), e "Depende de" (`<fieldset>` com um checkbox por outro nó do mesmo grafo; marcar/desmarcar define as arestas de entrada com `definirOrigens`).
- Toda a mudança de uma ação é computada com as funções puras de `edicao.js` sobre o roadmap atual e entregue **de uma vez** a `sessao.aplicar`. O id de um tópico nunca muda depois de criado.
- Remover: confirmação (`confirmar`, foco inicial em Cancelar) que diz o que será perdido: o tópico, suas conexões, o progresso dele e, se `removerNo` (simule antes com `podar: true`) podar grafos, o nome e a quantidade de tópicos de cada subgrafo removido.
- Renomear grafo e editar roadmap (título e descrição): diálogos curtos. O grafo raiz também pode ser renomeado.
- Erros: `ErroEdicao` (validação) aparece **dentro** do diálogo, numa região `role="alert"`, sem fechar e sem perder o que foi digitado. `ErroApi` com `status === 409` mostra "Este roadmap foi alterado em outro lugar (ou em outra aba)." com um botão "Recarregar roadmap" que chama `sessao.recarregar()` e fecha; outros `ErroApi` mostram a mensagem no diálogo.
- Depois de salvar: fecha, `ctx.avisar('Tópico salvo.')` (ou equivalente) e `sessao.focarNo(noId)` quando existir um nó para focar.
- Acessibilidade: `<label for>` em todos os campos, `required` + `aria-invalid` + `aria-describedby` nos inválidos, foco no primeiro campo inválido, `fieldset`/`legend`, Esc fecha, Enter nos campos de uma linha não pode disparar "Remover link". Funciona só com teclado.
- Estilos só em `css/edicao.css` (variáveis de tema de `css/estilos.css`, claro e escuro, `prefers-reduced-motion`).

## `js/tela-revisao.js` — fila de revisão

`export function montarRevisao(ctx)` → `{ aoAtualizarProgresso(id), desmontar() }`. Monta em `ctx.principal`: `<h1 id="titulo-grafo" tabindex="-1">Revisão</h1>` (recebe o foco quando `!ctx.primeiraCarga`), título do documento "Revisão · Grafos de estudo".

- Carrega `await ctx.entradas()`, dispara `ctx.sync.sincronizarTodos(ids)` em segundo plano e calcula `filaDeRevisao` (de `revisao.js`) com `registros` de `ctx.repo.escopo(id).ler()`. Redesenha em `aoAtualizarProgresso`.
- Cada item: título do tópico, trilha ("Roadmap › Grafo › Subgrafo"), quão atrasado ("para hoje", "atrasado há N dias"), intervalo atual, botões **Lembrei** / **Esqueci** (use `registrarRevisao` + `definir` + `ctx.sync.agendar` + `ctx.atualizarContagemRevisao()`), e o link "Abrir no grafo" (`<a href>` com `hashDaRota(rotaDoRoadmap(roadmapId, caminho))`).
- Responder remove o item, anuncia o resultado em `ctx.avisar` ("Próxima revisão em N dias"), e move o foco para o botão do próximo item (ou o `<h1>` se a fila esvaziar). Lista semântica (`<ul>`), cada item identificável por leitores de tela.
- Fila vazia: "Nada para revisar hoje." e, se houver, "Próxima revisão: dd/mm/aaaa" (a menor `proxima` futura entre os cards dominados de todos os roadmaps).
- Erros: `ctx.mostrarErro`. Estilos só em `css/revisao.css`.

## `js/ui-pacote.js` — exportar e importar

- `exportarRoadmap(ctx, roadmapId, roadmap)` (síncrono): monta o pacote com `criarPacote({ id, roadmap, progresso: ctx.repo.progresso(roadmapId), agora: Date.now() })`, baixa como arquivo JSON (`Blob` + `URL.createObjectURL` + `<a download>` temporário, revogando a URL depois) com `nomeDoArquivo`, e avisa com `ctx.avisar`.
- `abrirImportacao(ctx)` (async): só funciona com `ctx.fonte.editavel` (senão `ctx.avisar` explicando que precisa do servidor). Diálogo com `<input type="file" accept=".json,application/json">` rotulado. Recusa arquivos acima de 5 MB antes de ler. Lê com `file.text()` e `lerPacote(texto, { nomeArquivo })`; mostra uma **prévia** (título, nº de tópicos, se traz progresso e quantos registros, e a lista de `avisos`).
  Se o `id` já existe (`await ctx.entradas()`), pede a escolha (grupo de rádio): "Substituir o roadmap existente «X»" (usa `fonte.salvar` com o `atualizadoEm` atual; o progresso é **mesclado**, o mais recente vence) ou "Importar como novo roadmap" (id novo com `gerarIdDeRoadmap`). Sem conflito, cria com `fonte.criar`.
  Botão "Importar" só habilitado com um arquivo válido. Sucesso: `ctx.guardar(resposta)`, `ctx.repo.mesclar(id, progresso)` + `ctx.sync.agendar(id)` quando houver progresso, `ctx.avisar(...)` e `ctx.rotas.ir(rotaDoRoadmap(id, []))`.
  Erros (`ErroPacote`, `ErroApi`) aparecem no diálogo em `role="alert"`, sem fechá-lo. Estilos só em `css/pacote.css`.

## Como verificar na prática (todos os agentes)

Playwright global: `import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'` (Chromium já instalado; nunca rode `playwright install`).
Suba o servidor com banco temporário e porta própria: `PORT=<porta livre> DB_FILE=<arquivo em diretório temporário> node server/index.js` e rode seus scripts a partir do diretório de rascunho do sistema (não os coloque no repositório).
Bloqueie as fontes externas no navegador (`page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort())`). Verifique de verdade: fluxo completo só com teclado, tema escuro, viewport de 375px, e que não há erros no console.

---

# Adendo (depois da parte 1)

- `js/edicao.js` ganhou `podarOrfaos(roadmap, { somente } = {})` → `{ roadmap, removidos }` (mesmo formato de `removerNo`). Remove grafos órfãos e os subgrafos que só eles alcançam; `somente` limita a poda aos órfãos listados.
- **Editor:** ao salvar um tópico cujo `filho` mudou ou foi removido, compare `grafosOrfaos` antes e depois. Se a edição deixou subgrafos sem pai, pergunte (`confirmar`, foco em manter): "O subgrafo «X» (N tópicos) ficou sem tópico pai. Remover também?". Se sim, aplique `podarOrfaos(roadmap, { somente: <os novos órfãos> })` **antes** da única chamada a `sessao.aplicar`, passando `removidos`.
- O servidor limita o corpo a 5 MB (`MAX_TEXTO` de `pacote.js`), igual ao limite do `lerPacote`.
- **Servidor para testar a UI:** NÃO use `server/index.js` do repositório (outro agente o está reescrevendo). Use o launcher já pronto, que serve o código congelado do servidor e os arquivos estáticos do repositório vivo:
  `PORT=<porta livre> DB_FILE=<arquivo em diretório temporário> node <diretório de rascunho>/lancar.mjs` (o caminho completo vem na sua tarefa). A API é a mesma do contrato.
