// Persistência em um único arquivo JSON, com o estado inteiro em memória.
//
// Formato: { versao: 1, roadmaps: { [id]: { roadmap, atualizadoEm } }, progresso: { [id]: { resetEm, registros } } }
//
// Garantias:
//  - gravação atômica: escreve `<arquivo>.tmp` no mesmo diretório, faz fsync e `rename` por cima;
//  - gravações serializadas numa fila de promessas, e a leitura-verificação-escrita de cada
//    operação roda dentro da fila, então duas requisições simultâneas nunca se atropelam;
//  - cada mudança é montada numa cópia do estado, gravada, e só então vira o estado oficial:
//    se a gravação falhar, a memória continua igual ao disco.
// O id nunca vira caminho de arquivo (o arquivo é um só), e os mapas em memória são `Map`s.

import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tituloDoRoadmap, validarRoadmap } from '../js/dados.js';
import { gerarIdDeRoadmap, idDeRoadmapValido } from '../js/ids.js';
import { mesclarProgresso as mesclar, normalizarProgresso, progressoVazio } from '../js/sincronia.js';

const VERSAO = 1;

/**
 * Erro previsível de uso; `codigo` diz o que houve e a mensagem já está pronta para o cliente
 * (nunca contém caminhos do disco). Códigos: 'invalido', 'id-invalido', 'nao-encontrado',
 * 'ja-existe' e 'conflito' (este traz `atualizadoEm`, o instante atual do roadmap).
 */
export class ErroArmazenamento extends Error {
  constructor(codigo, mensagem, atualizadoEm) {
    super(mensagem);
    this.name = 'ErroArmazenamento';
    this.codigo = codigo;
    if (atualizadoEm !== undefined) this.atualizadoEm = atualizadoEm;
  }
}

export const roadmapNaoEncontrado = () => new ErroArmazenamento('nao-encontrado', 'Roadmap não encontrado.');

const ehObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);

/**
 * Valida com `validarRoadmap` e devolve a cópia limpa. Passar por JSON garante que o que fica
 * em memória é idêntico ao que será relido do disco (sem `undefined`, sem protótipos estranhos).
 */
function limpar(bruto) {
  let validado;
  try {
    validado = validarRoadmap(bruto);
  } catch (erro) {
    throw new ErroArmazenamento('invalido', erro.message);
  }
  return { roadmap: JSON.parse(JSON.stringify(validado.roadmap)), avisos: validado.avisos };
}

/** Lê o conteúdo do arquivo. Qualquer problema de formato lança erro (o chamador trata como corrompido). */
function lerEstado(texto) {
  const bruto = JSON.parse(texto);
  if (!ehObjeto(bruto) || !ehObjeto(bruto.roadmaps) || (bruto.progresso !== undefined && !ehObjeto(bruto.progresso))) {
    throw new Error('estrutura inesperada');
  }
  if (bruto.versao !== VERSAO) throw new Error(`versão ${JSON.stringify(bruto.versao)} desconhecida`);

  const roadmaps = new Map();
  for (const [id, entrada] of Object.entries(bruto.roadmaps)) {
    if (!idDeRoadmapValido(id)) throw new Error('id de roadmap inválido');
    if (!ehObjeto(entrada) || typeof entrada.atualizadoEm !== 'string' || Number.isNaN(Date.parse(entrada.atualizadoEm))) {
      throw new Error(`roadmap "${id}" sem atualizadoEm válido`);
    }
    // `validarRoadmap` lança se a estrutura for irrecuperável: o arquivo todo é tratado como corrompido.
    roadmaps.set(id, { roadmap: limpar(entrada.roadmap).roadmap, atualizadoEm: entrada.atualizadoEm });
  }

  const progresso = new Map();
  for (const [id, valor] of Object.entries(bruto.progresso ?? {})) {
    if (roadmaps.has(id)) progresso.set(id, normalizarProgresso(valor));
  }
  return { roadmaps, progresso };
}

