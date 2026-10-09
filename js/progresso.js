// Progresso e revisão espaçada.
// Regras puras (statusExibido, marcarStatus, registrarRevisao, contarProgresso): sem DOM e sem
// armazenamento. A persistência fica em repositorio.js e a mesclagem em sincronia.js.
//
// Cada registro guarda `atualizado` (ms) para que a mesclagem entre dispositivos e o
// servidor (ver sincronia.js) fique com o mais recente de cada card.

import { grafosAlcancaveis } from './dados.js';

export const DIA_MS = 24 * 60 * 60 * 1000;
export const STATUS_MARCAVEIS = ['novo', 'estudando', 'dominado'];

/** Chave de progresso de um nó dentro do roadmap: `idDoGrafo/idDoNo`. */
export const chaveDoNo = (grafoId, noId) => `${grafoId}/${noId}`;

export const registroPadrao = () => ({ status: 'novo', intervalo: 0, proxima: 0, atualizado: 0 });

const numeroOuZero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

// `proxima` é um timestamp em ms, mas uma data ISO escrita à mão no storage também vale.
function instante(valor) {
  const numero = typeof valor === 'string' && Number.isNaN(Number(valor)) ? Date.parse(valor) : Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

/** Aceita só registros bem formados; edição manual do storage não deve quebrar o app. */
export function normalizarRegistro(bruto) {
  if (bruto === null || typeof bruto !== 'object') return registroPadrao();
  const status = STATUS_MARCAVEIS.includes(bruto.status) ? bruto.status : 'novo';
  const atualizado = Math.max(0, numeroOuZero(bruto.atualizado));
  if (status !== 'dominado') return { status, intervalo: 0, proxima: 0, atualizado };
  return { status, intervalo: Math.max(0, numeroOuZero(bruto.intervalo)), proxima: instante(bruto.proxima), atualizado };
}

const chaveValida = (chave) => typeof chave === 'string' && chave.length <= 300 && chave.includes('/');

/** Mapa "grafo/no" -> registro, descartando chaves malformadas. */
export function normalizarDados(bruto) {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  // fromEntries cria propriedades próprias, então uma chave "__proto__" vinda de JSON não mexe no protótipo.
  return Object.fromEntries(
    Object.entries(bruto)
      .filter(([chave]) => chaveValida(chave))
      .map(([chave, registro]) => [chave, normalizarRegistro(registro)]),
  );
}

export const lerRegistro = (dados, grafoId, noId) =>
  Object.hasOwn(dados, chaveDoNo(grafoId, noId)) ? dados[chaveDoNo(grafoId, noId)] : registroPadrao();

/** Estado visível no card: 'novo' | 'estudando' | 'dominado' | 'revisar'. */
export function statusExibido(registro, agora) {
  if (registro.status === 'dominado' && registro.proxima <= agora) return 'revisar';
  return registro.status;
}

/** Marca o status de um card (botões Não visto / Estudando / Dominado). */
export function marcarStatus(status, agora) {
  if (status === 'dominado') return { status, intervalo: 1, proxima: agora + DIA_MS, atualizado: agora };
  return { status, intervalo: 0, proxima: 0, atualizado: agora };
}

/** Resposta à revisão: Lembrei dobra o intervalo; Esqueci volta a 1 dia. */
export function registrarRevisao(registro, lembrou, agora) {
  const intervalo = lembrou ? Math.max(1, registro.intervalo) * 2 : 1;
  return { status: 'dominado', intervalo, proxima: agora + intervalo * DIA_MS, atualizado: agora };
}

/**
 * Quantos tópicos estão dominados em `grafoId` e em todos os subgrafos dele, sem
 * contar o mesmo grafo duas vezes. Um card em revisão ainda conta como dominado.
 * @returns {{feitos: number, total: number}}
 */
export function contarProgresso(roadmap, grafoId, dados) {
  let feitos = 0;
  let total = 0;
  for (const id of grafosAlcancaveis(roadmap, grafoId)) {
    for (const no of roadmap.grafos[id].nos) {
      total += 1;
      if (lerRegistro(dados, id, no.id).status === 'dominado') feitos += 1;
    }
  }
  return { feitos, total };
}
