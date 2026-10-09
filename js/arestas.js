// Arestas desenhadas em SVG por trás dos cards.

const NS_SVG = 'http://www.w3.org/2000/svg';

/** Curva de Bézier que sai horizontalmente da origem e chega horizontalmente ao destino. */
export function caminhoCurva(x1, y1, x2, y2) {
  const folga = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + folga},${y1} ${x2 - folga},${y2} ${x2},${y2}`;
}

function elementoSvg(tag, atributos) {
  const elemento = document.createElementNS(NS_SVG, tag);
  for (const [nome, valor] of Object.entries(atributos)) elemento.setAttribute(nome, valor);
  return elemento;
}

/**
 * Redesenha todas as arestas. A linha sai da borda direita do card de origem e
 * chega à borda esquerda do destino, na altura do cabeçalho (`[data-ancora]`),
 * que não se move quando o card expande.
 *
 * @param {SVGSVGElement} svg      camada de arestas, posicionada em (0,0) de `grafoEl`
 * @param {HTMLElement} grafoEl    contêiner relativo que contém as colunas
 * @param {Map<string, HTMLElement>} cartoes  nó -> elemento do card
 * @param {[string, string][]} arestas
 * @param {Set<string>} dominados  nós de origem que deixam a aresta verde
 */
export function desenharArestas(svg, grafoEl, cartoes, arestas, dominados) {
  const base = grafoEl.getBoundingClientRect();
  svg.setAttribute('width', String(grafoEl.scrollWidth));
  svg.setAttribute('height', String(grafoEl.scrollHeight));
  svg.replaceChildren();

  for (const [de, para] of arestas) {
    const origem = cartoes.get(de);
    const destino = cartoes.get(para);
    if (!origem || !destino) continue;

    const caixaOrigem = origem.getBoundingClientRect();
    const caixaDestino = destino.getBoundingClientRect();
    const alturaOrigem = (origem.querySelector('[data-ancora]') ?? origem).getBoundingClientRect();
    const alturaDestino = (destino.querySelector('[data-ancora]') ?? destino).getBoundingClientRect();

    const x1 = caixaOrigem.right - base.left;
    const y1 = alturaOrigem.top + alturaOrigem.height / 2 - base.top;
    const x2 = caixaDestino.left - base.left;
    const y2 = alturaDestino.top + alturaDestino.height / 2 - base.top;

    const classe = dominados.has(de) ? 'aresta dominada' : 'aresta';
    svg.append(
      elementoSvg('path', { class: classe, d: caminhoCurva(x1, y1, x2, y2) }),
      elementoSvg('circle', { class: `${classe} ponta`, cx: x2, cy: y2, r: 3.5 }),
    );
  }
}
