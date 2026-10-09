// Edição imutável de roadmaps. Módulo puro: recebe um roadmap limpo (saída de `validarRoadmap`) e
// devolve outro, sem mutar o original. Operação inválida lança `ErroEdicao`, com mensagem pronta
// para mostrar ao usuário. O id de um nó ou grafo nunca muda: a chave de progresso "grafo/no" depende dele.
//
// Toda função trabalha numa cópia (`structuredClone`) e só entrega a cópia se nenhuma checagem falhou.

import { grafosAlcancaveis } from './dados.js';
import { gerarIdUnico } from './ids.js';

export class ErroEdicao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroEdicao';
  }
}

const tem = (objeto, chave) => Object.hasOwn(objeto, chave);
const erro = (mensagem) => new ErroEdicao(mensagem);
const copiar = (roadmap) => structuredClone(roadmap);

// Ids de grafo viram chaves de `roadmap.grafos`; nomes herdados de Object.prototype ("constructor")
// ficam sempre ocupados para nunca virarem chave.
const CHAVES_DE_OBJETO = Object.getOwnPropertyNames(Object.prototype);

// Mesma regra de `validarRoadmap`: só http(s) vira link (nada de `javascript:`).
function urlSegura(texto) {
  try {
    const { protocol } = new URL(texto);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function exigirObjeto(valor, mensagem) {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) throw erro(mensagem);
}

function buscarGrafo(roadmap, grafoId) {
  // hasOwn: "constructor" e "__proto__" não podem passar por propriedades herdadas.
  if (typeof grafoId !== 'string' || !tem(roadmap.grafos, grafoId)) throw erro(`O grafo "${grafoId}" não existe.`);
  return roadmap.grafos[grafoId];
}

function buscarNo(grafo, noId) {
  const no = grafo.nos.find((candidato) => candidato.id === noId);
  if (!no) throw erro(`O nó "${noId}" não existe neste grafo.`);
  return no;
}

function tituloValido(titulo, rotulo) {
  if (typeof titulo !== 'string' || titulo.trim() === '') throw erro(`O título do ${rotulo} não pode ficar vazio.`);
  return titulo.trim();
}

// Resumo e exemplo: ausente vira texto vazio; só texto é aceito.
function textoOpcional(valor, rotulo) {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw erro(`O ${rotulo} do nó deve ser um texto.`);
  return valor;
}

// Texto do link vazio cai para a própria URL, para o link nunca ficar invisível na tela.
function normalizarLinks(links) {
  if (!Array.isArray(links)) throw erro('Os links devem ser uma lista de pares [texto, url].');
  return links.map((link, posicao) => {
    const [texto, url] = Array.isArray(link) ? link : [];
    const endereco = typeof url === 'string' ? url.trim() : '';
    if (typeof texto !== 'string' || !urlSegura(endereco)) {
      throw erro(`Link ${posicao + 1} inválido: informe uma URL que comece com http:// ou https://.`);
    }
    return [texto.trim() || endereco, endereco];
  });
}

// `undefined`, `null` e '' significam "sem filho"; qualquer outro valor precisa ser um grafo existente.
// Apontar para o próprio grafo (ou para um ancestral) é permitido: o app já lida com o ciclo de grafos.
function filhoValido(roadmap, filho) {
  if (filho === undefined || filho === null || filho === '') return undefined;
  if (typeof filho !== 'string' || !tem(roadmap.grafos, filho)) throw erro(`O grafo filho "${filho}" não existe.`);
  return filho;
}

function idDeNoValido(grafo, id) {
  if (typeof id !== 'string' || id.trim() === '') throw erro('O id do nó deve ser um texto não vazio.');
  // "/" separa grafo e nó na chave de progresso.
  if (id.includes('/')) throw erro('O id do nó não pode conter "/".');
  if (grafo.nos.some((no) => no.id === id)) throw erro(`Já existe um nó com o id "${id}" neste grafo.`);
  return id;
}

// Origens sem repetição, todas existentes no grafo e diferentes do próprio nó.
function origensValidas(grafo, origens, noId) {
  if (!Array.isArray(origens)) throw erro('As origens devem ser uma lista de ids de nós.');
  const unicas = [...new Set(origens)];
  for (const de of unicas) {
    if (de === noId) throw erro('Um tópico não pode depender de si mesmo.');
    if (!grafo.nos.some((no) => no.id === de)) throw erro(`O nó de origem "${de}" não existe neste grafo.`);
  }
  return unicas;
}

const MENSAGEM_CICLO = 'Essa ligação criaria um ciclo: os tópicos precisam seguir uma ordem sem voltas.';

// Seguindo as arestas, dá para ir de `inicio` até `destino`? Ligar `destino` -> `inicio` fecha um ciclo se sim.
// Em vez de `temCiclo` no resultado: um grafo que já chegou com ciclo (`validarRoadmap` só avisa) não
// pode travar toda edição nele; só a ligação que fecha um ciclo NOVO é recusada.
function alcanca(arestas, inicio, destino) {
  const visitados = new Set();
  const pilha = [inicio];
  while (pilha.length) {
    const id = pilha.pop();
    if (id === destino) return true;
    if (visitados.has(id)) continue;
    visitados.add(id);
    for (const [de, para] of arestas) if (de === id) pilha.push(para);
  }
  return false;
}

/** Id de nó único dentro do grafo, gerado do título. */
export function gerarIdNo(roadmap, grafoId, titulo) {
  const grafo = buscarGrafo(roadmap, grafoId);
  return gerarIdUnico(titulo, grafo.nos.map((no) => no.id), 'no');
}

/** Id de grafo único entre os grafos do roadmap; sem "/" e fora das chaves herdadas de Object. */
export function gerarIdGrafo(roadmap, titulo) {
  return gerarIdUnico(titulo, [...Object.keys(roadmap.grafos), ...CHAVES_DE_OBJETO], 'grafo');
}

/**
 * Acrescenta um nó ao fim do grafo. `origens` são nós do mesmo grafo que passam a apontar para ele.
 * O nó novo não tem arestas de saída, então ligar origens a ele nunca cria ciclo.
 * @returns {{roadmap: object, noId: string}}
 */
export function adicionarNo(roadmap, grafoId, dados, origens = []) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  exigirObjeto(dados, 'Os dados do nó estão ausentes ou inválidos.');
  const titulo = tituloValido(dados.titulo, 'nó');
  const semId = dados.id === undefined || dados.id === null || dados.id === '';
  const id = semId ? gerarIdNo(novo, grafoId, titulo) : idDeNoValido(grafo, dados.id);
  const fontes = origensValidas(grafo, origens, id);

  grafo.nos.push({
    id,
    titulo,
    resumo: textoOpcional(dados.resumo, 'resumo'),
    exemplo: textoOpcional(dados.exemplo, 'exemplo'),
    links: dados.links === undefined ? [] : normalizarLinks(dados.links),
    filho: filhoValido(novo, dados.filho),
  });
  for (const de of fontes) grafo.arestas.push([de, id]);
  return { roadmap: novo, noId: id };
}

