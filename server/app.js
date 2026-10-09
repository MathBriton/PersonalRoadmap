// Aplicação Express: API JSON de roadmaps e progresso, mais os arquivos estáticos do app.
//
// A API não tem login. O que impede que um site qualquer aberto no mesmo navegador leia ou
// altere os dados:
//  - não há cabeçalhos CORS, então o preflight de PUT/DELETE falha e a resposta não é legível;
//  - escritas exigem `Content-Type: application/json`, o que também força preflight;
//  - escritas com `Origin` só valem se ele for o mesmo host da requisição (403);
//  - com HOST de loopback, o cabeçalho `Host` precisa ser de loopback na porta do servidor
//    (proteção contra DNS rebinding, em que um domínio externo passa a apontar para 127.0.0.1).

import path from 'node:path';
import express from 'express';
import { grafosAlcancaveis, tituloDoRoadmap } from '../js/dados.js';
import { idDeRoadmapValido } from '../js/ids.js';
import { ErroArmazenamento, roadmapNaoEncontrado } from './armazenamento.js';

const LIMITE_CORPO = '2mb';
const CSP =
  "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Lista explícita: nunca server/, node_modules, package.json, .git nem o arquivo de dados.
const PASTAS_PUBLICAS = ['css', 'js', 'data'];

const HOSTS_LOOPBACK = ['127.0.0.1', '::1', 'localhost'];
const METODOS_SEM_ESCRITA = new Set(['GET', 'HEAD', 'OPTIONS']);

const MENSAGEM_ID = 'Id de roadmap inválido: use letras minúsculas, números e hífens, com até 64 caracteres (e não use "revisao" nem "api").';
const MENSAGENS_HTTP = {
  400: 'Requisição inválida.',
  403: 'Acesso negado.',
  404: 'Não encontrado.',
  413: 'Corpo da requisição grande demais (limite de 2 MB).',
  415: 'Tipo de conteúdo não suportado.',
};
const STATUS_DE_ARMAZENAMENTO = {
  invalido: 400,
  'id-invalido': 400,
  'nao-encontrado': 404,
  'ja-existe': 409,
  conflito: 409,
};

/** Verdadeiro se o `HOST` de escuta é local; só então o cabeçalho Host é validado. */
export const ehLoopback = (host) => HOSTS_LOOPBACK.includes(String(host).toLowerCase());

class ErroDeRequisicao extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);

function corpoObjeto(req) {
  if (!ehObjeto(req.body)) throw new ErroDeRequisicao(400, 'Envie um objeto JSON no corpo da requisição.');
  return req.body;
}

function cabecalhosDeSeguranca(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP,
  });
  next();
}

/** Aceita só Hosts de loopback na porta em que a conexão chegou, mais os extras de HOSTS_PERMITIDOS. */
function validarHost(hostsPermitidos) {
  const extras = new Set(hostsPermitidos.map((h) => h.trim().toLowerCase()).filter(Boolean));
  return (req, res, next) => {
    const porta = req.socket.localPort;
    const recebido = String(req.headers.host ?? '').toLowerCase();
    const aceitos = [`localhost:${porta}`, `127.0.0.1:${porta}`, `[::1]:${porta}`];
    if (aceitos.includes(recebido) || extras.has(recebido)) return next();
    res.status(403).json({ erro: 'Host não permitido.' });
  };
}

function origemIgualAoHost(origem, host) {
  try {
    return new URL(origem).host.toLowerCase() === String(host ?? '').toLowerCase();
  } catch {
    return false; // inclui "null" (páginas file://, iframes com sandbox)
  }
}

/** Escritas: Origin coerente (403), Content-Type JSON (415) e só então a leitura do corpo (413/400). */
function escritas() {
  const lerJson = express.json({ limit: LIMITE_CORPO });
  return (req, res, next) => {
    if (METODOS_SEM_ESCRITA.has(req.method)) return next();
    if (req.headers.origin !== undefined && !origemIgualAoHost(req.headers.origin, req.headers.host)) {
      return res.status(403).json({ erro: 'Origem não permitida.' });
    }
    // `req.is` devolve null quando não há corpo (DELETE), por isso o cabeçalho é lido à mão.
    const tipo = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') {
      return res.status(415).json({ erro: 'Envie o corpo como JSON, com Content-Type: application/json.' });
    }
    lerJson(req, res, next);
  };
}

function resumo({ id, roadmap, atualizadoEm }) {
  const alcancaveis = grafosAlcancaveis(roadmap);
  const resultado = { id, titulo: tituloDoRoadmap(roadmap) };
  if (roadmap.descricao !== undefined) resultado.descricao = roadmap.descricao;
  resultado.topicos = alcancaveis.reduce((soma, grafoId) => soma + roadmap.grafos[grafoId].nos.length, 0);
  resultado.grafos = alcancaveis.length;
  resultado.atualizadoEm = atualizadoEm;
  return resultado;
}

