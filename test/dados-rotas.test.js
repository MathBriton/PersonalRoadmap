import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { grafosAlcancaveis, tituloDoRoadmap, validarRoadmap } from '../js/dados.js';
import { ROTA_INICIO, caminhoDaRota, hashDaRota, rotaDoHash, rotaDoRoadmap } from '../js/rotas.js';

const lerReact = async () => JSON.parse(await readFile(new URL('../data/react.json', import.meta.url), 'utf8'));

test('data/react.json é válido e não gera avisos', async () => {
  const { roadmap, avisos } = validarRoadmap(await lerReact());
  assert.deepEqual(avisos, []);
  assert.equal(roadmap.grafos.react.nos.length, 6);
  assert.equal(roadmap.grafos.hooks.nos.length, 6);
  assert.equal(roadmap.grafos.perf.nos.length, 5);
  assert.deepEqual(grafosAlcancaveis(roadmap).sort(), ['hooks', 'perf', 'react']);
});

const minimo = (extra = {}) => ({
  raiz: 'a',
  grafos: { a: { titulo: 'A', nos: [{ id: 'x' }, { id: 'y' }], arestas: [], ...extra } },
});

test('filho inexistente gera aviso e é descartado', () => {
  const bruto = minimo({ nos: [{ id: 'x', filho: 'nao-existe' }] });
  const { roadmap, avisos } = validarRoadmap(bruto);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /filho.*nao-existe/);
  assert.equal(roadmap.grafos.a.nos[0].filho, undefined);
});

test('aresta com nó inexistente gera aviso e é descartada', () => {
  const { roadmap, avisos } = validarRoadmap(minimo({ arestas: [['x', 'y'], ['x', 'z']] }));
  assert.equal(avisos.length, 1);
  assert.deepEqual(roadmap.grafos.a.arestas, [['x', 'y']]);
});

test('id duplicado no mesmo grafo gera aviso e a repetição é ignorada', () => {
  const { roadmap, avisos } = validarRoadmap(minimo({ nos: [{ id: 'x', titulo: '1' }, { id: 'x', titulo: '2' }] }));
  assert.equal(avisos.length, 1);
  assert.deepEqual(roadmap.grafos.a.nos.map((n) => n.titulo), ['1']);
});

test('o mesmo id em grafos diferentes é permitido', () => {
  const bruto = { raiz: 'a', grafos: { a: { nos: [{ id: 'x' }] }, b: { nos: [{ id: 'x' }] } } };
  assert.deepEqual(validarRoadmap(bruto).avisos, []);
});

test('links que não são http(s) são descartados', () => {
  const { roadmap, avisos } = validarRoadmap(
    minimo({ nos: [{ id: 'x', links: [['ok', 'https://exemplo.com'], ['ruim', 'javascript:alert(1)']] }] }),
  );
  assert.equal(avisos.length, 1);
  assert.deepEqual(roadmap.grafos.a.nos[0].links, [['ok', 'https://exemplo.com']]);
});

test('grafo com id "__proto__" é descartado com aviso, sem mexer no protótipo de grafos', () => {
  const bruto = JSON.parse('{"raiz":"a","grafos":{"a":{"nos":[{"id":"x"}]},"__proto__":{"titulo":"mau","nos":[{"id":"y"}]}}}');
  const { roadmap, avisos } = validarRoadmap(bruto);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /__proto__/);
  assert.deepEqual(Object.keys(roadmap.grafos), ['a']);
  assert.equal(Object.getPrototypeOf(roadmap.grafos), Object.prototype);
  assert.equal(roadmap.grafos.nos, undefined);
});

test('estrutura quebrada lança erro', () => {
  assert.throws(() => validarRoadmap(null), /inválido/);
  assert.throws(() => validarRoadmap({ raiz: 'a', grafos: {} }), /raiz/);
});

test('preserva titulo e descricao opcionais do roadmap e tituloDoRoadmap usa o da raiz como padrão', () => {
  const { roadmap } = validarRoadmap({ ...minimo(), titulo: '  Meu roadmap ', descricao: 'Texto', extra: 1 });
  assert.equal(roadmap.titulo, 'Meu roadmap');
  assert.equal(roadmap.descricao, 'Texto');
  assert.equal(tituloDoRoadmap(roadmap), 'Meu roadmap');
  assert.equal(tituloDoRoadmap(validarRoadmap(minimo()).roadmap), 'A');
  assert.equal('extra' in roadmap, false);
});

const roadmap = validarRoadmap({
  raiz: 'principal',
  grafos: { principal: { nos: [{ id: 'h', filho: 'hooks' }] }, hooks: { nos: [] }, perf: { nos: [] } },
}).roadmap;

test('rotaDoHash: vazio, # e #/ são a tela inicial', () => {
  for (const hash of ['', '#', '#/', undefined, null]) assert.deepEqual(rotaDoHash(hash), ROTA_INICIO, String(hash));
});

test('rotaDoHash: #revisao é a fila de revisão', () => {
  assert.deepEqual(rotaDoHash('#revisao'), { tela: 'revisao' });
  assert.deepEqual(rotaDoHash('#/revisao/qualquer-coisa'), { tela: 'revisao' });
});

test('rotaDoHash: #<roadmap>/<grafos> vira rota de roadmap', () => {
  assert.deepEqual(rotaDoHash('#react'), { tela: 'roadmap', roadmapId: 'react', relativo: [] });
  assert.deepEqual(rotaDoHash('#react/hooks'), { tela: 'roadmap', roadmapId: 'react', relativo: ['hooks'] });
  assert.deepEqual(rotaDoHash('#/react/perf/'), { tela: 'roadmap', roadmapId: 'react', relativo: ['perf'] });
});

test('rotaDoHash: id de roadmap inválido cai na tela inicial', () => {
  for (const hash of ['#React', '#a b', '#../x', '#api', '#-x', '#%E0%A4%A']) {
    assert.deepEqual(rotaDoHash(hash), ROTA_INICIO, hash);
  }
});

test('hashDaRota e rotaDoHash são inversos', () => {
  for (const hash of ['', '#revisao', '#react', '#react/hooks', '#python/a/b']) {
    assert.equal(hashDaRota(rotaDoHash(hash)), hash);
  }
});

test('caminhoDaRota acrescenta a raiz (que não aparece na URL) e valida os grafos', () => {
  const rota = (relativo) => ({ tela: 'roadmap', roadmapId: 'x', relativo });
  assert.deepEqual(caminhoDaRota(rota([]), roadmap), ['principal']);
  assert.deepEqual(caminhoDaRota(rota(['hooks']), roadmap), ['principal', 'hooks']);
  assert.deepEqual(caminhoDaRota(rota(['hooks', 'perf']), roadmap), ['principal', 'hooks', 'perf']);
});

test('caminhoDaRota: grafo inexistente cai na raiz', () => {
  const rota = (relativo) => ({ tela: 'roadmap', roadmapId: 'x', relativo });
  assert.deepEqual(caminhoDaRota(rota(['nao-existe']), roadmap), ['principal']);
  assert.deepEqual(caminhoDaRota(rota(['hooks', 'nao-existe']), roadmap), ['principal']);
  assert.deepEqual(caminhoDaRota(rota(['constructor']), roadmap), ['principal']);
});

test('rotaDoRoadmap tira a raiz do caminho', () => {
  assert.deepEqual(rotaDoRoadmap('react', ['principal', 'hooks']), { tela: 'roadmap', roadmapId: 'react', relativo: ['hooks'] });
  assert.equal(hashDaRota(rotaDoRoadmap('react', ['principal'])), '#react');
});
