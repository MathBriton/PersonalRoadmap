import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { criarApi, ErroApi } from '../js/api.js';
import { grafosAlcancaveis, validarRoadmap } from '../js/dados.js';
import { criarApp } from '../server/app.js';
import { criarArmazenamento } from '../server/armazenamento.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSP =
  "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// O armazenamento e o tratamento de erro avisam no console; aqui os avisos viram dado de teste.
mock.method(console, 'warn', () => {});
mock.method(console, 'error', () => {});
const avisosDoConsole = () => console.warn.mock.calls.map((chamada) => chamada.arguments.join(' '));

const temporarios = [];
after(() => Promise.all(temporarios.map((dir) => rm(dir, { recursive: true, force: true }))));
async function novoDiretorio() {
  const dir = await mkdtemp(path.join(tmpdir(), 'grafos-servidor-'));
  temporarios.push(dir);
  return dir;
}

const tentarJson = (texto) => {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
};

/** Cliente de alto nível (fetch nativo): JSON por padrão. */
async function chamar(base, metodo, caminho, corpo, cabecalhos = {}) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...cabecalhos },
    body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, cabecalhos: resposta.headers, texto, corpo: tentarJson(texto) };
}

/** Cliente de baixo nível (node:http): caminhos sem normalização e cabeçalhos livres (Host, Origin). */
function bruto(porta, { metodo = 'GET', caminho, cabecalhos = {}, corpo }) {
  return new Promise((resolver, rejeitar) => {
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos, agent: false }, (res) => {
      const partes = [];
      res.on('data', (parte) => partes.push(parte));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        resolver({ status: res.statusCode, cabecalhos: new Headers(res.headers), texto, corpo: tentarJson(texto) });
      });
    });
    req.on('error', rejeitar);
    req.end(corpo);
  });
}

/** Sobe o app numa porta livre, sobre o arquivo de dados `arquivo`. */
async function abrir(arquivo, { sementes, host, hostsPermitidos, diretorioPublico = RAIZ, armazenamento: pronto } = {}) {
  const armazenamento = pronto ?? (await criarArmazenamento({ arquivo, sementes }));
  const servidor = createServer(criarApp({ armazenamento, diretorioPublico, host, hostsPermitidos }));
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const porta = servidor.address().port;
  const base = `http://127.0.0.1:${porta}`;
  return {
    armazenamento,
    porta,
    base,
    chamar: (...argumentos) => chamar(base, ...argumentos),
    bruto: (opcoes) => bruto(porta, opcoes),
    async fechar() {
      servidor.closeAllConnections();
      await new Promise((resolver) => servidor.close(resolver));
      await armazenamento.aguardarGravacoes();
    },
  };
}

/** Roda `fn` com um servidor novo sobre um diretório temporário. */
async function comServidor(fn, opcoes = {}) {
  const diretorio = await novoDiretorio();
  const arquivo = path.join(diretorio, 'dados.json');
  const servidor = await abrir(arquivo, opcoes);
  try {
    await fn({ ...servidor, diretorio, arquivo });
  } finally {
    await servidor.fechar();
  }
}

const roadmap = (titulo = 'Teste', extra = {}) => ({
  raiz: 'raiz',
  grafos: {
    raiz: { titulo, nos: [{ id: 'a', titulo: 'A', resumo: 'r', exemplo: '', links: [['Doc', 'https://exemplo.com']] }], arestas: [] },
  },
  ...extra,
});
const reg = (status, atualizado, extra = {}) => ({ status, intervalo: 0, proxima: 0, atualizado, ...extra });
const lerArquivo = async (arquivo) => JSON.parse(await readFile(arquivo, 'utf8'));

// ---------------------------------------------------------------- endpoints do contrato

test('GET /api/saude', () =>
  comServidor(async ({ chamar }) => {
    const r = await chamar('GET', '/api/saude');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { ok: true });
    assert.match(r.cabecalhos.get('content-type'), /^application\/json/);
  }));

test('ciclo completo de um roadmap: criar, listar, ler, atualizar, progresso e apagar', () =>
  comServidor(async ({ chamar }) => {
    const vazio = await chamar('GET', '/api/roadmaps');
    assert.deepEqual([vazio.status, vazio.corpo], [200, []]);

    const criado = await chamar('POST', '/api/roadmaps', { id: 'meu', roadmap: roadmap('Meu estudo') });
    assert.equal(criado.status, 201);
    assert.equal(criado.cabecalhos.get('location'), '/api/roadmaps/meu');
    assert.deepEqual(Object.keys(criado.corpo).sort(), ['atualizadoEm', 'avisos', 'id', 'roadmap']);
    assert.equal(criado.corpo.id, 'meu');
    assert.deepEqual(criado.corpo.roadmap, roadmap('Meu estudo'));
    assert.deepEqual(criado.corpo.avisos, []);
    assert.ok(!Number.isNaN(Date.parse(criado.corpo.atualizadoEm)));

    const repetido = await chamar('POST', '/api/roadmaps', { id: 'meu', roadmap: roadmap() });
    assert.equal(repetido.status, 409);
    assert.match(repetido.corpo.erro, /meu/);

    const lido = await chamar('GET', '/api/roadmaps/meu');
    assert.equal(lido.status, 200);
    assert.deepEqual(lido.corpo, { id: 'meu', roadmap: roadmap('Meu estudo'), atualizadoEm: criado.corpo.atualizadoEm });

    const lista = await chamar('GET', '/api/roadmaps');
    assert.deepEqual(lista.corpo, [
      { id: 'meu', titulo: 'Meu estudo', topicos: 1, grafos: 1, atualizadoEm: criado.corpo.atualizadoEm },
    ]);

    const alterado = await chamar('PUT', '/api/roadmaps/meu', { roadmap: roadmap('Novo título') });
    assert.equal(alterado.status, 200);
    assert.deepEqual(Object.keys(alterado.corpo).sort(), ['atualizadoEm', 'avisos', 'id', 'roadmap']);
    assert.equal(alterado.corpo.roadmap.grafos.raiz.titulo, 'Novo título');
    assert.ok(alterado.corpo.atualizadoEm > criado.corpo.atualizadoEm);

    const semProgresso = await chamar('GET', '/api/roadmaps/meu/progresso');
    assert.deepEqual([semProgresso.status, semProgresso.corpo], [200, { resetEm: 0, registros: {} }]);

    const marcado = await chamar('POST', '/api/roadmaps/meu/progresso', { registros: { 'raiz/a': reg('estudando', 10) } });
    assert.equal(marcado.status, 200);
    assert.deepEqual(marcado.corpo, { resetEm: 0, registros: { 'raiz/a': reg('estudando', 10) } });
    assert.deepEqual((await chamar('GET', '/api/roadmaps/meu/progresso')).corpo, marcado.corpo);

    const apagado = await chamar('DELETE', '/api/roadmaps/meu');
    assert.equal(apagado.status, 204);
    assert.equal(apagado.texto, '');
    for (const [metodo, caminho, corpo] of [
      ['GET', '/api/roadmaps/meu'],
      ['PUT', '/api/roadmaps/meu', { roadmap: roadmap() }],
      ['DELETE', '/api/roadmaps/meu'],
      ['GET', '/api/roadmaps/meu/progresso'],
      ['POST', '/api/roadmaps/meu/progresso', { registros: {} }],
    ]) {
      const r = await chamar(metodo, caminho, corpo);
      assert.equal(r.status, 404, `${metodo} ${caminho}`);
      assert.equal(typeof r.corpo.erro, 'string');
    }

    // Recriar com o mesmo id não traz o progresso de volta: o DELETE apagou os dois.
    await chamar('POST', '/api/roadmaps', { id: 'meu', roadmap: roadmap() });
    assert.deepEqual((await chamar('GET', '/api/roadmaps/meu/progresso')).corpo, { resetEm: 0, registros: {} });
  }));

test('POST sem id gera o id do título, evita colisão e ids reservados', () =>
  comServidor(async ({ chamar }) => {
    const ids = [];
    for (const titulo of ['Renderização e listas', 'Renderização e listas', 'Revisão', 'API', '???']) {
      const r = await chamar('POST', '/api/roadmaps', { roadmap: roadmap(titulo) });
      assert.equal(r.status, 201, titulo);
      assert.equal(r.cabecalhos.get('location'), `/api/roadmaps/${r.corpo.id}`);
      ids.push(r.corpo.id);
    }
    assert.deepEqual(ids, ['renderizacao-e-listas', 'renderizacao-e-listas-2', 'revisao-2', 'api-2', 'roadmap']);
  }));

