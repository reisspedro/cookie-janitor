# 🧹 Cookie Janitor

Extensão de navegador (Manifest V3, Chrome/Brave/Edge) que responde uma pergunta simples:
**quais sites guardam cookies no seu navegador sem você usar mais?**

Ela cruza todos os cookies com o seu histórico e separa recência de frequência — porque são
coisas diferentes: tem site que você visitou ontem mas só usou uma vez no mês.

![painel](icones/icone-128.png)

## O que o painel mostra

**Recência** — quando foi a última visita, com data e hora exatas:

| Situação | Critério |
|---|---|
| `ativo` | visitado nos últimos 30 dias |
| `ocioso` | 31 a 90 dias sem visita |
| `antigo` | 91+ dias sem visita |
| `nunca` | nenhuma visita registrada no histórico |

**Frequência** — em quantos dias distintos dos últimos 7 ou 30 houve visita, classificada em
`frequente` (≥50% dos dias), `regular` (≥1/6) e `usei pouco` (1 a 4 dias). É esse cruzamento que
revela o caso interessante: o site que você abriu recentemente mas quase não usa.

## Segurança

Deletar cookie desloga você do site, então há três travas:

1. **Lista de protegidos** — domínios que nunca ficam selecionáveis. Já vem com gov.br, bancos
   (BB, Caixa, Itaú, Bradesco, Santander, Nubank, Inter, C6), PicPay, Mercado Pago, PayPal e
   Binance. Editável pelo cadeado de cada linha e salva localmente.
2. **Backup automático** — antes de deletar, baixa um `.json` com os cookies removidos. O botão
   *Restaurar backup* recoloca todos.
3. **Confirmação** informando quantos cookies e domínios serão afetados.

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

## Como a última visita é medida

O caminho ingênuo — varrer o histórico em janelas de tempo — dá resultado errado, porque
`history.search` com recorte de data devolve o horário da visita **daquela janela**, e um site
visitado há um ano e também ontem acaba registrado com a data antiga.

Aqui a medição é feita em duas passadas: uma consulta **por domínio, sem recorte de tempo**
(`startTime: 0`), que devolve a última visita real; e uma varredura dia a dia dos últimos 30 dias,
que mede frequência e serve de piso de segurança para a recência.

## Licença

MIT
