import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIA_MS, contarProgresso, marcarStatus, normalizarDados, registrarRevisao, statusExibido } from '../js/progresso.js';

const AGORA = Date.UTC(2026, 0, 10, 12);

test('marcar Dominado agenda a primeira revisão para daqui a 1 dia', () => {
  assert.deepEqual(marcarStatus('dominado', AGORA), { status: 'dominado', intervalo: 1, proxima: AGORA + DIA_MS, atualizado: AGORA });
});

test('marcar Não visto ou Estudando zera intervalo e proxima', () => {
  assert.deepEqual(marcarStatus('estudando', AGORA), { status: 'estudando', intervalo: 0, proxima: 0, atualizado: AGORA });
  assert.deepEqual(marcarStatus('novo', AGORA), { status: 'novo', intervalo: 0, proxima: 0, atualizado: AGORA });
});

test('dominado com proxima vencida aparece como Revisar hoje', () => {
  const registro = { status: 'dominado', intervalo: 1, proxima: AGORA, atualizado: 0 };
  assert.equal(statusExibido(registro, AGORA), 'revisar');
  assert.equal(statusExibido(registro, AGORA - 1), 'dominado');
  assert.equal(statusExibido({ status: 'estudando', intervalo: 0, proxima: 0, atualizado: 0 }, AGORA), 'estudando');
});

test('Lembrei dobra o intervalo (mínimo 1 antes de dobrar)', () => {
  const registro = { status: 'dominado', intervalo: 4, proxima: AGORA, atualizado: 0 };
  assert.deepEqual(registrarRevisao(registro, true, AGORA), {
    status: 'dominado',
    intervalo: 8,
    proxima: AGORA + 8 * DIA_MS,
    atualizado: AGORA,
  });
  assert.equal(registrarRevisao({ ...registro, intervalo: 0 }, true, AGORA).intervalo, 2);
});

test('Esqueci volta o intervalo para 1 dia', () => {
  const registro = { status: 'dominado', intervalo: 16, proxima: AGORA, atualizado: 0 };
  assert.deepEqual(registrarRevisao(registro, false, AGORA), {
    status: 'dominado',
    intervalo: 1,
    proxima: AGORA + DIA_MS,
    atualizado: AGORA,
  });
});

test('normalizarDados descarta lixo e aceita proxima como data ISO', () => {
  const dados = normalizarDados({
    'a/b': { status: 'dominado', intervalo: 2, proxima: '2020-01-01T00:00:00Z', atualizado: 7 },
    'a/c': { status: 'invalido', intervalo: 9, proxima: 9 },
    'a/d': 'texto',
  });
  assert.deepEqual(dados['a/b'], { status: 'dominado', intervalo: 2, proxima: Date.UTC(2020, 0, 1), atualizado: 7 });
  assert.deepEqual(dados['a/c'], { status: 'novo', intervalo: 0, proxima: 0, atualizado: 0 });
  assert.deepEqual(dados['a/d'], { status: 'novo', intervalo: 0, proxima: 0, atualizado: 0 });
  assert.deepEqual(normalizarDados([1, 2]), {});
  assert.deepEqual(normalizarDados(null), {});
});

test('normalizarDados ignora chaves malformadas e não é vulnerável a __proto__', () => {
  const bruto = JSON.parse('{"sem-barra": {"status":"dominado"}, "__proto__": {"status":"dominado"}, "a/b": {"status":"estudando"}}');
  const dados = normalizarDados(bruto);
  assert.deepEqual(Object.keys(dados), ['a/b']);
  assert.equal(Object.getPrototypeOf(dados), Object.prototype);
  assert.equal({}.status, undefined);
});

const roadmap = {
  raiz: 'r',
  grafos: {
    r: { nos: [{ id: 'a', filho: 'f' }, { id: 'b', filho: 'f' }] },
    f: { nos: [{ id: 'x' }, { id: 'y', filho: 'r' }] },
  },
};

test('contarProgresso soma o grafo e os subgrafos sem contar o mesmo grafo duas vezes', () => {
  const dados = {
    'r/a': { status: 'dominado', intervalo: 1, proxima: 0 },
    'f/x': { status: 'dominado', intervalo: 1, proxima: 0 },
    'f/y': { status: 'estudando', intervalo: 0, proxima: 0 },
  };
  assert.deepEqual(contarProgresso(roadmap, 'r', dados), { feitos: 2, total: 4 });
  assert.deepEqual(contarProgresso(roadmap, 'f', dados), { feitos: 2, total: 4 }); // f -> r -> f: sem laço infinito
});
