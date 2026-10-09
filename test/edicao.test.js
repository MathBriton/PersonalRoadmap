import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grafosAlcancaveis, tituloDoRoadmap, validarRoadmap } from '../js/dados.js';
import {
  ErroEdicao,
  adicionarAresta,
  adicionarNo,
  atualizarNo,
  atualizarRoadmap,
  criarGrafo,
  definirOrigens,
  gerarIdGrafo,
  gerarIdNo,
  grafosOrfaos,
  removerAresta,
  removerNo,
  renomearGrafo,
} from '../js/edicao.js';

// raiz: a -> b -> c, com "a" abrindo o grafo "sub"; "sub": x -> y, com "x" abrindo "neto".
const base = () =>
  validarRoadmap({
    raiz: 'raiz',
    titulo: 'Meu roadmap',
    descricao: 'Para estudar',
    grafos: {
      raiz: {
        titulo: 'Raiz',
        nos: [
          { id: 'a', titulo: 'A', resumo: 'resumo de a', exemplo: 'código de a', links: [['Docs', 'https://exemplo.com']], filho: 'sub' },
          { id: 'b', titulo: 'B' },
          { id: 'c', titulo: 'C' },
        ],
        arestas: [['a', 'b'], ['b', 'c']],
      },
      sub: { titulo: 'Sub', nos: [{ id: 'x', titulo: 'X', filho: 'neto' }, { id: 'y', titulo: 'Y' }], arestas: [['x', 'y']] },
      neto: { titulo: 'Neto', nos: [{ id: 'n1', titulo: 'N1' }], arestas: [] },
    },
  }).roadmap;

// O roadmap devolvido precisa ser exatamente a cópia limpa de `validarRoadmap`, sem nenhum aviso.
function afirmarLimpo(roadmap) {
  const { roadmap: validado, avisos } = validarRoadmap(roadmap);
  assert.deepEqual(avisos, []);
  assert.deepEqual(validado, roadmap);
}

// Roda a operação, prova que a entrada não foi mutada e que o resultado é limpo e é outro objeto.
function aplicar(roadmap, operacao) {
  const antes = structuredClone(roadmap);
  const resultado = operacao(roadmap);
  assert.deepEqual(roadmap, antes, 'a entrada foi mutada');
  const novo = resultado.roadmap ?? resultado;
  assert.notEqual(novo, roadmap);
  afirmarLimpo(novo);
  return resultado;
}

// Operação inválida: lança ErroEdicao com a mensagem esperada e não toca na entrada.
function recusar(roadmap, operacao, padrao) {
  const antes = structuredClone(roadmap);
  assert.throws(
    () => operacao(roadmap),
    (e) => {
      assert.ok(e instanceof ErroEdicao, `esperava ErroEdicao, veio ${e?.constructor?.name}: ${e?.message}`);
      assert.match(e.message, padrao);
      return true;
    },
  );
  assert.deepEqual(roadmap, antes, 'a entrada foi mutada');
}

const ids = (grafo) => grafo.nos.map((no) => no.id);

test('o roadmap de teste já é limpo', () => {
  afirmarLimpo(base());
});

test('ErroEdicao é um Error com nome próprio', () => {
  const e = new ErroEdicao('falhou');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ErroEdicao');
  assert.equal(e.message, 'falhou');
});

test('o resultado não compartilha objetos com a entrada', () => {
  const entrada = base();
  const antes = structuredClone(entrada);
  const novo = atualizarRoadmap(entrada, { titulo: 'Outro' });
  novo.grafos.raiz.nos[0].links.push(['x', 'https://x.com']);
  novo.grafos.raiz.arestas.push(['a', 'c']);
  novo.grafos.sub.nos.pop();
  assert.deepEqual(entrada, antes);
});

// ---------- ids

test('gerarIdNo gera slug do título e evita colisão só dentro do grafo', () => {
  const r = base();
  assert.equal(gerarIdNo(r, 'raiz', 'Renderização e listas'), 'renderizacao-e-listas');
  assert.equal(gerarIdNo(r, 'raiz', 'A'), 'a-2');
  assert.equal(gerarIdNo(r, 'sub', 'A'), 'a'); // "a" existe na raiz, não em "sub"
  assert.equal(gerarIdNo(r, 'raiz', '???'), 'no');
  assert.equal(gerarIdNo(r, 'raiz', undefined), 'no');
});

test('gerarIdNo pula os sufixos já ocupados e nunca contém "/"', () => {
  let r = base();
  for (let i = 0; i < 3; i += 1) r = adicionarNo(r, 'raiz', { titulo: 'Tópico' }).roadmap;
  assert.deepEqual(ids(r.grafos.raiz), ['a', 'b', 'c', 'topico', 'topico-2', 'topico-3']);
  assert.equal(gerarIdNo(r, 'raiz', 'Tópico'), 'topico-4');
  assert.equal(gerarIdNo(r, 'raiz', 'entrada/saída'), 'entrada-saida');
});

test('gerarIdNo com grafo inexistente lança ErroEdicao', () => {
  recusar(base(), (r) => gerarIdNo(r, 'nao-existe', 'X'), /não existe/);
});

test('gerarIdGrafo é único entre os grafos e nunca contém "/"', () => {
  const r = base();
  assert.equal(gerarIdGrafo(r, 'Hooks'), 'hooks');
  assert.equal(gerarIdGrafo(r, 'Sub'), 'sub-2');
  assert.equal(gerarIdGrafo(r, 'Raiz'), 'raiz-2');
  assert.equal(gerarIdGrafo(r, 'a/b/c'), 'a-b-c');
  assert.equal(gerarIdGrafo(r, '///'), 'grafo');
});