/** Atualiza só os campos presentes em `mudancas`. `filho: null` (ou '') remove o filho. */
export function atualizarNo(roadmap, grafoId, noId, mudancas) {
  const novo = copiar(roadmap);
  const no = buscarNo(buscarGrafo(novo, grafoId), noId);
  exigirObjeto(mudancas, 'As mudanças do nó estão ausentes ou inválidas.');
  if (mudancas.id !== undefined && mudancas.id !== noId) throw erro('O id de um nó não pode ser alterado.');

  // Valida tudo antes de aplicar: um campo ruim não pode deixar o nó pela metade.
  const titulo = mudancas.titulo === undefined ? no.titulo : tituloValido(mudancas.titulo, 'nó');
  const resumo = mudancas.resumo === undefined ? no.resumo : textoOpcional(mudancas.resumo, 'resumo');
  const exemplo = mudancas.exemplo === undefined ? no.exemplo : textoOpcional(mudancas.exemplo, 'exemplo');
  const links = mudancas.links === undefined ? no.links : normalizarLinks(mudancas.links);
  const filho = mudancas.filho === undefined ? no.filho : filhoValido(novo, mudancas.filho);

  Object.assign(no, { titulo, resumo, exemplo, links, filho });
  return novo;
}

/** Deixa o nó com exatamente estas arestas de entrada; as de saída não mudam. */
export function definirOrigens(roadmap, grafoId, noId, origens) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  buscarNo(grafo, noId);
  const fontes = origensValidas(grafo, origens, noId);

  // Mantém as arestas que continuam valendo, na mesma ordem, e acrescenta só as que faltam.
  const mantidas = grafo.arestas.filter(([de, para]) => para !== noId || fontes.includes(de));
  const jaLigadas = new Set(mantidas.filter(([, para]) => para === noId).map(([de]) => de));
  const novas = fontes.filter((de) => !jaLigadas.has(de));

  // Todas as arestas novas terminam em `noId`, então um ciclo novo passa por ele e volta a uma origem nova.
  if (novas.some((de) => alcanca(mantidas, noId, de))) throw erro(MENSAGEM_CICLO);
  grafo.arestas = [...mantidas, ...novas.map((de) => [de, noId])];
  return novo;
}

