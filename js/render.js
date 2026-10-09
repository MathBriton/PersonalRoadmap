// Renderização do cabeçalho, da trilha e dos cards. Todo o DOM é montado com
// createElement/textContent: nenhum texto vindo dos dados passa por innerHTML.

import { botao, el } from './dom.js';
import { organizarColunas } from './layout.js';
import { contarProgresso, lerRegistro, statusExibido } from './progresso.js';

const ROTULOS = {
  novo: 'Não visto',
  estudando: 'Estudando',
  dominado: 'Dominado',
  revisar: 'Revisar hoje',
};
const STATUS_BOTOES = ['novo', 'estudando', 'dominado'];

/** Texto e barra de progresso geral, mais o aviso de armazenamento indisponível. */
export function renderCabecalho(refs, { feitos, total, emMemoria }) {
  refs.texto.textContent = `${feitos} de ${total} ${total === 1 ? 'tópico dominado' : 'tópicos dominados'}`;
  const percentual = total === 0 ? 0 : Math.round((feitos / total) * 100);
  refs.barra.setAttribute('aria-valuemax', String(total));
  refs.barra.setAttribute('aria-valuenow', String(feitos));
  refs.barra.setAttribute('aria-valuetext', `${feitos} de ${total} (${percentual}%)`);
  refs.preenchida.style.width = `${percentual}%`;
  refs.aviso.hidden = !emMemoria;
}

/** Trilha de navegação: botões para os níveis anteriores e o nível atual como texto. */
export function renderTrilha(nav, titulos, aoIr) {
  const lista = el('ol', { classe: 'trilha-lista' });
  titulos.forEach((titulo, indice) => {
    if (indice === titulos.length - 1) {
      lista.append(el('li', {}, el('span', { classe: 'trilha-atual', texto: titulo, attrs: { 'aria-current': 'page' } })));
    } else {
      const voltar = el('button', { classe: 'trilha-voltar', texto: titulo, attrs: { type: 'button' } });
      voltar.addEventListener('click', () => aoIr(indice));
      lista.append(el('li', {}, voltar));
    }
  });
  nav.replaceChildren(lista);
}