test('gerarIdGrafo trata nomes herdados de Object como ocupados', () => {
  const r = base();
  assert.equal(gerarIdGrafo(r, 'constructor'), 'constructor-2');
  assert.equal(gerarIdGrafo(r, 'Constructor'), 'constructor-2');
  assert.equal(gerarIdGrafo(r, '__proto__'), 'proto'); // slugificar já tira os sublinhados
  for (const titulo of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype']) {
    const id = gerarIdGrafo(r, titulo);
    assert.ok(!(id in Object.prototype), id);
  }
});

test('criarGrafo com título "constructor" mantém roadmap.grafos seguro', () => {
  const { roadmap, grafoId } = aplicar(base(), (r) => criarGrafo(r, 'constructor'));
  assert.equal(grafoId, 'constructor-2');
  assert.equal(Object.getPrototypeOf(roadmap.grafos), Object.prototype);
  assert.equal(Object.hasOwn(roadmap.grafos, 'constructor'), false);
  assert.equal(roadmap.grafos.constructor, Object); // continua sendo o construtor herdado
  assert.deepEqual(grafosOrfaos(roadmap), ['constructor-2']);
});

// ---------- adicionarNo

test('adicionarNo acrescenta ao fim com os campos padrão e id gerado', () => {
  const { roadmap, noId } = aplicar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Novo tópico' }));
  assert.equal(noId, 'novo-topico');
  assert.deepEqual(roadmap.grafos.raiz.nos.at(-1), {
    id: 'novo-topico',
    titulo: 'Novo tópico',
    resumo: '',
    exemplo: '',
    links: [],
    filho: undefined,
  });
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['a', 'b'], ['b', 'c']]);
});

test('adicionarNo aceita todos os campos, id explícito, origens e filho', () => {
  const dados = {
    id: 'meu-id',
    titulo: '  Com espaços  ',
    resumo: 'r',
    exemplo: 'e',
    links: [['Docs', 'https://a.com'], ['  ', ' http://b.com/x ']],
    filho: 'neto',
  };
  const { roadmap, noId } = aplicar(base(), (r) => adicionarNo(r, 'raiz', dados, ['b', 'c']));
  assert.equal(noId, 'meu-id');
  assert.deepEqual(roadmap.grafos.raiz.nos.at(-1), {
    id: 'meu-id',
    titulo: 'Com espaços',
    resumo: 'r',
    exemplo: 'e',
    links: [['Docs', 'https://a.com'], ['http://b.com/x', 'http://b.com/x']],
    filho: 'neto',
  });
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['a', 'b'], ['b', 'c'], ['b', 'meu-id'], ['c', 'meu-id']]);
});

test('adicionarNo não mexe nos outros grafos', () => {
  const r = base();
  const { roadmap } = adicionarNo(r, 'sub', { titulo: 'Z' }, ['y']);
  assert.deepEqual(roadmap.grafos.raiz, r.grafos.raiz);
  assert.deepEqual(roadmap.grafos.neto, r.grafos.neto);
  assert.deepEqual(roadmap.grafos.sub.arestas, [['x', 'y'], ['y', 'z']]);
});

test('adicionarNo ignora origens repetidas', () => {
  const { roadmap } = aplicar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z' }, ['a', 'a', 'a']));
  assert.deepEqual(roadmap.grafos.raiz.arestas.filter(([, para]) => para === 'z'), [['a', 'z']]);
});

test('adicionarNo com filho igual ao próprio grafo é permitido', () => {
  const { roadmap } = aplicar(base(), (r) => adicionarNo(r, 'sub', { titulo: 'Volta', filho: 'sub' }));
  assert.equal(roadmap.grafos.sub.nos.at(-1).filho, 'sub');
});

test('adicionarNo recusa título vazio ou ausente', () => {
  for (const titulo of ['', '   ', undefined, null, 7]) {
    recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo }), /título do nó/);
  }
  recusar(base(), (r) => adicionarNo(r, 'raiz', {}), /título do nó/);
});

test('adicionarNo recusa dados ausentes', () => {
  recusar(base(), (r) => adicionarNo(r, 'raiz', null), /ausentes/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', undefined), /ausentes/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', 'texto'), /ausentes/);
});

test('adicionarNo recusa grafo inexistente, inclusive nomes herdados', () => {
  for (const grafoId of ['nao-existe', 'constructor', '__proto__', 'toString', undefined, 7]) {
    recusar(base(), (r) => adicionarNo(r, grafoId, { titulo: 'X' }), /não existe/);
  }
});

test('adicionarNo recusa id repetido no grafo, mas aceita o mesmo id em outro grafo', () => {
  recusar(base(), (r) => adicionarNo(r, 'raiz', { id: 'a', titulo: 'Outro A' }), /Já existe.*"a"/);
  const { roadmap } = aplicar(base(), (r) => adicionarNo(r, 'sub', { id: 'a', titulo: 'A em sub' }));
  assert.deepEqual(ids(roadmap.grafos.sub), ['x', 'y', 'a']);
});

test('adicionarNo recusa id explícito malformado', () => {
  for (const id of ['a/b', '   ', 42, {}]) {
    recusar(base(), (r) => adicionarNo(r, 'raiz', { id, titulo: 'X' }), /id do nó/);
  }
});

test('adicionarNo recusa origem inexistente (de outro grafo conta como inexistente)', () => {
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z' }, ['fantasma']), /origem "fantasma"/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z' }, ['x']), /origem "x"/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z' }, 'a'), /lista/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z' }, null), /lista/);
});