test('o título do roadmap (campo "titulo") tem prioridade sobre o do grafo raiz, e a descrição aparece na lista', () =>
  comServidor(async ({ chamar }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap('Grafo raiz', { titulo: '  Título próprio ', descricao: ' Descrição ' }) });
    const [item] = (await chamar('GET', '/api/roadmaps')).corpo;
    assert.equal(item.titulo, 'Título próprio');
    assert.equal(item.descricao, 'Descrição');
  }));

test('a lista conta só tópicos e grafos alcançáveis da raiz e vem ordenada por título', () =>
  comServidor(async ({ chamar }) => {
    const no = (id, filho) => ({ id, titulo: id, resumo: '', exemplo: '', links: [], ...(filho ? { filho } : {}) });
    const complexo = {
      raiz: 'r',
      grafos: {
        r: { titulo: 'R', nos: [no('1', 'sub'), no('2')], arestas: [['1', '2']] },
        sub: { titulo: 'Sub', nos: [no('3')], arestas: [] },
        orfao: { titulo: 'Órfão', nos: [no('4'), no('5'), no('6')], arestas: [] },
      },
    };
    await chamar('POST', '/api/roadmaps', { id: 'zeta', roadmap: roadmap('Zeta') });
    await chamar('POST', '/api/roadmaps', { id: 'complexo', roadmap: { ...complexo, titulo: 'Beta' } });
    await chamar('POST', '/api/roadmaps', { id: 'alfa', roadmap: roadmap('alfa') });
    const lista = (await chamar('GET', '/api/roadmaps')).corpo;
    assert.deepEqual(lista.map((item) => item.titulo), ['alfa', 'Beta', 'Zeta']);
    const beta = lista[1];
    assert.equal(beta.topicos, 3);
    assert.equal(beta.grafos, 2);
  }));

test('roadmap inválido: 400 com a mensagem; avisos voltam na resposta e nada inválido é gravado', () =>
  comServidor(async ({ chamar }) => {
    const casos = [
      { roadmap: { raiz: 'x', grafos: {} } },
      { roadmap: 'texto' },
      { roadmap: null },
      {},
      { id: 'ok' },
    ];
    for (const corpo of casos) {
      const r = await chamar('POST', '/api/roadmaps', corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.match(r.corpo.erro, /Roadmap inválido/);
    }
    assert.match((await chamar('POST', '/api/roadmaps', { roadmap: { raiz: 'x', grafos: {} } })).corpo.erro, /grafo raiz "x" não existe/);

    for (const corpo of [[], 'texto', 42, null]) {
      const r = await chamar('POST', '/api/roadmaps', JSON.stringify(corpo));
      assert.equal(r.status, 400);
      assert.equal(typeof r.corpo.erro, 'string');
    }

    const sujo = roadmap();
    sujo.grafos.raiz.nos[0].links.push(['Perigo', 'javascript:alert(1)']);
    sujo.grafos.raiz.arestas.push(['a', 'fantasma']);
    const criado = await chamar('POST', '/api/roadmaps', { id: 'sujo', roadmap: sujo });
    assert.equal(criado.status, 201);
    assert.equal(criado.corpo.avisos.length, 2);
    assert.deepEqual(criado.corpo.roadmap.grafos.raiz.nos[0].links, [['Doc', 'https://exemplo.com']]);
    assert.deepEqual(criado.corpo.roadmap.grafos.raiz.arestas, []);

    const antes = (await chamar('GET', '/api/roadmaps/sujo')).corpo;
    const invalido = await chamar('PUT', '/api/roadmaps/sujo', { roadmap: { raiz: 'x', grafos: {} } });
    assert.equal(invalido.status, 400);
    assert.deepEqual((await chamar('GET', '/api/roadmaps/sujo')).corpo, antes);
    assert.equal((await chamar('GET', '/api/roadmaps')).corpo.length, 1);
  }));

test('PUT com baseadoEm desatualizado dá 409 (com o atualizadoEm atual); com o correto, 200', () =>
  comServidor(async ({ chamar }) => {
    const t0 = (await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap('Um') })).corpo.atualizadoEm;
    const primeiro = await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Dois'), baseadoEm: t0 });
    assert.equal(primeiro.status, 200);
    const t1 = primeiro.corpo.atualizadoEm;
    assert.ok(t1 > t0);

    const velho = await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Três'), baseadoEm: t0 });
    assert.equal(velho.status, 409);
    assert.equal(typeof velho.corpo.erro, 'string');
    assert.equal(velho.corpo.atualizadoEm, t1);
    assert.equal((await chamar('GET', '/api/roadmaps/x')).corpo.roadmap.grafos.raiz.titulo, 'Dois');

    const certo = await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Quatro'), baseadoEm: t1 });
    assert.equal(certo.status, 200);
    // Sem baseadoEm (ou com null) a escrita não é condicional.
    assert.equal((await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Cinco') })).status, 200);
    assert.equal((await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Seis'), baseadoEm: null })).status, 200);
    assert.equal((await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap(), baseadoEm: 123 })).status, 400);
    assert.equal((await chamar('PUT', '/api/roadmaps/inexistente', { roadmap: roadmap() })).status, 404);
  }));

test('duas edições com o mesmo baseadoEm: só uma vence, a outra recebe 409', () =>
  comServidor(async ({ chamar }) => {
    const t0 = (await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() })).corpo.atualizadoEm;
    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap(`Edição ${i}`), baseadoEm: t0 })),
    );
    assert.deepEqual(resultados.map((r) => r.status).sort(), [200, ...Array(9).fill(409)]);
  }));

test('atualizadoEm é estritamente crescente mesmo em gravações no mesmo milissegundo ou com o relógio voltando', async () => {
  const diretorio = await novoDiretorio();
  const instantes = [5_000_000, 5_000_000, 5_000_000, 1_000, 5_000_000];
  const armazenamento = await criarArmazenamento({ arquivo: path.join(diretorio, 'dados.json'), relogio: () => instantes.shift() ?? 5_000_000 });
  const t0 = (await armazenamento.criar({ id: 'x', roadmap: roadmap() })).atualizadoEm;
  const seguintes = [];
  for (let i = 0; i < 3; i += 1) seguintes.push((await armazenamento.atualizar('x', roadmap(), undefined)).atualizadoEm);
  const todos = [t0, ...seguintes];
  assert.deepEqual([...todos].sort(), todos);
  assert.equal(new Set(todos).size, todos.length);
  await assert.rejects(armazenamento.atualizar('x', roadmap(), t0), { codigo: 'conflito' });
});

// ---------------------------------------------------------------- progresso

test('mesclagem de progresso: a ordem de chegada não muda o resultado', () =>
  comServidor(async ({ chamar }) => {
    for (const id of ['a', 'b']) await chamar('POST', '/api/roadmaps', { id, roadmap: roadmap() });
    const p1 = { registros: { 'raiz/a': reg('estudando', 10), 'raiz/b': reg('dominado', 20, { intervalo: 1, proxima: 1000 }) } };
    const p2 = { registros: { 'raiz/a': reg('novo', 30), 'raiz/c': reg('estudando', 5) } };

    await chamar('POST', '/api/roadmaps/a/progresso', p1);
    const ab = await chamar('POST', '/api/roadmaps/a/progresso', p2);
    await chamar('POST', '/api/roadmaps/b/progresso', p2);
    const ba = await chamar('POST', '/api/roadmaps/b/progresso', p1);

    assert.equal(ab.status, 200);
    assert.deepEqual(ab.corpo, ba.corpo);
    assert.deepEqual(Object.keys(ab.corpo.registros).sort(), ['raiz/a', 'raiz/b', 'raiz/c']);
    assert.equal(ab.corpo.registros['raiz/a'].atualizado, 30);
    // Reenviar o que o servidor já tem não muda nada (idempotente).
    assert.deepEqual((await chamar('POST', '/api/roadmaps/a/progresso', p1)).corpo, ab.corpo);
    assert.deepEqual((await chamar('GET', '/api/roadmaps/b/progresso')).corpo, ab.corpo);
  }));

