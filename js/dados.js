// Carrega e valida os grafos. As funções de validação são puras (sem DOM nem rede).

import { temCiclo } from './layout.js';

const tem = (objeto, chave) => Object.hasOwn(objeto, chave);
const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const ehTexto = (valor) => typeof valor === 'string';

function urlSegura(texto) {
  try {
    const { protocol } = new URL(texto);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Valida o roadmap e devolve uma cópia limpa, que o resto do app pode usar sem
 * checagens extras, junto com a lista de avisos sobre o que foi descartado.
 * Lança erro apenas se a estrutura básica (raiz e grafos) estiver quebrada.
 *
 * Avisos: id duplicado, `filho` inexistente, aresta com nó inexistente, e
 * também id de grafo com "/", link que não é http(s) e grafo com ciclo.
 *
 * @returns {{roadmap: object, avisos: string[]}}
 */
export function validarRoadmap(bruto) {
  if (!ehObjeto(bruto) || !ehTexto(bruto.raiz) || !ehObjeto(bruto.grafos)) {
    throw new Error('Roadmap inválido: esperado { "raiz": "...", "grafos": { ... } }.');
  }
  const avisos = [];
  const grafos = {};

  for (const [grafoId, grafoBruto] of Object.entries(bruto.grafos)) {
    if (grafoId.includes('/')) {
      avisos.push(`Grafo "${grafoId}": o id não pode conter "/" (separador da rota); grafo ignorado.`);
      continue;
    }
    if (!ehObjeto(grafoBruto)) {
      avisos.push(`Grafo "${grafoId}": formato inválido; grafo ignorado.`);
      continue;
    }
    if (!Array.isArray(grafoBruto.nos)) {
      avisos.push(`Grafo "${grafoId}": "nos" deve ser uma lista; tratado como vazio.`);
    }

    const nos = [];
    const ids = new Set();
    for (const noBruto of Array.isArray(grafoBruto.nos) ? grafoBruto.nos : []) {
      if (!ehObjeto(noBruto) || !ehTexto(noBruto.id) || noBruto.id === '') {
        avisos.push(`Grafo "${grafoId}": nó sem "id" válido; ignorado.`);
        continue;
      }
      if (ids.has(noBruto.id)) {
        avisos.push(`Grafo "${grafoId}": id de nó duplicado "${noBruto.id}"; a repetição foi ignorada.`);
        continue;
      }
      ids.add(noBruto.id);

      const links = [];
      for (const link of Array.isArray(noBruto.links) ? noBruto.links : []) {
        if (Array.isArray(link) && ehTexto(link[0]) && ehTexto(link[1]) && urlSegura(link[1])) {
          links.push([link[0], link[1]]);
        } else {
          avisos.push(`Grafo "${grafoId}", nó "${noBruto.id}": link inválido ou que não é http(s); ignorado.`);
        }
      }
      nos.push({
        id: noBruto.id,
        titulo: ehTexto(noBruto.titulo) && noBruto.titulo !== '' ? noBruto.titulo : noBruto.id,
        resumo: ehTexto(noBruto.resumo) ? noBruto.resumo : '',
        exemplo: ehTexto(noBruto.exemplo) ? noBruto.exemplo : '',
        links,
        filho: ehTexto(noBruto.filho) ? noBruto.filho : undefined,
      });
    }

    const arestas = [];
    for (const aresta of Array.isArray(grafoBruto.arestas) ? grafoBruto.arestas : []) {
      const [de, para] = Array.isArray(aresta) ? aresta : [];
      if (ids.has(de) && ids.has(para)) {
        arestas.push([de, para]);
      } else {
        avisos.push(`Grafo "${grafoId}": aresta ${JSON.stringify(aresta)} usa nó inexistente; ignorada.`);
      }
    }
    if (temCiclo(nos, arestas)) {
      avisos.push(`Grafo "${grafoId}": tem ciclo; o layout em colunas assume grafo sem ciclos.`);
    }

    grafos[grafoId] = {
      titulo: ehTexto(grafoBruto.titulo) && grafoBruto.titulo !== '' ? grafoBruto.titulo : grafoId,
      nos,
      arestas,
    };
  }

  if (!tem(grafos, bruto.raiz)) {
    throw new Error(`Roadmap inválido: o grafo raiz "${bruto.raiz}" não existe.`);
  }

  // `filho` só pode ser conferido depois que todos os grafos foram lidos.
  for (const [grafoId, grafo] of Object.entries(grafos)) {
    for (const no of grafo.nos) {
      if (no.filho !== undefined && !tem(grafos, no.filho)) {
        avisos.push(`Grafo "${grafoId}", nó "${no.id}": "filho" aponta para o grafo inexistente "${no.filho}"; ignorado.`);
        no.filho = undefined;
      }
    }
  }

  return { roadmap: { raiz: bruto.raiz, grafos }, avisos };
}

/**
 * Ids dos grafos alcançáveis a partir de `inicio` (inclusive) seguindo `filho`.
 * Cada grafo aparece uma vez, mesmo que seja filho de vários nós.
 * @returns {string[]}
 */
export function grafosAlcancaveis(roadmap, inicio = roadmap.raiz) {
  const visitados = new Set();
  const pilha = [inicio];
  while (pilha.length) {
    const id = pilha.pop();
    if (visitados.has(id) || !tem(roadmap.grafos, id)) continue;
    visitados.add(id);
    for (const no of roadmap.grafos[id].nos) {
      if (no.filho !== undefined) pilha.push(no.filho);
    }
  }
  return [...visitados];
}

/** Busca o JSON, valida e escreve cada aviso no console. */
export async function carregarRoadmap(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${resposta.status}).`);
  const { roadmap, avisos } = validarRoadmap(await resposta.json());
  for (const aviso of avisos) console.warn(`[grafos-de-estudo] ${aviso}`);
  return roadmap;
}
