// Cliente da API HTTP do servidor (ver docs/CONTRATO.md). Só faz fetch e traduz erros.

export class ErroApi extends Error {
  /** `status` 0 = sem resposta (servidor fora do ar, timeout); `corpo` = JSON do erro, se houve. */
  constructor(mensagem, status = 0, corpo = null) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.corpo = corpo;
  }
}

const BASE_PADRAO = new URL('../api/', import.meta.url);

export function criarApi({ base = BASE_PADRAO, fetchFn = (...args) => globalThis.fetch(...args), tempoMs = 8000 } = {}) {
  async function chamar(metodo, caminho, corpo, tempo = tempoMs) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), tempo);
    let resposta;
    try {
      resposta = await fetchFn(new URL(caminho, base), {
        method: metodo,
        headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle.signal,
      });
    } catch {
      throw new ErroApi('Servidor indisponível.', 0);
    } finally {
      clearTimeout(relogio);
    }
    if (resposta.status === 204) return null;
    let dados = null;
    try {
      dados = await resposta.json();
    } catch {
      /* corpo vazio ou não JSON */
    }
    if (!resposta.ok) throw new ErroApi(dados?.erro ?? `Erro ${resposta.status} do servidor.`, resposta.status, dados);
    return dados;
  }

  const rota = (id) => `roadmaps/${encodeURIComponent(id)}`;
  return {
    saude: () => chamar('GET', 'saude', undefined, 2500),
    listarRoadmaps: () => chamar('GET', 'roadmaps'),
    obterRoadmap: (id) => chamar('GET', rota(id)),
    criarRoadmap: ({ id, roadmap }) => chamar('POST', 'roadmaps', { id, roadmap }),
    salvarRoadmap: (id, roadmap, baseadoEm) => chamar('PUT', rota(id), { roadmap, baseadoEm }),
    excluirRoadmap: (id) => chamar('DELETE', rota(id)),
    obterProgresso: (id) => chamar('GET', `${rota(id)}/progresso`),
    mesclarProgresso: (id, parte) => chamar('POST', `${rota(id)}/progresso`, parte),
  };
}