test('resetEm descarta registros mais antigos, vale o maior e registros velhos não voltam', () =>
  comServidor(async ({ chamar }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    await chamar('POST', '/api/roadmaps/x/progresso', {
      registros: { 'raiz/a': reg('estudando', 10), 'raiz/b': reg('estudando', 20), 'raiz/c': reg('estudando', 30) },
    });
    const zerado = await chamar('POST', '/api/roadmaps/x/progresso', { resetEm: 25, registros: {} });
    assert.deepEqual(Object.keys(zerado.corpo.registros), ['raiz/c']);
    assert.equal(zerado.corpo.resetEm, 25);

    const velho = await chamar('POST', '/api/roadmaps/x/progresso', { registros: { 'raiz/a': reg('dominado', 10) } });
    assert.deepEqual(Object.keys(velho.corpo.registros), ['raiz/c']);
    const menor = await chamar('POST', '/api/roadmaps/x/progresso', { resetEm: 5, registros: {} });
    assert.equal(menor.corpo.resetEm, 25);
    const total = await chamar('POST', '/api/roadmaps/x/progresso', { resetEm: 1000, registros: {} });
    assert.deepEqual(total.corpo, { resetEm: 1000, registros: {} });
  }));

test('progresso: corpo inválido dá 400 e registros malformados são descartados', () =>
  comServidor(async ({ chamar }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    for (const corpo of [{}, { registros: [] }, { registros: 'x' }, { registros: null }, { registros: {}, resetEm: 'ontem' }, { registros: {}, resetEm: -1 }]) {
      const r = await chamar('POST', '/api/roadmaps/x/progresso', corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo));
      assert.equal(typeof r.corpo.erro, 'string');
    }
    const r = await chamar('POST', '/api/roadmaps/x/progresso', {
      registros: { 'sem-barra': reg('dominado', 5), 'raiz/a': { status: 'inventado', atualizado: 7 }, [`g/${'x'.repeat(400)}`]: reg('novo', 1) },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.registros, { 'raiz/a': { status: 'novo', intervalo: 0, proxima: 0, atualizado: 7 } });
  }));

test('50 POSTs de progresso simultâneos, com chaves diferentes, terminam todos presentes', () =>
  comServidor(async ({ chamar, arquivo, diretorio }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    const respostas = await Promise.all(
      Array.from({ length: 50 }, (_, i) => chamar('POST', '/api/roadmaps/x/progresso', { registros: { [`g/n${i}`]: reg('estudando', 100 + i) } })),
    );
    assert.ok(respostas.every((r) => r.status === 200));
    const esperadas = Array.from({ length: 50 }, (_, i) => `g/n${i}`).sort();
    assert.deepEqual(Object.keys((await chamar('GET', '/api/roadmaps/x/progresso')).corpo.registros).sort(), esperadas);
    assert.deepEqual(Object.keys((await lerArquivo(arquivo)).progresso.x.registros).sort(), esperadas);
    assert.deepEqual(await readdir(diretorio), ['dados.json']);
  }));

test('POSTs simultâneos de roadmap sem id, com o mesmo título, recebem ids diferentes', () =>
  comServidor(async ({ chamar }) => {
    const respostas = await Promise.all(Array.from({ length: 15 }, () => chamar('POST', '/api/roadmaps', { roadmap: roadmap('Mesmo título') })));
    assert.ok(respostas.every((r) => r.status === 201));
    assert.equal(new Set(respostas.map((r) => r.corpo.id)).size, 15);
    assert.equal((await chamar('GET', '/api/roadmaps')).corpo.length, 15);
  }));

test('gravações enfileiradas terminam antes de aguardarGravacoes() resolver', async () => {
  const diretorio = await novoDiretorio();
  const arquivo = path.join(diretorio, 'dados.json');
  const armazenamento = await criarArmazenamento({ arquivo });
  await armazenamento.criar({ id: 'x', roadmap: roadmap() });
  for (let i = 0; i < 30; i += 1) armazenamento.mesclarProgresso('x', { registros: { [`g/n${i}`]: reg('novo', i) } });
  await armazenamento.aguardarGravacoes();
  assert.equal(Object.keys((await lerArquivo(arquivo)).progresso.x.registros).length, 30);
});

// ---------------------------------------------------------------- persistência

test('semeia data/*.json na primeira execução, ignorando o que não serve de semente', async () => {
  const sementes = await novoDiretorio();
  await writeFile(path.join(sementes, 'bom.json'), JSON.stringify(roadmap('Bom')));
  await writeFile(path.join(sementes, 'Maiusculo.json'), JSON.stringify(roadmap()));
  await writeFile(path.join(sementes, 'revisao.json'), JSON.stringify(roadmap()));
  await writeFile(path.join(sementes, 'quebrado.json'), '{nao é json');
  await writeFile(path.join(sementes, 'sem-raiz.json'), JSON.stringify({ raiz: 'x', grafos: {} }));
  await writeFile(path.join(sementes, 'notas.txt'), 'não é json');
  await mkdir(path.join(sementes, 'pasta.json'));
  avisosDoConsole(); // só para garantir que o mock existe
  console.warn.mock.resetCalls();

  await comServidor(
    async ({ chamar }) => {
      const lista = (await chamar('GET', '/api/roadmaps')).corpo;
      assert.deepEqual(lista.map((item) => item.id), ['bom']);
      assert.equal(avisosDoConsole().filter((a) => a.includes('Semente')).length, 4);
    },
    { sementes },
  );
});

test('semeia o data/react.json de verdade, idêntico ao validado', () =>
  comServidor(
    async ({ chamar }) => {
      const esperado = validarRoadmap(JSON.parse(await readFile(path.join(RAIZ, 'data', 'react.json'), 'utf8'))).roadmap;
      const r = await chamar('GET', '/api/roadmaps/react');
      assert.equal(r.status, 200);
      assert.deepEqual(r.corpo.roadmap, JSON.parse(JSON.stringify(esperado)));
      const [item] = (await chamar('GET', '/api/roadmaps')).corpo;
      assert.equal(item.id, 'react');
      assert.equal(item.grafos, grafosAlcancaveis(esperado).length);
    },
    { sementes: path.join(RAIZ, 'data') },
  ));

test('não ressemeia depois de DELETE + reinício', async () => {
  const diretorio = await novoDiretorio();
  const arquivo = path.join(diretorio, 'dados.json');
  const sementes = path.join(RAIZ, 'data');

  const primeira = await abrir(arquivo, { sementes });
  assert.equal((await primeira.chamar('GET', '/api/roadmaps/react')).status, 200);
  assert.equal((await primeira.chamar('DELETE', '/api/roadmaps/react')).status, 204);
  await primeira.fechar();

  const segunda = await abrir(arquivo, { sementes });
  try {
    assert.deepEqual((await segunda.chamar('GET', '/api/roadmaps')).corpo, []);
    assert.equal((await segunda.chamar('GET', '/api/roadmaps/react')).status, 404);
  } finally {
    await segunda.fechar();
  }
});

test('persistência: recriar o armazenamento a partir do mesmo arquivo preserva tudo', async () => {
  const diretorio = await novoDiretorio();
  const arquivo = path.join(diretorio, 'dados.json');

  const antes = await abrir(arquivo);
  await antes.chamar('POST', '/api/roadmaps', { id: 'um', roadmap: roadmap('Um') });
  await antes.chamar('POST', '/api/roadmaps', { id: 'constructor', roadmap: roadmap('Constructor') });
  const editado = await antes.chamar('PUT', '/api/roadmaps/um', { roadmap: roadmap('Um editado', { descricao: 'Desc' }) });
  await antes.chamar('POST', '/api/roadmaps/um/progresso', { registros: { 'raiz/a': reg('dominado', 50, { intervalo: 2, proxima: 9000 }) } });
  await antes.chamar('POST', '/api/roadmaps/um/progresso', { resetEm: 40, registros: {} });
  const fotografia = async (s) => ({
    lista: (await s.chamar('GET', '/api/roadmaps')).corpo,
    um: (await s.chamar('GET', '/api/roadmaps/um')).corpo,
    constructor: (await s.chamar('GET', '/api/roadmaps/constructor')).corpo,
    progresso: (await s.chamar('GET', '/api/roadmaps/um/progresso')).corpo,
  });
  const esperado = await fotografia(antes);
  await antes.fechar();

  const dados = await lerArquivo(arquivo);
  assert.equal(dados.versao, 1);
  assert.deepEqual(Object.keys(dados.roadmaps).sort(), ['constructor', 'um']);
  assert.equal(dados.roadmaps.um.atualizadoEm, editado.corpo.atualizadoEm);
  assert.deepEqual(dados.progresso.um, { resetEm: 40, registros: { 'raiz/a': reg('dominado', 50, { intervalo: 2, proxima: 9000 }) } });

  const depois = await abrir(arquivo);
  try {
    assert.deepEqual(await fotografia(depois), esperado);
    assert.equal(esperado.um.atualizadoEm, editado.corpo.atualizadoEm);
  } finally {
    await depois.fechar();
  }
});

