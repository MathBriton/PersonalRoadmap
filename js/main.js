// Inicialização e ligação dos módulos: escolhe a fonte de dados (servidor ou local),
// monta o contexto compartilhado e troca de tela conforme a rota.

import { criarApi } from './api.js';
import { criarFonte } from './fonte.js';
import { criarRepositorio } from './repositorio.js';
import { contarRevisoes } from './revisao.js';
import { ROTA_INICIO, criarRotas } from './rotas.js';
import { criarSincronizador } from './sync.js';
import { montarInicio } from './tela-inicio.js';
import { montarRoadmap } from './tela-roadmap.js';

const porId = (id) => document.getElementById(id);
const MS_AVISO = 8000;

const TEXTO_SYNC = {
  local: 'Modo local: sem servidor, o progresso fica só neste navegador.',
  sincronizado: 'Salvo no servidor.',
  enviando: 'Salvando…',
  offline: 'Sem conexão com o servidor. O progresso está salvo neste navegador e será enviado depois.',
};

async function iniciar() {
  const fonte = await criarFonte(criarApi());
  const repo = criarRepositorio();
  const cache = new Map(); // roadmapId -> { id, roadmap, atualizadoEm }

  const principal = porId('principal');
  const trilha = porId('trilha');
  const botaoZerar = porId('btn-zerar');
  const refsProgresso = {
    texto: porId('progresso-texto'),
    barra: porId('progresso-barra'),
    preenchida: porId('progresso-preenchida'),
    aviso: porId('aviso-storage'),
  };

  let temporizadorAviso = null;
  function avisar(mensagem, tipo = 'info') {
    const area = porId('avisos');
    clearTimeout(temporizadorAviso);
    area.textContent = mensagem;
    area.dataset.tipo = tipo;
    area.hidden = false;
    temporizadorAviso = setTimeout(() => {
      area.hidden = true;
    }, MS_AVISO);
  }

  function mostrarErro(mensagem) {
    const erro = porId('erro');
    erro.textContent = mensagem ?? '';
    erro.hidden = !mensagem;
  }

  let tela = null;
  let roadmapAtivo = null;

  let estadoAnterior = null;
  const sync = criarSincronizador({
    repo,
    fonte,
    aoMudarEstado(estado) {
      porId('estado-sync').textContent = TEXTO_SYNC[estado];
      if (estado === 'offline') avisar(TEXTO_SYNC.offline, 'erro');
      else if (estado === 'sincronizado' && estadoAnterior === 'offline') avisar('Conexão restabelecida: progresso sincronizado.');
      if (estado !== 'enviando') estadoAnterior = estado;
    },
    aoAtualizar(id) {
      tela?.aoAtualizarProgresso?.(id);
      atualizarContagemRevisao();
    },
  });
  porId('estado-sync').textContent = TEXTO_SYNC[sync.estado];

  function atualizarContagemRevisao() {
    const entradas = [...cache.values()].map(({ id, roadmap }) => ({ id, roadmap, registros: repo.escopo(id).ler() }));
    const total = contarRevisoes(entradas, Date.now());
    const marcador = porId('contagem-revisao');
    marcador.textContent = String(total);
    marcador.hidden = total === 0;
    porId('link-revisao').setAttribute('aria-label', total > 0 ? `Revisão: ${total} para revisar hoje` : 'Revisão');
  }

  const ctx = {
    fonte,
    repo,
    sync,
    principal,
    trilha,
    primeiraCarga: true,
    avisar,
    mostrarErro,
    atualizarContagemRevisao,
    cabecalho: {
      refs: refsProgresso,
      mostrar: (visivel) => {
        porId('area-progresso').hidden = !visivel;
      },
      aoZerar: (funcao) => {
        botaoZerar.onclick = funcao;
      },
    },
    mostrarTrilha: (visivel) => {
      trilha.hidden = !visivel;
    },
    rotas: null,
    /** Todos os roadmaps com seus dados; reaproveita o cache quando o `atualizadoEm` não mudou. */
    async entradas() {
      const lista = await fonte.listar();
      const idsAtuais = new Set(lista.map((meta) => meta.id));
      for (const id of cache.keys()) if (!idsAtuais.has(id)) cache.delete(id);
      return Promise.all(
        lista.map(async (meta) => {
          const guardado = cache.get(meta.id);
          if (guardado && meta.atualizadoEm && guardado.atualizadoEm === meta.atualizadoEm) return guardado;
          const dados = await fonte.obter(meta.id);
          cache.set(meta.id, dados);
          return dados;
        }),
      );
    },
    guardar: (dados) => cache.set(dados.id, dados),
    esquecer: (id) => cache.delete(id),
  };

  function montarTela(rota) {
    if (rota.tela === 'roadmap') return montarRoadmap(ctx, rota);
    if (rota.tela === 'revisao') {
      // Carregada sob demanda: se falhar, o resto do app continua funcionando.
      let vivo = true;
      let montada = null;
      import('./tela-revisao.js')
        .then((modulo) => {
          if (vivo) montada = modulo.montarRevisao(ctx);
        })
        .catch((erro) => {
          console.error(erro);
          if (vivo) mostrarErro('Não foi possível carregar a fila de revisão.');
        });
      return {
        aoAtualizarProgresso: (id) => montada?.aoAtualizarProgresso?.(id),
        desmontar() {
          vivo = false;
          montada?.desmontar?.();
        },
      };
    }
    return montarInicio(ctx);
  }

  function aoMudarRota(rota) {
    mostrarErro(null);
    if (tela?.aoMudarRota?.(rota)) return;
    tela?.desmontar?.();
    principal.replaceChildren();
    roadmapAtivo = rota.tela === 'roadmap' ? rota.roadmapId : null;
    tela = montarTela(rota);
    ctx.primeiraCarga = false;
  }

  ctx.rotas = criarRotas(aoMudarRota);

  // Ao voltar para a aba ou recuperar a rede, troca progresso com o servidor (inclui mudanças de outros dispositivos).
  function sincronizarAgora() {
    if (!fonte.progresso) return;
    sync.sincronizarTodos(roadmapAtivo ? [roadmapAtivo] : [...cache.keys()]);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizarAgora();
  });
  window.addEventListener('online', sincronizarAgora);

  aoMudarRota(ctx.rotas.rota());
  ctx.entradas().then(atualizarContagemRevisao, () => {});
}

iniciar();
