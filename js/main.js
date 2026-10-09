// Inicialização e ligação dos módulos.

import { desenharArestas } from './arestas.js';
import { carregarRoadmap } from './dados.js';
import { contarProgresso, criarRepositorio, lerRegistro, marcarStatus, registrarRevisao } from './progresso.js';
import { focoAtual, renderCabecalho, renderGrafo, renderTrilha, restaurarFoco } from './render.js';
import { criarRotas } from './rotas.js';

const URL_DADOS = new URL('../data/react.json', import.meta.url);
const NOME_APP = 'Grafos de estudo';
const porId = (id) => document.getElementById(id);

function mostrarErro(mensagem) {
  const erro = porId('erro');
  erro.textContent = mensagem;
  erro.hidden = false;
}

async function iniciar() {
  let roadmap;
  try {
    roadmap = await carregarRoadmap(URL_DADOS);
  } catch (erro) {
    console.error(erro);
    mostrarErro(`Não foi possível carregar os dados: ${erro.message}`);
    return;
  }

  const repo = criarRepositorio();
  const abertos = new Set(); // cards abertos na visita atual ao grafo
  const grafoEl = porId('grafo');
  const quadro = porId('quadro');
  const cabecalho = {
    texto: porId('progresso-texto'),
    barra: porId('progresso-barra'),
    preenchida: porId('progresso-preenchida'),
    aviso: porId('aviso-storage'),
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'arestas');
  svg.setAttribute('aria-hidden', 'true');

  let grafoId = roadmap.raiz;
  let cartoes = new Map();
  let dominados = new Set();

  function redesenhar() {
    desenharArestas(svg, grafoEl, cartoes, roadmap.grafos[grafoId].arestas, dominados);
  }

  // Cards mudam de tamanho ao expandir, ao girar a tela ou quando as fontes chegam.
  const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(redesenhar) : null;

  const rotas = criarRotas(roadmap, () => {
    abertos.clear();
    renderizar({ moverFoco: true });
  });

  const acoes = {
    aoAlternar(noId, aberto) {
      if (aberto) abertos.add(noId);
      else abertos.delete(noId);
      redesenhar();
    },
    aoMarcar(noId, status) {
      repo.definir(grafoId, noId, marcarStatus(status, Date.now()));
      renderizar();
    },
    aoRevisar(noId, lembrou) {
      repo.definir(grafoId, noId, registrarRevisao(lerRegistro(repo.ler(), grafoId, noId), lembrou, Date.now()));
      renderizar();
    },
    aoAbrir: (filhoId) => rotas.abrir(filhoId),
  };

  function renderizar({ moverFoco = false } = {}) {
    const caminho = rotas.caminho();
    grafoId = caminho.at(-1);
    const grafo = roadmap.grafos[grafoId];
    const dados = repo.ler();
    const agora = Date.now();

    renderCabecalho(cabecalho, { ...contarProgresso(roadmap, roadmap.raiz, dados), emMemoria: repo.emMemoria });
    renderTrilha(porId('trilha'), caminho.map((id) => roadmap.grafos[id].titulo), (indice) => rotas.voltarPara(indice));
    porId('titulo-grafo').textContent = grafo.titulo;
    document.title = `${grafo.titulo} · ${NOME_APP}`;

    const foco = focoAtual(grafoEl);
    cartoes = renderGrafo(grafoEl, svg, { grafoId, grafo, roadmap, dados, agora, abertos, acoes });
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
      porId('titulo-grafo').focus();
    }
  }

  porId('btn-zerar').addEventListener('click', () => {
    if (!confirm('Zerar todo o progresso? Isso apaga o status e as revisões de todos os tópicos.')) return;
    repo.limpar();
    renderizar();
  });

  window.addEventListener('resize', redesenhar);
  document.fonts?.ready.then(redesenhar);
  renderizar();
}

iniciar();