test('arquivo corrompido: é guardado como .corrompido-*, o servidor sobe vazio e não ressemeia', async () => {
  const roadmapRuim = { 'x': { roadmap: { raiz: 'z', grafos: {} }, atualizadoEm: '2026-01-01T00:00:00.000Z' } };
  const casos = {
    truncado: '{"versao":1,"roadmaps":{',
    'lixo binário': '\u0000\u0001não é json',
    'não é objeto': '[]',
    'versão desconhecida': JSON.stringify({ versao: 2, roadmaps: {}, progresso: {} }),
    'sem roadmaps': JSON.stringify({ versao: 1 }),
    'roadmap irrecuperável': JSON.stringify({ versao: 1, roadmaps: roadmapRuim, progresso: {} }),
    'id inválido': JSON.stringify({ versao: 1, roadmaps: { 'Id Ruim': { roadmap: roadmap(), atualizadoEm: '2026-01-01T00:00:00.000Z' } } }),
    'sem atualizadoEm': JSON.stringify({ versao: 1, roadmaps: { x: { roadmap: roadmap() } } }),
  };
  for (const [nome, conteudo] of Object.entries(casos)) {
    const diretorio = await novoDiretorio();
    const arquivo = path.join(diretorio, 'dados.json');
    await writeFile(arquivo, conteudo);
    console.warn.mock.resetCalls();

    const sementes = path.join(RAIZ, 'data'); // se ressemeasse, o react apareceria
    const servidor = await abrir(arquivo, { sementes });
    try {
      assert.deepEqual((await servidor.chamar('GET', '/api/roadmaps')).corpo, [], nome);
    } finally {
      await servidor.fechar();
    }
    const arquivos = await readdir(diretorio);
    const guardado = arquivos.filter((a) => a.startsWith('dados.json.corrompido-'));
    assert.equal(guardado.length, 1, nome);
    assert.equal(await readFile(path.join(diretorio, guardado[0]), 'utf8'), conteudo, nome);
    assert.deepEqual(arquivos.sort(), ['dados.json', guardado[0]].sort(), nome);
    assert.deepEqual(await lerArquivo(arquivo), { versao: 1, roadmaps: {}, progresso: {} }, nome);
    assert.ok(avisosDoConsole().some((a) => a.includes('corrompido')), nome);

    // Um segundo início não mexe mais em nada e também não ressemeia.
    const outra = await abrir(arquivo, { sementes });
    try {
      assert.deepEqual((await outra.chamar('GET', '/api/roadmaps')).corpo, [], nome);
    } finally {
      await outra.fechar();
    }
    assert.equal((await readdir(diretorio)).length, 2, nome);
  }
});

test('nenhum arquivo temporário sobra depois de qualquer operação', () =>
  comServidor(async ({ chamar, diretorio }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Outro') });
    await chamar('POST', '/api/roadmaps/x/progresso', { registros: { 'g/n': reg('novo', 1) } });
    await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap(), baseadoEm: '2000-01-01T00:00:00.000Z' }); // 409
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() }); // 409
    await chamar('DELETE', '/api/roadmaps/x');
    assert.deepEqual(await readdir(diretorio), ['dados.json']);
  }));

test('falha de gravação: 500 genérico sem caminho, e a memória continua igual ao disco', () =>
  comServidor(async ({ chamar, arquivo, diretorio }) => {
    const criado = await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap('Antes') });
    await chamar('POST', '/api/roadmaps/x/progresso', { registros: { 'g/a': reg('novo', 1) } });
    const estadoBom = async () => ({
      roadmap: (await chamar('GET', '/api/roadmaps/x')).corpo,
      progresso: (await chamar('GET', '/api/roadmaps/x/progresso')).corpo,
      lista: (await chamar('GET', '/api/roadmaps')).corpo.length,
    });
    const antes = await estadoBom();
    const falhas = async () => [
      await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Depois') }),
      await chamar('POST', '/api/roadmaps', { id: 'y', roadmap: roadmap() }),
      await chamar('POST', '/api/roadmaps/x/progresso', { registros: { 'g/b': reg('novo', 2) } }),
      await chamar('DELETE', '/api/roadmaps/x'),
    ];
    const conferir = (respostas) => {
      for (const r of respostas) {
        assert.equal(r.status, 500);
        assert.deepEqual(r.corpo, { erro: 'Erro interno.' });
        assert.ok(!r.texto.includes(diretorio) && !r.texto.includes('tmp') && !/EISDIR|ENOTDIR|EACCES/.test(r.texto));
      }
    };

    // 1) o arquivo temporário não pode ser aberto (há um diretório no lugar)
    console.error.mock.resetCalls();
    await mkdir(`${arquivo}.tmp`);
    conferir(await falhas());
    assert.ok(console.error.mock.calls.length >= 4);
    assert.deepEqual(await estadoBom(), antes);
    assert.equal((await lerArquivo(arquivo)).roadmaps.x.atualizadoEm, criado.corpo.atualizadoEm);
    await rm(`${arquivo}.tmp`, { recursive: true });

    // 2) o rename falha (o destino virou um diretório): o temporário não pode ficar para trás
    await rm(arquivo);
    await mkdir(arquivo);
    conferir(await falhas());
    assert.deepEqual(await estadoBom(), antes);
    assert.deepEqual(await readdir(diretorio), ['dados.json']);
    await rm(arquivo, { recursive: true });

    // Passado o problema, tudo volta a funcionar e o disco recebe o estado completo.
    const ok = await chamar('PUT', '/api/roadmaps/x', { roadmap: roadmap('Depois') });
    assert.equal(ok.status, 200);
    const dados = await lerArquivo(arquivo);
    assert.equal(dados.roadmaps.x.roadmap.grafos.raiz.titulo, 'Depois');
    assert.deepEqual(Object.keys(dados.progresso.x.registros), ['g/a']);
  }));

// ---------------------------------------------------------------- formato do pedido

test('corpo maior que 5 MB (o mesmo limite do lerPacote): 413; logo abaixo do limite o corpo é lido normalmente', () =>
  comServidor(async ({ chamar, bruto }) => {
    const enorme = JSON.stringify({ roadmap: 'x'.repeat(5 * 1024 * 1024 + 10) });
    for (const [metodo, caminho] of [['POST', '/api/roadmaps'], ['POST', '/api/roadmaps/x/progresso']]) {
      const r = await chamar(metodo, caminho, enorme);
      assert.equal(r.status, 413, caminho);
      assert.match(r.corpo.erro, /5 MB/);
    }
    // Content-Length mentindo para menos não adianta: o limite vale para o que chega.
    const r = await bruto({
      metodo: 'POST',
      caminho: '/api/roadmaps',
      cabecalhos: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      corpo: enorme,
    });
    assert.equal(r.status, 413);

    const quase = await chamar('POST', '/api/roadmaps', JSON.stringify({ roadmap: 'x'.repeat(4.9 * 1024 * 1024) }));
    assert.equal(quase.status, 400);
    assert.match(quase.corpo.erro, /Roadmap inválido/);
  }));

test('JSON malformado: 400; corpo vazio ou que não é objeto: 400', () =>
  comServidor(async ({ chamar, bruto }) => {
    for (const texto of ['{"roadmap":', '{nao json}', '', '{"a":1}}']) {
      const r = await chamar('POST', '/api/roadmaps', texto === '' ? undefined : texto);
      assert.equal(r.status, 400, texto);
      assert.equal(typeof r.corpo.erro, 'string');
    }
    assert.equal((await chamar('POST', '/api/roadmaps', '{"roadmap":')).corpo.erro, 'JSON malformado.');
    const vazio = await bruto({ metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'application/json', 'content-length': '0' } });
    assert.equal(vazio.status, 400);
    assert.equal(typeof vazio.corpo.erro, 'string');
  }));