test('adicionarNo recusa filho inexistente, inclusive nomes herdados', () => {
  for (const filho of ['nao-existe', 'constructor', '__proto__', 7]) {
    recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z', filho }), /grafo filho/);
  }
});

test('adicionarNo recusa links que não são http(s) ou estão malformados', () => {
  for (const links of [
    [['Ruim', 'javascript:alert(1)']],
    [['Ruim', 'ftp://exemplo.com']],
    [['Ruim', 'não é url']],
    [['Ruim', '']],
    [['Só texto']],
    [['Ok', 'https://ok.com'], 'solto'],
    [[1, 'https://ok.com']],
    [['Ruim', 5]],
    'https://ok.com',
  ]) {
    recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z', links }), /[Ll]ink/);
  }
});

test('adicionarNo recusa resumo e exemplo que não são texto', () => {
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z', resumo: 5 }), /resumo/);
  recusar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z', exemplo: [] }), /exemplo/);
});

test('adicionarNo preserva o exemplo exatamente como veio (código com indentação)', () => {
  const exemplo = '  function f() {\n    return 1;\n  }\n';
  const { roadmap } = aplicar(base(), (r) => adicionarNo(r, 'raiz', { titulo: 'Z', exemplo }));
  assert.equal(roadmap.grafos.raiz.nos.at(-1).exemplo, exemplo);
});

test('adicionarNo num grafo vazio', () => {
  const { roadmap: comGrafo, grafoId } = criarGrafo(base(), 'Vazio');
  const { roadmap, noId } = aplicar(comGrafo, (r) => adicionarNo(r, grafoId, { titulo: 'Primeiro' }));
  assert.equal(noId, 'primeiro');
  assert.deepEqual(ids(roadmap.grafos[grafoId]), ['primeiro']);
});

// ---------- atualizarNo

test('atualizarNo altera só os campos informados', () => {
  const antes = base();
  const roadmap = aplicar(antes, (r) => atualizarNo(r, 'raiz', 'a', { titulo: 'A novo', resumo: 'novo resumo' }));
  assert.deepEqual(roadmap.grafos.raiz.nos[0], { ...antes.grafos.raiz.nos[0], titulo: 'A novo', resumo: 'novo resumo' });
  assert.deepEqual(roadmap.grafos.raiz.nos.slice(1), antes.grafos.raiz.nos.slice(1));
  assert.deepEqual(roadmap.grafos.raiz.arestas, antes.grafos.raiz.arestas);
  assert.deepEqual(roadmap.grafos.sub, antes.grafos.sub);
});

test('atualizarNo troca exemplo e links, e limpa com valores vazios', () => {
  const roadmap = aplicar(base(), (r) =>
    atualizarNo(r, 'raiz', 'a', { exemplo: '', links: [['Novo', 'https://novo.com']], resumo: null }),
  );
  const a = roadmap.grafos.raiz.nos[0];
  assert.equal(a.exemplo, '');
  assert.equal(a.resumo, '');
  assert.deepEqual(a.links, [['Novo', 'https://novo.com']]);
  assert.deepEqual(aplicar(roadmap, (r) => atualizarNo(r, 'raiz', 'a', { links: [] })).grafos.raiz.nos[0].links, []);
});

test('atualizarNo define, troca e remove o filho (null ou texto vazio)', () => {
  const r = base();
  const comFilho = aplicar(r, (x) => atualizarNo(x, 'raiz', 'b', { filho: 'neto' }));
  assert.equal(comFilho.grafos.raiz.nos[1].filho, 'neto');
  const trocado = aplicar(comFilho, (x) => atualizarNo(x, 'raiz', 'b', { filho: 'sub' }));
  assert.equal(trocado.grafos.raiz.nos[1].filho, 'sub');
  for (const vazio of [null, '']) {
    const semFilho = aplicar(r, (x) => atualizarNo(x, 'raiz', 'a', { filho: vazio }));
    assert.equal(semFilho.grafos.raiz.nos[0].filho, undefined);
  }
  // sem a chave "filho" nas mudanças, o filho atual é mantido
  assert.equal(aplicar(r, (x) => atualizarNo(x, 'raiz', 'a', { titulo: 'A2' })).grafos.raiz.nos[0].filho, 'sub');
});

test('atualizarNo recusa filho inexistente, inclusive nomes herdados', () => {
  for (const filho of ['nao-existe', 'constructor', '__proto__', 3]) {
    recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { filho }), /grafo filho/);
  }
});

test('atualizarNo permite filho que aponta para o grafo do próprio nó ou para um ancestral', () => {
  const proprio = aplicar(base(), (r) => atualizarNo(r, 'sub', 'y', { filho: 'sub' }));
  assert.equal(proprio.grafos.sub.nos[1].filho, 'sub');
  const ancestral = aplicar(base(), (r) => atualizarNo(r, 'neto', 'n1', { filho: 'raiz' }));
  assert.equal(ancestral.grafos.neto.nos[0].filho, 'raiz');
  assert.deepEqual(grafosAlcancaveis(ancestral).sort(), ['neto', 'raiz', 'sub']);
});

test('atualizarNo recusa título vazio, mas aceita omitir o título', () => {
  for (const titulo of ['', '   ', null, 5]) {
    recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { titulo }), /título do nó/);
  }
  assert.equal(aplicar(base(), (r) => atualizarNo(r, 'raiz', 'a', { resumo: 'x' })).grafos.raiz.nos[0].titulo, 'A');
  assert.equal(aplicar(base(), (r) => atualizarNo(r, 'raiz', 'a', { titulo: '  Com borda ' })).grafos.raiz.nos[0].titulo, 'Com borda');
});

