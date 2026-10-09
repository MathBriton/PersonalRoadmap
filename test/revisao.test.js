import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarRoadmap } from '../js/dados.js';
import { DIA_MS } from '../js/progresso.js';
import { caminhoAteGrafo, contarRevisoes, filaDeRevisao } from '../js/revisao.js';

const AGORA = Date.UTC(2026, 0, 10, 12);

// Atalho para montar roadmaps: grafos = { id: [nó, ...] }, em que o nó é "id" ou ["id", "filho"].
function montar(grafos, extra = {}) {
  const bruto = { raiz: 'r', ...extra, grafos: {} };
  for (const [grafoId, nos] of Object.entries(grafos)) {
    bruto.grafos[grafoId] = {
      titulo: `Grafo ${grafoId}`,
      nos: nos.map((no) => {
        const [id, filho] = Array.isArray(no) ? no : [no];
        return { id, titulo: `Nó ${id}`, filho };
      }),
    };
  }
  return validarRoadmap(bruto).roadmap;
}

const vencido = (dias = 1, proxima = AGORA - dias * DIA_MS) => ({ status: 'dominado', intervalo: dias, proxima, atualizado: 1 });
const futuro = () => ({ status: 'dominado', intervalo: 4, proxima: AGORA + DIA_MS, atualizado: 1 });

test('caminhoAteGrafo: a raiz, filhos diretos e netos', () => {
  const roadmap = montar({ r: [['a', 'g1']], g1: [['b', 'g2']], g2: ['c'] });
  assert.deepEqual(caminhoAteGrafo(roadmap, 'r'), ['r']);
  assert.deepEqual(caminhoAteGrafo(roadmap, 'g1'), ['r', 'g1']);
  assert.deepEqual(caminhoAteGrafo(roadmap, 'g2'), ['r', 'g1', 'g2']);
});

test('caminhoAteGrafo devolve null para grafo órfão ou inexistente', () => {
  const roadmap = montar({ r: [['a', 'g1']], g1: ['b'], orfao: [['c', 'g1']] });
  assert.equal(caminhoAteGrafo(roadmap, 'orfao'), null);
  assert.equal(caminhoAteGrafo(roadmap, 'nao-existe'), null);
  assert.equal(caminhoAteGrafo(roadmap, undefined), null);
  // Nomes herdados de Object.prototype não são grafos.
  assert.equal(caminhoAteGrafo(roadmap, 'constructor'), null);
  assert.equal(caminhoAteGrafo(roadmap, '__proto__'), null);
});

test('caminhoAteGrafo escolhe o menor caminho, mesmo quando o longo vem primeiro na ordem dos nós', () => {
  const roadmap = montar({
    r: [['n1', 'longo1'], ['n2', 'atalho']],
    longo1: [['x', 'longo2']],
    longo2: [['y', 'alvo']],
    atalho: [['z', 'alvo']],
    alvo: ['folha'],
  });
  assert.deepEqual(caminhoAteGrafo(roadmap, 'alvo'), ['r', 'atalho', 'alvo']);
});

test('caminhoAteGrafo desempata pela ordem dos nós', () => {
  const grafos = (primeiro, segundo) => ({
    r: [[primeiro, primeiro === 'a' ? 'x' : 'y'], [segundo, segundo === 'a' ? 'x' : 'y']],
    x: [['n', 'alvo']],
    y: [['n', 'alvo']],
    alvo: ['folha'],
  });
  assert.deepEqual(caminhoAteGrafo(montar(grafos('a', 'b')), 'alvo'), ['r', 'x', 'alvo']);
  assert.deepEqual(caminhoAteGrafo(montar(grafos('b', 'a')), 'alvo'), ['r', 'y', 'alvo']);
});

test('caminhoAteGrafo não trava com ciclos de grafos, laços nem filho inexistente', () => {
  const roadmap = montar({
    r: [['a', 'g1'], ['volta', 'r'], ['aponta-nada', 'fantasma']],
    g1: [['b', 'g2'], ['eu', 'g1']],
    g2: [['c', 'g1']],
  });
  assert.deepEqual(caminhoAteGrafo(roadmap, 'g1'), ['r', 'g1']);
  assert.deepEqual(caminhoAteGrafo(roadmap, 'g2'), ['r', 'g1', 'g2']);
  assert.equal(caminhoAteGrafo(roadmap, 'fantasma'), null);
});