const serializar = (estado) =>
  JSON.stringify(
    { versao: VERSAO, roadmaps: Object.fromEntries(estado.roadmaps), progresso: Object.fromEntries(estado.progresso) },
    null,
    2,
  );

/** Primeira execução: roadmaps de `<diretorio>/*.json`, com o nome do arquivo (sem extensão) como id. */
async function lerSementes(diretorio, instante) {
  const roadmaps = new Map();
  if (!diretorio) return roadmaps;
  let itens;
  try {
    itens = await readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return roadmaps;
    throw erro;
  }
  const arquivos = itens.filter((item) => item.isFile() && item.name.endsWith('.json')).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const { name } of arquivos) {
    const id = name.slice(0, -'.json'.length);
    if (!idDeRoadmapValido(id)) {
      console.warn(`[armazenamento] Semente "${name}" ignorada: o nome não é um id de roadmap válido.`);
      continue;
    }
    try {
      const { roadmap } = limpar(JSON.parse(await readFile(path.join(diretorio, name), 'utf8')));
      roadmaps.set(id, { roadmap, atualizadoEm: instante });
    } catch (erro) {
      console.warn(`[armazenamento] Semente "${name}" ignorada: ${erro.message}`);
    }
  }
  return roadmaps;
}

/**
 * @param {object} opcoes
 * @param {string} opcoes.arquivo caminho do arquivo de dados (o diretório é criado se não existir)
 * @param {string} [opcoes.sementes] diretório com `*.json` de roadmaps para a primeira execução
 * @param {() => number} [opcoes.relogio] fonte de "agora" em ms; só os testes trocam
 */
