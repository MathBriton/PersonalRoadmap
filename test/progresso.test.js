import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAVE_STORAGE,
  DIA_MS,
  contarProgresso,
  criarRepositorio,
  marcarStatus,
  normalizarDados,
  registrarRevisao,
  statusExibido,
} from '../js/progresso.js';

const AGORA = Date.UTC(2026, 0, 10, 12);

test('marcar Dominado agenda a primeira revisão para daqui a 1 dia', () => {
  assert.deepEqual(marcarStatus('dominado', AGORA), { status: 'dominado', intervalo: 1, proxima: AGORA + DIA_MS });
});

test('marcar Não visto ou Estudando zera intervalo e proxima', () => {
  assert.deepEqual(marcarStatus('estudando', AGORA), { status: 'estudando', intervalo: 0, proxima: 0 });
  assert.deepEqual(marcarStatus('novo', AGORA), { status: 'novo', intervalo: 0, proxima: 0 });
});

test('dominado com proxima vencida aparece como Revisar hoje', () => {
  const registro = { status: 'dominado', intervalo: 1, proxima: AGORA };
  assert.equal(statusExibido(registro, AGORA), 'revisar');
  assert.equal(statusExibido(registro, AGORA - 1), 'dominado');
  assert.equal(statusExibido({ status: 'estudando', intervalo: 0, proxima: 0 }, AGORA), 'estudando');
});

test('Lembrei dobra o intervalo (mínimo 1 antes de dobrar)', () => {
  const registro = { status: 'dominado', intervalo: 4, proxima: AGORA };
  assert.deepEqual(registrarRevisao(registro, true, AGORA), { status: 'dominado', intervalo: 8, proxima: AGORA + 8 * DIA_MS });
  assert.equal(registrarRevisao({ ...registro, intervalo: 0 }, true, AGORA).intervalo, 2);
});

test('Esqueci volta o intervalo para 1 dia', () => {
  const registro = { status: 'dominado', intervalo: 16, proxima: AGORA };
  assert.deepEqual(registrarRevisao(registro, false, AGORA), { status: 'dominado', intervalo: 1, proxima: AGORA + DIA_MS });
});

test('normalizarDados descarta lixo e aceita proxima como data ISO', () => {
  const dados = normalizarDados({
    'a/b': { status: 'dominado', intervalo: 2, proxima: '2020-01-01T00:00:00Z' },
    'a/c': { status: 'invalido', intervalo: 9, proxima: 9 },
    'a/d': 'texto',
  });
  assert.deepEqual(dados['a/b'], { status: 'dominado', intervalo: 2, proxima: Date.UTC(2020, 0, 1) });
  assert.deepEqual(dados['a/c'], { status: 'novo', intervalo: 0, proxima: 0 });
  assert.deepEqual(dados['a/d'], { status: 'novo', intervalo: 0, proxima: 0 });
  assert.deepEqual(normalizarDados([1, 2]), {});
  assert.deepEqual(normalizarDados(null), {});
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

function storageFalso({ falhaLeitura = false, falhaEscrita = false } = {}) {
  const valores = new Map();
  return {
    valores,
    getItem(chave) {
      if (falhaLeitura) throw new Error('bloqueado');
      return valores.get(chave) ?? null;
    },
    setItem(chave, valor) {
      if (falhaEscrita) throw new Error('cheio');
      valores.set(chave, valor);
    },
  };
}

test('o repositório grava na chave grafos-estudo-v1', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  repo.definir('react', 'hooks', marcarStatus('dominado', AGORA));
  assert.deepEqual(JSON.parse(storage.valores.get(CHAVE_STORAGE)), {
    'react/hooks': { status: 'dominado', intervalo: 1, proxima: AGORA + DIA_MS },
  });
  assert.equal(repo.emMemoria, false);
});

test('o repositório relê o storage (edição manual vale na próxima leitura)', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  storage.valores.set(CHAVE_STORAGE, JSON.stringify({ 'a/b': { status: 'dominado', intervalo: 1, proxima: 1 } }));
  assert.equal(repo.ler()['a/b'].proxima, 1);
});

test('JSON corrompido no storage vira progresso vazio, sem lançar erro', () => {
  const storage = storageFalso();
  storage.valores.set(CHAVE_STORAGE, '{nao é json');
  assert.deepEqual(criarRepositorio(() => storage).ler(), {});
});

test('sem localStorage (acesso lança erro) o progresso fica em memória', () => {
  const repo = criarRepositorio(() => {
    throw new Error('SecurityError');
  });
  repo.definir('a', 'b', marcarStatus('estudando', AGORA));
  assert.equal(repo.ler()['a/b'].status, 'estudando');
  assert.equal(repo.emMemoria, true);
});

test('se a escrita falhar, o progresso continua em memória', () => {
  const repo = criarRepositorio(() => storageFalso({ falhaEscrita: true }));
  repo.definir('a', 'b', marcarStatus('dominado', AGORA));
  assert.equal(repo.ler()['a/b'].status, 'dominado');
  assert.equal(repo.emMemoria, true);
});

test('limpar apaga todo o progresso', () => {
  const repo = criarRepositorio(() => storageFalso());
  repo.definir('a', 'b', marcarStatus('dominado', AGORA));
  repo.limpar();
  assert.deepEqual(repo.ler(), {});
});
