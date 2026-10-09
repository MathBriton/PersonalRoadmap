// Persistência local do progresso: localStorage com fallback em memória, separada por
// roadmap. Toda leitura e escrita fica em try/catch porque até acessar `localStorage`
// pode lançar erro (modo anônimo restrito, cookies bloqueados).
//
// Formato: { [roadmapId]: { resetEm, registros: { "grafo/no": registro } } }
// Dados do formato v1 (mapa plano do único roadmap que existia) são migrados para "react".

import { chaveDoNo, normalizarDados } from './progresso.js';
import { mesclarProgresso } from './sincronia.js';

export const CHAVE_STORAGE = 'grafos-estudo-v2';
export const CHAVE_STORAGE_V1 = 'grafos-estudo-v1';
export const ID_ROADMAP_V1 = 'react';

const semProgresso = () => ({ resetEm: 0, registros: {} });

function normalizarTudo(bruto) {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  return Object.fromEntries(
    Object.entries(bruto).map(([id, progresso]) => {
      const resetEm = Number(progresso?.resetEm);
      return [id, { resetEm: Number.isFinite(resetEm) ? Math.max(0, resetEm) : 0, registros: normalizarDados(progresso?.registros) }];
    }),
  );
}

export function criarRepositorio(obterStorage = () => globalThis.localStorage, chave = CHAVE_STORAGE) {
  let memoria = {};
  let emMemoria = false;

  function lerTudo() {
    if (emMemoria) return memoria;
    let texto;
    let textoV1;
    try {
      const storage = obterStorage();
      texto = storage.getItem(chave);
      textoV1 = texto ? null : storage.getItem(CHAVE_STORAGE_V1);
    } catch {
      emMemoria = true;
      return memoria;
    }
    try {
      if (texto) memoria = normalizarTudo(JSON.parse(texto));
      else if (textoV1) memoria = { [ID_ROADMAP_V1]: { resetEm: 0, registros: normalizarDados(JSON.parse(textoV1)) } };
      else memoria = {};
    } catch {
      memoria = {};
    }
    return memoria;
  }

  function gravarTudo(todos) {
    memoria = todos;
    if (emMemoria) return;
    try {
      obterStorage().setItem(chave, JSON.stringify(todos));
    } catch {
      emMemoria = true;
    }
  }

  const progressoDe = (id) => lerTudo()[id] ?? semProgresso();

  function mesclar(id, parte) {
    const mesclado = mesclarProgresso(progressoDe(id), parte);
    gravarTudo({ ...lerTudo(), [id]: mesclado });
    return mesclado;
  }

  return {
    progresso: progressoDe,
    mesclar,
    /** Roadmaps que têm algum progresso guardado neste navegador. */
    roadmaps: () => Object.keys(lerTudo()),
    /** Esquece o progresso local de um roadmap excluído, para não voltar se o id for reaproveitado. */
    descartar(id) {
      const { [id]: _descartado, ...resto } = lerTudo();
      gravarTudo(resto);
    },
    /** Visão de um roadmap com a API simples que a renderização usa. */
    escopo(id) {
      return {
        /** Mapa "grafo/no" -> registro dos registros vivos. */
        ler: () => progressoDe(id).registros,
        progresso: () => progressoDe(id),
        mesclar: (parte) => mesclar(id, parte),
        /**
         * Grava o registro de um card. O `atualizado` nunca anda para trás em relação ao que
         * já existe, senão um relógio atrasado faria a mudança perder na mesclagem.
         * @returns {object} o registro gravado
         */
        definir(grafoId, noId, registro) {
          const chaveNo = chaveDoNo(grafoId, noId);
          const anterior = progressoDe(id).registros[chaveNo]?.atualizado ?? 0;
          const gravado = { ...registro, atualizado: Math.max(registro.atualizado ?? 0, anterior + 1) };
          mesclar(id, { resetEm: 0, registros: { [chaveNo]: gravado } });
          return gravado;
        },
        /**
         * Zera o progresso do roadmap. Em vez de apagar, avança `resetEm` para além de todos os
         * registros, assim a mesclagem com outros dispositivos não os traz de volta.
         * @returns {{resetEm: number, registros: {}}}
         */
        limpar(agora) {
          const atual = progressoDe(id);
          const maisRecente = Math.max(0, ...Object.values(atual.registros).map((r) => r.atualizado));
          const novo = { resetEm: Math.max(agora, atual.resetEm, maisRecente + 1), registros: {} };
          gravarTudo({ ...lerTudo(), [id]: novo });
          return novo;
        },
        /** Verdadeiro quando o storage falhou e o progresso só vive nesta aba. */
        get emMemoria() {
          return emMemoria;
        },
      };
    },
    get emMemoria() {
      return emMemoria;
    },
  };
}
