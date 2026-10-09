// Ponto de entrada: lê o ambiente, sobe o servidor e encerra com elegância.
//
// Variáveis de ambiente:
//   PORT              porta (padrão 3000; 0 escolhe uma livre)
//   HOST              endereço de escuta (padrão 127.0.0.1: a API não tem login, então só esta máquina acessa)
//   DB_FILE           arquivo de dados (padrão armazenamento/dados.json na raiz do projeto)
//   HOSTS_PERMITIDOS  lista separada por vírgulas de valores de Host aceitos além dos de loopback,
//                     por exemplo "localhost:8080" atrás de um túnel SSH (só vale com HOST de loopback)

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarApp, ehLoopback } from './app.js';
import { criarArmazenamento } from './armazenamento.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Se algo travar o encerramento (conexão pendurada, disco parado), a saída é forçada com erro.
const PRAZO_ENCERRAMENTO_MS = 10_000;
const PRAZO_CONEXOES_MS = 3_000;

function lerPorta(texto = '3000') {
  if (!/^\d+$/.test(texto) || Number(texto) > 65535) throw new Error(`PORT inválida: "${texto}".`);
  return Number(texto);
}

async function iniciar() {
  const porta = lerPorta(process.env.PORT);
  const host = process.env.HOST || '127.0.0.1';
  const arquivo = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(raiz, 'armazenamento', 'dados.json');
  const hostsPermitidos = (process.env.HOSTS_PERMITIDOS ?? '').split(',');

  const armazenamento = await criarArmazenamento({ arquivo, sementes: path.join(raiz, 'data') });
  const app = criarApp({ armazenamento, diretorioPublico: raiz, host, hostsPermitidos });
  const servidor = createServer(app);

  await new Promise((resolver, rejeitar) => {
    servidor.once('error', (erro) => {
      rejeitar(erro.code === 'EADDRINUSE' ? new Error(`A porta ${porta} já está em uso em ${host}.`) : erro);
    });
    servidor.listen(porta, host, resolver);
  });

  const { port } = servidor.address();
  console.log(`Grafos de estudo em http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  console.log(`Dados em ${arquivo}`);
  if (!ehLoopback(host)) {
    console.warn(
      `Aviso: HOST=${host} deixa a API acessível pela rede e ela não tem autenticação: quem alcançar ` +
        'esta porta pode ler, alterar e apagar todos os roadmaps e o progresso. Use só em rede confiável.',
    );
  }

  let encerrando = false;
  async function encerrar(sinal) {
    if (encerrando) return;
    encerrando = true;
    console.log(`${sinal} recebido: encerrando...`);
    const limite = setTimeout(() => {
      console.error('O encerramento demorou demais; saindo à força.');
      process.exit(1);
    }, PRAZO_ENCERRAMENTO_MS);
    limite.unref();
    try {
      // Para de aceitar conexões, deixa as requisições em andamento terminarem (com um prazo
      // para quem ficou pendurado) e só então espera a fila de gravação esvaziar.
      const fechado = new Promise((resolver) => servidor.close(resolver));
      servidor.closeIdleConnections();
      setTimeout(() => servidor.closeAllConnections(), PRAZO_CONEXOES_MS).unref();
      await fechado;
      await armazenamento.aguardarGravacoes();
      process.exitCode = 0;
    } catch (erro) {
      console.error(`Falha ao encerrar: ${erro.message}`);
      process.exitCode = 1;
    }
  }
  process.once('SIGINT', () => encerrar('SIGINT'));
  process.once('SIGTERM', () => encerrar('SIGTERM'));
}

iniciar().catch((erro) => {
  console.error(`Não foi possível iniciar: ${erro.message}`);
  process.exit(1);
});