/** Liga `de` a `para`. Aresta repetida é ignorada; laço, ciclo e nó inexistente lançam erro. */
export function adicionarAresta(roadmap, grafoId, de, para) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  buscarNo(grafo, de);
  buscarNo(grafo, para);
  if (de === para) throw erro('Um tópico não pode depender de si mesmo.');
  if (grafo.arestas.some(([a, b]) => a === de && b === para)) return novo;

  if (alcanca(grafo.arestas, para, de)) throw erro(MENSAGEM_CICLO);
  grafo.arestas.push([de, para]);
  return novo;
}

/** Desliga `de` de `para`. Se a ligação já não existia, nada muda (a operação é idempotente). */
export function removerAresta(roadmap, grafoId, de, para) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  buscarNo(grafo, de);
  buscarNo(grafo, para);
  grafo.arestas = grafo.arestas.filter(([a, b]) => !(a === de && b === para));
  return novo;
}

/**
 * Remove o nó e as arestas que o tocam. Com `podar`, remove também os grafos que eram alcançáveis
 * da raiz e deixaram de ser (um grafo com outro pai alcançável continua), com os subgrafos deles.
 * Grafos que já eram órfãos antes (criados e ainda sem pai) não são tocados.
 * `removidos.nos` lista o nó e todos os nós dos grafos podados, para a UI zerar o progresso deles.
 * @returns {{roadmap: object, removidos: {nos: {grafoId: string, noId: string}[], grafos: string[]}}}
 */
export function removerNo(roadmap, grafoId, noId, { podar = true } = {}) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  buscarNo(grafo, noId);
  const alcancavelAntes = new Set(grafosAlcancaveis(roadmap));

  grafo.nos = grafo.nos.filter((no) => no.id !== noId);
  grafo.arestas = grafo.arestas.filter(([de, para]) => de !== noId && para !== noId);
  const removidos = { nos: [{ grafoId, noId }], grafos: [] };
  if (!podar) return { roadmap: novo, removidos };

  const alcancavelDepois = new Set(grafosAlcancaveis(novo));
  removidos.grafos = Object.keys(novo.grafos).filter((id) => alcancavelAntes.has(id) && !alcancavelDepois.has(id));
  for (const id of removidos.grafos) {
    for (const no of novo.grafos[id].nos) removidos.nos.push({ grafoId: id, noId: no.id });
    delete novo.grafos[id];
  }
  // Um grafo órfão que apontava para um grafo podado ficaria com `filho` pendente.
  for (const restante of Object.values(novo.grafos)) {
    for (const no of restante.nos) {
      if (no.filho !== undefined && !tem(novo.grafos, no.filho)) no.filho = undefined;
    }
  }
  return { roadmap: novo, removidos };
}

