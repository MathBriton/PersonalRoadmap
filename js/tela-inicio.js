// Tela inicial: seletor de roadmaps, com progresso e revisões de cada um.
// Criar, excluir e importar só aparecem quando há servidor (fonte.editavel).

import { tituloDoRoadmap } from './dados.js';
import { botaoDialogo, confirmar, criarDialogo } from './dialogo.js';
import { botao, el } from './dom.js';
import { contarProgresso } from './progresso.js';
import { contarRevisoes } from './revisao.js';
import { rotaDoRoadmap } from './rotas.js';

const ID_GRAFO_RAIZ = 'principal';

/** Monta a tela em `ctx.principal`. Devolve `aoAtualizarProgresso(id)` e `desmontar()`. */
export function montarInicio(ctx) {
  let vivo = true;
  let entradas = [];
  const focarAoMontar = !ctx.primeiraCarga;

  const titulo = el('h1', { classe: 'titulo-grafo', texto: 'Roadmaps', attrs: { id: 'titulo-grafo', tabindex: '-1' } });
  const ferramentas = el('div', { classe: 'ferramentas', attrs: { role: 'toolbar', 'aria-label': 'Ferramentas' } });
  const estado = el('p', { classe: 'vazio', texto: 'Carregando…' });
  const lista = el('ul', { classe: 'roadmaps' });
  ctx.principal.replaceChildren(el('div', { classe: 'cabeca-grafo' }, titulo, ferramentas), estado, lista);
  document.title = 'Grafos de estudo';
  if (focarAoMontar) titulo.focus();

  if (ctx.fonte.editavel) {
    ferramentas.append(
      botao('Novo roadmap', 'ferr:novo-roadmap', novoRoadmap, { classe: 'btn btn-primario' }),
      botao('Importar', 'ferr:importar', importar),
    );
  } else {
    ctx.principal.prepend(
      el('p', {
        classe: 'aviso',
        texto: 'Servidor não encontrado: modo local, somente leitura, com o progresso guardado só neste navegador. Rode "npm start" para criar, editar, importar e sincronizar roadmaps.',
      }),
    );
  }

  function desenhar() {
    const agora = Date.now();
    estado.hidden = entradas.length > 0;
    if (entradas.length === 0) {
      estado.textContent = ctx.fonte.editavel
        ? 'Nenhum roadmap ainda. Crie um novo ou importe um arquivo.'
        : 'Nenhum roadmap disponível.';
    }
    lista.replaceChildren(
      ...entradas.map(({ id, roadmap }) => {
        const registros = ctx.repo.escopo(id).ler();
        const { feitos, total } = contarProgresso(roadmap, roadmap.raiz, registros);
        const revisar = contarRevisoes([{ id, roadmap, registros }], agora);
        const percentual = total === 0 ? 0 : Math.round((feitos / total) * 100);
        const nome = tituloDoRoadmap(roadmap);
        const barra = el(
          'div',
          {
            classe: 'barra',
            attrs: { role: 'progressbar', 'aria-label': `Progresso em ${nome}`, 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(feitos), 'aria-valuetext': `${feitos} de ${total} (${percentual}%)` },
          },
          el('div', { classe: 'barra-preenchida' }),
        );
        barra.firstChild.style.width = `${percentual}%`;
        const meta = `${feitos} de ${total} ${total === 1 ? 'tópico dominado' : 'tópicos dominados'}${revisar > 0 ? ` · ${revisar} para revisar` : ''}`;
        const acoes = el('div', { classe: 'grupo' });
        if (ctx.fonte.editavel) {
          acoes.append(botao('Excluir', `excluir:${id}`, () => excluir(id, nome), { classe: 'btn btn-perigo' }));
          acoes.lastChild.setAttribute('aria-label', `Excluir roadmap ${nome}`);
        }
        return el(
          'li',
          { classe: 'roadmap-card' },
          el('h2', { classe: 'roadmap-titulo' }, el('a', { texto: nome, attrs: { href: `#${encodeURIComponent(id)}` } })),
          roadmap.descricao ? el('p', { classe: 'roadmap-descricao', texto: roadmap.descricao }) : null,
          el('p', { classe: 'roadmap-meta', texto: meta }),
          barra,
          acoes.childElementCount > 0 ? acoes : null,
        );
      }),
    );
  }

  async function carregar() {
    try {
      entradas = await ctx.entradas();
      if (!vivo) return;
      desenhar();
      ctx.atualizarContagemRevisao();
      // Em segundo plano: traz o progresso de outros dispositivos; aoAtualizarProgresso redesenha.
      ctx.sync.sincronizarTodos(entradas.map((entrada) => entrada.id));
    } catch (erro) {
      if (vivo) {
        estado.hidden = true;
        ctx.mostrarErro(`Não foi possível carregar os roadmaps: ${erro.message}`);
      }
    }
  }

  async function novoRoadmap() {
    const dialogo = criarDialogo({ titulo: 'Novo roadmap' });
    const form = el('form', { classe: 'formulario' });
    const campoTitulo = el('input', { attrs: { id: 'novo-roadmap-titulo', type: 'text', required: '', maxlength: '80', autocomplete: 'off' } });
    const campoDescricao = el('textarea', { attrs: { id: 'novo-roadmap-descricao', rows: '3', maxlength: '300' } });
    const erro = el('p', { classe: 'erro-campo', attrs: { role: 'alert' } });
    erro.hidden = true;
    form.append(
      el('div', { classe: 'campo' }, el('label', { texto: 'Título', attrs: { for: 'novo-roadmap-titulo' } }), campoTitulo),
      el('div', { classe: 'campo' }, el('label', { texto: 'Descrição (opcional)', attrs: { for: 'novo-roadmap-descricao' } }), campoDescricao),
      erro,
    );
    const criar = el('button', { classe: 'btn btn-primario', texto: 'Criar', attrs: { type: 'submit' } });
    dialogo.corpo.append(form);
    dialogo.rodape.append(botaoDialogo('Cancelar', () => dialogo.fechar()), criar);
    criar.setAttribute('form', 'novo-roadmap-form');
    form.id = 'novo-roadmap-form';

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const nome = campoTitulo.value.trim();
      if (!nome) {
        erro.textContent = 'Informe um título.';
        erro.hidden = false;
        campoTitulo.focus();
        return;
      }
      criar.disabled = true;
      try {
        const roadmap = { raiz: ID_GRAFO_RAIZ, titulo: nome, grafos: { [ID_GRAFO_RAIZ]: { titulo: nome, nos: [], arestas: [] } } };
        const descricao = campoDescricao.value.trim();
        if (descricao) roadmap.descricao = descricao;
        const criado = await ctx.fonte.criar({ roadmap });
        ctx.guardar(criado);
        dialogo.fechar(criado.id);
      } catch (falha) {
        erro.textContent = falha.message;
        erro.hidden = false;
        criar.disabled = false;
      }
    });

    const id = await dialogo.abrir();
    if (id) ctx.rotas.ir(rotaDoRoadmap(id, []));
  }

  async function excluir(id, nome) {
    const ok = await confirmar(
      'Excluir roadmap',
      [`Excluir "${nome}" e todo o progresso dele? Isso não pode ser desfeito.`, 'Se quiser guardar uma cópia, exporte antes.'],
      { rotulo: 'Excluir', perigo: true },
    );
    if (!ok || !vivo) return;
    try {
      await ctx.fonte.excluir(id);
      ctx.repo.descartar(id);
      ctx.esquecer(id);
      entradas = entradas.filter((entrada) => entrada.id !== id);
      desenhar();
      ctx.atualizarContagemRevisao();
      ctx.avisar(`Roadmap "${nome}" excluído.`);
      titulo.focus();
    } catch (falha) {
      ctx.avisar(falha.message, 'erro');
    }
  }

  async function importar() {
    try {
      (await import('./ui-pacote.js')).abrirImportacao(ctx);
    } catch (falha) {
      console.error(falha);
      ctx.avisar('Não foi possível abrir a importação.', 'erro');
    }
  }

  carregar();

  return {
    aoAtualizarProgresso() {
      if (entradas.length > 0) desenhar();
    },
    desmontar() {
      vivo = false;
    },
  };
}
