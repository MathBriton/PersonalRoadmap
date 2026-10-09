// Exportar e importar roadmaps como arquivo JSON. Módulo puro: não lê nem grava arquivos.
//
// Pacote: { formato, versao, exportadoEm, id, roadmap, progresso }. Um roadmap puro { raiz, grafos }
// também é aceito, para quem escreve o JSON à mão ou usa os arquivos de `data/`.
//
// `lerPacote` é a porta de entrada de arquivos escolhidos pelo usuário, então trata o conteúdo como
// hostil: qualquer problema vira `ErroPacote` com mensagem em português, nunca um erro cru.

import { tituloDoRoadmap, validarRoadmap } from './dados.js';
import { gerarIdDeRoadmap, idDeRoadmapValido, slugificar, TAMANHO_MAX_ID } from './ids.js';
import { DIA_MS, chaveDoNo } from './progresso.js';
import { normalizarProgresso } from './sincronia.js';

export const FORMATO = 'grafos-de-estudo';
export const VERSAO = 1;

// Limites de importação. O servidor já recusa corpos acima de 2 MB; aqui o teto de texto evita
// que um arquivo enorme trave o navegador, e os de nós e grafos evitam roadmaps que o layout não aguenta.
export const MAX_NOS = 5000;
export const MAX_GRAFOS = 1000;
export const MAX_TEXTO = 5 * 1024 * 1024;
const MAX_AVISOS = 20;
// Os avisos e a mensagem de raiz inexistente ecoam textos do arquivo (ids, raiz); um id de megabytes
// viraria uma linha de megabytes na tela. O corte é no meio: o começo diz onde, o fim diz o que houve.
const MAX_LINHA = 300;

// Teto de um intervalo de revisão (100 anos); acima disso o valor só pode ser lixo ou ataque.
const INTERVALO_MAX_DIAS = 36500;

export class ErroPacote extends Error {
  constructor(mensagem, opcoes) {
    super(mensagem, opcoes);
    this.name = 'ErroPacote';
  }
}

const tem = (objeto, chave) => Object.hasOwn(objeto, chave);
const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
const encurtar = (texto) => (texto.length > MAX_LINHA ? `${texto.slice(0, MAX_LINHA / 2)}…${texto.slice(-MAX_LINHA / 2)}` : texto);

function instanteISO(agora) {
  const data = typeof agora === 'number' || agora instanceof Date ? new Date(agora) : new Date(NaN);
  if (Number.isNaN(data.getTime())) throw new ErroPacote('Data de exportação inválida.');
  return data.toISOString();
}

/** Monta o pacote de exportação. `agora` é o instante em ms (ou `Date`); o relógio é do chamador. */
export function criarPacote({ id, roadmap, progresso, agora }) {
  return { formato: FORMATO, versao: VERSAO, exportadoEm: instanteISO(agora), id, roadmap, progresso: progresso ?? null };
}

/** "react" + 2026-01-10 -> "react-2026-01-10.json". A data é em UTC, não no fuso de quem exporta. */
export function nomeDoArquivo(id, agora) {
  const iso = instanteISO(agora);
  return `${id}-${iso.slice(0, iso.indexOf('T'))}.json`;
}

function lerJson(entrada) {
  if (typeof entrada !== 'string') return entrada;
  if (entrada.length > MAX_TEXTO) {
    throw new ErroPacote(`O arquivo é grande demais (o máximo é ${Math.round(MAX_TEXTO / 1024 / 1024)} MB).`);
  }
  // Editores do Windows gravam JSON com BOM, que o JSON.parse não aceita.
  const texto = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada;
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroPacote('O arquivo não é um JSON válido.');
  }
}