function criarCard(no, indice, ctx) {
  const { grafoId, roadmap, dados, agora, abertos, acoes, edicao } = ctx;
  const registro = lerRegistro(dados, grafoId, no.id);
  const status = statusExibido(registro, agora);
  const aberto = abertos.has(no.id);
  const idDetalhe = `detalhe-${indice}`;
  const foco = (acao) => `${indice}:${acao}`;

  const filho = no.filho !== undefined ? roadmap.grafos[no.filho] : undefined;
  const progressoFilho = filho ? contarProgresso(roadmap, no.filho, dados) : null;

  const alternar = el(
    'button',
    {
      classe: 'card-cabecalho',
      attrs: { type: 'button', 'aria-expanded': String(aberto), 'aria-controls': idDetalhe, 'data-foco': foco('toggle') },
    },
    el('span', { classe: 'card-titulo', texto: no.titulo }),
    el('span', { classe: 'selo', texto: ROTULOS[status] }),
    progressoFilho && el('span', { classe: 'sub-progresso', texto: `Subgrafo ${progressoFilho.feitos}/${progressoFilho.total}` }),
    el('span', { classe: 'chevron', attrs: { 'aria-hidden': 'true' } }),
  );

  const detalhe = el('div', { classe: 'card-detalhe', attrs: { id: idDetalhe } });
  detalhe.hidden = !aberto;
  if (no.resumo) detalhe.append(el('p', { classe: 'resumo', texto: no.resumo }));
  if (no.exemplo) {
    detalhe.append(el('pre', { classe: 'codigo', attrs: { tabindex: '0' } }, el('code', { texto: no.exemplo })));
  }
  if (no.links.length > 0) {
    const lista = el('ul', { classe: 'links' });
    for (const [texto, url] of no.links) {
      lista.append(el('li', {}, el('a', { texto, attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } })));
    }
    detalhe.append(lista);
  }

  if (status === 'revisar') {
    detalhe.append(el('p', { classe: 'nota', texto: 'Hora de revisar: você ainda se lembra deste tópico?' }));
  } else if (status === 'dominado') {
    detalhe.append(el('p', { classe: 'nota', texto: `Próxima revisão em ${new Date(registro.proxima).toLocaleDateString('pt-BR')}.` }));
  }

  const grupoStatus = el(
    'div',
    { classe: 'grupo', attrs: { role: 'group', 'aria-label': 'Marcar status do tópico' } },
    ...STATUS_BOTOES.map((s) =>
      botao(ROTULOS[s], foco(`status-${s}`), () => acoes.aoMarcar(no.id, s), { pressionado: registro.status === s }),
    ),
  );
  const grupoAcoes = el('div', { classe: 'acoes' }, grupoStatus);
  if (status === 'revisar') {
    grupoAcoes.append(
      el(
        'div',
        { classe: 'grupo', attrs: { role: 'group', 'aria-label': 'Revisão' } },
        botao('Lembrei', foco('lembrei'), () => acoes.aoRevisar(no.id, true)),
        botao('Esqueci', foco('esqueci'), () => acoes.aoRevisar(no.id, false)),
      ),
    );
  }
  if (filho) {
    grupoAcoes.append(botao('Abrir subgrafo', foco('subgrafo'), () => acoes.aoAbrir(no.filho), { classe: 'btn btn-primario' }));
  }
  if (edicao?.ativo) {
    grupoAcoes.append(
      el(
        'div',
        { classe: 'grupo', attrs: { role: 'group', 'aria-label': 'Edição do tópico' } },
        botao('Editar tópico', foco('editar'), () => edicao.aoEditar(no.id)),
        botao('Remover tópico', foco('remover'), () => edicao.aoRemover(no.id), { classe: 'btn btn-perigo' }),
      ),
    );
  }
  detalhe.append(grupoAcoes);

  const card = el(
    'article',
    { classe: `card${aberto ? ' aberto' : ''}`, attrs: { 'data-status': status } },
    el('h2', { classe: 'card-h', attrs: { 'data-ancora': '' } }, alternar),
    detalhe,
  );

  // Alterna na hora, sem recriar o card, para manter o foco e a posição de rolagem.
  alternar.addEventListener('click', () => {
    const abrir = alternar.getAttribute('aria-expanded') !== 'true';
    alternar.setAttribute('aria-expanded', String(abrir));
    detalhe.hidden = !abrir;
    card.classList.toggle('aberto', abrir);
    acoes.aoAlternar(no.id, abrir);
  });
  return card;
}

/**
 * Monta as colunas de cards dentro de `grafoEl` (a camada SVG fica por trás).
 * @returns {Map<string, HTMLElement>} nó -> elemento do card
 */
export function renderGrafo(grafoEl, svg, ctx) {
  const { grafo } = ctx;
  const cartoes = new Map();
  const indices = new Map(grafo.nos.map((no, i) => [no.id, i]));

  if (grafo.nos.length === 0) {
    grafoEl.replaceChildren(svg, el('p', { classe: 'vazio', texto: 'Este grafo ainda não tem tópicos.' }));
    return cartoes;
  }

  const colunas = organizarColunas(grafo.nos, grafo.arestas).map((nos, nivel) => {
    const coluna = el('div', { classe: 'coluna', attrs: { 'data-nivel': String(nivel) } });
    for (const no of nos) {
      const card = criarCard(no, indices.get(no.id), ctx);
      cartoes.set(no.id, card);
      coluna.append(card);
    }
    return coluna;
  });
  grafoEl.replaceChildren(svg, ...colunas);
  return cartoes;
}

/** Guarda qual controle tem o foco, para devolvê-lo depois de recriar os cards. */
export function focoAtual(area) {
  const ativo = document.activeElement;
  return ativo && area.contains(ativo) ? (ativo.dataset.foco ?? null) : null;
}

/** Devolve o foco ao controle de mesma chave; se ele sumiu, ao cabeçalho do mesmo card. */
export function restaurarFoco(area, chave) {
  if (!chave) return;
  const controles = [...area.querySelectorAll('[data-foco]')];
  const alvo =
    controles.find((c) => c.dataset.foco === chave) ??
    controles.find((c) => c.dataset.foco === `${chave.split(':')[0]}:toggle`);
  alvo?.focus();
}
