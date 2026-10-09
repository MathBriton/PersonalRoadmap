// Tela de um roadmap: grafo atual, trilha, progresso, exportação e modo de edição.
// O editor e a exportação são carregados sob demanda (import dinâmico), então um defeito
// neles não impede de estudar.

import { desenharArestas } from './arestas.js';
import { tituloDoRoadmap } from './dados.js';
import { confirmar } from './dialogo.js';
import { botao, el } from './dom.js';
import { contarProgresso, lerRegistro, marcarStatus, registrarRevisao } from './progresso.js';
import { focoAtual, renderCabecalho, renderGrafo, renderTrilha, restaurarFoco } from './render.js';
import { ROTA_INICIO, caminhoDaRota, rotaDoRoadmap } from './rotas.js';

const NOME_APP = 'Grafos de estudo';

/**
 * Monta a tela em `ctx.principal`. Devolve os ganchos que o main.js usa:
 * `aoMudarRota(rota)` (true se tratou a rota sem remontar), `aoAtualizarProgresso(id)` e `desmontar()`.
 */
export function montarRoadmap(ctx, rotaInicial) {
  const roadmapId = rotaInicial.roadmapId;
  const escopo = ctx.repo.escopo(roadmapId);
  let vivo = true;
  let rota = rotaInicial;
  let roadmap = null;
  let atualizadoEm = null;
  let caminho = [];
  let modoEdicao = false;
  let editor = null;
  const focarAoMontar = !ctx.primeiraCarga; // vindo de outra tela, o foco vai para o título
  const abertos = new Set(); // cards abertos na visita atual ao grafo
  let cartoes = new Map();
  let dominados = new Set();

  const titulo = el('h1', { classe: 'titulo-grafo', attrs: { id: 'titulo-grafo', tabindex: '-1' } });
  const ferramentas = el('div', { classe: 'ferramentas', attrs: { role: 'toolbar', 'aria-label': 'Ferramentas do roadmap' } });
  const extrasEdicao = el('div', { classe: 'grupo' });
  const grafoEl = el('div', { classe: 'grafo', attrs: { id: 'grafo' } });
  const quadro = el('div', { classe: 'quadro', attrs: { id: 'quadro' } }, grafoEl);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'arestas');
  svg.setAttribute('aria-hidden', 'true');
  ctx.principal.replaceChildren(el('p', { classe: 'vazio', texto: 'Carregando…' }));

  const grafoAtual = () => caminho.at(-1);

  function redesenhar() {
    if (roadmap) desenharArestas(svg, grafoEl, cartoes, roadmap.grafos[grafoAtual()].arestas, dominados);
  }

  // Cards mudam de tamanho ao expandir, ao girar a tela ou quando as fontes chegam.
  const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(redesenhar) : null;
  const aoRedimensionar = () => redesenhar();
  window.addEventListener('resize', aoRedimensionar);
  document.fonts?.ready.then(() => vivo && redesenhar());

  function depoisDeMudarProgresso() {
    ctx.sync.agendar(roadmapId);
    renderizar();
    ctx.atualizarContagemRevisao();
  }

  const acoes = {
    aoAlternar(noId, aberto) {
      if (aberto) abertos.add(noId);
      else abertos.delete(noId);
      redesenhar();
    },
    aoMarcar(noId, status) {
      escopo.definir(grafoAtual(), noId, marcarStatus(status, Date.now()));
      depoisDeMudarProgresso();
    },
    aoRevisar(noId, lembrou) {
      const grafoId = grafoAtual();
      escopo.definir(grafoId, noId, registrarRevisao(lerRegistro(escopo.ler(), grafoId, noId), lembrou, Date.now()));
      depoisDeMudarProgresso();
    },
    aoAbrir: (filhoId) => ctx.rotas.ir(rotaDoRoadmap(roadmapId, [...caminho, filhoId])),
  };

  function renderizar({ moverFoco = false } = {}) {
    if (!roadmap) return;
    const grafoId = grafoAtual();
    const grafo = roadmap.grafos[grafoId];
    const dados = escopo.ler();
    const agora = Date.now();

    renderCabecalho(ctx.cabecalho.refs, { ...contarProgresso(roadmap, roadmap.raiz, dados), emMemoria: escopo.emMemoria });
    renderTrilha(ctx.trilha, caminho.map((id) => roadmap.grafos[id].titulo), (indice) =>
      ctx.rotas.ir(rotaDoRoadmap(roadmapId, caminho.slice(0, indice + 1))),
    );
    titulo.textContent = grafo.titulo;
    document.title = `${grafo.titulo} · ${tituloDoRoadmap(roadmap)} · ${NOME_APP}`;

    const edicao = modoEdicao
      ? { ativo: true, aoEditar: (noId) => editor.editarNo(grafoId, noId), aoRemover: (noId) => editor.removerNo(grafoId, noId) }
      : null;
    const foco = focoAtual(grafoEl);
    cartoes = renderGrafo(grafoEl, svg, { grafoId, grafo, roadmap, dados, agora, abertos, acoes, edicao });
    dominados = new Set(grafo.nos.filter((no) => lerRegistro(dados, grafoId, no.id).status === 'dominado').map((no) => no.id));
    restaurarFoco(grafoEl, foco);

    if (observador) {
      observador.disconnect();
      observador.observe(grafoEl);
      for (const card of cartoes.values()) observador.observe(card);
    }
    redesenhar();

    if (moverFoco) {
      quadro.scrollLeft = 0;
      titulo.focus();
    }
  }

  // Mantém o maior prefixo do caminho cujos grafos ainda existem (um grafo pode ter sido podado).
  function ajustarCaminho() {
    const valido = [roadmap.raiz];
    for (const id of caminho.slice(1)) {
      if (!Object.hasOwn(roadmap.grafos, id)) break;
      valido.push(id);
    }
    if (valido.length !== caminho.length) {
      caminho = valido;
      ctx.rotas.substituir(rotaDoRoadmap(roadmapId, caminho), false);
    }
  }

  /**
   * Grava no servidor o roadmap editado e redesenha. Lança ErroApi se falhar (409 = alterado em outro lugar).
   * `removidos.nos` (de edicao.removerNo) têm o progresso zerado para o id não ressuscitar se for reaproveitado.
   */
  async function aplicar(novoRoadmap, { removidos } = {}) {
    const resposta = await ctx.fonte.salvar(roadmapId, novoRoadmap, atualizadoEm);
    roadmap = resposta.roadmap;
    atualizadoEm = resposta.atualizadoEm;
    ctx.guardar({ id: roadmapId, roadmap, atualizadoEm });
    const agora = Date.now();
    for (const { grafoId, noId } of removidos?.nos ?? []) escopo.definir(grafoId, noId, marcarStatus('novo', agora));
    if (removidos?.nos?.length) ctx.sync.agendar(roadmapId);
    ajustarCaminho();
    renderizar();
    ctx.atualizarContagemRevisao();
    return resposta;
  }

  async function recarregar() {
    const dados = await ctx.fonte.obter(roadmapId);
    roadmap = dados.roadmap;
    atualizadoEm = dados.atualizadoEm;
    ctx.guardar(dados);
    ajustarCaminho();
    renderizar();
    ctx.atualizarContagemRevisao();
  }

  /** O que o editor (js/editor.js) enxerga da tela. */
  const sessao = {
    roadmapId,
    ctx,
    obterRoadmap: () => roadmap,
    grafoAtual,
    aplicar,
    recarregar,
    /** Foca o cabeçalho do card de um tópico do grafo atual (depois de uma edição que recria os cards). */
    focarNo: (noId) => cartoes.get(noId)?.querySelector('.card-cabecalho')?.focus(),
  };

  async function alternarEdicao(evento) {
    if (!modoEdicao && !editor) {
      try {
        editor = (await import('./editor.js')).criarEditor(sessao);
      } catch (erro) {
        console.error(erro);
        ctx.avisar('Não foi possível carregar o editor.', 'erro');
        return;
      }
    }
    modoEdicao = !modoEdicao;
    evento.currentTarget.setAttribute('aria-pressed', String(modoEdicao));
    extrasEdicao.replaceChildren(
      ...(modoEdicao
        ? [
            botao('Adicionar tópico', 'ferr:novo-no', () => editor.novoNo(grafoAtual())),
            botao('Renomear grafo', 'ferr:renomear-grafo', () => editor.renomearGrafo(grafoAtual())),
            botao('Dados do roadmap', 'ferr:dados-roadmap', () => editor.editarRoadmap()),
          ]
        : []),
    );
    renderizar();
  }

  async function exportar() {
    try {
      (await import('./ui-pacote.js')).exportarRoadmap(ctx, roadmapId, roadmap);
    } catch (erro) {
      console.error(erro);
      ctx.avisar('Não foi possível exportar o roadmap.', 'erro');
    }
  }

  function construir() {
    const botoes = [];
    if (ctx.fonte.editavel) botoes.push(botao('Modo de edição', 'ferr:editar', alternarEdicao, { pressionado: false }));
    botoes.push(botao('Exportar', 'ferr:exportar', exportar));
    ferramentas.replaceChildren(...botoes, extrasEdicao);
    ctx.principal.replaceChildren(el('div', { classe: 'cabeca-grafo' }, titulo, ferramentas), quadro);
    ctx.cabecalho.mostrar(true);
    ctx.mostrarTrilha(true);
    ctx.cabecalho.aoZerar(async () => {
      const ok = await confirmar(
        'Zerar progresso',
        ['Isso apaga o status e as revisões de todos os tópicos deste roadmap.', 'Os dados do roadmap não são alterados.'],
        { rotulo: 'Zerar progresso', perigo: true },
      );
      if (!ok) return;
      escopo.limpar(Date.now());
      depoisDeMudarProgresso();
    });
  }

  (async () => {
    try {
      const dados = await ctx.fonte.obter(roadmapId);
      if (!vivo) return;
      roadmap = dados.roadmap;
      atualizadoEm = dados.atualizadoEm;
      ctx.guardar(dados);
      caminho = caminhoDaRota(rota, roadmap);
      if (caminho.length !== rota.relativo.length + 1) ctx.rotas.substituir(rotaDoRoadmap(roadmapId, caminho), false);
      construir();
      renderizar({ moverFoco: focarAoMontar });
      ctx.sync.agendar(roadmapId); // em segundo plano: envia o que está só aqui e recebe o que veio de fora
    } catch (erro) {
      if (!vivo) return;
      if (erro.status === 404) {
        ctx.avisar('Roadmap não encontrado.', 'erro');
        ctx.rotas.substituir(ROTA_INICIO);
      } else {
        ctx.mostrarErro(`Não foi possível carregar o roadmap: ${erro.message}`);
      }
    }
  })();

  return {
    roadmapId,
    aoMudarRota(nova) {
      if (nova.tela !== 'roadmap' || nova.roadmapId !== roadmapId) return false;
      rota = nova;
      if (!roadmap) return true; // ainda carregando: a rota nova vale quando chegar
      caminho = caminhoDaRota(nova, roadmap);
      if (caminho.length !== nova.relativo.length + 1) ctx.rotas.substituir(rotaDoRoadmap(roadmapId, caminho), false);
      abertos.clear();
      renderizar({ moverFoco: true });
      return true;
    },
    aoAtualizarProgresso(id) {
      if (id === roadmapId) renderizar();
    },
    desmontar() {
      vivo = false;
      observador?.disconnect();
      window.removeEventListener('resize', aoRedimensionar);
      ctx.cabecalho.aoZerar(null);
      ctx.cabecalho.mostrar(false);
      ctx.mostrarTrilha(false);
    },
  };
}