test('escritas sem Content-Type application/json: 415, e nada é gravado', () =>
  comServidor(async ({ chamar, bruto }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    const corpo = JSON.stringify({ id: 'y', roadmap: roadmap() });
    const tentativas = [
      { metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: {}, corpo },
      { metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'text/plain' }, corpo },
      { metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'application/x-www-form-urlencoded' }, corpo },
      { metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'application/json; charset=latin1' }, corpo },
      { metodo: 'PUT', caminho: '/api/roadmaps/x', cabecalhos: { 'content-type': 'text/plain' }, corpo: JSON.stringify({ roadmap: roadmap('Z') }) },
      { metodo: 'POST', caminho: '/api/roadmaps/x/progresso', cabecalhos: {}, corpo: JSON.stringify({ registros: { 'g/n': reg('novo', 1) } }) },
      // DELETE com corpo segue a regra geral; sem corpo, ver o teste seguinte.
      // (o node:http não declara o tamanho do corpo de um DELETE sozinho, por isso o Content-Length à mão)
      { metodo: 'DELETE', caminho: '/api/roadmaps/x', cabecalhos: { 'content-type': 'text/plain', 'content-length': '4' }, corpo: 'lixo' },
    ];
    for (const tentativa of tentativas) {
      const r = await bruto(tentativa);
      assert.equal(r.status, 415, `${tentativa.metodo} ${tentativa.caminho} ${JSON.stringify(tentativa.cabecalhos)}`);
      assert.equal(typeof r.corpo.erro, 'string');
    }
    const lista = (await chamar('GET', '/api/roadmaps')).corpo;
    assert.deepEqual(lista.map((item) => item.id), ['x']);
    assert.equal((await chamar('GET', '/api/roadmaps/x')).corpo.roadmap.grafos.raiz.titulo, 'Teste');
    assert.deepEqual((await chamar('GET', '/api/roadmaps/x/progresso')).corpo.registros, {});

    // Com charset utf-8 declarado funciona.
    const ok = await bruto({ metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'Application/JSON; charset=UTF-8' }, corpo });
    assert.equal(ok.status, 201);
  }));