test('atualizarNo recusa links que não são http(s)', () => {
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { links: [['x', 'javascript:alert(1)']] }), /Link 1 inválido/);
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { links: [['ok', 'https://ok.com'], ['x', 'data:text/html,oi']] }), /Link 2 inválido/);
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { links: null }), /lista/);
});

test('atualizarNo não aplica nada se um dos campos for inválido', () => {
  // o título é válido, mas o link não: a entrada fica intacta (recusar confere) e nada é devolvido
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { titulo: 'Novo', links: [['x', 'ftp://x']] }), /Link/);
});

test('atualizarNo recusa mudar o id, mas aceita repetir o mesmo', () => {
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', { id: 'outro' }), /id de um nó não pode/);
  const roadmap = aplicar(base(), (r) => atualizarNo(r, 'raiz', 'a', { id: 'a', titulo: 'A2' }));
  assert.equal(roadmap.grafos.raiz.nos[0].id, 'a');
});

test('atualizarNo recusa nó, grafo e mudanças inexistentes', () => {
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'fantasma', { titulo: 'X' }), /nó "fantasma"/);
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'x', { titulo: 'X' }), /nó "x"/); // "x" é de outro grafo
  recusar(base(), (r) => atualizarNo(r, 'nao-existe', 'a', { titulo: 'X' }), /grafo "nao-existe"/);
  recusar(base(), (r) => atualizarNo(r, 'constructor', 'a', { titulo: 'X' }), /grafo "constructor"/);
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', undefined), /ausentes/);
  recusar(base(), (r) => atualizarNo(r, 'raiz', 'a', null), /ausentes/);
});

test('atualizarNo sem mudanças devolve uma cópia igual', () => {
  const r = base();
  const novo = aplicar(r, (x) => atualizarNo(x, 'raiz', 'a', {}));
  assert.deepEqual(novo, r);
});

// ---------- definirOrigens

test('definirOrigens deixa exatamente as arestas de entrada pedidas', () => {
  // c hoje só recebe de b; passa a receber de a
  const roadmap = aplicar(base(), (r) => definirOrigens(r, 'raiz', 'c', ['a']));
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['a', 'b'], ['a', 'c']]);
});

test('definirOrigens mantém as arestas de saída e a ordem das que continuam', () => {
  const r = adicionarAresta(base(), 'raiz', 'a', 'c'); // arestas: a->b, b->c, a->c
  const roadmap = aplicar(r, (x) => definirOrigens(x, 'raiz', 'b', ['a']));
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['a', 'b'], ['b', 'c'], ['a', 'c']]);
  const trocado = aplicar(r, (x) => definirOrigens(x, 'raiz', 'c', ['b', 'a']));
  assert.deepEqual(trocado.grafos.raiz.arestas, [['a', 'b'], ['b', 'c'], ['a', 'c']]);
});

test('definirOrigens com lista vazia remove todas as entradas', () => {
  const roadmap = aplicar(base(), (r) => definirOrigens(r, 'raiz', 'b', []));
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['b', 'c']]);
});

test('definirOrigens ignora repetidas e é idempotente', () => {
  const uma = aplicar(base(), (r) => definirOrigens(r, 'raiz', 'c', ['a', 'a', 'b', 'a']));
  assert.deepEqual(uma.grafos.raiz.arestas, [['a', 'b'], ['b', 'c'], ['a', 'c']]);
  const duas = aplicar(uma, (r) => definirOrigens(r, 'raiz', 'c', ['b', 'a']));
  assert.deepEqual(duas, uma);
});

test('definirOrigens recusa ciclo direto e indireto (a -> b -> c -> a)', () => {
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['b']), /ciclo/); // a->b e b->a
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['c']), /ciclo/); // a->b->c->a
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['b', 'c']), /ciclo/);
});

test('definirOrigens recusa o próprio nó, origem inexistente e entrada inválida', () => {
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['a']), /si mesmo/);
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['fantasma']), /origem "fantasma"/);
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', ['x']), /origem "x"/);
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'a', undefined), /lista/);
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'fantasma', ['a']), /nó "fantasma"/);
  recusar(base(), (r) => definirOrigens(r, 'nao-existe', 'a', []), /grafo "nao-existe"/);
});

test('definirOrigens recusa atomicamente: uma origem boa e uma ruim não aplicam nada', () => {
  recusar(base(), (r) => definirOrigens(r, 'raiz', 'c', ['a', 'fantasma']), /fantasma/);
});

// ---------- ciclo que já existia

// `validarRoadmap` só avisa de ciclo e mantém o grafo (dados antigos, importação). Editar esse
// grafo não pode travar por causa do ciclo antigo: só uma ligação que FECHA um ciclo novo é recusada.
// Não usa `aplicar`, porque a entrada (com ciclo) nunca é "limpa".
const comCicloAntigo = () => {
  const { roadmap, avisos } = validarRoadmap({
    raiz: 'r',
    grafos: { r: { titulo: 'R', nos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], arestas: [['a', 'b'], ['b', 'a']] } },
  });
  assert.equal(avisos.length, 1); // o aviso do ciclo
  return roadmap;
};

test('ciclo antigo: definirOrigens com as mesmas origens do nó do ciclo não é recusado', () => {
  const r = comCicloAntigo();
  const antes = structuredClone(r);
  assert.deepEqual(definirOrigens(r, 'r', 'b', ['a']), r);
  assert.deepEqual(r, antes);
});