export async function criarArmazenamento({ arquivo, sementes, relogio = Date.now }) {
  const destino = path.resolve(arquivo);
  // Nome fixo: como as gravações são serializadas, um resto de queda é sobrescrito na próxima.
  const temporario = `${destino}.tmp`;
  await mkdir(path.dirname(destino), { recursive: true });

  async function gravar(estado) {
    try {
      const aberto = await open(temporario, 'w', 0o600);
      try {
        await aberto.writeFile(serializar(estado));
        await aberto.sync();
      } finally {
        await aberto.close();
      }
      await rename(temporario, destino);
    } catch (erro) {
      await unlink(temporario).catch(() => {});
      throw erro;
    }
  }

  const agoraISO = () => new Date(relogio()).toISOString();
  // Estritamente crescente por roadmap: duas gravações no mesmo milissegundo (ou um relógio
  // que andou para trás) não podem produzir o mesmo `atualizadoEm`, senão o 409 não detectaria.
  const instanteApos = (anterior) => new Date(Math.max(relogio(), Date.parse(anterior) + 1)).toISOString();

  let texto;
  try {
    texto = await readFile(destino, 'utf8');
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }

  let estado;
  if (texto === undefined) {
    estado = { roadmaps: await lerSementes(sementes, agoraISO()), progresso: new Map() };
    // Grava já, mesmo vazio: é a existência do arquivo que impede ressemear depois.
    await gravar(estado);
  } else {
    try {
      estado = lerEstado(texto);
    } catch (erro) {
      const guardado = `${destino}.corrompido-${agoraISO().replace(/[:.]/g, '-')}`;
      await rename(destino, guardado);
      console.warn(
        `[armazenamento] ${path.basename(destino)} está corrompido (${erro.message}). ` +
          `Guardado como ${path.basename(guardado)}; iniciando vazio.`,
      );
      estado = { roadmaps: new Map(), progresso: new Map() };
      await gravar(estado);
    }
  }

  let fila = Promise.resolve();
  /** Executa `tarefa` depois de todas as anteriores; a falha de uma não trava as seguintes. */
  function naFila(tarefa) {
    const execucao = fila.then(tarefa);
    fila = execucao.then(
      () => {},
      () => {},
    );
    return execucao;
  }

  /** Grava e só então adota `novo` como estado. */
  async function trocar(novo) {
    await gravar(novo);
    estado = novo;
  }

  const comRoadmap = (id, roadmap) => new Map(estado.roadmaps).set(id, roadmap);

  // Os valores devolvidos são os próprios objetos do estado, que nunca são mutados (cada mudança
  // cria objetos novos); quem chama só deve ler e serializar.
  return {
    listar: () => [...estado.roadmaps].map(([id, entrada]) => ({ id, ...entrada })),

    /** @returns {{roadmap: object, atualizadoEm: string} | undefined} */
    obter: (id) => estado.roadmaps.get(id),

    /** Progresso do roadmap (vazio se nunca houve), ou `undefined` se o roadmap não existe. */
    progressoDe: (id) => (estado.roadmaps.has(id) ? (estado.progresso.get(id) ?? progressoVazio()) : undefined),

    /** `id` opcional: sem ele, gera um do título. @returns {{id, roadmap, atualizadoEm, avisos}} */
    async criar({ id, roadmap: bruto }) {
      if (id !== undefined && !idDeRoadmapValido(id)) throw new ErroArmazenamento('id-invalido', 'Id de roadmap inválido.');
      const { roadmap, avisos } = limpar(bruto);
      return naFila(async () => {
        const idFinal = id ?? gerarIdDeRoadmap(tituloDoRoadmap(roadmap), estado.roadmaps.keys());
        if (estado.roadmaps.has(idFinal)) throw new ErroArmazenamento('ja-existe', `Já existe um roadmap com o id "${idFinal}".`);
        const entrada = { roadmap, atualizadoEm: agoraISO() };
        await trocar({ roadmaps: comRoadmap(idFinal, entrada), progresso: estado.progresso });
        return { id: idFinal, ...entrada, avisos };
      });
    },

    /** Se `baseadoEm` vier e não for o `atualizadoEm` atual, lança 'conflito' (edição concorrente). */
    async atualizar(id, bruto, baseadoEm) {
      const { roadmap, avisos } = limpar(bruto);
      return naFila(async () => {
        const atual = estado.roadmaps.get(id);
        if (!atual) throw roadmapNaoEncontrado();
        if (baseadoEm !== undefined && baseadoEm !== atual.atualizadoEm) {
          throw new ErroArmazenamento(
            'conflito',
            'O roadmap foi alterado em outro lugar desde que você o abriu. Recarregue antes de salvar.',
            atual.atualizadoEm,
          );
        }
        const entrada = { roadmap, atualizadoEm: instanteApos(atual.atualizadoEm) };
        await trocar({ roadmaps: comRoadmap(id, entrada), progresso: estado.progresso });
        return { id, ...entrada, avisos };
      });
    },

    /** Apaga o roadmap e o progresso dele. */
    remover: (id) =>
      naFila(async () => {
        if (!estado.roadmaps.has(id)) throw roadmapNaoEncontrado();
        const roadmaps = new Map(estado.roadmaps);
        const progresso = new Map(estado.progresso);
        roadmaps.delete(id);
        progresso.delete(id);
        await trocar({ roadmaps, progresso });
      }),

    /** Mescla `parte` ao progresso guardado (`mesclarProgresso` de sincronia.js) e devolve o resultado. */
    mesclarProgresso: (id, parte) =>
      naFila(async () => {
        if (!estado.roadmaps.has(id)) throw roadmapNaoEncontrado();
        const atual = estado.progresso.get(id) ?? progressoVazio();
        const mesclado = mesclar(atual, parte);
        // O cliente reenvia o que já sabe com frequência; sem mudança, não vale um fsync.
        if (JSON.stringify(mesclado) === JSON.stringify(atual)) return atual;
        await trocar({ roadmaps: estado.roadmaps, progresso: new Map(estado.progresso).set(id, mesclado) });
        return mesclado;
      }),

    /** Resolve quando todas as gravações já enfileiradas terminarem (nunca rejeita). */
    aguardarGravacoes: () => fila,
  };
}