test('DELETE sem corpo funciona sem Content-Type (é como o cliente do app envia), mas Origin e Host continuam valendo', () =>
  comServidor(async ({ bruto, porta, chamar }) => {
    for (const id of ['a', 'b', 'c']) await chamar('POST', '/api/roadmaps', { id, roadmap: roadmap() });

    // Origin estranho: 403 mesmo sem Content-Type, e nada é apagado.
    const outraOrigem = await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/a', cabecalhos: { origin: 'http://evil.example' } });
    assert.equal(outraOrigem.status, 403);
    const hostRuim = await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/a', cabecalhos: { host: 'evil.example' } });
    assert.equal(hostRuim.status, 403);
    assert.equal((await chamar('GET', '/api/roadmaps')).corpo.length, 3);

    // Sem Content-Type e sem corpo, com a Origin certa (o que o navegador faz): apaga.
    const semTipo = await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/a', cabecalhos: { origin: `http://127.0.0.1:${porta}` } });
    assert.equal(semTipo.status, 204);
    assert.equal(semTipo.texto, '');
    // Content-Length: 0 explícito também é "sem corpo".
    assert.equal((await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/b', cabecalhos: { 'content-length': '0' } })).status, 204);
    // Id inexistente continua sendo 404, não 415.
    assert.equal((await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/a' })).status, 404);
    assert.equal((await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/Invalido' })).status, 404);

    // Só POST/PUT (e DELETE com corpo) exigem o tipo: nada mais perdeu a exigência.
    const post = await bruto({ metodo: 'POST', caminho: '/api/roadmaps/c/progresso', corpo: '{"registros":{}}', cabecalhos: { 'content-length': '16' } });
    assert.equal(post.status, 415);
    const comCorpo = await bruto({ metodo: 'DELETE', caminho: '/api/roadmaps/c', cabecalhos: { 'content-length': '2' }, corpo: '{}' });
    assert.equal(comCorpo.status, 415);
    assert.deepEqual((await chamar('GET', '/api/roadmaps')).corpo.map((item) => item.id), ['c']);
  }));

test('o cliente real do frontend (js/api.js) funciona contra o servidor: criar, salvar, 409, progresso e excluir', () =>
  comServidor(async ({ base }) => {
    const api = criarApi({ base: new URL('/api/', base) });
    assert.deepEqual(await api.saude(), { ok: true });

    const criado = await api.criarRoadmap({ roadmap: roadmap('Via cliente') });
    assert.equal(criado.id, 'via-cliente');
    assert.deepEqual((await api.listarRoadmaps()).map((item) => item.id), ['via-cliente']);

    const salvo = await api.salvarRoadmap(criado.id, roadmap('Editado'), criado.atualizadoEm);
    assert.ok(salvo.atualizadoEm > criado.atualizadoEm);
    await assert.rejects(
      api.salvarRoadmap(criado.id, roadmap('Velho'), criado.atualizadoEm),
      (erro) => erro instanceof ErroApi && erro.status === 409 && erro.corpo.atualizadoEm === salvo.atualizadoEm,
    );

    const mesclado = await api.mesclarProgresso(criado.id, { resetEm: 0, registros: { 'raiz/a': reg('estudando', 10) } });
    assert.deepEqual(await api.obterProgresso(criado.id), mesclado);
    assert.equal((await api.obterRoadmap(criado.id)).roadmap.grafos.raiz.titulo, 'Editado');

    // É o botão "Excluir" da tela inicial: o cliente não manda Content-Type quando não há corpo.
    assert.equal(await api.excluirRoadmap(criado.id), null);
    await assert.rejects(api.obterRoadmap(criado.id), { status: 404 });
    await assert.rejects(api.excluirRoadmap(criado.id), { status: 404 });
    assert.deepEqual(await api.listarRoadmaps(), []);
  }));

test('ids inválidos na URL nunca chegam ao armazenamento: 404 em todas as rotas com :id', () =>
  comServidor(async ({ bruto, chamar }) => {
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: roadmap() });
    const ids = ['..%2Fx', '..%2f..%2fdados', 'A', 'revisao', 'api', 'a'.repeat(65), '__proto__', 'toString', 'a--b', '-a', 'a-', 'a%20b', '%00', '%2e%2e', '.hidden', 'x%2Fprogresso'];
    const json = { 'content-type': 'application/json' };
    for (const id of ids) {
      for (const [metodo, sufixo, corpo] of [
        ['GET', '', undefined],
        ['PUT', '', JSON.stringify({ roadmap: roadmap() })],
        ['DELETE', '', undefined],
        ['GET', '/progresso', undefined],
        ['POST', '/progresso', JSON.stringify({ registros: {} })],
      ]) {
        const r = await bruto({ metodo, caminho: `/api/roadmaps/${id}${sufixo}`, cabecalhos: json, corpo });
        assert.equal(r.status, 404, `${metodo} /api/roadmaps/${id}${sufixo}`);
        assert.equal(typeof r.corpo?.erro, 'string');
      }
    }
    // Um id válido, mas inexistente, também é 404; e o roadmap existente continua intacto.
    assert.equal((await chamar('GET', '/api/roadmaps/constructor')).status, 404);
    assert.equal((await chamar('GET', '/api/roadmaps')).corpo.length, 1);
  }));

test('ids inválidos no corpo do POST: 400, e nada é criado', () =>
  comServidor(async ({ chamar }) => {
    const ids = ['../x', 'A', 'revisao', 'api', 'a'.repeat(65), '__proto__', 'a b', 'a/b', '', 0, 123, true, {}, [], ['x']];
    for (const id of ids) {
      const r = await chamar('POST', '/api/roadmaps', { id, roadmap: roadmap() });
      assert.equal(r.status, 400, JSON.stringify(id));
      assert.match(r.corpo.erro, /Id de roadmap inválido/);
    }
    assert.equal((await chamar('POST', '/api/roadmaps', { id: 'a'.repeat(64), roadmap: roadmap() })).status, 201);
    assert.equal((await chamar('POST', '/api/roadmaps', { id: null, roadmap: roadmap() })).status, 201);
    assert.equal((await chamar('GET', '/api/roadmaps')).corpo.length, 2);
  }));

test('id inválido (URL ou corpo) é recusado antes de qualquer chamada ao armazenamento', async () => {
  const chamadas = [];
  const nomes = ['listar', 'obter', 'progressoDe', 'criar', 'atualizar', 'remover', 'mesclarProgresso'];
  const armazenamento = {
    aguardarGravacoes: async () => {},
    ...Object.fromEntries(nomes.map((nome) => [nome, (...argumentos) => void chamadas.push([nome, ...argumentos])])),
  };
  const servidor = await abrir('inutil', { armazenamento });
  try {
    const rotas = [['GET', ''], ['PUT', ''], ['DELETE', ''], ['GET', '/progresso'], ['POST', '/progresso']];
    for (const id of ['..%2Fx', 'A', 'revisao', 'api', 'a'.repeat(65), '__proto__', '%00']) {
      for (const [metodo, sufixo] of rotas) {
        const corpo = metodo === 'GET' || metodo === 'DELETE' ? undefined : { roadmap: roadmap(), registros: {} };
        assert.equal((await servidor.chamar(metodo, `/api/roadmaps/${id}${sufixo}`, corpo)).status, 404);
      }
    }
    assert.equal((await servidor.chamar('POST', '/api/roadmaps', { id: '../x', roadmap: roadmap() })).status, 400);
    assert.deepEqual(chamadas, []);

    // Prova de que o espião está ligado: um id válido chega ao armazenamento, exatamente como veio.
    await servidor.chamar('GET', '/api/roadmaps/valido');
    assert.deepEqual(chamadas, [['obter', 'valido']]);
  } finally {
    await servidor.fechar();
  }
});

test('chaves perigosas ("__proto__", "constructor") não poluem nada nem quebram o armazenamento', () =>
  comServidor(async ({ chamar, arquivo }) => {
    const textoRoadmap =
      '{"raiz":"raiz","grafos":{"__proto__":{"titulo":"Mal","nos":[],"arestas":[]},' +
      '"constructor":{"titulo":"Construtor","nos":[{"id":"__proto__","titulo":"P","resumo":"","exemplo":"","links":[]}],"arestas":[]},' +
      '"raiz":{"titulo":"R","nos":[{"id":"__proto__","titulo":"N","resumo":"","exemplo":"","links":[],"filho":"__proto__"},' +
      '{"id":"constructor","titulo":"C","resumo":"","exemplo":"","filho":"constructor"},{"id":"hasOwnProperty","titulo":"H","resumo":"","exemplo":""}],' +
      '"arestas":[["__proto__","constructor"],["constructor","hasOwnProperty"]]}}}';
    const criado = await chamar('POST', '/api/roadmaps', `{"id":"constructor","roadmap":${textoRoadmap}}`);
    assert.equal(criado.status, 201);
    assert.equal((await chamar('GET', '/api/roadmaps/constructor')).status, 200);
    assert.deepEqual((await chamar('GET', '/api/roadmaps/constructor')).corpo.roadmap, criado.corpo.roadmap);
    assert.equal((await chamar('PUT', '/api/roadmaps/constructor', `{"roadmap":${textoRoadmap}}`)).status, 200);

    const resposta = await chamar(
      'POST',
      '/api/roadmaps/constructor/progresso',
      '{"registros":{"__proto__":{"status":"dominado","atualizado":9},"__proto__/x":{"status":"dominado","intervalo":1,"proxima":5,"atualizado":9},' +
        '"constructor/y":{"status":"estudando","atualizado":8},"hasOwnProperty/z":{"status":"estudando","atualizado":7}}}',
    );
    assert.equal(resposta.status, 200);
    const registros = resposta.corpo.registros;
    assert.deepEqual(Object.keys(registros).sort(), ['__proto__/x', 'constructor/y', 'hasOwnProperty/z']);
    assert.equal(Object.hasOwn(registros, '__proto__'), false);
    assert.equal(registros['__proto__/x'].status, 'dominado');

    const semProto = await chamar('POST', '/api/roadmaps/constructor/progresso', '{"__proto__":{"polui":true},"resetEm":1,"registros":{"a/b":{"status":"novo","atualizado":3}}}');
    assert.equal(semProto.status, 200);
    assert.equal(({}).polui, undefined);
    assert.equal(({}).status, undefined);
    assert.equal(({}).titulo, undefined);
    assert.deepEqual(Object.keys(Object.prototype), []);

    // O que está em disco relê igual (a chave "constructor" vira propriedade própria, não método).
    const dados = await lerArquivo(arquivo);
    assert.ok(Object.hasOwn(dados.roadmaps, 'constructor'));
    assert.ok(Object.hasOwn(dados.progresso.constructor.registros, '__proto__/x'));
  }));

// ---------------------------------------------------------------- segurança

test('Host fora da lista de loopback: 403 em JSON (DNS rebinding), inclusive em estáticos e escritas', () =>
  comServidor(async ({ bruto, porta, chamar }) => {
    const ruins = ['evil.example', `evil.example:${porta}`, 'localhost', `localhost:${porta + 1}`, `127.0.0.1.evil.example:${porta}`, `localhost.evil.example:${porta}`, `127.0.0.2:${porta}`, `[::2]:${porta}`];
    for (const host of ruins) {
      for (const [metodo, caminho] of [['GET', '/api/saude'], ['GET', '/api/roadmaps'], ['GET', '/index.html'], ['GET', '/nada'], ['POST', '/api/roadmaps']]) {
        const r = await bruto({ metodo, caminho, cabecalhos: { Host: host, 'content-type': 'application/json' }, corpo: metodo === 'POST' ? JSON.stringify({ roadmap: roadmap() }) : undefined });
        assert.equal(r.status, 403, `${metodo} ${caminho} Host: "${host}"`);
        assert.equal(typeof r.corpo.erro, 'string');
        assert.match(r.cabecalhos.get('content-type'), /^application\/json/);
      }
    }
    assert.deepEqual((await chamar('GET', '/api/roadmaps')).corpo, []);

    // HTTP/1.0 pode vir sem Host nenhum: também é recusado.
    const semHost = await new Promise((resolver, rejeitar) => {
      const socket = connect(porta, '127.0.0.1', () => socket.end('GET /api/roadmaps HTTP/1.0\r\n\r\n'));
      let texto = '';
      socket.on('data', (parte) => (texto += parte));
      socket.on('close', () => resolver(texto));
      socket.on('error', rejeitar);
    });
    assert.match(semHost, /^HTTP\/1\.1 403/);

    for (const host of [`localhost:${porta}`, `127.0.0.1:${porta}`, `[::1]:${porta}`, `LocalHost:${porta}`]) {
      assert.equal((await bruto({ caminho: '/api/saude', cabecalhos: { Host: host } })).status, 200, host);
    }
  }));

test('na porta 80 o navegador omite ":80" do Host: o Host sem porta só é aceito nessa porta', async () => {
  const armazenamento = await criarArmazenamento({ arquivo: path.join(await novoDiretorio(), 'dados.json') });
  const servidor = createServer(criarApp({ armazenamento, diretorioPublico: RAIZ }));
  // Escutar na 80 exige privilégio; o app só consulta `socket.localPort`, então ele é trocado por conexão.
  let portaDaConexao;
  servidor.on('connection', (socket) => Object.defineProperty(socket, 'localPort', { value: portaDaConexao }));
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const porta = servidor.address().port;
  const status = async (host) => (await bruto(porta, { caminho: '/api/saude', cabecalhos: { Host: host } })).status;
  try {
    portaDaConexao = 80;
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'LocalHost', 'localhost:80', '127.0.0.1:80', '[::1]:80']) {
      assert.equal(await status(host), 200, host);
    }
    for (const host of [`localhost:${porta}`, 'evil.example', 'evil.example:80', 'localhost:81', '127.0.0.1.evil.example', 'localhost.evil.example', '127.0.0.2']) {
      assert.equal(await status(host), 403, host);
    }
    // Em qualquer outra porta o navegador sempre manda a porta, então Host sem porta continua recusado.
    portaDaConexao = porta;
    assert.equal(await status('localhost'), 403);
    assert.equal(await status('127.0.0.1'), 403);
    assert.equal(await status(`localhost:${porta}`), 200);
    assert.equal(await status('localhost:80'), 403);
  } finally {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
    await armazenamento.aguardarGravacoes();
  }
});

test('HOSTS_PERMITIDOS acrescenta hosts aceitos; com HOST não loopback o Host não é validado', async () => {
  await comServidor(
    async ({ bruto }) => {
      assert.equal((await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'meu-pc:8080' } })).status, 200);
      assert.equal((await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'MEU-PC:8080' } })).status, 200);
      assert.equal((await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'meu-pc:8081' } })).status, 403);
      assert.equal((await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'outro:8080' } })).status, 403);
    },
    { hostsPermitidos: [' Meu-PC:8080 ', ''] },
  );
  await comServidor(
    async ({ bruto }) => {
      const r = await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'qualquer.coisa:1' } });
      assert.equal(r.status, 200);
    },
    { host: '0.0.0.0' },
  );
});