function criarApi(armazenamento) {
  const api = express.Router();

  // O id da URL é validado antes de qualquer consulta. Um id que não pode existir é "não encontrado".
  api.param('id', (req, res, next, id) => next(idDeRoadmapValido(id) ? undefined : roadmapNaoEncontrado()));

  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(escritas());

  api.get('/saude', (req, res) => res.json({ ok: true }));

  api.get('/roadmaps', (req, res) => {
    const itens = armazenamento.listar().map(resumo);
    itens.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR') || (a.id < b.id ? -1 : 1));
    res.json(itens);
  });

  api.get('/roadmaps/:id', (req, res) => {
    const entrada = armazenamento.obter(req.params.id);
    if (!entrada) throw roadmapNaoEncontrado();
    res.json({ id: req.params.id, roadmap: entrada.roadmap, atualizadoEm: entrada.atualizadoEm });
  });

  api.post('/roadmaps', async (req, res) => {
    const { id, roadmap } = corpoObjeto(req);
    if (id != null && !idDeRoadmapValido(id)) throw new ErroDeRequisicao(400, MENSAGEM_ID);
    const criado = await armazenamento.criar({ id: id ?? undefined, roadmap });
    res.status(201).location(`/api/roadmaps/${criado.id}`).json(criado);
  });

  api.put('/roadmaps/:id', async (req, res) => {
    const { roadmap, baseadoEm } = corpoObjeto(req);
    if (baseadoEm != null && typeof baseadoEm !== 'string') {
      throw new ErroDeRequisicao(400, '"baseadoEm" deve ser o texto do atualizadoEm recebido do servidor.');
    }
    res.json(await armazenamento.atualizar(req.params.id, roadmap, baseadoEm ?? undefined));
  });

  api.delete('/roadmaps/:id', async (req, res) => {
    await armazenamento.remover(req.params.id);
    res.status(204).end();
  });

  api.get('/roadmaps/:id/progresso', (req, res) => {
    const progresso = armazenamento.progressoDe(req.params.id);
    if (!progresso) throw roadmapNaoEncontrado();
    res.json(progresso);
  });

  api.post('/roadmaps/:id/progresso', async (req, res) => {
    const { resetEm, registros } = corpoObjeto(req);
    if (!ehObjeto(registros)) throw new ErroDeRequisicao(400, 'Progresso inválido: "registros" deve ser um objeto.');
    if (resetEm != null && !(typeof resetEm === 'number' && Number.isFinite(resetEm) && resetEm >= 0)) {
      throw new ErroDeRequisicao(400, 'Progresso inválido: "resetEm" deve ser um número em milissegundos.');
    }
    res.json(await armazenamento.mesclarProgresso(req.params.id, { resetEm: resetEm ?? 0, registros }));
  });

  api.use((req, res) => res.status(404).json({ erro: 'Rota da API não encontrada.' }));
  return api;
}

// Express 5 repassa para cá tanto o que os handlers lançam quanto o que rejeitam.
function tratarErro(erro, req, res, next) {
  if (res.headersSent) return next(erro);
  if (erro instanceof ErroDeRequisicao) return res.status(erro.status).json({ erro: erro.message });
  if (erro instanceof ErroArmazenamento) {
    const corpo = { erro: erro.message };
    if (erro.codigo === 'conflito') corpo.atualizadoEm = erro.atualizadoEm;
    return res.status(STATUS_DE_ARMAZENAMENTO[erro.codigo] ?? 500).json(corpo);
  }
  if (erro?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON malformado.' });
  // Erros 4xx de bibliotecas (corpo grande demais, charset, percent-encoding quebrado, ".." no
  // caminho estático). A mensagem delas pode citar caminhos, então só o status é aproveitado.
  const status = erro?.status ?? erro?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ erro: MENSAGENS_HTTP[status] ?? MENSAGENS_HTTP[400] });
  }
  console.error('[servidor] Erro inesperado:', erro);
  res.status(500).json({ erro: 'Erro interno.' });
}

/**
 * @param {object} opcoes
 * @param {object} opcoes.armazenamento resultado de `criarArmazenamento`
 * @param {string} opcoes.diretorioPublico raiz do projeto (onde estão index.html, css/, js/ e data/)
 * @param {string} [opcoes.host] HOST de escuta; se for loopback (o padrão), o cabeçalho Host é validado
 * @param {string[]} [opcoes.hostsPermitidos] valores de Host aceitos além dos de loopback (ex.: "meu-pc:3000")
 */
export function criarApp({ armazenamento, diretorioPublico, host = '127.0.0.1', hostsPermitidos = [] }) {
  const raiz = path.resolve(diretorioPublico);
  const app = express();
  app.disable('x-powered-by');
  // Escapa <, > e & nos JSONs: defesa extra caso algum navegador trate a resposta como HTML.
  app.set('json escape', true);

  app.use(cabecalhosDeSeguranca);
  if (ehLoopback(host)) app.use(validarHost(hostsPermitidos));

  app.use('/api', criarApi(armazenamento));

  app.get(['/', '/index.html'], (req, res, next) => {
    res.sendFile('index.html', { root: raiz, dotfiles: 'deny' }, (erro) => {
      if (erro && !res.headersSent) next(erro);
    });
  });
  for (const pasta of PASTAS_PUBLICAS) {
    app.use(`/${pasta}`, express.static(path.join(raiz, pasta), { index: false, redirect: false, dotfiles: 'ignore' }));
  }

  app.use((req, res) => res.status(404).json({ erro: 'Não encontrado.' }));
  app.use(tratarErro);
  return app;
}