test('ciclo antigo: ligações fora do ciclo continuam possíveis', () => {
  const r = comCicloAntigo();
  assert.deepEqual(adicionarAresta(r, 'r', 'c', 'd').grafos.r.arestas, [['a', 'b'], ['b', 'a'], ['c', 'd']]);
  assert.deepEqual(definirOrigens(r, 'r', 'd', ['c', 'a']).grafos.r.arestas, [['a', 'b'], ['b', 'a'], ['c', 'd'], ['a', 'd']]);
  assert.equal(adicionarNo(r, 'r', { titulo: 'E' }, ['a']).roadmap.grafos.r.arestas.length, 3);
});

test('ciclo antigo: a busca que parte de dentro do ciclo termina (não gira para sempre)', () => {
  const r = comCicloAntigo();
  // c -> a entra no ciclo antigo sem fechar outro: a busca a partir de "a" volta a "a" e precisa parar
  assert.deepEqual(adicionarAresta(r, 'r', 'c', 'a').grafos.r.arestas, [['a', 'b'], ['b', 'a'], ['c', 'a']]);
  assert.deepEqual(definirOrigens(r, 'r', 'a', ['b', 'c']).grafos.r.arestas, [['a', 'b'], ['b', 'a'], ['c', 'a']]);
});

test('ciclo antigo: ainda recusa a ligação que fecha um ciclo novo', () => {
  const r = adicionarAresta(comCicloAntigo(), 'r', 'c', 'd');
  recusar(r, (x) => adicionarAresta(x, 'r', 'd', 'c'), /ciclo/);
  recusar(r, (x) => definirOrigens(x, 'r', 'c', ['d']), /ciclo/);
  recusar(r, (x) => definirOrigens(x, 'r', 'c', ['a', 'd']), /ciclo/);
});

test('ciclo antigo: remover uma aresta do ciclo o desfaz', () => {
  const r = removerAresta(comCicloAntigo(), 'r', 'b', 'a');
  assert.deepEqual(validarRoadmap(r).avisos, []);
});

// ---------- adicionarAresta / removerAresta

test('adicionarAresta liga dois nós', () => {
  const roadmap = aplicar(base(), (r) => adicionarAresta(r, 'raiz', 'a', 'c')); // atalho acíclico
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['a', 'b'], ['b', 'c'], ['a', 'c']]);
});

test('adicionarAresta ignora duplicata e devolve um roadmap novo e igual', () => {
  const r = base();
  const roadmap = aplicar(r, (x) => adicionarAresta(x, 'raiz', 'a', 'b'));
  assert.deepEqual(roadmap, r);
});

test('adicionarAresta recusa laço', () => {
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'a', 'a'), /si mesmo/);
});

test('adicionarAresta recusa ciclo direto e indireto (a -> b -> c -> a)', () => {
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'b', 'a'), /ciclo/);
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'c', 'a'), /ciclo/);
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'c', 'b'), /ciclo/);
});

test('adicionarAresta aceita ligações entre ramos independentes', () => {
  const { roadmap } = adicionarNo(base(), 'raiz', { titulo: 'D' });
  const ligado = aplicar(roadmap, (r) => adicionarAresta(r, 'raiz', 'd', 'a'));
  assert.deepEqual(ligado.grafos.raiz.arestas.at(-1), ['d', 'a']);
});

test('adicionarAresta recusa nó e grafo inexistentes', () => {
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'fantasma', 'a'), /nó "fantasma"/);
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'a', 'fantasma'), /nó "fantasma"/);
  recusar(base(), (r) => adicionarAresta(r, 'raiz', 'a', 'x'), /nó "x"/);
  recusar(base(), (r) => adicionarAresta(r, 'nao-existe', 'a', 'b'), /grafo "nao-existe"/);
  recusar(base(), (r) => adicionarAresta(r, '__proto__', 'a', 'b'), /grafo "__proto__"/);
});

test('removerAresta remove só a aresta pedida', () => {
  const roadmap = aplicar(base(), (r) => removerAresta(r, 'raiz', 'a', 'b'));
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['b', 'c']]);
  assert.deepEqual(ids(roadmap.grafos.raiz), ['a', 'b', 'c']);
});

test('removerAresta é idempotente quando a ligação não existe', () => {
  const r = base();
  assert.deepEqual(aplicar(r, (x) => removerAresta(x, 'raiz', 'c', 'a')), r);
  assert.deepEqual(aplicar(r, (x) => removerAresta(x, 'raiz', 'b', 'a')), r); // a direção importa
});

test('removerAresta recusa nó e grafo inexistentes', () => {
  recusar(base(), (r) => removerAresta(r, 'raiz', 'fantasma', 'a'), /nó "fantasma"/);
  recusar(base(), (r) => removerAresta(r, 'raiz', 'a', 'fantasma'), /nó "fantasma"/);
  recusar(base(), (r) => removerAresta(r, 'nao-existe', 'a', 'b'), /grafo "nao-existe"/);
});

test('remover uma aresta permite religar o que antes fecharia um ciclo', () => {
  const r = removerAresta(base(), 'raiz', 'a', 'b'); // a, b->c; agora c->a não forma ciclo
  aplicar(r, (x) => adicionarAresta(x, 'raiz', 'c', 'a'));
});

// ---------- removerNo

