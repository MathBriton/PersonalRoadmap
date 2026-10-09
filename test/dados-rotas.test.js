import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { grafosAlcancaveis, validarRoadmap } from '../js/dados.js';
import { caminhoDoHash, hashDoCaminho } from '../js/rotas.js';

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

test('estrutura quebrada lança erro', () => {
  assert.throws(() => validarRoadmap(null), /inválido/);
  assert.throws(() => validarRoadmap({ raiz: 'a', grafos: {} }), /raiz/);
});

const roadmap = validarRoadmap({
  raiz: 'react',
  grafos: { react: { nos: [{ id: 'h', filho: 'hooks' }] }, hooks: { nos: [] }, perf: { nos: [] } },
}).roadmap;

test('caminhoDoHash lê o caminho a partir da raiz', () => {
  assert.deepEqual(caminhoDoHash('#react/hooks', roadmap), ['react', 'hooks']);
  assert.deepEqual(caminhoDoHash('#/react/perf/', roadmap), ['react', 'perf']);
  assert.deepEqual(caminhoDoHash('#react', roadmap), ['react']);
});

test('hash vazio, grafo inexistente ou sem a raiz cai na raiz', () => {
  for (const hash of ['', '#', '#hooks', '#react/nao-existe', '#nao-existe', undefined, '#react/%E0%A4%A']) {
    assert.deepEqual(caminhoDoHash(hash, roadmap), ['react'], String(hash));
  }
});

test('ids como "constructor" não passam por propriedades herdadas', () => {
  assert.deepEqual(caminhoDoHash('#react/constructor', roadmap), ['react']);
});

test('hashDoCaminho e caminhoDoHash são inversos', () => {
  const caminho = ['react', 'hooks'];
  assert.equal(hashDoCaminho(caminho), '#react/hooks');
  assert.deepEqual(caminhoDoHash(hashDoCaminho(caminho), roadmap), caminho);
});