test('caminhoAteGrafo devolve null quando a raiz não existe', () => {
  assert.equal(caminhoAteGrafo({ raiz: 'sumiu', grafos: { a: { titulo: 'A', nos: [] } } }, 'a'), null);
});

test('filaDeRevisao lista só os cards com status exibido "revisar"', () => {
  const roadmap = montar({ r: [['a', 'g1'], 'b', 'c', 'd'], g1: ['x', 'y'] });
  const registros = {
    'r/a': vencido(2),
    'r/b': futuro(),
    'r/c': { status: 'estudando', intervalo: 0, proxima: 0, atualizado: 1 },
    'g1/x': vencido(4),
    // 'r/d' e 'g1/y' sem registro: ficam como "novo".
  };
  assert.deepEqual(filaDeRevisao([{ id: 'meu', roadmap, registros }], AGORA), [
    {
      roadmapId: 'meu',
      roadmapTitulo: 'Grafo r',
      grafoId: 'g1',
      caminho: ['r', 'g1'],
      trilha: ['Grafo r', 'Grafo g1'],
      noId: 'x',
      noTitulo: 'Nó x',
      proxima: AGORA - 4 * DIA_MS,
      intervalo: 4,
    },
    {
      roadmapId: 'meu',
      roadmapTitulo: 'Grafo r',
      grafoId: 'r',
      caminho: ['r'],
      trilha: ['Grafo r'],
      noId: 'a',
      noTitulo: 'Nó a',
      proxima: AGORA - 2 * DIA_MS,
      intervalo: 2,
    },
  ]);
});

test('filaDeRevisao: a revisão vale a partir do instante exato de "proxima"', () => {
  const roadmap = montar({ r: ['a'] });
  const entradas = [{ id: 'x', roadmap, registros: { 'r/a': vencido(1, AGORA) } }];
  assert.equal(filaDeRevisao(entradas, AGORA).length, 1);
  assert.equal(filaDeRevisao(entradas, AGORA - 1).length, 0);
});

test('filaDeRevisao usa o título do roadmap, ou o do grafo raiz quando não há', () => {
  const comTitulo = montar({ r: ['a'] }, { titulo: 'Meu título' });
  const semTitulo = montar({ r: ['a'] });
  const registros = { 'r/a': vencido() };
  const fila = filaDeRevisao(
    [
      { id: 'com', roadmap: comTitulo, registros },
      { id: 'sem', roadmap: semTitulo, registros },
    ],
    AGORA,
  );
  assert.deepEqual(fila.map((item) => [item.roadmapId, item.roadmapTitulo]), [['com', 'Meu título'], ['sem', 'Grafo r']]);
});

test('filaDeRevisao ordena por proxima, depois roadmapId, grafoId e noId', () => {
  const roadmap = montar({ r: [['a', 'g1'], ['b', 'g2'], 'z', 'y'], g1: ['n'], g2: ['n'] });
  const antigo = vencido(10);
  const igual = vencido(3);
  const registros = {
    'r/z': igual,
    'r/y': igual,
    'g2/n': igual,
    'g1/n': igual,
    'r/a': antigo,
  };
  const fila = filaDeRevisao(
    [
      { id: 'b-rm', roadmap, registros: { 'r/y': igual } },
      { id: 'a-rm', roadmap, registros },
    ],
    AGORA,
  );
  assert.deepEqual(
    fila.map((item) => `${item.roadmapId}:${item.grafoId}/${item.noId}`),
    ['a-rm:r/a', 'a-rm:g1/n', 'a-rm:g2/n', 'a-rm:r/y', 'a-rm:r/z', 'b-rm:r/y'],
  );
});

test('filaDeRevisao ignora grafos órfãos e registros de nós que não existem mais', () => {
  const roadmap = montar({ r: [['a', 'g1']], g1: ['x'], orfao: ['o'] });
  const registros = {
    'r/a': vencido(),
    'g1/x': vencido(),
    'orfao/o': vencido(), // grafo fora do alcance da raiz
    'r/removido': vencido(), // nó que não existe mais
    'sumiu/x': vencido(), // grafo que não existe mais
    'sem-barra': vencido(),
  };
  const fila = filaDeRevisao([{ id: 'x', roadmap, registros }], AGORA);
  assert.deepEqual(fila.map((item) => `${item.grafoId}/${item.noId}`).sort(), ['g1/x', 'r/a']);
});

