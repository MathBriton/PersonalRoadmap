import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marcarStatus } from '../js/progresso.js';
import { CHAVE_STORAGE, CHAVE_STORAGE_V1, criarRepositorio } from '../js/repositorio.js';

const AGORA = Date.UTC(2026, 0, 10, 12);

function storageFalso({ falhaEscrita = false } = {}) {
  const valores = new Map();
  return {
    valores,
    getItem: (chave) => valores.get(chave) ?? null,
    setItem(chave, valor) {
      if (falhaEscrita) throw new Error('cheio');
      valores.set(chave, valor);
    },
  };
}

test('grava na chave grafos-estudo-v2, separado por roadmap', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  repo.escopo('react').definir('react', 'hooks', marcarStatus('dominado', AGORA));
  repo.escopo('python').definir('python', 'listas', marcarStatus('estudando', AGORA));

  assert.equal(CHAVE_STORAGE, 'grafos-estudo-v2');
  const guardado = JSON.parse(storage.valores.get(CHAVE_STORAGE));
  assert.deepEqual(Object.keys(guardado).sort(), ['python', 'react']);
  assert.equal(guardado.react.registros['react/hooks'].status, 'dominado');
  assert.equal(repo.escopo('react').ler()['python/listas'], undefined);
  assert.equal(repo.emMemoria, false);
});

test('relê o storage a cada leitura (edição manual vale na próxima leitura)', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  storage.valores.set(CHAVE_STORAGE, JSON.stringify({ react: { resetEm: 0, registros: { 'a/b': { status: 'dominado', intervalo: 1, proxima: 1 } } } }));
  assert.equal(repo.escopo('react').ler()['a/b'].proxima, 1);
});

test('JSON corrompido no storage vira progresso vazio, sem lançar erro', () => {
  const storage = storageFalso();
  storage.valores.set(CHAVE_STORAGE, '{nao é json');
  assert.deepEqual(criarRepositorio(() => storage).escopo('react').ler(), {});
});

test('migra o formato v1 para o roadmap react sem apagar o original', () => {
  const storage = storageFalso();
  storage.valores.set(CHAVE_STORAGE_V1, JSON.stringify({ 'hooks/usestate': { status: 'dominado', intervalo: 2, proxima: 5 } }));
  const repo = criarRepositorio(() => storage);
  assert.equal(repo.escopo('react').ler()['hooks/usestate'].intervalo, 2);
  assert.deepEqual(repo.escopo('outro').ler(), {});
  assert.ok(storage.valores.has(CHAVE_STORAGE_V1));
});

test('sem localStorage (acesso lança erro) o progresso fica em memória', () => {
  const repo = criarRepositorio(() => {
    throw new Error('SecurityError');
  });
  const escopo = repo.escopo('react');
  escopo.definir('a', 'b', marcarStatus('estudando', AGORA));
  assert.equal(escopo.ler()['a/b'].status, 'estudando');
  assert.equal(escopo.emMemoria, true);
  assert.equal(repo.emMemoria, true);
});

test('se a escrita falhar, o progresso continua em memória', () => {
  const storage = storageFalso({ falhaEscrita: true });
  const repo = criarRepositorio(() => storage);
  const escopo = repo.escopo('react');
  escopo.definir('a', 'b', marcarStatus('dominado', AGORA));
  assert.equal(escopo.ler()['a/b'].status, 'dominado');
  assert.equal(repo.emMemoria, true);
});

test('definir nunca deixa o atualizado andar para trás (relógio atrasado)', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  const escopo = repo.escopo('react');
  escopo.definir('a', 'b', marcarStatus('dominado', AGORA + 5000));
  const gravado = escopo.definir('a', 'b', marcarStatus('estudando', AGORA)); // relógio 5s atrás
  assert.ok(gravado.atualizado > AGORA + 5000);
  assert.equal(escopo.ler()['a/b'].status, 'estudando');
});

test('limpar avança resetEm além de todos os registros e esvazia o progresso', () => {
  const storage = storageFalso();
  const repo = criarRepositorio(() => storage);
  const escopo = repo.escopo('react');
  escopo.definir('a', 'b', marcarStatus('dominado', AGORA + 9000)); // registro "no futuro"
  const zerado = escopo.limpar(AGORA);
  assert.deepEqual(escopo.ler(), {});
  assert.ok(zerado.resetEm > AGORA + 9000);
  // um registro antigo que chegue de outro dispositivo não ressuscita
  escopo.mesclar({ resetEm: 0, registros: { 'a/b': marcarStatus('dominado', AGORA + 9000) } });
  assert.deepEqual(escopo.ler(), {});
  // mas uma marcação nova depois do reset vale
  escopo.definir('a', 'b', marcarStatus('estudando', AGORA + 10000));
  assert.equal(escopo.ler()['a/b'].status, 'estudando');
});