test('Origin numa escrita precisa corresponder ao Host: senão 403 e nada é gravado', () =>
  comServidor(async ({ bruto, porta, chamar }) => {
    const corpo = JSON.stringify({ id: 'x', roadmap: roadmap() });
    const json = { 'content-type': 'application/json' };
    const ruins = ['http://evil.example', 'null', 'not a url', `http://127.0.0.1:${porta + 1}`, `http://localhost:${porta}`, `http://127.0.0.1.evil.example:${porta}`, ''];
    for (const origin of ruins) {
      for (const [metodo, caminho, c] of [['POST', '/api/roadmaps', corpo], ['PUT', '/api/roadmaps/x', corpo], ['DELETE', '/api/roadmaps/x'], ['POST', '/api/roadmaps/x/progresso', '{"registros":{}}']]) {
        const r = await bruto({ metodo, caminho, cabecalhos: { ...json, origin }, corpo: c });
        assert.equal(r.status, 403, `${metodo} ${caminho} Origin: "${origin}"`);
        assert.equal(typeof r.corpo.erro, 'string');
      }
    }
    // O 403 vem antes do 415: nem o tipo do corpo é examinado para quem tem Origin estranho.
    assert.equal((await bruto({ metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { origin: 'http://evil.example', 'content-type': 'text/plain' }, corpo })).status, 403);
    assert.deepEqual((await chamar('GET', '/api/roadmaps')).corpo, []);

    const mesmo = await bruto({ metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { ...json, origin: `http://127.0.0.1:${porta}` }, corpo });
    assert.equal(mesmo.status, 201);
    // Sem Origin (curl, scripts) ou lido de outro site: leitura não é bloqueada, mas também não ganha CORS.
    const leitura = await bruto({ caminho: '/api/roadmaps', cabecalhos: { origin: 'http://evil.example' } });
    assert.equal(leitura.status, 200);
    assert.equal(leitura.cabecalhos.get('access-control-allow-origin'), null);
  }));

