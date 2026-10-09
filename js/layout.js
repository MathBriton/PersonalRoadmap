// Layout em colunas. Módulo puro: não acessa o DOM.

/**
 * Ordena os nós em ondas (algoritmo de Kahn). O nível de um nó é o caminho mais
 * longo desde as raízes (nós sem aresta de entrada). Arestas que apontam para
 * nós inexistentes e laços (de === para) são ignorados.
 *
 * Nós presos em ciclos (ou depois deles) nunca chegam a grau de entrada zero.
 * Eles vão para uma coluna extra, depois do último nível alcançado, para o
 * layout não quebrar. `ciclicos` lista esses nós.
 *
 * @param {{id: string}[]} nos
 * @param {[string, string][]} arestas
 * @returns {{niveis: Map<string, number>, ciclicos: Set<string>}}
 */
function ordenar(nos, arestas) {
  const ids = new Set(nos.map((no) => no.id));
  const saidas = new Map();
  const grauEntrada = new Map();
  for (const id of ids) {
    saidas.set(id, []);
    grauEntrada.set(id, 0);
  }
  for (const [de, para] of arestas) {
    if (!ids.has(de) || !ids.has(para) || de === para) continue;
    saidas.get(de).push(para);
    grauEntrada.set(para, grauEntrada.get(para) + 1);
  }

  const niveis = new Map();
  const fila = [];
  for (const [id, grau] of grauEntrada) {
    if (grau === 0) {
      niveis.set(id, 0);
      fila.push(id);
    }
  }

  const processados = new Set();
  let maiorNivel = -1;
  for (let i = 0; i < fila.length; i++) {
    const id = fila[i];
    processados.add(id);
    const nivel = niveis.get(id);
    maiorNivel = Math.max(maiorNivel, nivel);
    for (const proximo of saidas.get(id)) {
      niveis.set(proximo, Math.max(niveis.get(proximo) ?? 0, nivel + 1));
      grauEntrada.set(proximo, grauEntrada.get(proximo) - 1);
      if (grauEntrada.get(proximo) === 0) fila.push(proximo);
    }
  }

  const ciclicos = new Set();
  for (const id of ids) {
    if (!processados.has(id)) {
      ciclicos.add(id);
      niveis.set(id, maiorNivel + 1);
    }
  }
  return { niveis, ciclicos };
}

/** @returns {Map<string, number>} nível (índice da coluna) de cada nó */
export function calcularNiveis(nos, arestas) {
  return ordenar(nos, arestas).niveis;
}

/** Verdadeiro se o grafo tem ciclo ou laço, o que o layout não suporta bem. */
export function temCiclo(nos, arestas) {
  const temLaco = arestas.some(([de, para]) => de === para);
  return temLaco || ordenar(nos, arestas).ciclicos.size > 0;
}

/**
 * Agrupa os nós em colunas pelo nível, mantendo a ordem de declaração dentro de
 * cada coluna.
 * @returns {object[][]} colunas[nivel] = nós daquele nível
 */
export function organizarColunas(nos, arestas) {
  const niveis = calcularNiveis(nos, arestas);
  const colunas = [];
  for (const no of nos) {
    const nivel = niveis.get(no.id);
    (colunas[nivel] ??= []).push(no);
  }
  return Array.from(colunas, (coluna) => coluna ?? []);
}