/**
 * Cria um grafo vazio, ainda sem nó pai (fica órfão até algum nó apontar `filho` para ele).
 * @returns {{roadmap: object, grafoId: string}}
 */
export function criarGrafo(roadmap, titulo) {
  const novo = copiar(roadmap);
  const nome = tituloValido(titulo, 'grafo');
  const grafoId = gerarIdGrafo(novo, nome);
  novo.grafos[grafoId] = { titulo: nome, nos: [], arestas: [] };
  return { roadmap: novo, grafoId };
}

export function renomearGrafo(roadmap, grafoId, titulo) {
  const novo = copiar(roadmap);
  const grafo = buscarGrafo(novo, grafoId);
  grafo.titulo = tituloValido(titulo, 'grafo');
  return novo;
}

/** Atualiza título e descrição do roadmap. Texto vazio (ou `null`) remove o campo; `undefined` mantém. */
export function atualizarRoadmap(roadmap, mudancas = {}) {
  const novo = copiar(roadmap);
  exigirObjeto(mudancas, 'As mudanças do roadmap estão ausentes ou inválidas.');
  for (const campo of ['titulo', 'descricao']) {
    if (mudancas[campo] === undefined) continue;
    const valor = mudancas[campo] ?? '';
    if (typeof valor !== 'string') throw erro(`O campo "${campo}" do roadmap deve ser um texto.`);
    if (valor.trim() === '') delete novo[campo];
    else novo[campo] = valor.trim();
  }
  return novo;
}

/** Ids dos grafos que nenhum nó alcançável a partir da raiz tem como filho. */
export function grafosOrfaos(roadmap) {
  const alcancaveis = new Set(grafosAlcancaveis(roadmap));
  return Object.keys(roadmap.grafos).filter((id) => !alcancaveis.has(id));
}

/**
 * Remove os grafos órfãos (sem pai alcançável da raiz) e os subgrafos que só eles alcançam.
 * `somente` limita a poda aos órfãos listados: o editor passa só os que a própria edição acabou
 * de deixar sem pai, para não apagar órfãos antigos (por exemplo, de um roadmap importado).
 * `removidos` tem o mesmo formato de `removerNo`, para a UI zerar o progresso dos nós podados.
 * @returns {{roadmap: object, removidos: {nos: {grafoId: string, noId: string}[], grafos: string[]}}}
 */
export function podarOrfaos(roadmap, { somente } = {}) {
  const novo = copiar(roadmap);
  const alcancaveis = new Set(grafosAlcancaveis(novo));
  const permitidos = somente === undefined ? null : new Set(somente);
  const alvos = new Set();
  for (const id of Object.keys(novo.grafos)) {
    if (alcancaveis.has(id) || (permitidos && !permitidos.has(id))) continue;
    for (const alcancado of grafosAlcancaveis(novo, id)) if (!alcancaveis.has(alcancado)) alvos.add(alcancado);
  }

  const removidos = { nos: [], grafos: [...alvos] };
  for (const id of alvos) {
    for (const no of novo.grafos[id].nos) removidos.nos.push({ grafoId: id, noId: no.id });
    delete novo.grafos[id];
  }
  // Um grafo que sobrou e apontava para um grafo podado ficaria com `filho` pendente.
  for (const restante of Object.values(novo.grafos)) {
    for (const no of restante.nos) {
      if (no.filho !== undefined && !tem(novo.grafos, no.filho)) no.filho = undefined;
    }
  }
  return { roadmap: novo, removidos };
}
