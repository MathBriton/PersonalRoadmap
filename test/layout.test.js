import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularNiveis, organizarColunas, temCiclo } from '../js/layout.js';

const nos = (...ids) => ids.map((id) => ({ id }));

test('o nível é o caminho mais longo desde as raízes', () => {
  // a -> b -> d  e  a -> d: d fica no nível 2, não no 1
  const niveis = calcularNiveis(nos('a', 'b', 'c', 'd'), [['a', 'b'], ['b', 'd'], ['a', 'd']]);
  assert.deepEqual([...niveis], [['a', 0], ['c', 0], ['b', 1], ['d', 2]]);
});

test('nós sem arestas ficam todos na primeira coluna', () => {
  assert.deepEqual(organizarColunas(nos('x', 'y'), []).map((c) => c.map((n) => n.id)), [['x', 'y']]);
});

test('organizarColunas mantém a ordem de declaração dentro da coluna', () => {
  const colunas = organizarColunas(nos('a', 'c', 'b'), [['a', 'b'], ['a', 'c']]);
  assert.deepEqual(colunas.map((c) => c.map((n) => n.id)), [['a'], ['c', 'b']]);
});

test('arestas para nós inexistentes e laços são ignorados', () => {
  const niveis = calcularNiveis(nos('a', 'b'), [['a', 'fantasma'], ['b', 'b']]);
  assert.deepEqual([...niveis], [['a', 0], ['b', 0]]);
});

test('ciclos não travam: os nós presos vão para uma coluna extra', () => {
  const arestas = [['a', 'b'], ['b', 'c'], ['c', 'b']];
  const niveis = calcularNiveis(nos('a', 'b', 'c'), arestas);
  assert.equal(niveis.get('a'), 0);
  assert.equal(niveis.get('b'), 1);
  assert.equal(niveis.get('c'), 1);
  assert.equal(temCiclo(nos('a', 'b', 'c'), arestas), true);
});

test('temCiclo é falso para grafos acíclicos e verdadeiro para laços', () => {
  assert.equal(temCiclo(nos('a', 'b'), [['a', 'b']]), false);
  assert.equal(temCiclo(nos('a'), [['a', 'a']]), true);
});

test('grafo vazio gera zero colunas', () => {
  assert.deepEqual(organizarColunas([], []), []);
});