/** Confere formato e versão e devolve as partes do pacote; um roadmap puro vira pacote sem id nem progresso. */
function separarPartes(dados) {
  if (!ehObjeto(dados)) {
    throw new ErroPacote('O conteúdo não é um pacote nem um roadmap: esperado um objeto JSON.');
  }
  if (!tem(dados, 'formato')) return { roadmapBruto: dados, idBruto: undefined, progressoBruto: null };

  if (dados.formato !== FORMATO) {
    throw new ErroPacote('Formato de arquivo desconhecido: este não é um pacote do Grafos de estudo.');
  }
  const { versao } = dados;
  if (!Number.isInteger(versao) || versao < 1) {
    throw new ErroPacote('A versão do pacote está ausente ou é inválida.');
  }
  if (versao > VERSAO) {
    throw new ErroPacote(
      `Este pacote usa a versão ${versao} do formato, mais nova que a ${VERSAO} que este app entende. Atualize o app para importá-lo.`,
    );
  }
  if (!ehObjeto(dados.roadmap)) throw new ErroPacote('O pacote não contém um roadmap.');
  return { roadmapBruto: dados.roadmap, idBruto: dados.id, progressoBruto: dados.progresso };
}

/**
 * Recusa roadmaps grandes antes de validar (a contagem usa o que veio no arquivo, sem depender de
 * a validação passar) e tira o grafo "__proto__": como chave de objeto ele trocaria o protótipo de
 * `roadmap.grafos` em vez de criar uma propriedade.
 * @returns {{roadmapBruto: object, avisos: string[]}}
 */
function conferirTamanho(roadmapBruto) {
  if (!ehObjeto(roadmapBruto.grafos)) return { roadmapBruto, avisos: [] };
  const entradas = Object.entries(roadmapBruto.grafos);
  if (entradas.length > MAX_GRAFOS) {
    throw new ErroPacote(`O roadmap tem ${entradas.length} grafos; o máximo aceito é ${MAX_GRAFOS}.`);
  }
  const nos = entradas.reduce((soma, [, grafo]) => soma + (ehObjeto(grafo) && Array.isArray(grafo.nos) ? grafo.nos.length : 0), 0);
  if (nos > MAX_NOS) {
    throw new ErroPacote(`O roadmap tem ${nos} tópicos no total; o máximo aceito é ${MAX_NOS}.`);
  }
  if (!entradas.some(([grafoId]) => grafoId === '__proto__')) return { roadmapBruto, avisos: [] };
  const grafos = Object.fromEntries(entradas.filter(([grafoId]) => grafoId !== '__proto__'));
  return { roadmapBruto: { ...roadmapBruto, grafos }, avisos: ['Grafo "__proto__": o id é reservado pelo JavaScript; grafo ignorado.'] };
}

function validar(roadmapBruto) {
  try {
    return validarRoadmap(roadmapBruto);
  } catch (erro) {
    // Um `Error` simples é a mensagem em português de `validarRoadmap`; TypeError e afins viram o aviso genérico.
    if (erro?.constructor === Error) throw new ErroPacote(encurtar(erro.message), { cause: erro });
    throw erro;
  }
}

/** Id do pacote se for válido; senão o nome do arquivo sem extensão; senão o título do roadmap. */
function escolherId(idDoPacote, nomeArquivo, roadmap) {
  if (idDeRoadmapValido(idDoPacote)) return idDoPacote;
  if (typeof nomeArquivo === 'string') {
    const semPasta = nomeArquivo.split(/[\\/]/).pop();
    const doNome = slugificar(semPasta.replace(/\.[^.]*$/, ''), TAMANHO_MAX_ID);
    if (idDeRoadmapValido(doNome)) return doNome;
  }
  return gerarIdDeRoadmap(tituloDoRoadmap(roadmap), []);
}

/**
 * Normaliza o progresso do pacote. Mantém só registros de cards que existem no roadmap (inclusive
 * em grafos órfãos, que o usuário ainda pode religar) e limita valores absurdos.
 * @returns {object | null} `null` se o pacote não trouxe progresso (ou ele estava mal formado)
 */
