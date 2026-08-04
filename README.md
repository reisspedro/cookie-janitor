# 🧹 Cookie Janitor

Extensão de navegador (Manifest V3, Chrome/Brave/Edge) que responde uma pergunta simples:
**quais sites guardam cookies no seu navegador sem você usar mais?**

Ela cruza todos os cookies com o seu histórico e separa recência de frequência — porque são
coisas diferentes: tem site que você visitou ontem mas só usou uma vez no mês.

![painel](icones/icone-128.png)

## O que o painel mostra

Para cada domínio que guarda cookie, três medidas independentes:

- **Primeira visita** — desde quando esse site existe na sua vida, com data e hora.
- **Última visita** — quando foi a última vez, com data e hora.
- **Uso na janela** — quantas visitas e em quantos dias distintos nos últimos 7 ou 30 dias.

A situação vem da recência:

| Situação | Critério |
|---|---|
| `ativo` | visitado nos últimos 30 dias |
| `ocioso` | 31 a 90 dias sem visita |
| `antigo` | 91+ dias sem visita |
| `sem registro` | nenhuma visita encontrada no histórico |

E a frequência é classificada em `frequente`, `regular` e **`usei pouco`** — o cruzamento que
revela o caso interessante: o site que você abriu recentemente mas quase não usou.

`sem registro` **não** significa abandonado: pode ser histórico limpo, navegação anônima ou
cookie vindo de conteúdo incorporado. Por isso nada vem pré-selecionado — marcar é sempre ato
explícito seu.

## Segurança

Deletar cookie desloga você do site, então há três travas:

1. **Nada vem pré-selecionado.** Marcar é sempre ato explícito.
2. **Lista de protegidos** — domínios que nunca ficam selecionáveis. Já vem com gov.br, bancos
   (BB, Caixa, Itaú, Bradesco, Santander, Nubank, Inter, C6), PicPay, Mercado Pago, PayPal e
   Binance. Editável pelo cadeado de cada linha e salva localmente.
3. **Backup duplo** — antes de deletar, baixa um `.json` e guarda uma cópia dentro da própria
   extensão, porque o download pode ser bloqueado pelo navegador. *Desfazer última limpeza*
   usa essa cópia; *Restaurar de arquivo* usa o `.json`.
4. **Confirmação** informando quantos cookies e domínios serão afetados, e relatório honesto
   depois: quantos foram apagados, quantos já não existiam e quantos falharam.

Opcionalmente apaga também localStorage, IndexedDB, cache e service workers dos domínios
selecionados (desligado por padrão).

## Instalar

1. Abra `brave://extensions` (ou `chrome://extensions`)
2. Ligue o **Modo de desenvolvedor**
3. **Carregar sem compactação** e selecione esta pasta
4. Clique no ícone do cookie → **Abrir painel**

Ao trocar de versão, use o botão de recarregar no card da extensão — permissões novas no
manifest só passam a valer depois do reload.

## Permissões

| Permissão | Para quê |
|---|---|
| `cookies` | ler e apagar cookies |
| `history` | descobrir quais sites você visitou e com que frequência |
| `storage` | guardar a lista de protegidos e a data da última faxina |
| `browsingData` | apagar dados de site (só quando a opção é marcada) |
| `<all_urls>` | sem isso o navegador só entrega os cookies da aba aberta |

**Nenhuma requisição de rede é feita.** Tudo roda local; nada sai da máquina.

## Como as medidas são feitas

`chrome.history.search` devolve **uma entrada por página, com a última visita dela** — não a
lista de visitas. Contar frequência varrendo janelas de tempo com ele produz número errado, e
sem `startTime: 0` a busca só enxerga as últimas 24 horas.

Aqui cada domínio é resolvido em duas etapas: `search` com `startTime: 0` lista as páginas
daquele host, e `chrome.history.getVisits` devolve **todas as visitas de cada página**, com
horário. É de lá que saem a primeira visita, a última exata e a contagem da janela.

Quando um domínio tem mais páginas do que dá para ler dentro do orçamento de consultas, a linha
recebe um **⚠** e os números devem ser lidos como piso, nunca como total.

## Agrupamento de domínios

Cookies são agrupados pelo domínio registrável, e errar esse limite seria grave: juntar
`alice.github.io` com `bob.github.io` faria uma seleção apagar cookies de dois sites
independentes. Então IPv4, IPv6, `localhost` e hosts de um rótulo ficam inteiros, há uma lista
de sufixos públicos (`co.uk`, `com.br`) e de hospedagens onde cada subdomínio é um site
(`github.io`, `vercel.app`, `netlify.app`), e uma regra genérica para ccTLDs.

Não é a [Public Suffix List](https://publicsuffix.org/) completa. Na dúvida a extensão agrupa
**menos**, mantendo hosts separados — errar para o lado de mostrar duas linhas é inofensivo;
errar para o lado de juntar sites independentes apagaria dados que você não escolheu.

## Licença

MIT