test('sem CORS: o preflight não recebe nenhuma permissão', () =>
  comServidor(async ({ bruto }) => {
    for (const caminho of ['/api/roadmaps', '/api/roadmaps/x', '/api/roadmaps/x/progresso', '/api/saude']) {
      const r = await bruto({
        metodo: 'OPTIONS',
        caminho,
        cabecalhos: { origin: 'http://evil.example', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
      });
      assert.ok(r.status !== 200 || r.cabecalhos.get('access-control-allow-origin') === null, caminho);
      for (const nome of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-allow-credentials']) {
        assert.equal(r.cabecalhos.get(nome), null, `${caminho} ${nome}`);
      }
    }
  }));

test('cabeçalhos de segurança em toda resposta (API, estáticos, 404 e erros)', () =>
  comServidor(async ({ bruto, chamar }) => {
    const respostas = [
      await bruto({ caminho: '/api/saude' }),
      await bruto({ caminho: '/api/inexistente' }),
      await bruto({ caminho: '/' }),
      await bruto({ caminho: '/index.html' }),
      await bruto({ caminho: '/js/main.js' }),
      await bruto({ caminho: '/css/estilos.css' }),
      await bruto({ caminho: '/data/react.json' }),
      await bruto({ caminho: '/nada' }),
      await bruto({ caminho: '/package.json' }),
      await bruto({ caminho: '/api/saude', cabecalhos: { Host: 'evil.example' } }),
      await bruto({ metodo: 'POST', caminho: '/api/roadmaps', corpo: '{}' }),
      await bruto({ metodo: 'POST', caminho: '/api/roadmaps', cabecalhos: { 'content-type': 'application/json' }, corpo: '{' }),
      await bruto({ caminho: '/api/roadmaps/%E0%A4%A' }),
    ];
    for (const r of respostas) {
      assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff');
      assert.equal(r.cabecalhos.get('referrer-policy'), 'no-referrer');
      assert.equal(r.cabecalhos.get('content-security-policy'), CSP);
      assert.equal(r.cabecalhos.get('x-powered-by'), null);
    }
    assert.equal(respostas[0].cabecalhos.get('cache-control'), 'no-store');

    // Como os JSONs escapam "<", ">" e "&", um navegador que tratasse a resposta como HTML não veria tags.
    const suspeito = roadmap();
    suspeito.grafos.raiz.nos[0].resumo = '<script>alert(1)</script> & cia';
    await chamar('POST', '/api/roadmaps', { id: 'x', roadmap: suspeito });
    const lido = await chamar('GET', '/api/roadmaps/x');
    assert.ok(!lido.texto.includes('<script>'));
    assert.equal(lido.corpo.roadmap.grafos.raiz.nos[0].resumo, '<script>alert(1)</script> & cia');
  }));

test('erro inesperado: 500 { erro: "Erro interno." } sem caminhos nem stack, e log no console', async () => {
  const segredo = "EACCES: permission denied, open '/var/segredo/dados.json.tmp'";
  const armazenamento = {
    listar() {
      throw new Error(segredo);
    },
    obter: () => undefined,
    async criar() {
      throw new Error(segredo);
    },
    aguardarGravacoes: async () => {},
  };
  const servidor = await abrir('inutil', { armazenamento });
  try {
    console.error.mock.resetCalls();
    for (const r of [
      await servidor.chamar('GET', '/api/roadmaps'),
      await servidor.chamar('POST', '/api/roadmaps', { roadmap: roadmap() }),
    ]) {
      assert.equal(r.status, 500);
      assert.deepEqual(r.corpo, { erro: 'Erro interno.' });
      assert.ok(!r.texto.includes('segredo') && !r.texto.includes('at '));
    }
    assert.equal(console.error.mock.calls.length, 2);
    // Depois do erro o servidor segue respondendo.
    assert.equal((await servidor.chamar('GET', '/api/saude')).status, 200);
  } finally {
    await servidor.fechar();
  }
});

// ---------------------------------------------------------------- estáticos e rotas desconhecidas

test('estáticos: só index.html, css/, js/ e data/', () =>
  comServidor(async ({ bruto }) => {
    for (const [caminho, tipo] of [
      ['/', /text\/html/],
      ['/index.html', /text\/html/],
      ['/js/main.js', /javascript/],
      ['/css/estilos.css', /text\/css/],
      ['/data/react.json', /application\/json/],
    ]) {
      const r = await bruto({ caminho });
      assert.equal(r.status, 200, caminho);
      assert.match(r.cabecalhos.get('content-type'), tipo, caminho);
    }
    assert.equal((await bruto({ metodo: 'HEAD', caminho: '/index.html' })).status, 200);

    const fora = [
      '/server/app.js', '/server/armazenamento.js', '/package.json', '/package-lock.json', '/node_modules/express/package.json',
      '/armazenamento/dados.json', '/.git/config', '/.git/HEAD', '/.gitignore', '/docs/CONTRATO.md', '/test/servidor.test.js', '/README.md',
      '/%2e%2e/package.json', '/../package.json', '/js/../package.json', '/js/%2e%2e/package.json', '/js/..%2fpackage.json',
      '/js/..%2f..%2f..%2fetc/passwd', '/%2fetc/passwd', '/js/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/data/../package.json', '/css/..\\package.json',
      '/js/%00', '/js', '/js/', '/css/', '/data/', '/js/.env', '/index.html/..%2fpackage.json', '/INDEX.HTML.bak',
    ];
    for (const caminho of fora) {
      const r = await bruto({ caminho });
      assert.ok([400, 403, 404].includes(r.status), `${caminho} => ${r.status}`);
      assert.ok(!r.texto.includes('grafos-de-estudo') && !r.texto.includes('"express"') && !r.texto.includes('root:'), caminho);
      assert.equal(typeof r.corpo?.erro, 'string', caminho);
    }
    assert.equal((await bruto({ metodo: 'POST', caminho: '/index.html' })).status, 404);
  }));

test('estáticos: uma raiz com arquivos sensíveis expõe somente a lista explícita', async () => {
  const raiz = await novoDiretorio();
  const gravar = async (relativo, conteudo) => {
    await mkdir(path.dirname(path.join(raiz, relativo)), { recursive: true });
    await writeFile(path.join(raiz, relativo), conteudo);
  };
  await gravar('index.html', '<p>ok</p>');
  await gravar('js/app.js', 'export {}');
  await gravar('js/.oculto', 'segredo');
  await gravar('css/a.css', 'a{}');
  await gravar('data/d.json', '{}');
  for (const proibido of ['server/app.js', 'package.json', 'node_modules/x/package.json', 'armazenamento/dados.json', '.git/config', '.env', 'indice.html', 'outra/pagina.html']) {
    await gravar(proibido, 'SEGREDO');
  }
  // Um link simbólico dentro de js/ apontando para fora da lista é o único jeito de escapar: confirma o que acontece.
  await symlink(path.join(raiz, 'package.json'), path.join(raiz, 'js', 'atalho.json'));

  await comServidor(
    async ({ bruto }) => {
      for (const caminho of ['/', '/index.html', '/js/app.js', '/css/a.css', '/data/d.json']) {
        assert.equal((await bruto({ caminho })).status, 200, caminho);
      }
      for (const caminho of ['/server/app.js', '/package.json', '/node_modules/x/package.json', '/armazenamento/dados.json', '/.git/config', '/.env', '/indice.html', '/outra/pagina.html', '/js/.oculto', '/js/../package.json', '/js/%2e%2e/package.json']) {
        const r = await bruto({ caminho });
        assert.ok([400, 403, 404].includes(r.status), `${caminho} => ${r.status}`);
        assert.ok(!r.texto.includes('SEGREDO'), caminho);
      }
    },
    { diretorioPublico: raiz },
  );
});

test('rotas /api desconhecidas: 404 em JSON, nunca HTML', () =>
  comServidor(async ({ bruto }) => {
    const casos = [
      ['GET', '/api/inexistente'], ['GET', '/api'], ['GET', '/api/'], ['GET', '/api/roadmaps/x/y/z'], ['GET', '/api/roadmaps/x/progresso/extra'],
      ['POST', '/api/inexistente'], ['PUT', '/api/roadmaps'], ['DELETE', '/api/roadmaps'], ['PATCH', '/api/roadmaps/x'], ['GET', '/api/roadmaps/../x'],
      ['POST', '/api/saude'], ['GET', '/api/saude/extra'],
    ];
    for (const [metodo, caminho] of casos) {
      const r = await bruto({ metodo, caminho, cabecalhos: { 'content-type': 'application/json' }, corpo: ['GET', 'DELETE'].includes(metodo) ? undefined : '{}' });
      assert.equal(r.status, 404, `${metodo} ${caminho}`);
      assert.match(r.cabecalhos.get('content-type'), /^application\/json/, `${metodo} ${caminho}`);
      assert.equal(typeof r.corpo.erro, 'string');
      assert.ok(!r.texto.includes('<'), `${metodo} ${caminho}`);
    }
    const percentQuebrado = await bruto({ caminho: '/api/roadmaps/%E0%A4%A' });
    assert.equal(percentQuebrado.status, 400);
    assert.equal(typeof percentQuebrado.corpo.erro, 'string');
    assert.ok([400, 404].includes((await bruto({ caminho: '/js/%E0%A4%A' })).status));
  }));

// ---------------------------------------------------------------- processo (server/index.js)

/** Sobe `node server/index.js` e espera a linha com a URL. */
function iniciarProcesso(env) {
  const filho = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.js')], {
    env: { ...process.env, HOST: '', HOSTS_PERMITIDOS: '', PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processo = { filho, saida: '', erros: '' };
  filho.stdout.on('data', (parte) => (processo.saida += parte));
  filho.stderr.on('data', (parte) => (processo.erros += parte));
  processo.encerrou = new Promise((resolver) => filho.once('close', (codigo, sinal) => resolver({ codigo, sinal })));
  processo.pronto = new Promise((resolver, rejeitar) => {
    const verificar = () => {
      const achado = /http:\/\/\S+:(\d+)/.exec(processo.saida);
      if (achado) resolver(Number(achado[1]));
    };
    filho.stdout.on('data', verificar);
    processo.encerrou.then(() => rejeitar(new Error(`o processo saiu antes de subir: ${processo.erros}`)));
  });
  return processo;
}

test('index.js: sobe, atende, e SIGTERM encerra com código 0 deixando o arquivo íntegro', async () => {
  const diretorio = await novoDiretorio();
  const arquivo = path.join(diretorio, 'sub', 'dados.json');
  const processo = iniciarProcesso({ DB_FILE: arquivo });
  try {
    const porta = await processo.pronto;
    const base = `http://127.0.0.1:${porta}`;
    assert.deepEqual((await chamar(base, 'GET', '/api/saude')).corpo, { ok: true });
    assert.deepEqual((await chamar(base, 'GET', '/api/roadmaps')).corpo.map((item) => item.id), ['react']);
    const mesclas = await Promise.all(
      Array.from({ length: 10 }, (_, i) => chamar(base, 'POST', '/api/roadmaps/react/progresso', { registros: { [`react/n${i}`]: reg('novo', i + 1) } })),
    );
    assert.ok(mesclas.every((r) => r.status === 200));
    assert.equal((await chamar(base, 'GET', '/')).status, 200);
  } finally {
    processo.filho.kill('SIGTERM');
  }
  const { codigo, sinal } = await processo.encerrou;
  assert.deepEqual([codigo, sinal], [0, null]);
  assert.match(processo.saida, /encerrando/);
  const dados = await lerArquivo(arquivo);
  assert.equal(dados.versao, 1);
  assert.deepEqual(Object.keys(dados.roadmaps), ['react']);
  assert.equal(Object.keys(dados.progresso.react.registros).length, 10);
  assert.deepEqual(await readdir(path.dirname(arquivo)), ['dados.json']);
});

test('index.js: HOST não local imprime o aviso de que a API não tem autenticação', async () => {
  const diretorio = await novoDiretorio();
  const processo = iniciarProcesso({ DB_FILE: path.join(diretorio, 'dados.json'), HOST: '0.0.0.0' });
  try {
    await processo.pronto;
  } finally {
    processo.filho.kill('SIGTERM');
  }
  assert.equal((await processo.encerrou).codigo, 0);
  assert.match(processo.erros, /Aviso: HOST=0\.0\.0\.0/);
  assert.match(processo.erros, /autenticação/);

  const local = iniciarProcesso({ DB_FILE: path.join(diretorio, 'dados.json') });
  try {
    await local.pronto;
  } finally {
    local.filho.kill('SIGTERM');
  }
  assert.equal((await local.encerrou).codigo, 0);
  assert.doesNotMatch(local.erros, /Aviso/);
});

test('index.js: PORT inválida ou ocupada termina com código 1 e mensagem clara', async () => {
  const diretorio = await novoDiretorio();
  const invalida = iniciarProcesso({ DB_FILE: path.join(diretorio, 'dados.json'), PORT: 'abc' });
  await assert.rejects(invalida.pronto);
  assert.equal((await invalida.encerrou).codigo, 1);
  assert.match(invalida.erros, /PORT inválida/);

  const ocupante = createServer();
  await new Promise((resolver) => ocupante.listen(0, '127.0.0.1', resolver));
  try {
    const ocupada = iniciarProcesso({ DB_FILE: path.join(diretorio, 'dados.json'), PORT: String(ocupante.address().port) });
    await assert.rejects(ocupada.pronto);
    assert.equal((await ocupada.encerrou).codigo, 1);
    assert.match(ocupada.erros, /já está em uso/);
  } finally {
    await new Promise((resolver) => ocupante.close(resolver));
  }
});
