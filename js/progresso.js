// Progresso e revisão espaçada.
// As regras (statusExibido, marcarStatus, registrarRevisao, contarProgresso) são puras;
// só `criarRepositorio` toca o armazenamento, sempre dentro de try/catch.

import { grafosAlcancaveis } from './dados.js';

export const CHAVE_STORAGE = 'grafos-estudo-v1';
export const DIA_MS = 24 * 60 * 60 * 1000;
export const STATUS_MARCAVEIS = ['novo', 'estudando', 'dominado'];

/** Chave de progresso de um nó: `idDoGrafo/idDoNo`. */
export const chaveDoNo = (grafoId, noId) => `${grafoId}/${noId}`;

export const registroPadrao = () => ({ status: 'novo', intervalo: 0, proxima: 0 });

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
  if (status !== 'dominado') return { status, intervalo: 0, proxima: 0 };
  return { status, intervalo: Math.max(0, numeroOuZero(bruto.intervalo)), proxima: instante(bruto.proxima) };
}

export function normalizarDados(bruto) {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const dados = {};
  for (const [chave, registro] of Object.entries(bruto)) dados[chave] = normalizarRegistro(registro);
  return dados;
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
  if (status === 'dominado') return { status, intervalo: 1, proxima: agora + DIA_MS };
  return { status, intervalo: 0, proxima: 0 };
}

/** Resposta à revisão: Lembrei dobra o intervalo; Esqueci volta a 1 dia. */
export function registrarRevisao(registro, lembrou, agora) {
  const intervalo = lembrou ? Math.max(1, registro.intervalo) * 2 : 1;
  return { status: 'dominado', intervalo, proxima: agora + intervalo * DIA_MS };
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

/**
 * Persistência no localStorage com fallback em memória. `obterStorage` é uma
 * função porque até acessar `localStorage` pode lançar erro (modo anônimo restrito).
 */
export function criarRepositorio(obterStorage = () => globalThis.localStorage, chave = CHAVE_STORAGE) {
  let memoria = {};
  let emMemoria = false;

  function ler() {
    if (!emMemoria) {
      let texto;
      try {
        texto = obterStorage().getItem(chave);
      } catch {
        emMemoria = true;
        return memoria;
      }
      try {
        memoria = texto ? normalizarDados(JSON.parse(texto)) : {};
      } catch {
        memoria = {};
      }
    }
    return memoria;
  }

  function gravar(dados) {
    memoria = dados;
    if (emMemoria) return;
    try {
      obterStorage().setItem(chave, JSON.stringify(dados));
    } catch {
      emMemoria = true;
    }
  }

  return {
    ler,
    definir(grafoId, noId, registro) {
      gravar({ ...ler(), [chaveDoNo(grafoId, noId)]: registro });
    },
    limpar() {
      gravar({});
    },
    /** Verdadeiro quando o storage falhou e o progresso só vive nesta aba. */
    get emMemoria() {
      return emMemoria;
    },
  };
}