test('removerNo tira o nó e todas as arestas que o tocam', () => {
  const { roadmap, removidos } = aplicar(base(), (r) => removerNo(r, 'raiz', 'b'));
  assert.deepEqual(ids(roadmap.grafos.raiz), ['a', 'c']);
  assert.deepEqual(roadmap.grafos.raiz.arestas, []); // a->b e b->c eram as duas arestas pendentes
  assert.deepEqual(removidos, { nos: [{ grafoId: 'raiz', noId: 'b' }], grafos: [] });
  assert.deepEqual(grafosAlcancaveis(roadmap).sort(), ['neto', 'raiz', 'sub']);
});

test('removerNo poda o grafo filho e os subgrafos dele', () => {
  // "a" é o único pai de "sub", que é o único pai de "neto"
  const { roadmap, removidos } = aplicar(base(), (r) => removerNo(r, 'raiz', 'a'));
  assert.deepEqual(Object.keys(roadmap.grafos), ['raiz']);
  assert.deepEqual(removidos.grafos.sort(), ['neto', 'sub']);
  assert.deepEqual(removidos.nos[0], { grafoId: 'raiz', noId: 'a' });
  assert.deepEqual(
    removidos.nos.slice(1).sort((p, q) => `${p.grafoId}/${p.noId}`.localeCompare(`${q.grafoId}/${q.noId}`)),
    [
      { grafoId: 'neto', noId: 'n1' },
      { grafoId: 'sub', noId: 'x' },
      { grafoId: 'sub', noId: 'y' },
    ],
  );
  assert.deepEqual(roadmap.grafos.raiz.arestas, [['b', 'c']]);
  assert.deepEqual(grafosOrfaos(roadmap), []);
});

test('removerNo poda só o necessário quando o nó removido está num subgrafo', () => {
  const { roadmap, removidos } = aplicar(base(), (r) => removerNo(r, 'sub', 'x'));
  assert.deepEqual(Object.keys(roadmap.grafos).sort(), ['raiz', 'sub']);
  assert.deepEqual(removidos.grafos, ['neto']);
  assert.deepEqual(removidos.nos, [{ grafoId: 'sub', noId: 'x' }, { grafoId: 'neto', noId: 'n1' }]);
  assert.deepEqual(ids(roadmap.grafos.sub), ['y']);
  assert.deepEqual(roadmap.grafos.sub.arestas, []);
});

test('removerNo não poda o grafo compartilhado por dois nós pais', () => {
  const dois = aplicar(base(), (r) => atualizarNo(r, 'raiz', 'b', { filho: 'sub' })); // a e b abrem "sub"
  const primeiro = aplicar(dois, (r) => removerNo(r, 'raiz', 'a'));
  assert.deepEqual(primeiro.removidos, { nos: [{ grafoId: 'raiz', noId: 'a' }], grafos: [] });
  assert.deepEqual(Object.keys(primeiro.roadmap.grafos).sort(), ['neto', 'raiz', 'sub']);
  assert.deepEqual(grafosAlcancaveis(primeiro.roadmap).sort(), ['neto', 'raiz', 'sub']);
  // quando o último pai sai, o grafo e seu subgrafo saem junto
  const segundo = aplicar(primeiro.roadmap, (r) => removerNo(r, 'raiz', 'b'));
  assert.deepEqual(segundo.removidos.grafos.sort(), ['neto', 'sub']);
  assert.deepEqual(Object.keys(segundo.roadmap.grafos), ['raiz']);
});

test('removerNo não poda um subgrafo ainda alcançável por outro ramo', () => {
  // raiz: a -> sub (x -> neto) e b -> outro (z -> neto): remover "a" poda "sub" mas "neto" fica
  let r = criarGrafo(base(), 'Outro');
  const outro = r.grafoId;
  r = adicionarNo(r.roadmap, outro, { id: 'z', titulo: 'Z', filho: 'neto' }).roadmap;
  r = atualizarNo(r, 'raiz', 'b', { filho: outro });
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'raiz', 'a'));
  assert.deepEqual(removidos.grafos, ['sub']);
  assert.deepEqual(Object.keys(roadmap.grafos).sort(), ['neto', 'outro', 'raiz']);
  assert.deepEqual(grafosAlcancaveis(roadmap).sort(), ['neto', 'outro', 'raiz']);
});

test('removerNo poda grafos que só se alcançam em ciclo entre si', () => {
  // sub e neto apontam um para o outro, mas só "a" abre "sub": sem "a", os dois somem
  const r = aplicar(base(), (x) => atualizarNo(x, 'neto', 'n1', { filho: 'sub' }));
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'raiz', 'a'));
  assert.deepEqual(removidos.grafos.sort(), ['neto', 'sub']);
  assert.deepEqual(Object.keys(roadmap.grafos), ['raiz']);
});

test('removerNo mantém o grafo raiz mesmo quando um filho aponta de volta para ele', () => {
  const r = aplicar(base(), (x) => atualizarNo(x, 'sub', 'y', { filho: 'raiz' }));
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'raiz', 'a'));
  assert.deepEqual(removidos.grafos.sort(), ['neto', 'sub']);
  assert.deepEqual(Object.keys(roadmap.grafos), ['raiz']);
  assert.equal(roadmap.raiz, 'raiz');
});

test('removerNo com podar: false deixa os grafos como órfãos', () => {
  const { roadmap, removidos } = aplicar(base(), (r) => removerNo(r, 'raiz', 'a', { podar: false }));
  assert.deepEqual(removidos, { nos: [{ grafoId: 'raiz', noId: 'a' }], grafos: [] });
  assert.deepEqual(Object.keys(roadmap.grafos).sort(), ['neto', 'raiz', 'sub']);
  assert.deepEqual(grafosOrfaos(roadmap).sort(), ['neto', 'sub']);
});

