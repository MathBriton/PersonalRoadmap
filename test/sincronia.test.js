import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mesclarProgresso, normalizarProgresso, progressoVazio, registroMaisRecente } from '../js/sincronia.js';

const reg = (status, atualizado, extra = {}) => ({ status, intervalo: 0, proxima: 0, atualizado, ...extra });
const prog = (registros, resetEm = 0) => ({ resetEm, registros });

test('vence o registro mais recente de cada card', () => {
  const a = prog({ 'g/x': reg('estudando', 10), 'g/y': reg('estudando', 50) });
  const b = prog({ 'g/x': reg('novo', 20), 'g/z': reg('estudando', 5) });
  const m = mesclarProgresso(a, b);
  assert.equal(m.registros['g/x'].status, 'novo');
  assert.equal(m.registros['g/y'].status, 'estudando');
  assert.ok(m.registros['g/z']);
});

test('é comutativa, idempotente e associativa', () => {
  const a = prog({ 'g/x': reg('estudando', 10), 'g/y': reg('novo', 7) }, 3);
  const b = prog({ 'g/x': reg('novo', 10), 'g/z': reg('estudando', 12) }, 5); // empate em g/x
  const c = prog({ 'g/y': reg('estudando', 9) }, 0);
  assert.deepEqual(mesclarProgresso(a, b), mesclarProgresso(b, a));
  assert.deepEqual(mesclarProgresso(a, a), mesclarProgresso(a, progressoVazio()));
  const ab = mesclarProgresso(a, b);
  assert.deepEqual(mesclarProgresso(ab, ab), ab);
  assert.deepEqual(mesclarProgresso(mesclarProgresso(a, b), c), mesclarProgresso(a, mesclarProgresso(b, c)));
});

test('resetEm descarta registros mais antigos e vale o maior entre as partes', () => {
  const a = prog({ 'g/x': reg('dominado', 10), 'g/y': reg('estudando', 100) });
  const b = prog({}, 50);
  const m = mesclarProgresso(a, b);
  assert.equal(m.resetEm, 50);
  assert.deepEqual(Object.keys(m.registros), ['g/y']);
});

test('um registro exatamente no instante do reset é mantido', () => {
  assert.deepEqual(Object.keys(mesclarProgresso(prog({ 'g/x': reg('estudando', 50) }), prog({}, 50)).registros), ['g/x']);
});

test('o empate de atualizado é decidido de forma determinística', () => {
  const a = reg('estudando', 10);
  const b = reg('novo', 10);
  assert.deepEqual(registroMaisRecente(a, b), registroMaisRecente(b, a));
});

test('normalizarProgresso aceita lixo e descarta registros anteriores ao resetEm', () => {
  assert.deepEqual(normalizarProgresso(null), progressoVazio());
  assert.deepEqual(normalizarProgresso([]), progressoVazio());
  assert.deepEqual(normalizarProgresso({ resetEm: 'x', registros: 3 }), progressoVazio());
  const n = normalizarProgresso({ resetEm: 20, registros: { 'a/b': reg('dominado', 10), 'a/c': reg('dominado', 30) } });
  assert.deepEqual(Object.keys(n.registros), ['a/c']);
});

test('mesclar não muta as entradas', () => {
  const a = prog({ 'g/x': reg('estudando', 10) });
  const copia = structuredClone(a);
  mesclarProgresso(a, prog({ 'g/x': reg('novo', 20) }, 15));
  assert.deepEqual(a, copia);
});