function lerProgresso(bruto, roadmap, agora, avisos) {
  if (bruto === null || bruto === undefined) return null;
  if (!ehObjeto(bruto)) {
    avisos.push('O progresso do pacote está mal formado e foi ignorado.');
    return null;
  }

  const existentes = new Set();
  for (const [grafoId, grafo] of Object.entries(roadmap.grafos)) {
    for (const no of grafo.nos) existentes.add(chaveDoNo(grafoId, no.id));
  }
  const brutos = ehObjeto(bruto.registros) ? Object.entries(bruto.registros) : [];
  const mantidos = brutos.filter(([chave]) => existentes.has(chave));
  if (mantidos.length < brutos.length) {
    const n = brutos.length - mantidos.length;
    avisos.push(
      n === 1
        ? '1 registro de progresso ignorado (card que não existe neste roadmap).'
        : `${n} registros de progresso ignorados (cards que não existem neste roadmap).`,
    );
  }

  // Um `resetEm` no futuro apagaria tudo o que o usuário marcar a partir de agora: relógio errado ou arquivo adulterado.
  const limite = agora + DIA_MS;
  const resetBruto = Number(bruto.resetEm);
  const resetFuturo = resetBruto > limite;
  const normalizado = normalizarProgresso({
    resetEm: resetFuturo ? 0 : resetBruto,
    registros: Object.fromEntries(mantidos),
  });

  let corrigidos = resetFuturo ? 1 : 0;
  const proximaMax = agora + INTERVALO_MAX_DIAS * DIA_MS;
  const registros = Object.fromEntries(
    Object.entries(normalizado.registros).map(([chave, registro]) => {
      const limitado = {
        ...registro,
        atualizado: Math.min(registro.atualizado, limite),
        intervalo: Math.min(registro.intervalo, INTERVALO_MAX_DIAS),
        proxima: Math.min(registro.proxima, proximaMax),
      };
      if (limitado.atualizado !== registro.atualizado || limitado.intervalo !== registro.intervalo || limitado.proxima !== registro.proxima) {
        corrigidos += 1;
      }
      return [chave, limitado];
    }),
  );
  if (corrigidos > 0) avisos.push('Datas ou intervalos do progresso fora do possível foram corrigidos.');
  return { resetEm: normalizado.resetEm, registros };
}

/** Evita que um arquivo hostil devolva milhares de avisos, ou avisos enormes, para a tela. */
function resumirAvisos(avisos) {
  const linhas = avisos.slice(0, MAX_AVISOS).map(encurtar);
  const resto = avisos.length - MAX_AVISOS;
  if (resto > 0) linhas.push(`... e mais ${resto} ${resto === 1 ? 'aviso' : 'avisos'}.`);
  return linhas;
}

/**
 * Lê um pacote ou um roadmap puro, em texto JSON ou já como objeto.
 * `agora` (padrão: o relógio do cliente) só serve para recusar datas de progresso no futuro.
 * @param {string | object} entrada
 * @param {{nomeArquivo?: string, agora?: number}} [opcoes]
 * @returns {{id: string, roadmap: object, progresso: object | null, avisos: string[]}}
 * @throws {ErroPacote}
 */
export function lerPacote(entrada, opcoes) {
  try {
    const nomeArquivo = opcoes?.nomeArquivo;
    const agora = Number.isFinite(opcoes?.agora) ? opcoes.agora : Date.now();

    const { roadmapBruto, idBruto, progressoBruto } = separarPartes(lerJson(entrada));
    const tamanho = conferirTamanho(roadmapBruto);
    const validado = validar(tamanho.roadmapBruto);
    const avisos = [...tamanho.avisos, ...validado.avisos];

    const { roadmap } = validado;
    const progresso = lerProgresso(progressoBruto, roadmap, agora, avisos);
    return { id: escolherId(idBruto, nomeArquivo, roadmap), roadmap, progresso, avisos: resumirAvisos(avisos) };
  } catch (erro) {
    if (erro instanceof ErroPacote) throw erro;
    throw new ErroPacote('Não foi possível ler o arquivo: o conteúdo tem um formato inesperado.', { cause: erro });
  }
}
