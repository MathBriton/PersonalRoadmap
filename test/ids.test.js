import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gerarIdDeRoadmap, gerarIdUnico, idDeRoadmapValido, slugificar } from '../js/ids.js';

test('slugificar tira acentos, símbolos e bordas', () => {
  assert.equal(slugificar('Renderização e listas'), 'renderizacao-e-listas');
  assert.equal(slugificar('  C++ & Rust!  '), 'c-rust');
  assert.equal(slugificar('///'), '');
  assert.equal(slugificar(undefined), '');
});

test('slugificar respeita o tamanho máximo sem deixar hífen no fim', () => {
  const slug = slugificar('a'.repeat(39) + ' b c', 40);
  assert.ok(slug.length <= 40);
  assert.ok(!slug.endsWith('-'));
});

test('idDeRoadmapValido aceita só slugs, sem reservados', () => {
  for (const ok of ['react', 'node-js', 'a1', 'x'.repeat(64)]) assert.equal(idDeRoadmapValido(ok), true, ok);
  for (const ruim of ['', 'React', 'a b', 'a/b', '../x', '-a', 'a-', 'a--b', 'revisao', 'api', 'x'.repeat(65), 7, null]) {
    assert.equal(idDeRoadmapValido(ruim), false, String(ruim));
  }
});

test('gerarIdUnico acrescenta sufixo numérico em colisões', () => {
  assert.equal(gerarIdUnico('Hooks', ['outro']), 'hooks');
  assert.equal(gerarIdUnico('Hooks', ['hooks']), 'hooks-2');
  assert.equal(gerarIdUnico('Hooks', new Set(['hooks', 'hooks-2'])), 'hooks-3');
  assert.equal(gerarIdUnico('???', []), 'item');
});

test('gerarIdDeRoadmap evita ids reservados', () => {
  assert.equal(gerarIdDeRoadmap('Revisão', []), 'revisao-2');
  assert.equal(gerarIdDeRoadmap('API', []), 'api-2');
  assert.equal(gerarIdDeRoadmap('', []), 'roadmap');
});
