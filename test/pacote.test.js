import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { validarRoadmap } from '../js/dados.js';
import { DIA_MS, chaveDoNo, marcarStatus, registrarRevisao } from '../js/progresso.js';
import {
  ErroPacote,
  FORMATO,
  MAX_GRAFOS,
  MAX_NOS,
  MAX_TEXTO,
  VERSAO,
  criarPacote,
  lerPacote,
  nomeDoArquivo,
} from '../js/pacote.js';

const AGORA = Date.UTC(2026, 0, 10, 12);
const lerReact = async () => JSON.parse(await readFile(new URL('../data/react.json', import.meta.url), 'utf8'));

// Roadmap pequeno e válido: "r" abre "sub"; "orfao" não é alcançável.
const roadmapMinimo = () => ({
  raiz: 'r',
  titulo: 'Meu estudo',
  grafos: {
    r: { titulo: 'Raiz', nos: [{ id: 'a', titulo: 'A', filho: 'sub' }, { id: 'b', titulo: 'B' }], arestas: [['a', 'b']] },
    sub: { titulo: 'Sub', nos: [{ id: 'x', titulo: 'X' }], arestas: [] },
    orfao: { titulo: 'Órfão', nos: [{ id: 'o', titulo: 'O' }], arestas: [] },
  },
});
const pacoteMinimo = (extra = {}) => ({ formato: FORMATO, versao: VERSAO, id: 'meu-estudo', roadmap: roadmapMinimo(), progresso: null, ...extra });
const registro = (extra = {}) => ({ status: 'estudando', intervalo: 0, proxima: 0, atualizado: AGORA - 1000, ...extra });
const ler = (entrada, opcoes) => lerPacote(entrada, { agora: AGORA, ...opcoes });

function assertErroPacote(entrada, mensagem, opcoes) {
  assert.throws(
    () => lerPacote(entrada, opcoes),
    (erro) => {
      assert.ok(erro instanceof ErroPacote, `esperado ErroPacote, veio ${erro?.name}: ${erro?.message}`);
      assert.equal(erro.name, 'ErroPacote');
      if (mensagem) assert.match(erro.message, mensagem);
      return true;
    },
  );
}

test('constantes do formato', () => {
  assert.equal(FORMATO, 'grafos-de-estudo');
  assert.equal(VERSAO, 1);
});

// --- criarPacote e nomeDoArquivo ---

test('criarPacote monta o pacote com a data de exportação em ISO', () => {
  const roadmap = roadmapMinimo();
  const progresso = { resetEm: 0, registros: { 'r/a': registro() } };
  assert.deepEqual(criarPacote({ id: 'meu-estudo', roadmap, progresso, agora: AGORA }), {
    formato: 'grafos-de-estudo',
    versao: 1,
    exportadoEm: '2026-01-10T12:00:00.000Z',
    id: 'meu-estudo',
    roadmap,
    progresso,
  });
});

test('criarPacote sem progresso grava null e aceita Date em vez de ms', () => {
  const pacote = criarPacote({ id: 'x', roadmap: roadmapMinimo(), agora: new Date(AGORA) });
  assert.equal(pacote.progresso, null);
  assert.equal(pacote.exportadoEm, '2026-01-10T12:00:00.000Z');
});

test('criarPacote e nomeDoArquivo recusam instante inválido', () => {
  for (const agora of [undefined, null, NaN, Infinity, 'ontem', 8.64e15 + 1, {}]) {
    assert.throws(() => criarPacote({ id: 'x', roadmap: {}, agora }), ErroPacote, String(agora));
    assert.throws(() => nomeDoArquivo('x', agora), ErroPacote, String(agora));
  }
});

test('nomeDoArquivo usa id e data em AAAA-MM-DD', () => {
  assert.equal(nomeDoArquivo('react', AGORA), 'react-2026-01-10.json');
  assert.equal(nomeDoArquivo('react', Date.UTC(2026, 2, 5, 8)), 'react-2026-03-05.json');
  assert.equal(nomeDoArquivo('react', new Date(AGORA)), 'react-2026-01-10.json');
});

