// Mesclagem de progresso entre navegador, outros dispositivos e servidor.
// Módulo puro: o servidor e o cliente importam esta mesma regra, então os dois
// convergem para o mesmo resultado, em qualquer ordem e quantas vezes forem aplicados.
//
// Progresso de um roadmap: { resetEm, registros: { "grafo/no": registro } }
//  - cada registro tem `atualizado` (ms); na mesclagem vence o mais recente de cada card;
//  - `resetEm` é o instante do último "Zerar progresso": registros mais antigos que ele
//    são descartados, e o maior `resetEm` entre as duas partes vale.
// Os instantes vêm sempre do relógio do cliente; o servidor não gera nenhum.

import { normalizarDados } from './progresso.js';

export const progressoVazio = () => ({ resetEm: 0, registros: {} });

/** Aceita só progresso bem formado e já descarta registros anteriores ao `resetEm`. */
export function normalizarProgresso(bruto) {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return progressoVazio();
  const resetEm = Number.isFinite(Number(bruto.resetEm)) ? Math.max(0, Number(bruto.resetEm)) : 0;
  const registros = Object.fromEntries(
    Object.entries(normalizarDados(bruto.registros)).filter(([, registro]) => registro.atualizado >= resetEm),
  );
  return { resetEm, registros };
}

/** O registro mais recente; em empate de `atualizado`, desempata de forma determinística. */
export function registroMaisRecente(a, b) {
  if (a.atualizado !== b.atualizado) return a.atualizado > b.atualizado ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/**
 * Mescla dois progressos do mesmo roadmap. Comutativa, associativa e idempotente.
 * @returns {{resetEm: number, registros: object}}
 */
export function mesclarProgresso(a, b) {
  const [pa, pb] = [normalizarProgresso(a), normalizarProgresso(b)];
  const resetEm = Math.max(pa.resetEm, pb.resetEm);
  const escolhidos = new Map();
  for (const [chave, registro] of [...Object.entries(pa.registros), ...Object.entries(pb.registros)]) {
    if (registro.atualizado < resetEm) continue;
    escolhidos.set(chave, escolhidos.has(chave) ? registroMaisRecente(escolhidos.get(chave), registro) : registro);
  }
  return { resetEm, registros: Object.fromEntries(escolhidos) };
}
