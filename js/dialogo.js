// Janelas modais sobre o <dialog> nativo: foco preso na janela, Esc fecha, e o foco volta
// ao elemento que a abriu. Usado pelo editor, pela importação e pelas confirmações.

let contador = 0;

function el(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

/**
 * Cria (sem abrir) uma janela modal.
 * `abrir()` devolve uma Promise que resolve com o valor passado a `fechar(valor)`,
 * ou `undefined` se o usuário cancelar (Esc, clique fora ou botão cancelar).
 *
 * @returns {{ dialog: HTMLDialogElement, corpo: HTMLElement, rodape: HTMLElement,
 *             abrir(): Promise<any>, fechar(valor?: any): void }}
 */
export function criarDialogo({ titulo, classe = '' }) {
  contador += 1;
  const idTitulo = `dialogo-titulo-${contador}`;
  const dialog = el('dialog', `dialogo ${classe}`.trim());
  dialog.setAttribute('aria-labelledby', idTitulo);
  const cabecalho = el('h2', 'dialogo-titulo', titulo);
  cabecalho.id = idTitulo;
  const corpo = el('div', 'dialogo-corpo');
  const rodape = el('div', 'dialogo-rodape');
  dialog.append(cabecalho, corpo, rodape);

  let resultado;
  let resolver;
  let origem = null;

  // Clique no fundo (fora da caixa) cancela; cliques dentro têm outro alvo.
  dialog.addEventListener('click', (evento) => {
    if (evento.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (origem?.isConnected) origem.focus();
    resolver(resultado);
  });

  return {
    dialog,
    corpo,
    rodape,
    abrir() {
      origem = document.activeElement;
      return new Promise((resolve) => {
        resolver = resolve;
        document.body.append(dialog);
        dialog.showModal();
      });
    },
    fechar(valor) {
      resultado = valor;
      dialog.close();
    },
  };
}

/** Botão de ação para o rodapé de um diálogo. */
export function botaoDialogo(texto, aoClicar, { primario = false, perigo = false } = {}) {
  const botao = el('button', `btn${primario ? ' btn-primario' : ''}${perigo ? ' btn-perigo' : ''}`, texto);
  botao.type = 'button';
  botao.addEventListener('click', aoClicar);
  return botao;
}

/** Confirmação simples. Resolve `true` se o usuário confirmar. */
export async function confirmar(titulo, mensagem, { rotulo = 'Confirmar', perigo = false } = {}) {
  const dialogo = criarDialogo({ titulo });
  for (const linha of Array.isArray(mensagem) ? mensagem : [mensagem]) dialogo.corpo.append(el('p', '', linha));
  const cancelar = botaoDialogo('Cancelar', () => dialogo.fechar(false));
  const ok = botaoDialogo(rotulo, () => dialogo.fechar(true), { primario: !perigo, perigo });
  dialogo.rodape.append(cancelar, ok);
  // O botão seguro recebe o foco inicial quando a ação é destrutiva.
  const promessa = dialogo.abrir();
  (perigo ? cancelar : ok).focus();
  return (await promessa) === true;
}