test('filaDeRevisao lista um grafo alcançável por vários caminhos uma única vez, pelo menor caminho', () => {
  const roadmap = montar({
    r: [['a', 'longo'], ['b', 'alvo']],
    longo: [['c', 'alvo']],
    alvo: ['x', 'y'],
  });
  const registros = { 'alvo/x': vencido(), 'alvo/y': vencido(2) };
  const fila = filaDeRevisao([{ id: 'x', roadmap, registros }], AGORA);
  assert.equal(fila.length, 2);
  for (const item of fila) {
    assert.deepEqual(item.caminho, ['r', 'alvo']);
    assert.deepEqual(item.trilha, ['Grafo r', 'Grafo alvo']);
  }
});

test('filaDeRevisao não duplica itens nem trava com ciclos de grafos (a -> b -> a) e laços', () => {
  const roadmap = montar({
    r: [['a', 'g1']],
    g1: [['b', 'g2'], ['eu', 'g1']],
    g2: [['c', 'g1'], ['raiz', 'r']],
  });
  const registros = {
    'r/a': vencido(),
    'g1/b': vencido(),
    'g1/eu': vencido(),
    'g2/c': vencido(),
    'g2/raiz': vencido(),
  };
  const fila = filaDeRevisao([{ id: 'x', roadmap, registros }], AGORA);
  assert.deepEqual(fila.map((item) => `${item.grafoId}/${item.noId}`).sort(), ['g1/b', 'g1/eu', 'g2/c', 'g2/raiz', 'r/a']);
  assert.deepEqual(fila.find((item) => item.grafoId === 'g2').caminho, ['r', 'g1', 'g2']);
});

test('filaDeRevisao aceita registros ausentes, vazios ou malformados', () => {
  const roadmap = montar({ r: ['a', 'b', 'c'] });
  assert.deepEqual(filaDeRevisao([], AGORA), []);
  for (const registros of [undefined, null, {}]) {
    assert.deepEqual(filaDeRevisao([{ id: 'x', roadmap, registros }], AGORA), []);
  }
  const lixo = { 'r/a': null, 'r/b': 'texto', 'r/c': { status: 'dominado', proxima: 'não é data', intervalo: 'x' } };
  const fila = filaDeRevisao([{ id: 'x', roadmap, registros: lixo }], AGORA);
  // Só "c" é dominado; sem `proxima` válida ele vale 0, ou seja, está vencido.
  assert.deepEqual(fila.map((item) => [item.noId, item.proxima, item.intervalo]), [['c', 0, 0]]);
});

test('filaDeRevisao não confunde nomes herdados de Object.prototype com registros', () => {
  const roadmap = montar({ constructor: ['toString'] }, { raiz: 'constructor' });
  assert.deepEqual(filaDeRevisao([{ id: 'x', roadmap, registros: {} }], AGORA), []);
});

test('filaDeRevisao entrega caminhos independentes e não muta as entradas', () => {
  const roadmap = montar({ r: [['a', 'g1']], g1: ['x', 'y'] });
  const registros = { 'g1/x': vencido(), 'g1/y': vencido() };
  const entradas = [{ id: 'x', roadmap, registros }];
  const copia = structuredClone(entradas);
  const fila = filaDeRevisao(entradas, AGORA);
  fila[0].caminho.push('mexido');
  fila[0].trilha.push('mexido');
  assert.deepEqual(fila[1].caminho, ['r', 'g1']);
  assert.deepEqual(fila[1].trilha, ['Grafo r', 'Grafo g1']);
  assert.deepEqual(entradas, copia);
});

test('contarRevisoes conta os itens de todos os roadmaps', () => {
  const um = montar({ r: ['a', 'b'] });
  const dois = montar({ r: ['c'] });
  const entradas = [
    { id: 'um', roadmap: um, registros: { 'r/a': vencido(), 'r/b': futuro() } },
    { id: 'dois', roadmap: dois, registros: { 'r/c': vencido() } },
  ];
  assert.equal(contarRevisoes(entradas, AGORA), 2);
  assert.equal(contarRevisoes([], AGORA), 0);
});
