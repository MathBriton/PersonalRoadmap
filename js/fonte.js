// Fonte de dados dos roadmaps. Duas implementações com a mesma interface:
//  - servidor: usa a API Express (lista, edita, cria, exclui e guarda o progresso);
//  - local: sem servidor (ex.: `npx serve`), só o roadmap de exemplo em data/react.json,
//    somente leitura, com o progresso apenas no localStorage.
//
// Interface:
//   modo: 'servidor' | 'local'      editavel: boolean
//   listar()                  -> [{ id, titulo, descricao?, topicos, grafos, atualizadoEm }]
//   obter(id)                 -> { id, roadmap, atualizadoEm }
//   criar({ id?, roadmap })   -> { id, roadmap, atualizadoEm, avisos }
//   salvar(id, roadmap, baseadoEm) -> { id, roadmap, atualizadoEm, avisos }
//   excluir(id)
//   progresso: { mesclar(id, parte) -> progresso mesclado } | null (sem servidor)
// Os métodos lançam ErroApi.

import { ErroApi } from './api.js';
import { tituloDoRoadmap, validarRoadmap } from './dados.js';
import { contarProgresso } from './progresso.js';

function fonteServidor(api) {
  return {
    modo: 'servidor',
    editavel: true,
    listar: () => api.listarRoadmaps(),
    obter: (id) => api.obterRoadmap(id),
    criar: (dados) => api.criarRoadmap(dados),
    salvar: (id, roadmap, baseadoEm) => api.salvarRoadmap(id, roadmap, baseadoEm),
    excluir: (id) => api.excluirRoadmap(id),
    progresso: { mesclar: (id, parte) => api.mesclarProgresso(id, parte) },
  };
}

const ID_LOCAL = 'react';
const SOMENTE_COM_SERVIDOR = () => Promise.reject(new ErroApi('Disponível apenas com o servidor em execução (npm start).', 501));

function fonteLocal(urlDados = new URL('../data/react.json', import.meta.url)) {
  let carregando = null;
  function carregar() {
    carregando ??= (async () => {
      const resposta = await fetch(urlDados);
      if (!resposta.ok) throw new ErroApi(`Não foi possível carregar ${urlDados.pathname} (HTTP ${resposta.status}).`, resposta.status);
      const { roadmap, avisos } = validarRoadmap(await resposta.json());
      for (const aviso of avisos) console.warn(`[grafos-de-estudo] ${aviso}`);
      return roadmap;
    })().catch((erro) => {
      carregando = null;
      throw erro instanceof ErroApi ? erro : new ErroApi(erro.message, 0);
    });
    return carregando;
  }
  return {
    modo: 'local',
    editavel: false,
    async listar() {
      const roadmap = await carregar();
      return [
        {
          id: ID_LOCAL,
          titulo: tituloDoRoadmap(roadmap),
          descricao: roadmap.descricao,
          topicos: contarProgresso(roadmap, roadmap.raiz, {}).total,
          grafos: Object.keys(roadmap.grafos).length,
          atualizadoEm: null,
        },
      ];
    },
    async obter(id) {
      if (id !== ID_LOCAL) throw new ErroApi('Roadmap não encontrado.', 404);
      return { id, roadmap: await carregar(), atualizadoEm: null };
    },
    criar: SOMENTE_COM_SERVIDOR,
    salvar: SOMENTE_COM_SERVIDOR,
    excluir: SOMENTE_COM_SERVIDOR,
    progresso: null,
  };
}

/** Usa o servidor se ele responder; senão cai no modo local. */
export async function criarFonte(api) {
  try {
    await api.saude();
    return fonteServidor(api);
  } catch {
    return fonteLocal();
  }
}

export { fonteLocal, fonteServidor };
