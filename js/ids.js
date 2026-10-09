// Ids legíveis (slugs). Módulo puro, usado pelo navegador e pelo servidor.

/** Ids que não podem ser de roadmap porque são palavras de rota ("#revisao") ou de API. */
export const IDS_RESERVADOS = new Set(['revisao', 'api']);
export const TAMANHO_MAX_ID = 64;

const PADRAO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Renderização e listas" -> "renderizacao-e-listas". Pode devolver "" se não sobrar nada. */
export function slugificar(texto, max = 40) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Id de roadmap aceito pelo servidor: slug de até 64 caracteres e fora da lista de reservados. */
export function idDeRoadmapValido(id) {
  return typeof id === 'string' && id.length <= TAMANHO_MAX_ID && PADRAO_ID.test(id) && !IDS_RESERVADOS.has(id);
}

/** Devolve `base` slugificado, ou com sufixo -2, -3... se já estiver em `ocupados`. */
export function gerarIdUnico(base, ocupados, padrao = 'item') {
  const usados = ocupados instanceof Set ? ocupados : new Set(ocupados);
  const raiz = slugificar(base) || padrao;
  if (!usados.has(raiz)) return raiz;
  for (let n = 2; ; n += 1) {
    const candidato = `${raiz}-${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

/** Como `gerarIdUnico`, mas nunca devolve um id reservado. */
export function gerarIdDeRoadmap(titulo, existentes) {
  return gerarIdUnico(titulo, new Set([...existentes, ...IDS_RESERVADOS]), 'roadmap');
}