test('removerNo remove o único nó de um grafo e o grafo continua existindo', () => {
  const { roadmap, removidos } = aplicar(base(), (r) => removerNo(r, 'neto', 'n1'));
  assert.deepEqual(roadmap.grafos.neto, { titulo: 'Neto', nos: [], arestas: [] });
  assert.deepEqual(removidos, { nos: [{ grafoId: 'neto', noId: 'n1' }], grafos: [] });
});

test('removerNo do único nó da raiz deixa a raiz vazia, ainda válida', () => {
  const r = validarRoadmap({ raiz: 'r', grafos: { r: { titulo: 'R', nos: [{ id: 'unico', titulo: 'Único' }] } } }).roadmap;
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'r', 'unico'));
  assert.deepEqual(roadmap.grafos.r.nos, []);
  assert.equal(roadmap.raiz, 'r');
  assert.deepEqual(removidos, { nos: [{ grafoId: 'r', noId: 'unico' }], grafos: [] });
});

test('removerNo remove o único nó da raiz que abria todos os outros grafos', () => {
  const r = validarRoadmap({
    raiz: 'r',
    grafos: { r: { titulo: 'R', nos: [{ id: 'p', titulo: 'P', filho: 's' }] }, s: { titulo: 'S', nos: [{ id: 'q', titulo: 'Q' }] } },
  }).roadmap;
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'r', 'p'));
  assert.deepEqual(Object.keys(roadmap.grafos), ['r']);
  assert.deepEqual(removidos.nos, [{ grafoId: 'r', noId: 'p' }, { grafoId: 's', noId: 'q' }]);
});

test('removerNo não poda órfãos que já existiam antes (grafo recém-criado, ainda sem pai)', () => {
  const { roadmap: comOrfao, grafoId } = criarGrafo(base(), 'Rascunho');
  const { roadmap, removidos } = aplicar(comOrfao, (r) => removerNo(r, 'raiz', 'b'));
  assert.ok(Object.hasOwn(roadmap.grafos, grafoId));
  assert.deepEqual(removidos.grafos, []);
  assert.deepEqual(grafosOrfaos(roadmap), [grafoId]);
});

test('removerNo limpa o filho pendente de um órfão que apontava para um grafo podado', () => {
  const { roadmap: comOrfao, grafoId } = criarGrafo(base(), 'Rascunho');
  const r = adicionarNo(comOrfao, grafoId, { id: 'rasc', titulo: 'Rasc', filho: 'sub' }).roadmap;
  const { roadmap, removidos } = aplicar(r, (x) => removerNo(x, 'raiz', 'a')); // poda sub e neto
  assert.deepEqual(removidos.grafos.sort(), ['neto', 'sub']);
  assert.equal(roadmap.grafos[grafoId].nos[0].filho, undefined);
});

test('removerNo recusa nó e grafo inexistentes', () => {
  recusar(base(), (r) => removerNo(r, 'raiz', 'fantasma'), /nó "fantasma"/);
  recusar(base(), (r) => removerNo(r, 'raiz', 'x'), /nó "x"/);
  recusar(base(), (r) => removerNo(r, 'nao-existe', 'a'), /grafo "nao-existe"/);
  recusar(base(), (r) => removerNo(r, 'constructor', 'a'), /grafo "constructor"/);
});

test('depois de remover um nó, o mesmo id pode ser gerado de novo', () => {
  const { roadmap } = removerNo(base(), 'raiz', 'c');
  assert.equal(gerarIdNo(roadmap, 'raiz', 'C'), 'c');
});

// ---------- criarGrafo / renomearGrafo

test('criarGrafo cria um grafo vazio e órfão com id único', () => {
  const { roadmap, grafoId } = aplicar(base(), (r) => criarGrafo(r, '  Hooks avançados '));
  assert.equal(grafoId, 'hooks-avancados');
  assert.deepEqual(roadmap.grafos[grafoId], { titulo: 'Hooks avançados', nos: [], arestas: [] });
  assert.deepEqual(grafosOrfaos(roadmap), [grafoId]);
  assert.equal(criarGrafo(roadmap, 'Hooks avançados').grafoId, 'hooks-avancados-2');
});

test('criarGrafo gera ids sem "/" mesmo com títulos estranhos', () => {
  const { grafoId } = criarGrafo(base(), 'a/b');
  assert.equal(grafoId, 'a-b');
  assert.equal(criarGrafo(base(), '!!!').grafoId, 'grafo');
});

test('criarGrafo recusa título vazio', () => {
  for (const titulo of ['', '   ', undefined, null]) recusar(base(), (r) => criarGrafo(r, titulo), /título do grafo/);
});

test('um grafo criado deixa de ser órfão quando um nó aponta para ele', () => {
  const { roadmap, grafoId } = criarGrafo(base(), 'Novo');
  const ligado = aplicar(roadmap, (r) => atualizarNo(r, 'raiz', 'c', { filho: grafoId }));
  assert.deepEqual(grafosOrfaos(ligado), []);
});

test('renomearGrafo muda só o título e mantém o id', () => {
  const roadmap = aplicar(base(), (r) => renomearGrafo(r, 'sub', '  Subtópicos '));
  assert.equal(roadmap.grafos.sub.titulo, 'Subtópicos');
  assert.deepEqual(Object.keys(roadmap.grafos), ['raiz', 'sub', 'neto']);
  assert.deepEqual(roadmap.grafos.sub.nos, base().grafos.sub.nos);
});

