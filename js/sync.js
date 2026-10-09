// Sincronização do progresso com o servidor, local-first: toda mudança grava primeiro no
// repositório local (a tela não espera a rede) e depois envia o progresso inteiro do roadmap
// para ser mesclado no servidor. Como a mesclagem é idempotente (sincronia.js), não há fila
// de pendências: se um envio falha, o próximo envio (nova mudança, volta da conexão, volta à
// aba) leva tudo de novo.

export function criarSincronizador({ repo, fonte, aoMudarEstado, aoAtualizar }) {
  const emVoo = new Map(); // roadmapId -> Promise do ciclo de envio em andamento
  const repetir = new Set(); // roadmaps que mudaram durante um envio
  let estado = fonte.progresso ? 'sincronizado' : 'local';

  function definirEstado(novo) {
    if (novo === estado) return;
    estado = novo;
    aoMudarEstado?.(estado);
  }

  /** Envia o progresso local, adota o resultado mesclado e avisa se veio algo novo de fora. */
  async function enviar(id) {
    const enviado = repo.progresso(id);
    try {
      const mesclado = await fonte.progresso.mesclar(id, enviado);
      repo.mesclar(id, mesclado);
      definirEstado('sincronizado');
      const trouxeNovidade =
        mesclado.resetEm !== enviado.resetEm ||
        Object.entries(mesclado.registros).some(([chave, registro]) => JSON.stringify(registro) !== JSON.stringify(enviado.registros[chave]));
      if (trouxeNovidade) aoAtualizar?.(id);
      return true;
    } catch {
      definirEstado('offline');
      return false;
    }
  }

  const sincronizador = {
    get estado() {
      return estado;
    },
    /** Envia (e recebe) o progresso do roadmap. Pedidos que chegam durante um envio viram um único reenvio. */
    agendar(id) {
      if (!fonte.progresso) return Promise.resolve(false);
      if (emVoo.has(id)) {
        repetir.add(id);
        return emVoo.get(id);
      }
      const ciclo = (async () => {
        try {
          let ok;
          do {
            repetir.delete(id);
            definirEstado('enviando');
            ok = await enviar(id);
          } while (ok && repetir.has(id));
          return ok;
        } finally {
          repetir.delete(id);
          emVoo.delete(id);
        }
      })();
      emVoo.set(id, ciclo);
      return ciclo;
    },
    sincronizarTodos: (ids) => Promise.all(ids.map((id) => sincronizador.agendar(id))),
  };
  return sincronizador;
}