test('nomeDoArquivo troca de dia exatamente à meia-noite UTC', () => {
  assert.equal(nomeDoArquivo('r', Date.parse('2026-01-10T23:59:59.999Z')), 'r-2026-01-10.json');
  assert.equal(nomeDoArquivo('r', Date.parse('2026-01-11T00:00:00.000Z')), 'r-2026-01-11.json');
  assert.equal(nomeDoArquivo('r', Date.parse('2025-12-31T23:59:59.999Z')), 'r-2025-12-31.json');
  assert.equal(nomeDoArquivo('r', Date.parse('2026-01-01T00:00:00.000Z')), 'r-2026-01-01.json');
  assert.equal(nomeDoArquivo('r', Date.parse('2024-02-29T23:59:59.999Z')), 'r-2024-02-29.json');
  assert.equal(nomeDoArquivo('r', Date.parse('2024-03-01T00:00:00.000Z')), 'r-2024-03-01.json');
});

test('nomeDoArquivo não depende do fuso horário de quem exporta', () => {
  const original = process.env.TZ;
  try {
    // Kiritimati é UTC+14 e Pago Pago é UTC-11: aí o dia local difere do dia UTC perto da virada.
    process.env.TZ = 'Pacific/Kiritimati';
    const tarde = Date.parse('2026-01-10T23:30:00Z');
    assert.equal(new Date(tarde).getDate(), 11, 'o fuso de teste não entrou em vigor');
    assert.equal(nomeDoArquivo('r', tarde), 'r-2026-01-10.json');

    process.env.TZ = 'Pacific/Pago_Pago';
    const cedo = Date.parse('2026-01-11T00:30:00Z');
    assert.equal(new Date(cedo).getDate(), 10, 'o fuso de teste não entrou em vigor');
    assert.equal(nomeDoArquivo('r', cedo), 'r-2026-01-11.json');
    assert.equal(criarPacote({ id: 'r', roadmap: {}, agora: cedo }).exportadoEm, '2026-01-11T00:30:00.000Z');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

// --- ida e volta ---

test('ida e volta com data/react.json devolve o mesmo roadmap e o mesmo progresso', async () => {
  const { roadmap, avisos } = validarRoadmap(await lerReact());
  assert.deepEqual(avisos, []);
  const progresso = {
    resetEm: AGORA - 5 * DIA_MS,
    registros: {
      [chaveDoNo('react', 'jsx')]: marcarStatus('dominado', AGORA - 3 * DIA_MS),
      [chaveDoNo('react', 'estado')]: marcarStatus('estudando', AGORA - 2 * DIA_MS),
      [chaveDoNo('hooks', 'usestate')]: registrarRevisao(marcarStatus('dominado', AGORA - 4 * DIA_MS), true, AGORA - 1000),
      [chaveDoNo('perf', 'memo')]: marcarStatus('novo', AGORA - 1000),
    },
  };
  const pacote = criarPacote({ id: 'react', roadmap, progresso, agora: AGORA });

  for (const entrada of [JSON.stringify(pacote), JSON.stringify(pacote, null, 2), structuredClone(pacote)]) {
    const lido = ler(entrada);
    assert.equal(lido.id, 'react');
    assert.deepEqual(lido.avisos, []);
    assert.deepEqual(lido.roadmap, roadmap);
    assert.deepEqual(lido.progresso, progresso);
  }
});

test('ida e volta preserva progresso vazio e a ausência de progresso', () => {
  const { roadmap } = validarRoadmap(roadmapMinimo());
  const vazio = { resetEm: 0, registros: {} };
  assert.deepEqual(ler(JSON.stringify(criarPacote({ id: 'x', roadmap, progresso: vazio, agora: AGORA }))).progresso, vazio);
  assert.equal(ler(JSON.stringify(criarPacote({ id: 'x', roadmap, agora: AGORA }))).progresso, null);
});

test('lerPacote não muta a entrada', () => {
  const entrada = pacoteMinimo({ progresso: { resetEm: 0, registros: { 'r/a': registro(), 'fantasma/z': registro() } } });
  const copia = structuredClone(entrada);
  ler(entrada);
  assert.deepEqual(entrada, copia);
});

// --- roadmap puro e id ---

test('aceita um roadmap puro, sem progresso, e deriva o id do nome do arquivo', async () => {
  const texto = JSON.stringify(await lerReact());
  const lido = ler(texto, { nomeArquivo: 'meu-react.json' });
  assert.equal(lido.id, 'meu-react');
  assert.equal(lido.progresso, null);
  assert.deepEqual(lido.avisos, []);
  assert.equal(lido.roadmap.raiz, 'react');
});

test('o id vem do pacote se for válido, senão do nome do arquivo, senão do título', () => {
  const comId = (id, opcoes) => ler(pacoteMinimo({ id }), opcoes).id;
  assert.equal(comId('outro-id', { nomeArquivo: 'arquivo.json' }), 'outro-id');
  assert.equal(comId('Id Inválido!', { nomeArquivo: 'Meu Arquivo (2).json' }), 'meu-arquivo-2');
  assert.equal(comId('Id Inválido!'), 'meu-estudo'); // do título "Meu estudo"
  // Reservado, grande demais, tipo errado: tudo cai na derivação.
  assert.equal(comId('revisao'), 'meu-estudo');
  assert.equal(comId('a'.repeat(65)), 'meu-estudo');
  for (const id of [undefined, null, 7, {}, [], '../etc', 'a/b', '']) assert.equal(comId(id), 'meu-estudo', String(id));
});

test('deriva o id do nome do arquivo ignorando pasta e extensão', () => {
  const doNome = (nomeArquivo) => ler(roadmapMinimo(), { nomeArquivo }).id;
  assert.equal(doNome('C:\\fakepath\\Estudos de React.json'), 'estudos-de-react');
  assert.equal(doNome('/home/ana/roadmap-node.JSON'), 'roadmap-node');
  assert.equal(doNome('sem-extensao'), 'sem-extensao');
  // Nome inútil, reservado ou de tipo errado: usa o título.
  for (const nome of ['.json', '???.json', 'api.json', 'revisao', '', 42, null, {}]) assert.equal(doNome(nome), 'meu-estudo', String(nome));
});

test('o id derivado nunca é reservado nem inválido', () => {
  const sem = { raiz: 'r', grafos: { r: { titulo: 'API', nos: [] } } };
  assert.equal(ler(sem).id, 'api-2');
  assert.equal(ler({ raiz: 'r', grafos: { r: { titulo: '???', nos: [] } } }).id, 'roadmap');
});

// --- progresso ---

test('o progresso só mantém cards que existem no roadmap e resume os ignorados num aviso', () => {
  const registros = {
    'r/a': registro(),
    'sub/x': registro({ status: 'dominado', intervalo: 2, proxima: AGORA + DIA_MS }),
    'orfao/o': registro(), // grafo órfão ainda existe no roadmap: o usuário pode religá-lo
    'r/removido': registro(),
    'fantasma/z': registro(),
    'sem-barra': registro(),
  };
  const lido = ler(JSON.stringify(pacoteMinimo({ progresso: { resetEm: 0, registros } })));
  assert.deepEqual(Object.keys(lido.progresso.registros).sort(), ['orfao/o', 'r/a', 'sub/x']);
  assert.deepEqual(lido.avisos, ['3 registros de progresso ignorados (cards que não existem neste roadmap).']);
});

test('um único registro ignorado usa o singular e nenhum ignorado não gera aviso', () => {
  const um = ler(pacoteMinimo({ progresso: { resetEm: 0, registros: { 'r/a': registro(), 'r/some': registro() } } }));
  assert.deepEqual(um.avisos, ['1 registro de progresso ignorado (card que não existe neste roadmap).']);
  const nenhum = ler(pacoteMinimo({ progresso: { resetEm: 0, registros: { 'r/a': registro() } } }));
  assert.deepEqual(nenhum.avisos, []);
});

test('ids de nó com "/" continuam casando com a chave do progresso', () => {
  const roadmap = { raiz: 'r', grafos: { r: { titulo: 'R', nos: [{ id: 'a/b', titulo: 'AB' }] } } };
  const lido = ler(pacoteMinimo({ roadmap, progresso: { resetEm: 0, registros: { 'r/a/b': registro(), 'r/a': registro() } } }));
  assert.deepEqual(Object.keys(lido.progresso.registros), ['r/a/b']);
});

test('descarta registros anteriores ao resetEm, como a mesclagem faz', () => {
  const registros = { 'r/a': registro({ atualizado: 100 }), 'r/b': registro({ atualizado: 300 }) };
  const lido = ler(pacoteMinimo({ progresso: { resetEm: 200, registros } }));
  assert.equal(lido.progresso.resetEm, 200);
  assert.deepEqual(Object.keys(lido.progresso.registros), ['r/b']);
  assert.deepEqual(lido.avisos, []);
});

test('progresso com tipo errado é ignorado com aviso; registros com tipo errado viram vazios', () => {
  for (const progresso of ['texto', 7, true, [], [1, 2]]) {
    const lido = ler(pacoteMinimo({ progresso }));
    assert.equal(lido.progresso, null, JSON.stringify(progresso));
    assert.deepEqual(lido.avisos, ['O progresso do pacote está mal formado e foi ignorado.']);
  }
  for (const registros of [undefined, null, 'x', 5, [], [registro()]]) {
    const lido = ler(pacoteMinimo({ progresso: { resetEm: 0, registros } }));
    assert.deepEqual(lido.progresso, { resetEm: 0, registros: {} });
    assert.deepEqual(lido.avisos, []);
  }
});

test('registros com campos de tipo errado são normalizados em vez de quebrar', () => {
  const registros = {
    'r/a': 'texto',
    'r/b': { status: { x: 1 }, intervalo: [], proxima: {}, atualizado: 'amanhã' },
    'sub/x': { status: 'dominado', intervalo: '3', proxima: '2026-01-11T12:00:00Z', atualizado: '5' },
  };
  const lido = ler(JSON.stringify(pacoteMinimo({ progresso: { resetEm: 'nunca', registros } })));
  assert.deepEqual(lido.progresso.registros['r/a'], { status: 'novo', intervalo: 0, proxima: 0, atualizado: 0 });
  assert.deepEqual(lido.progresso.registros['r/b'], { status: 'novo', intervalo: 0, proxima: 0, atualizado: 0 });
  assert.deepEqual(lido.progresso.registros['sub/x'], { status: 'dominado', intervalo: 3, proxima: Date.UTC(2026, 0, 11, 12), atualizado: 5 });
  assert.equal(lido.progresso.resetEm, 0);
});

test('valores gigantes no progresso são limitados, com aviso', () => {
  const texto = `{
    "formato": "${FORMATO}", "versao": 1, "id": "x", "roadmap": ${JSON.stringify(roadmapMinimo())},
    "progresso": { "resetEm": 1e300, "registros": {
      "r/a": { "status": "dominado", "intervalo": 1e300, "proxima": 1e300, "atualizado": 1e300 },
      "r/b": { "status": "dominado", "intervalo": 1e999, "proxima": "1e999", "atualizado": "-5" }
    } }
  }`;
  const lido = ler(texto);
  const limite = AGORA + DIA_MS;
  // O reset no futuro apagaria tudo o que o usuário marcar depois: é descartado.
  assert.equal(lido.progresso.resetEm, 0);
  assert.deepEqual(lido.progresso.registros['r/a'], {
    status: 'dominado',
    intervalo: 36500,
    proxima: AGORA + 36500 * DIA_MS,
    atualizado: limite,
  });
  assert.deepEqual(lido.progresso.registros['r/b'], { status: 'dominado', intervalo: 0, proxima: 0, atualizado: 0 });
  for (const registro of Object.values(lido.progresso.registros)) {
    for (const valor of Object.values(registro)) assert.ok(typeof valor === 'string' || Number.isFinite(valor));
  }
  assert.deepEqual(lido.avisos, ['Datas ou intervalos do progresso fora do possível foram corrigidos.']);
});

test('um resetEm dentro da tolerância de relógio é mantido', () => {
  const lido = ler(pacoteMinimo({ progresso: { resetEm: AGORA + 1000, registros: {} } }));
  assert.equal(lido.progresso.resetEm, AGORA + 1000);
  assert.deepEqual(lido.avisos, []);
});

test('chaves "__proto__" no progresso e no roadmap não poluem nem trocam protótipos', () => {
  const texto = `{
    "formato": "${FORMATO}", "versao": 1, "id": "x",
    "roadmap": { "raiz": "r", "grafos": {
      "r": { "titulo": "R", "nos": [{ "id": "a", "filho": "__proto__" }, { "id": "__proto__" }] },
      "__proto__": { "titulo": "Malicioso", "nos": [{ "id": "p" }], "polui": true }
    } },
    "progresso": { "resetEm": 0, "registros": {
      "__proto__": { "status": "dominado" },
      "r/__proto__": { "status": "estudando", "atualizado": 3 },
      "__proto__/p": { "status": "dominado" }
    }, "__proto__": { "polui": true } }
  }`;
  const lido = ler(texto);
  assert.equal(Object.getPrototypeOf(lido.roadmap.grafos), Object.prototype);
  assert.deepEqual(Object.keys(lido.roadmap.grafos), ['r']);
  assert.equal(lido.roadmap.grafos.polui, undefined);
  assert.equal(lido.roadmap.grafos.nos, undefined);
  assert.equal(lido.roadmap.grafos.r.nos[0].filho, undefined);
  assert.deepEqual(Object.keys(lido.progresso.registros), ['r/__proto__']);
  assert.equal(Object.getPrototypeOf(lido.progresso.registros), Object.prototype);
  assert.equal({}.polui, undefined);
  assert.equal({}.status, undefined);
  assert.ok(lido.avisos.some((aviso) => aviso.includes('__proto__')));
});

test('a raiz "__proto__" é recusada com ErroPacote', () => {
  assertErroPacote('{"raiz":"__proto__","grafos":{"__proto__":{"nos":[]}}}', /raiz/);
});

// --- hostilidade ---

test('JSON inválido, vazio ou de tipo errado vira ErroPacote em português', () => {
  const ruins = ['', '   ', '{', '{"a":', 'não é json', 'undefined', "{'aspas': 'simples'}", '[]', '[1, 2]', 'null', '42', '"texto"', 'true'];
  for (const texto of ruins) assertErroPacote(texto, /JSON|objeto/);
  assertErroPacote('{', /não é um JSON válido/);
  assertErroPacote('[]', /objeto JSON/);
});

test('entradas que nem são texto nem objeto viram ErroPacote', () => {
  for (const entrada of [undefined, null, 42, true, [], [1], () => {}, Symbol('x'), 10n]) {
    assertErroPacote(entrada, /objeto JSON/);
  }
});

test('roadmap sem raiz ou com estrutura quebrada vira ErroPacote', () => {
  assertErroPacote({}, /Roadmap inválido/);
  assertErroPacote({ raiz: 'a' }, /Roadmap inválido/);
  assertErroPacote({ raiz: 7, grafos: {} }, /Roadmap inválido/);
  assertErroPacote({ raiz: 'a', grafos: [] }, /Roadmap inválido/);
  assertErroPacote({ raiz: 'a', grafos: null }, /Roadmap inválido/);
  assertErroPacote({ raiz: 'a', grafos: {} }, /raiz "a" não existe/);
  assertErroPacote({ raiz: 'a', grafos: { b: { nos: [] } } }, /raiz "a" não existe/);
  assertErroPacote({ raiz: 'a', grafos: { a: 'texto' } }, /raiz "a" não existe/);
  assertErroPacote({ raiz: 'a/b', grafos: { 'a/b': { nos: [] } } }, /raiz "a\/b" não existe/);
  assertErroPacote(pacoteMinimo({ roadmap: { raiz: 'nada', grafos: {} } }), /raiz/);
});

test('formato desconhecido, versão estranha e pacote sem roadmap viram ErroPacote', () => {
  assertErroPacote(pacoteMinimo({ formato: 'outro-app' }), /Formato de arquivo desconhecido/);
  assertErroPacote(pacoteMinimo({ formato: undefined }), /Formato de arquivo desconhecido/);
  assertErroPacote(pacoteMinimo({ formato: ['grafos-de-estudo'] }), /Formato de arquivo desconhecido/);
  for (const versao of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, [], {}, true]) {
    assertErroPacote(pacoteMinimo({ versao }), /versão do pacote/);
  }
  for (const roadmap of [undefined, null, 'texto', 7, [], [roadmapMinimo()]]) {
    assertErroPacote(pacoteMinimo({ roadmap }), /não contém um roadmap/);
  }
});

test('versão maior que a suportada pede para atualizar o app', () => {
  for (const versao of [2, 3, 999]) {
    assertErroPacote(pacoteMinimo({ versao }), new RegExp(`versão ${versao}.*Atualize o app`));
  }
  assert.doesNotThrow(() => ler(pacoteMinimo({ versao: 1 })));
});

test('aceita arquivo com BOM, comum em JSON salvo pelo Windows', () => {
  assert.equal(ler(`\uFEFF${JSON.stringify(pacoteMinimo())}`).id, 'meu-estudo');
});

test('recusa roadmap com mais de 5000 nós no total, com mensagem clara', () => {
  const nos = (prefixo, quantidade) => Array.from({ length: quantidade }, (_, i) => ({ id: `${prefixo}${i}` }));
  const com = (a, b) => ({ raiz: 'r', grafos: { r: { titulo: 'R', nos: nos('a', a) }, g: { titulo: 'G', nos: nos('b', b) } } });
  assertErroPacote(com(3000, 2001), /5000/);
  assertErroPacote(com(3000, 2001), /5001 tópicos/);
  assertErroPacote(pacoteMinimo({ roadmap: com(5001, 0) }), /máximo aceito é 5000/);
  const limite = ler(com(2500, 2500));
  assert.equal(limite.roadmap.grafos.r.nos.length + limite.roadmap.grafos.g.nos.length, MAX_NOS);
});

test('recusa roadmap com grafos demais', () => {
  const grafos = Object.fromEntries(Array.from({ length: MAX_GRAFOS + 1 }, (_, i) => [`g${i}`, { nos: [] }]));
  assertErroPacote({ raiz: 'g0', grafos }, /grafos/);
});

test('recusa texto grande demais antes de tentar interpretar', () => {
  assertErroPacote('x'.repeat(MAX_TEXTO + 1), /grande demais/);
  assertErroPacote(`[${' '.repeat(MAX_TEXTO)}]`, /grande demais/);
});

test('limita a quantidade de avisos devolvidos', () => {
  const arestas = Array.from({ length: 500 }, (_, i) => ['a', `fantasma${i}`]);
  const lido = ler({ raiz: 'r', grafos: { r: { titulo: 'R', nos: [{ id: 'a' }], arestas } } });
  assert.equal(lido.avisos.length, 21);
  assert.match(lido.avisos.at(-1), /e mais 480 avisos/);
});

test('os avisos de validarRoadmap são repassados', () => {
  const lido = ler({ raiz: 'r', grafos: { r: { titulo: 'R', nos: [{ id: 'a', links: [['x', 'javascript:alert(1)']] }] } } });
  assert.equal(lido.avisos.length, 1);
  assert.match(lido.avisos[0], /link inválido/);
  assert.deepEqual(lido.roadmap.grafos.r.nos[0].links, []);
});

// Qualquer valor estranho em qualquer posição do pacote só pode virar resultado ou ErroPacote.
test('valores estranhos em qualquer posição nunca lançam erro cru', () => {
  const estranhos = [
    undefined, null, 0, -1, 1e308, -1e308, NaN, Infinity, '', 'texto', '/', 'a/b', '__proto__', 'constructor', true, false, [], [[]], [null], {}, { '': 1 },
    { __proto__: null }, JSON.parse('{"__proto__":{"x":1}}'), [['a', 'b', 'c']], 'x'.repeat(10_000), 10n, Symbol('s'), () => 1,
  ];
  const caminhos = [
    (pacote, v) => { pacote.id = v; },
    (pacote, v) => { pacote.roadmap = v; },
    (pacote, v) => { pacote.roadmap.raiz = v; },
    (pacote, v) => { pacote.roadmap.titulo = v; },
    (pacote, v) => { pacote.roadmap.descricao = v; },
    (pacote, v) => { pacote.roadmap.grafos = v; },
    (pacote, v) => { pacote.roadmap.grafos.r = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.titulo = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.nos = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.nos[0] = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.nos[0].id = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.nos[0].filho = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.nos[0].links = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.arestas = v; },
    (pacote, v) => { pacote.roadmap.grafos.r.arestas[0] = v; },
    (pacote, v) => { pacote.progresso = v; },
    (pacote, v) => { pacote.progresso.resetEm = v; },
    (pacote, v) => { pacote.progresso.registros = v; },
    (pacote, v) => { pacote.progresso.registros['r/a'] = v; },
    (pacote, v) => { pacote.progresso.registros['r/a'].status = v; },
    (pacote, v) => { pacote.progresso.registros['r/a'].intervalo = v; },
    (pacote, v) => { pacote.progresso.registros['r/a'].proxima = v; },
    (pacote, v) => { pacote.progresso.registros['r/a'].atualizado = v; },
    (pacote, v) => { pacote.formato = v; },
    (pacote, v) => { pacote.versao = v; },
  ];
  for (const [i, alterar] of caminhos.entries()) {
    for (const valor of estranhos) {
      const pacote = pacoteMinimo({ progresso: { resetEm: 0, registros: { 'r/a': registro({ status: 'dominado' }) } } });
      alterar(pacote, valor);
      for (const opcoes of [undefined, null, {}, { nomeArquivo: valor }, { agora: valor }]) {
        try {
          const lido = lerPacote(pacote, opcoes);
          assert.ok(idValido(lido.id));
        } catch (erro) {
          assert.ok(erro instanceof ErroPacote, `caminho ${i}, valor ${inspect(valor, { depth: 0 }).slice(0, 30)}: ${erro?.name}: ${erro?.message}`);
          assert.match(erro.message, /[a-zà-ú]/i);
        }
      }
    }
  }
  assert.equal({}.status, undefined);
  assert.equal({}.x, undefined);
});

const idValido = (id) => typeof id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) && id.length <= 64 && !['revisao', 'api'].includes(id);

test('ErroPacote é um Error com nome próprio e guarda a causa quando há', () => {
  const erro = new ErroPacote('x', { cause: 'y' });
  assert.ok(erro instanceof Error);
  assert.equal(erro.name, 'ErroPacote');
  assert.equal(erro.cause, 'y');
});