test('renomear o grafo raiz muda o título do roadmap só se ele não tiver título próprio', () => {
  const semTitulo = atualizarRoadmap(base(), { titulo: '' });
  assert.equal(tituloDoRoadmap(renomearGrafo(semTitulo, 'raiz', 'Novo nome')), 'Novo nome');
  assert.equal(tituloDoRoadmap(renomearGrafo(base(), 'raiz', 'Novo nome')), 'Meu roadmap');
});

test('renomearGrafo recusa título vazio e grafo inexistente', () => {
  recusar(base(), (r) => renomearGrafo(r, 'sub', ''), /título do grafo/);
  recusar(base(), (r) => renomearGrafo(r, 'sub', '   '), /título do grafo/);
  recusar(base(), (r) => renomearGrafo(r, 'nao-existe', 'X'), /grafo "nao-existe"/);
  recusar(base(), (r) => renomearGrafo(r, 'constructor', 'X'), /grafo "constructor"/);
});

// ---------- atualizarRoadmap

test('atualizarRoadmap define título e descrição com trim', () => {
  const roadmap = aplicar(base(), (r) => atualizarRoadmap(r, { titulo: '  Novo  ', descricao: ' Outra ' }));
  assert.equal(roadmap.titulo, 'Novo');
  assert.equal(roadmap.descricao, 'Outra');
  assert.deepEqual(roadmap.grafos, base().grafos);
});

test('atualizarRoadmap com texto vazio ou null remove o campo; undefined mantém', () => {
  const semTitulo = aplicar(base(), (r) => atualizarRoadmap(r, { titulo: '' }));
  assert.equal(Object.hasOwn(semTitulo, 'titulo'), false);
  assert.equal(semTitulo.descricao, 'Para estudar');
  const semDescricao = aplicar(base(), (r) => atualizarRoadmap(r, { descricao: '   ' }));
  assert.equal(Object.hasOwn(semDescricao, 'descricao'), false);
  const nenhum = aplicar(base(), (r) => atualizarRoadmap(r, { titulo: null, descricao: null }));
  assert.equal(Object.hasOwn(nenhum, 'titulo') || Object.hasOwn(nenhum, 'descricao'), false);
  assert.deepEqual(aplicar(base(), (r) => atualizarRoadmap(r, { titulo: undefined })), base());
  assert.deepEqual(aplicar(base(), (r) => atualizarRoadmap(r)), base());
});

test('atualizarRoadmap acrescenta campos a um roadmap que não os tinha', () => {
  const sem = atualizarRoadmap(atualizarRoadmap(base(), { titulo: '' }), { descricao: '' });
  const roadmap = aplicar(sem, (r) => atualizarRoadmap(r, { descricao: 'Nova' }));
  assert.equal(roadmap.descricao, 'Nova');
  assert.equal(Object.hasOwn(roadmap, 'titulo'), false);
});

test('atualizarRoadmap recusa valores que não são texto', () => {
  recusar(base(), (r) => atualizarRoadmap(r, { titulo: 5 }), /"titulo"/);
  recusar(base(), (r) => atualizarRoadmap(r, { descricao: {} }), /"descricao"/);
  recusar(base(), (r) => atualizarRoadmap(r, null), /ausentes/);
});

// ---------- grafosOrfaos

test('grafosOrfaos é vazio num roadmap totalmente ligado', () => {
  assert.deepEqual(grafosOrfaos(base()), []);
});

test('grafosOrfaos lista grafos sem pai e os subgrafos que só eles alcançam', () => {
  const { roadmap, grafoId } = criarGrafo(base(), 'Solto');
  const comFilho = adicionarNo(roadmap, grafoId, { id: 'm', titulo: 'M', filho: 'neto' }).roadmap;
  assert.deepEqual(grafosOrfaos(comFilho), [grafoId]); // "neto" ainda é alcançável pela raiz
  const solto = removerNo(comFilho, 'raiz', 'a', { podar: false }).roadmap;
  assert.deepEqual(grafosOrfaos(solto), ['sub', 'neto', grafoId]);
});

// ---------- fluxo completo

test('um fluxo de edição seguido mantém o roadmap sempre válido e os ids estáveis', () => {
  let r = base();
  const passos = [
    (x) => criarGrafo(x, 'Extras'),
    (x, estado) => atualizarNo(x, 'raiz', 'c', { filho: estado.grafoId }),
    (x, estado) => adicionarNo(x, estado.grafoId, { titulo: 'Extra 1', links: [['Docs', 'https://e.com']] }),
    (x, estado) => adicionarNo(x, estado.grafoId, { titulo: 'Extra 2' }, [estado.noId]),
    (x) => adicionarAresta(x, 'raiz', 'a', 'c'),
    (x) => definirOrigens(x, 'raiz', 'c', ['b']),
    (x) => renomearGrafo(x, 'sub', 'Sub renomeado'),
    (x) => atualizarRoadmap(x, { titulo: 'Final' }),
    (x) => removerNo(x, 'raiz', 'b'),
  ];
  const estado = {};
  for (const passo of passos) {
    const resultado = aplicar(r, (x) => passo(x, estado));
    Object.assign(estado, resultado.grafoId ? { grafoId: resultado.grafoId } : {}, resultado.noId ? { noId: resultado.noId } : {});
    r = resultado.roadmap ?? resultado;
  }
  assert.deepEqual(ids(r.grafos.extras), ['extra-1', 'extra-2']);
  assert.deepEqual(r.grafos.extras.arestas, [['extra-1', 'extra-2']]);
  assert.deepEqual(ids(r.grafos.raiz), ['a', 'c']);
  assert.equal(tituloDoRoadmap(r), 'Final');
});
