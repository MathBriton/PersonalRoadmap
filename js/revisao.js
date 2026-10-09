// Fila de revisão entre roadmaps. Módulo puro: recebe os dados prontos e devolve a lista, sem
// DOM, rede nem relógio (o `agora` vem do chamador).
//
// Só entram cards de grafos alcançáveis a partir da raiz: um grafo órfão não aparece na tela,
// então revisar um card dele não faria sentido. Registros de nós que não existem mais são ignorados.

import { tituloDoRoadmap } from './dados.js';
import { chaveDoNo, normalizarRegistro, statusExibido } from './progresso.js';

const tem = (objeto, chave) => Object.hasOwn(objeto, chave);

/**
 * BFS a partir da raiz seguindo `filho`. Devolve grafo -> grafo pai (a raiz tem pai `null`).
 * Cada grafo é visitado uma vez, então ciclos (a -> b -> a) e grafos com vários pais não travam
 * nem duplicam nada; o pai guardado vale o caminho mais curto, e em empate vence o primeiro nó
 * na ordem de declaração.
 */
function paisDosGrafos(roadmap) {
  const pais = new Map();
  if (!tem(roadmap.grafos, roadmap.raiz)) return pais;
  pais.set(roadmap.raiz, null);
  const fila = [roadmap.raiz];
  for (let i = 0; i < fila.length; i += 1) {
    const id = fila[i];
    for (const no of roadmap.grafos[id].nos) {
      const filho = no.filho;
      if (filho === undefined || pais.has(filho) || !tem(roadmap.grafos, filho)) continue;
      pais.set(filho, id);
      fila.push(filho);
    }
  }
  return pais;
}

function caminhoPelosPais(pais, grafoId) {
  const caminho = [];
  for (let id = grafoId; id !== null; id = pais.get(id)) caminho.push(id);
  return caminho.reverse();
}

/**
 * Caminho de grafos da raiz até `grafoId`, seguindo `filho` pelo menor número de saltos.
 * @returns {string[] | null} `[raiz, ..., grafoId]`, ou `null` se o grafo não existe ou é inalcançável
 */
export function caminhoAteGrafo(roadmap, grafoId) {
  const pais = paisDosGrafos(roadmap);
  return pais.has(grafoId) ? caminhoPelosPais(pais, grafoId) : null;
}

// Comparação por unidade de código, não por locale, para a ordem ser a mesma em qualquer máquina.
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Cards em revisão dos grafos alcançáveis, ainda sem caminho nem trilha. Subir até a raiz custa o
 * tamanho do caminho, e quem só conta (o selo, a cada atualização de progresso) não deve pagar isso
 * por grafo: numa cadeia de milhares de grafos o custo viraria quadrático mesmo sem nada para revisar.
 */
function* cardsEmRevisao(entradas, agora) {
  for (const { id: roadmapId, roadmap, registros } of entradas) {
    if (registros == null) continue;
    const pais = paisDosGrafos(roadmap);
    for (const grafoId of pais.keys()) {
      for (const no of roadmap.grafos[grafoId].nos) {
        const chave = chaveDoNo(grafoId, no.id);
        if (!tem(registros, chave)) continue;
        // Normaliza porque o storage pode ter sido editado à mão; garante `proxima` e `intervalo` numéricos.
        const registro = normalizarRegistro(registros[chave]);
        if (statusExibido(registro, agora) === 'revisar') yield { roadmapId, roadmap, pais, grafoId, no, registro };
      }
    }
  }
}

/**
 * Cards para revisar agora, dos mais atrasados para os mais recentes.
 * @param {{id: string, roadmap: object, registros: object}[]} entradas
 * @param {number} agora instante em ms
 * @returns {{roadmapId: string, roadmapTitulo: string, grafoId: string, caminho: string[], trilha: string[],
 *   noId: string, noTitulo: string, proxima: number, intervalo: number}[]}
 */
export function filaDeRevisao(entradas, agora) {
  const itens = [];
  let atual = null; // caminho do grafo em curso: os cards de um mesmo grafo vêm em sequência
  for (const { roadmapId, roadmap, pais, grafoId, no, registro } of cardsEmRevisao(entradas, agora)) {
    if (atual?.pais !== pais || atual.grafoId !== grafoId) atual = { pais, grafoId, caminho: caminhoPelosPais(pais, grafoId) };
    const { caminho } = atual;
    itens.push({
      roadmapId,
      roadmapTitulo: tituloDoRoadmap(roadmap),
      grafoId,
      caminho: [...caminho],
      trilha: caminho.map((id) => roadmap.grafos[id].titulo),
      noId: no.id,
      noTitulo: no.titulo,
      proxima: registro.proxima,
      intervalo: registro.intervalo,
    });
  }
  return itens.sort(
    (a, b) =>
      a.proxima - b.proxima ||
      comparar(a.roadmapId, b.roadmapId) ||
      comparar(a.grafoId, b.grafoId) ||
      comparar(a.noId, b.noId),
  );
}

/** Quantos cards estão para revisar (o número do selo na tela inicial). */
export function contarRevisoes(entradas, agora) {
  let total = 0;
  for (const _card of cardsEmRevisao(entradas, agora)) total += 1;
  return total;
}
