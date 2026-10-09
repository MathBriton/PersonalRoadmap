// Helpers mínimos para montar DOM sem innerHTML: texto sempre entra por textContent.

/**
 * Cria um elemento. `attrs` vira atributos; `filhos` (nós ou textos; falsos são ignorados) são anexados.
 * @returns {HTMLElement}
 */
export function el(tag, { classe, texto, attrs = {} } = {}, ...filhos) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  for (const [nome, valor] of Object.entries(attrs)) elemento.setAttribute(nome, valor);
  elemento.append(...filhos.filter(Boolean));
  return elemento;
}

/** Botão com `data-foco` (para restaurar o foco depois de recriar a tela) e, opcionalmente, aria-pressed. */
export function botao(texto, foco, aoClicar, { classe = 'btn', pressionado } = {}) {
  const attrs = { type: 'button', 'data-foco': foco };
  if (pressionado !== undefined) attrs['aria-pressed'] = String(pressionado);
  const elemento = el('button', { classe, texto, attrs });
  elemento.addEventListener('click', aoClicar);
  return elemento;
}
