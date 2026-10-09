# Grafos de estudo

Roadmaps de estudo em **grafos** e **cards expansíveis**. Cada tópico é um card com resumo, exemplo de código e links; um card pode abrir um **subgrafo** (React → Hooks → useEffect). O progresso fica no navegador, com lembretes de **revisão espaçada**.

JavaScript puro com ES modules, sem dependências e sem etapa de build.

## Como rodar

Os módulos ES e o `fetch` do JSON não funcionam a partir de `file://`, então sirva a pasta por HTTP:

```sh
npx serve .
# ou: python3 -m http.server 8000
```

e abra o endereço indicado. Rotas: `#react` (raiz), `#react/hooks`, `#react/perf`.

Testes das partes puras (layout, progresso, rotas e validação), com o `node:test` do Node 22+:

```sh
npm test
```

## Como adicionar um grafo

Os dados ficam em `data/react.json`: um conjunto de grafos indexados por `id`.

```json
{
  "raiz": "react",
  "grafos": {
    "react": {
      "titulo": "React",
      "nos": [
        {
          "id": "hooks",
          "titulo": "Hooks",
          "resumo": "Funções que começam com use.",
          "exemplo": "const [n, setN] = useState(0);",
          "links": [["Docs: hooks", "https://react.dev/reference/react/hooks"]],
          "filho": "hooks"
        }
      ],
      "arestas": [["estado", "hooks"]]
    },
    "hooks": { "titulo": "Hooks", "nos": [], "arestas": [] }
  }
}
```

1. Crie o grafo novo em `grafos` (por exemplo `"rotas": { "titulo": "Rotas", "nos": [...], "arestas": [...] }`).
2. Ligue um card a ele com `"filho": "rotas"`. Ele passa a mostrar **Abrir subgrafo** e o progresso `feitos/total`.

Regras:

- `id` do nó é único **dentro do grafo**; o progresso é guardado por `idDoGrafo/idDoNo`. Ids de grafo não podem conter `/`.
- `arestas` são pares `[de, para]` entre nós do mesmo grafo. O layout assume grafo **sem ciclos**.
- Links precisam ser `http(s)`.
- Ao carregar, `filho` inexistente, aresta com nó inexistente, `id` duplicado, link inválido e ciclo geram um aviso no console, e o item problemático é ignorado em vez de quebrar a página.

## Progresso e revisão

Cada card tem o status *Não visto*, *Estudando* ou *Dominado*, guardado no `localStorage` na chave `grafos-estudo-v1` (`{ "grafo/no": { status, intervalo, proxima } }`). Se o storage estiver indisponível, o progresso fica em memória e a página avisa.

| Ação | Efeito |
|---|---|
| Marcar **Dominado** | `intervalo = 1` dia, `proxima = agora + 1 dia` |
| Marcar **Não visto** ou **Estudando** | zera `intervalo` e `proxima` |
| Dominado com `proxima <= agora` | aparece como **Revisar hoje**, com os botões Lembrei e Esqueci |
| **Lembrei** | `intervalo = max(1, intervalo) * 2`, `proxima = agora + intervalo` dias |
| **Esqueci** | `intervalo = 1`, `proxima = agora + 1 dia` |

## Estrutura

```
index.html
css/estilos.css
js/
  main.js       inicialização e ligação dos módulos
  dados.js      carrega e valida os grafos (puro, exceto o fetch)
  layout.js     níveis e colunas (puro)
  render.js     cards, trilha e cabeçalho
  arestas.js    linhas SVG
  progresso.js  regras de revisão (puras) + localStorage com fallback em memória
  rotas.js      hash <-> caminho de grafos
data/react.json primeiro roadmap (grafos react, hooks e perf)
test/           testes dos módulos puros
```

`layout.js`, `progresso.js` (regras), `dados.js` (validação) e `rotas.js` (`caminhoDoHash`) não dependem do DOM.
