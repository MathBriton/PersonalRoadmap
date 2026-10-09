// Navegação por location.hash. `caminhoDoHash` e `hashDoCaminho` são puras.
// O caminho é uma lista de ids de grafos começando pela raiz: "#react/hooks".

function decodificar(parte) {
  try {
    return decodeURIComponent(parte);
  } catch {
    return parte;
  }
}

/** Hash inválido (vazio, grafo inexistente, não começa pela raiz) cai na raiz. */
export function caminhoDoHash(hash, roadmap) {
  const partes = String(hash ?? '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodificar);
  const valido = partes[0] === roadmap.raiz && partes.every((id) => Object.hasOwn(roadmap.grafos, id));
  return valido ? partes : [roadmap.raiz];
}

export const hashDoCaminho = (caminho) => `#${caminho.map(encodeURIComponent).join('/')}`;

const mesmoCaminho = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

function lerHash() {
  try {
    return globalThis.location.hash;
  } catch {
    return '';
  }
}

/**
 * Mantém o caminho atual em estado interno e o espelha no hash. Se o navegador
 * bloquear a escrita no hash, a navegação segue funcionando pelo estado.
 * `aoMudar(caminho)` roda quando o caminho muda (por clique ou pelo botão voltar).
 */
export function criarRotas(roadmap, aoMudar) {
  let caminho = caminhoDoHash(lerHash(), roadmap);

  // Troca um hash vazio ou inválido pelo canônico sem criar entrada no histórico.
  function canonicalizar() {
    const hash = lerHash();
    const canonico = hashDoCaminho(caminho);
    if (hash !== '' && hash !== canonico) {
      try {
        globalThis.history.replaceState(null, '', canonico);
      } catch {
        /* sem permissão para reescrever a URL: segue só com o estado interno */
      }
    }
  }

  function ir(novo) {
    if (mesmoCaminho(novo, caminho)) return;
    caminho = novo;
    try {
      globalThis.location.hash = hashDoCaminho(novo);
    } catch {
      /* hash bloqueado: o estado interno basta */
    }
    aoMudar(caminho);
  }

  globalThis.addEventListener?.('hashchange', () => {
    const novo = caminhoDoHash(lerHash(), roadmap);
    if (!mesmoCaminho(novo, caminho)) {
      caminho = novo;
      aoMudar(caminho);
    }
    canonicalizar();
  });
  canonicalizar();

  return {
    caminho: () => caminho,
    /** Abre um subgrafo a partir do grafo atual. */
    abrir: (grafoId) => ir([...caminho, grafoId]),
    /** Volta para o nível `indice` da trilha (0 = raiz). */
    voltarPara: (indice) => ir(caminho.slice(0, indice + 1)),
  };
}
