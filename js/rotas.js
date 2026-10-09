// Navegação por location.hash.
//   ""/"#"        -> tela inicial (lista de roadmaps)
//   "#revisao"    -> fila de revisão
//   "#<id>[/<grafo>...]" -> roadmap; o caminho de grafos é [raiz, ...segmentos] (a raiz não aparece na URL)
// `rotaDoHash`, `hashDaRota` e `caminhoDaRota` são puras.

import { idDeRoadmapValido } from './ids.js';

export const ROTA_INICIO = Object.freeze({ tela: 'inicio' });

function decodificar(parte) {
  try {
    return decodeURIComponent(parte);
  } catch {
    return parte;
  }
}

/** Hash vazio ou inválido cai na tela inicial. */
export function rotaDoHash(hash) {
  const partes = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodificar);
  if (partes.length === 0) return ROTA_INICIO;
  if (partes[0] === 'revisao') return { tela: 'revisao' };
  if (!idDeRoadmapValido(partes[0])) return ROTA_INICIO;
  return { tela: 'roadmap', roadmapId: partes[0], relativo: partes.slice(1) };
}

export function hashDaRota(rota) {
  if (rota.tela === 'revisao') return '#revisao';
  if (rota.tela === 'roadmap') return `#${[rota.roadmapId, ...rota.relativo].map(encodeURIComponent).join('/')}`;
  return '';
}

/** Caminho de grafos [raiz, ...] da rota; se algum grafo não existe, cai na raiz. */
export function caminhoDaRota(rota, roadmap) {
  const valido = rota.relativo.every((id) => Object.hasOwn(roadmap.grafos, id));
  return valido ? [roadmap.raiz, ...rota.relativo] : [roadmap.raiz];
}

export const rotaDoRoadmap = (roadmapId, caminho) => ({ tela: 'roadmap', roadmapId, relativo: caminho.slice(1) });

const mesmaRota = (a, b) => hashDaRota(a) === hashDaRota(b);

function lerHash() {
  try {
    return globalThis.location.hash;
  } catch {
    return '';
  }
}

/**
 * Mantém a rota atual em estado interno e a espelha no hash. Se o navegador bloquear a
 * escrita no hash, a navegação segue funcionando pelo estado interno.
 * `aoMudar(rota)` roda quando a rota muda (por clique, link ou botão voltar).
 */
export function criarRotas(aoMudar) {
  let atual = rotaDoHash(lerHash());

  // Troca um hash inválido ou fora do padrão pelo canônico, sem criar entrada no histórico.
  function canonicalizar() {
    const hash = lerHash();
    const canonico = hashDaRota(atual);
    if (hash === '' || hash === '#' || hash === canonico) return;
    try {
      globalThis.history.replaceState(null, '', canonico || globalThis.location.pathname + globalThis.location.search);
    } catch {
      /* sem permissão para reescrever a URL: segue só com o estado interno */
    }
  }

  function ir(rota) {
    if (mesmaRota(rota, atual)) return;
    atual = rota;
    try {
      globalThis.location.hash = hashDaRota(rota);
    } catch {
      /* hash bloqueado: o estado interno basta */
    }
    aoMudar(atual);
  }

  globalThis.addEventListener?.('hashchange', () => {
    const nova = rotaDoHash(lerHash());
    if (!mesmaRota(nova, atual)) {
      atual = nova;
      aoMudar(atual);
    }
    canonicalizar();
  });
  canonicalizar();

  return {
    rota: () => atual,
    ir,
    /** Troca a rota sem criar entrada no histórico (redirecionamentos e correção de caminho). */
    substituir(rota, notificar = true) {
      const mudou = !mesmaRota(rota, atual);
      atual = rota;
      try {
        globalThis.history.replaceState(null, '', hashDaRota(rota) || globalThis.location.pathname + globalThis.location.search);
      } catch {
        /* idem */
      }
      if (mudou && notificar) aoMudar(atual);
    },
  };
}
