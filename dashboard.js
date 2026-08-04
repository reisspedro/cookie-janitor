// Cookie Janitor — painel.
// Para cada domínio que guarda cookie, mede a partir do histórico: quando você
// visitou pela primeira vez, quando visitou pela última e quanto usou nos últimos
// 30 dias. Tudo vem de chrome.history.getVisits, que devolve as visitas de verdade.

const DIA = 24 * 60 * 60 * 1000;
const DIAS_JANELA = 30;
const LIMITE_ATIVO = 30;
const LIMITE_OCIOSO = 90;
const LINHAS_POR_PAGINA = 300;
const TETO_URLS_DOMINIO = 300;   // páginas devolvidas por domínio
const URLS_AMOSTRADAS = 40;      // páginas por domínio que viram getVisits
const ORCAMENTO_VISITAS = 6000;  // teto global de chamadas getVisits

// Sufixos onde o registrável tem 3 rótulos. Não é a Public Suffix List inteira:
// o que não estiver aqui cai na regra genérica de ccTLD, e na dúvida agrupamos
// MENOS (mantendo hosts separados) em vez de juntar sites independentes.
const SUFIXOS_PUBLICOS = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br', 'jus.br',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk',
  'com.ar', 'com.mx', 'com.pt', 'com.au', 'com.co', 'com.es', 'com.tr', 'com.sg',
  'com.hk', 'com.tw', 'com.cn', 'com.ua', 'com.pl', 'com.ru', 'com.vn', 'com.my',
  'co.jp', 'co.kr', 'co.in', 'co.nz', 'co.za', 'co.il', 'co.th', 'co.id'
]);

// Domínios de hospedagem: cada subdomínio é um site independente.
const SUFIXOS_PRIVADOS = new Set([
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'blogspot.com',
  'wordpress.com', 'glitch.me', 'repl.co', 'replit.dev', 'surge.sh', 'onrender.com',
  'fly.dev', 'railway.app', 'supabase.co', 'notion.site', 'substack.com',
  'myshopify.com', 'zendesk.com', 'atlassian.net', 'sharepoint.com', 'sourceforge.net',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'r2.dev', 'ngrok.io',
  'trycloudflare.com', 'translate.goog', 'itch.io', 'neocities.org'
]);

const SEGUNDO_NIVEL = ['com', 'net', 'org', 'gov', 'edu', 'ac', 'co', 'or', 'ne', 'gob', 'mil', 'int'];

const PROTEGIDOS_PADRAO = [
  'gov.br', 'bb.com.br', 'caixa.gov.br', 'itau.com.br', 'bradesco.com.br',
  'santander.com.br', 'nubank.com.br', 'inter.co', 'c6bank.com.br',
  'picpay.com', 'mercadopago.com.br', 'paypal.com', 'binance.com'
];

let dominios = [];
let protegidos = new Set();
let selecionados = new Set();
let filtroBucket = 'todos';
let limiteLinhas = LINHAS_POR_PAGINA;
let analisando = false;

const $ = (id) => document.getElementById(id);
const janelaAtual = () => Number($('janela').value);

window.addEventListener('error', (e) => setStatus(`Erro: ${e.message}`, 'erro'));
window.addEventListener('unhandledrejection', (e) =>
  setStatus(`Erro: ${e.reason && e.reason.message ? e.reason.message : e.reason}`, 'erro'));

// Agrupar hosts independentes na mesma linha faria a seleção apagar cookies de
// sites diferentes — por isso IP, localhost e host de um rótulo ficam inteiros.
function dominioBase(host) {
  host = String(host).replace(/^\./, '').replace(/\.$/, '').toLowerCase();
  if (!host) return host;
  if (host.includes(':') || host.startsWith('[')) return host;            // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;                  // IPv4
  const p = host.split('.');
  if (p.length <= 2) return host;
  const dois = p.slice(-2).join('.');
  const tres = p.slice(-3).join('.');
  if (SUFIXOS_PRIVADOS.has(dois)) return tres;
  if (SUFIXOS_PUBLICOS.has(dois)) return tres;
  if (p[p.length - 1].length === 2 && SEGUNDO_NIVEL.includes(p[p.length - 2])) return tres;
  return dois;
}

function bucketDe(dias) {
  if (dias === null) return 'semdados';
  if (dias <= LIMITE_ATIVO) return 'ativo';
  if (dias <= LIMITE_OCIOSO) return 'ocioso';
  return 'antigo';
}

// Classifica pelo sinal MAIS forte: preferimos superestimar uso a sugerir
// exclusão de algo que a pessoa usa.
function classificarUso(visitas, diasAtivos, janela) {
  if (!visitas && !diasAtivos) return 'nenhum';
  if (diasAtivos >= janela * 0.5 || visitas >= janela * 2) return 'frequente';
  if (diasAtivos >= janela / 6 || visitas >= janela / 2) return 'regular';
  return 'raro';
}

const ROTULO_USO = { frequente: 'frequente', regular: 'regular', raro: 'usei pouco', nenhum: 'nada na janela' };
const ROTULO_BUCKET = { ativo: 'ativo', ocioso: 'ocioso', antigo: 'antigo', semdados: 'sem registro' };

function rotuloVisita(ms) {
  if (!ms) return '—';
  const dias = Math.max(0, Math.floor((Date.now() - ms) / DIA));
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) return `há ${Math.round(dias / 30)} meses`;
  const anos = (dias / 365).toFixed(1).replace('.', ',');
  return `há ${anos} anos`;
}

const dataHora = (ms) => new Date(ms).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
});

function urlDoCookie(c) {
  return (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + (c.path || '/');
}

// Um cookie só é o mesmo cookie se store, partição, domínio, caminho e nome batem.
function chaveDoCookie(c) {
  const part = c.partitionKey ? JSON.stringify(c.partitionKey) : '';
  return `${c.storeId || ''}|${part}|${c.domain}|${c.path}|${c.name}`;
}

function setStatus(msg, classe = '') {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.className = classe;
}

const respirar = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- coleta

async function coletarCookies() {
  let stores = [{ id: null }];
  try {
    const encontrados = await chrome.cookies.getAllCookieStores();
    if (encontrados && encontrados.length) stores = encontrados;
  } catch { /* sem permissão para listar stores: usa o padrão */ }

  const todos = [];
  for (const s of stores) {
    try {
      const lote = await chrome.cookies.getAll(s.id ? { storeId: s.id } : {});
      for (const c of lote) todos.push(c);
    } catch { /* store inacessível (ex. janela anônima fechada) */ }
  }
  return todos;
}

// `search` só devolve a última visita de cada página; `getVisits` devolve todas.
// É de lá que saem a primeira visita, a última exata e a contagem da janela.
async function medirDominios(lista, aoProgredir) {
  const agora = Date.now();
  const corte = agora - DIAS_JANELA * DIA;
  const out = new Map();
  let orcamento = ORCAMENTO_VISITAS;

  for (let i = 0; i < lista.length; i++) {
    const dominio = lista[i];
    if (i % 10 === 0) {
      if (aoProgredir) aoProgredir(i + 1, lista.length);
      await respirar();
    }

    let itens = [];
    let falhou = false;
    try {
      // Sem startTime o Chrome só olha as últimas 24h; com 0, olha tudo.
      itens = await chrome.history.search({ text: dominio, startTime: 0, maxResults: TETO_URLS_DOMINIO });
    } catch { falhou = true; }

    const paginas = [];
    for (const it of itens) {
      let host;
      try { host = new URL(it.url).hostname; } catch { continue; }
      if (dominioBase(host) !== dominio) continue;   // o texto casa com título também
      paginas.push(it);
    }
    const truncado = itens.length >= TETO_URLS_DOMINIO;

    if (!paginas.length) {
      // Ausência de registro não é prova de abandono: pode ser histórico limpo,
      // aba anônima, conteúdo incorporado ou busca truncada.
      out.set(dominio, {
        primeira: null, ultima: null, visitas: 0, dias: new Set(),
        confiavel: !(falhou || truncado)
      });
      continue;
    }

    paginas.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
    const amostra = paginas.slice(0, URLS_AMOSTRADAS);
    const completo = paginas.length <= URLS_AMOSTRADAS && !truncado;

    let primeira = Infinity, ultima = 0, visitas = 0;
    const dias = new Set();

    if (orcamento >= amostra.length) {
      orcamento -= amostra.length;
      for (const pagina of amostra) {
        let lista = [];
        try { lista = await chrome.history.getVisits({ url: pagina.url }); } catch { /* segue */ }
        for (const v of lista) {
          const t = v.visitTime;
          if (!t) continue;
          if (t < primeira) primeira = t;
          if (t > ultima) ultima = t;
          if (t >= corte) { visitas++; dias.add(Math.floor((agora - t) / DIA)); }
        }
      }
    }

    if (!ultima) ultima = paginas[0].lastVisitTime || 0;   // getVisits indisponível
    out.set(dominio, {
      primeira: primeira === Infinity ? null : primeira,
      ultima: ultima || null,
      visitas,
      dias,
      confiavel: completo && !falhou
    });
  }
  return out;
}

async function analisar() {
  if (analisando) return;
  analisando = true;
  $('reanalisar').disabled = true;

  try {
    if (!chrome.cookies || !chrome.history) {
      throw new Error('Faltam as permissões de cookies/histórico. Recarregue a extensão em brave://extensions.');
    }
    const precisaRecarregar = !chrome.storage || !chrome.browsingData;

    let guardado = {};
    try { guardado = (await chrome.storage.local.get('protegidos')) || {}; } catch { /* usa padrão */ }
    protegidos = new Set(guardado.protegidos || PROTEGIDOS_PADRAO);

    setStatus('Lendo cookies…');
    await respirar();
    const cookies = await coletarCookies();

    const porDominio = new Map();
    for (const c of cookies) {
      const d = dominioBase(c.domain);
      if (!porDominio.has(d)) porDominio.set(d, []);
      porDominio.get(d).push(c);
    }

    const medidas = await medirDominios([...porDominio.keys()], (n, total) =>
      setStatus(`Lendo histórico — domínio ${n} de ${total} (${cookies.length} cookies)`));

    setStatus('Montando o painel…');
    await respirar();

    dominios = [...porDominio].map(([dominio, cs]) => {
      const m = medidas.get(dominio);
      const dias = m.ultima ? Math.max(0, Math.floor((Date.now() - m.ultima) / DIA)) : null;
      return {
        dominio,
        cookies: cs,
        total: cs.length,
        primeira: m.primeira,
        ultima: m.ultima,
        visitas: m.visitas,
        dias30: m.dias.size,
        dias7: [...m.dias].filter((d) => d < 7).length,
        confiavel: m.confiavel,
        diasSemVisita: dias,
        bucket: bucketDe(dias)
      };
    });

    // Nada vem pré-marcado: seleção é sempre ato explícito.
    selecionados.clear();
    limiteLinhas = LINHAS_POR_PAGINA;
    render();

    const semRegistro = dominios.filter((d) => d.bucket === 'semdados').length;
    setStatus(
      cookies.length
        ? `${cookies.length} cookies em ${dominios.length} domínios. ` +
          `${semRegistro} sem registro no histórico — nada vem marcado, a escolha é sua.` +
          (precisaRecarregar ? ' ⚠️ Recarregue a extensão em brave://extensions para ativar protegidos salvos e limpeza de dados de site.' : '')
        : 'Nenhum cookie encontrado. Se isso parece errado, recarregue a extensão em brave://extensions.',
      cookies.length && !precisaRecarregar ? 'ok' : 'erro'
    );
  } catch (e) {
    console.error(e);
    setStatus(`Falhou: ${e && e.message ? e.message : e}`, 'erro');
  } finally {
    analisando = false;
    $('reanalisar').disabled = false;
  }
}

// ---------------------------------------------------------------- render

const diasNaJanela = (d) => (janelaAtual() === 7 ? d.dias7 : d.dias30);
const visitasNaJanela = (d) => (janelaAtual() === 7 ? Math.round(d.visitas * d.dias7 / (d.dias30 || 1)) : d.visitas);
const usoDe = (d) => classificarUso(visitasNaJanela(d), diasNaJanela(d), janelaAtual());

function render() {
  const busca = $('busca').value.trim().toLowerCase();
  const ordem = $('ordem').value;
  const filtroUso = $('uso').value;
  const janela = janelaAtual();

  const contagem = { ativo: 0, ocioso: 0, antigo: 0, semdados: 0 };
  let pouco = 0;
  for (const d of dominios) {
    contagem[d.bucket]++;
    if (usoDe(d) === 'raro') pouco++;
  }

  $('c-cookies').textContent = dominios.reduce((s, d) => s + d.total, 0);
  $('c-dominios').textContent = dominios.length;
  $('c-antigos').textContent = contagem.antigo;
  $('c-pouco').textContent = pouco;
  $('c-semdados').textContent = contagem.semdados;
  $('c-protegidos').textContent = dominios.filter((d) => protegidos.has(d.dominio)).length;

  const barra = $('barra');
  barra.replaceChildren();
  const totalDom = dominios.length || 1;
  for (const [b, cor] of [['ativo', 'var(--ok)'], ['ocioso', 'var(--morno)'], ['antigo', 'var(--frio)'], ['semdados', 'var(--morto)']]) {
    if (!contagem[b]) continue;
    const seg = document.createElement('div');
    seg.style.flexGrow = contagem[b];
    seg.style.background = cor;
    seg.style.color = b === 'semdados' ? '#fff' : '#14161b';
    const pct = Math.round(contagem[b] / totalDom * 100);
    seg.textContent = pct >= 7 ? String(contagem[b]) : '';
    seg.title = `${ROTULO_BUCKET[b]}: ${contagem[b]} domínios (${pct}%)`;
    barra.appendChild(seg);
  }

  const visiveis = dominios.filter((d) => {
    if (busca && !d.dominio.includes(busca)) return false;
    if (filtroUso !== 'todos' && usoDe(d) !== filtroUso) return false;
    if (filtroBucket === 'todos') return true;
    if (filtroBucket === 'protegido') return protegidos.has(d.dominio);
    if (filtroBucket === 'pouco') return usoDe(d) === 'raro';
    return d.bucket === filtroBucket;
  });

  const peso = { semdados: 0, antigo: 1, ocioso: 2, ativo: 3 };
  visiveis.sort((a, b) => {
    if (ordem === 'cookies') return b.total - a.total;
    if (ordem === 'nome') return a.dominio.localeCompare(b.dominio);
    if (ordem === 'antiguidade') return (a.primeira ?? Infinity) - (b.primeira ?? Infinity);
    if (ordem === 'menos-usado') {
      return visitasNaJanela(a) - visitasNaJanela(b) || diasNaJanela(a) - diasNaJanela(b);
    }
    return peso[a.bucket] - peso[b.bucket] || (b.diasSemVisita ?? 1e9) - (a.diasSemVisita ?? 1e9);
  });

  const pagina = visiveis.slice(0, limiteLinhas);
  const frag = document.createDocumentFragment();

  for (const d of pagina) {
    const prot = protegidos.has(d.dominio);
    const ativos = diasNaJanela(d);
    const vis = visitasNaJanela(d);
    const uso = usoDe(d);

    const tr = document.createElement('tr');
    if (prot) tr.className = 'protegido';

    const tdSel = document.createElement('td');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'sel';
    chk.dataset.dominio = d.dominio;
    chk.checked = selecionados.has(d.dominio);
    chk.disabled = prot;
    tdSel.appendChild(chk);

    const tdLock = document.createElement('td');
    const lock = document.createElement('button');
    lock.className = 'lock';
    lock.textContent = prot ? '🔒' : '🔓';
    lock.title = prot ? 'Protegido — clique para liberar' : 'Clique para proteger';
    lock.dataset.protege = d.dominio;
    tdLock.appendChild(lock);

    const tdDom = document.createElement('td');
    tdDom.className = 'dom';
    tdDom.textContent = d.dominio;
    if (!d.confiavel) {
      const alerta = document.createElement('span');
      alerta.className = 'incerto';
      alerta.textContent = ' ⚠';
      alerta.title = 'Medição incompleta: o histórico deste domínio tem mais páginas do que foi possível ler, ou a consulta falhou. Trate os números como piso.';
      tdDom.appendChild(alerta);
    }
    tdDom.title = 'Clique para ver os cookies';
    tdDom.dataset.expandir = d.dominio;

    const tdN = document.createElement('td');
    tdN.className = 'num';
    tdN.textContent = String(d.total);

    const tdPrimeira = document.createElement('td');
    if (d.primeira) {
      const r = document.createElement('div');
      r.textContent = rotuloVisita(d.primeira);
      const e = document.createElement('div');
      e.className = 'exato';
      e.textContent = dataHora(d.primeira);
      tdPrimeira.append(r, e);
      tdPrimeira.title = 'Primeira visita registrada no histórico.';
    } else {
      tdPrimeira.textContent = '—';
    }

    const tdUltima = document.createElement('td');
    if (d.ultima) {
      const r = document.createElement('div');
      r.textContent = rotuloVisita(d.ultima);
      const e = document.createElement('div');
      e.className = 'exato';
      e.textContent = dataHora(d.ultima);
      tdUltima.append(r, e);
      tdUltima.title = 'Última visita registrada no histórico.';
    } else {
      tdUltima.textContent = 'sem registro';
    }

    const tdUso = document.createElement('td');
    const cx = document.createElement('div');
    cx.className = 'uso-cel';
    const txt = document.createElement('span');
    txt.className = `uso-txt ${uso}`;
    txt.textContent = `${vis} visita${vis === 1 ? '' : 's'} · ${ativos} dia${ativos === 1 ? '' : 's'} · ${ROTULO_USO[uso]}`;
    const barraUso = document.createElement('div');
    barraUso.className = 'uso-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, Math.round(ativos / janela * 100))}%`;
    barraUso.appendChild(fill);
    cx.append(txt, barraUso);
    tdUso.title = `${vis} visitas em ${ativos} dia(s) distinto(s) dos últimos ${janela}.`;
    tdUso.appendChild(cx);

    const tdTag = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `tag ${d.bucket}`;
    tag.textContent = ROTULO_BUCKET[d.bucket];
    tdTag.appendChild(tag);

    tr.append(tdSel, tdLock, tdDom, tdN, tdPrimeira, tdUltima, tdUso, tdTag);
    frag.appendChild(tr);
  }

  if (visiveis.length > pagina.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.style.textAlign = 'center';
    const btn = document.createElement('button');
    btn.id = 'mais';
    btn.textContent = `Mostrar mais (${visiveis.length - pagina.length} restantes)`;
    td.appendChild(btn);
    tr.appendChild(td);
    frag.appendChild(tr);
  }

  $('corpo').replaceChildren(frag);
  $('vazio').hidden = visiveis.length > 0;
  $('visiveis').textContent = visiveis.length;
  atualizarSelecao();
}

function atualizarSelecao() {
  const cookies = dominios
    .filter((d) => selecionados.has(d.dominio))
    .reduce((s, d) => s + d.total, 0);
  $('selinfo').textContent = selecionados.size
    ? `${selecionados.size} domínios · ${cookies} cookies selecionados`
    : 'Nenhum domínio selecionado';
  $('deletar').disabled = selecionados.size === 0;
}

// ---------------------------------------------------------------- ações

async function guardarBackup(cookies) {
  const dados = { criado: new Date().toISOString(), cookies };
  const texto = JSON.stringify(dados, null, 2);

  const blob = new Blob([texto], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cookies-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);

  // O download pode ser bloqueado pelo navegador; a cópia local é a rede de segurança.
  // Acima do teto do storage ela não cabe — e isso precisa ser dito, senão a
  // pessoa acha que tem desfazer quando não tem.
  if (texto.length < 4_000_000) {
    try { await chrome.storage.local.set({ ultimoBackup: dados }); } catch { return false; }
    return true;
  }
  return false;
}

async function deletar() {
  const alvos = dominios.filter((d) => selecionados.has(d.dominio));
  if (!alvos.length) return;
  const cookies = alvos.flatMap((d) => d.cookies);

  const aviso = $('opt-backup').checked
    ? '\n\nO backup vai guardar o VALOR de cada cookie — suas sessões logadas. ' +
      'Ele cai em Downloads em texto puro: trate como arquivo de senha e apague depois.'
    : '';
  if (!confirm(`Deletar ${cookies.length} cookies de ${alvos.length} domínios?\n\nVocê será deslogado desses sites.${aviso}`)) return;

  $('deletar').disabled = true;
  try {
    let copiaInterna = true;
    if ($('opt-backup').checked) copiaInterna = await guardarBackup(cookies);

    let ok = 0, naoAchados = 0, falhas = 0;
    for (const c of cookies) {
      const alvo = { url: urlDoCookie(c), name: c.name, storeId: c.storeId };
      if (c.partitionKey) alvo.partitionKey = c.partitionKey;
      try {
        // remove() resolve mesmo quando não apaga nada: só conta o que voltou.
        const r = await chrome.cookies.remove(alvo);
        if (r) ok++; else naoAchados++;
      } catch { falhas++; }
    }

    if ($('opt-sitedata').checked) {
      // Origens vêm dos domínios reais dos cookies, não do domínio-base.
      const origens = [...new Set(cookies.flatMap((c) => {
        const h = c.domain.replace(/^\./, '');
        return [`https://${h}`, `http://${h}`];
      }))];
      try {
        await chrome.browsingData.remove(
          { origins: origens },
          { cacheStorage: true, indexedDB: true, localStorage: true, serviceWorkers: true, fileSystems: true }
        );
      } catch (e) {
        setStatus(`Cookies apagados, mas os dados de site falharam: ${e.message}`, 'erro');
      }
    }

    try {
      await chrome.storage.local.set({ ultimaLimpeza: { quando: Date.now(), cookies: ok, dominios: alvos.length } });
    } catch { /* histórico do popup é opcional */ }

    selecionados.clear();
    const extras = [
      naoAchados ? `${naoAchados} já não existiam` : '',
      falhas ? `${falhas} falharam` : ''
    ].filter(Boolean).join(', ');
    const semCopia = copiaInterna ? '' :
      ' ⚠️ O backup não coube dentro da extensão: "Desfazer última limpeza" não vai funcionar, só o arquivo baixado.';
    setStatus(`🧹 ${ok} cookies deletados de ${alvos.length} domínios${extras ? ` (${extras})` : ''}.${semCopia}`, semCopia ? 'erro' : 'ok');
    await analisar();
  } catch (e) {
    console.error(e);
    setStatus(`Falha ao deletar: ${e.message}`, 'erro');
    $('deletar').disabled = false;
  }
}

async function restaurarLista(lista) {
  let ok = 0, falhas = 0;
  const vistos = new Set();
  for (const c of lista) {
    const chave = chaveDoCookie(c);
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const det = {
      url: urlDoCookie(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      storeId: c.storeId
    };
    if (!c.hostOnly) det.domain = c.domain;
    if (c.sameSite && c.sameSite !== 'unspecified') det.sameSite = c.sameSite;
    if (!c.session && c.expirationDate) det.expirationDate = c.expirationDate;
    if (c.partitionKey) det.partitionKey = c.partitionKey;
    try { await chrome.cookies.set(det); ok++; } catch { falhas++; }
  }
  setStatus(
    `♻️ ${ok} cookies restaurados` +
    (falhas ? ` · ${falhas} não voltaram (expirados, ou a janela anônima de origem já fechou).` : '.'),
    'ok'
  );
  await analisar();
}

async function restaurarArquivo(arquivo) {
  let dados;
  try { dados = JSON.parse(await arquivo.text()); }
  catch { return setStatus('Arquivo de backup inválido.', 'erro'); }
  const lista = Array.isArray(dados) ? dados : dados.cookies;
  if (!Array.isArray(lista)) return setStatus('Backup sem lista de cookies.', 'erro');
  // Restaurar grava cookies de sessão em qualquer domínio: um arquivo de
  // origem desconhecida conseguiria te logar numa conta que não é sua.
  if (!confirm(
    `Restaurar ${lista.length} cookies de "${arquivo.name}"?\n\n` +
    'Só continue se este arquivo foi gerado por você nesta extensão. ' +
    'Um backup de outra pessoa implantaria as sessões dela no seu navegador.'
  )) return;
  await restaurarLista(lista);
}

async function apagarBackupGuardado() {
  try {
    const { ultimoBackup } = (await chrome.storage.local.get('ultimoBackup')) || {};
    if (!ultimoBackup) return setStatus('Não há backup guardado nesta extensão.');
    if (!confirm('Apagar o backup guardado dentro da extensão?\n\nVocê perde o "Desfazer última limpeza".')) return;
    await chrome.storage.local.remove('ultimoBackup');
    setStatus('Backup guardado apagado. As sessões que estavam nele não existem mais aqui.', 'ok');
  } catch {
    setStatus('Não foi possível apagar: recarregue a extensão em brave://extensions.', 'erro');
  }
}

async function restaurarUltimo() {
  let guardado = {};
  try { guardado = (await chrome.storage.local.get('ultimoBackup')) || {}; } catch { /* sem storage */ }
  const b = guardado.ultimoBackup;
  if (!b || !Array.isArray(b.cookies)) {
    return setStatus('Não há backup guardado nesta extensão. Use "Restaurar de arquivo…".', 'erro');
  }
  if (!confirm(`Restaurar ${b.cookies.length} cookies do backup de ${new Date(b.criado).toLocaleString('pt-BR')}?`)) return;
  await restaurarLista(b.cookies);
}

async function alternarProtecao(dominio) {
  if (protegidos.has(dominio)) {
    protegidos.delete(dominio);
  } else {
    protegidos.add(dominio);
    selecionados.delete(dominio);
  }
  try { await chrome.storage.local.set({ protegidos: [...protegidos] }); } catch { /* segue em memória */ }
  render();
}

function expandir(dominio, linha) {
  const proxima = linha.nextElementSibling;
  if (proxima && proxima.classList.contains('detalhe')) return proxima.remove();
  const d = dominios.find((x) => x.dominio === dominio);
  if (!d) return;
  const tr = document.createElement('tr');
  tr.className = 'detalhe';
  const td = document.createElement('td');
  td.colSpan = 8;
  const nomes = d.cookies
    .map((c) => `${c.name}${c.session ? ' (sessão)' : ''}${c.partitionKey ? ' (particionado)' : ''} → ${c.domain}${c.path}`)
    .sort();
  for (const n of nomes) {
    const code = document.createElement('code');
    code.textContent = n;
    td.append(code, document.createElement('br'));
  }
  tr.appendChild(td);
  linha.after(tr);
}

// ---------------------------------------------------------------- eventos

const reRender = () => { limiteLinhas = LINHAS_POR_PAGINA; render(); };
const visiveisAgora = () => {
  const busca = $('busca').value.trim().toLowerCase();
  const filtroUso = $('uso').value;
  return dominios.filter((d) => {
    if (protegidos.has(d.dominio)) return false;
    if (busca && !d.dominio.includes(busca)) return false;
    if (filtroUso !== 'todos' && usoDe(d) !== filtroUso) return false;
    if (filtroBucket === 'todos') return true;
    if (filtroBucket === 'protegido') return false;
    if (filtroBucket === 'pouco') return usoDe(d) === 'raro';
    return d.bucket === filtroBucket;
  });
};

$('reanalisar').addEventListener('click', analisar);
$('busca').addEventListener('input', reRender);
$('ordem').addEventListener('change', reRender);
$('uso').addEventListener('change', reRender);
$('janela').addEventListener('change', reRender);

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filtroBucket = chip.dataset.bucket;
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c === chip);
  reRender();
});

$('sel-visiveis').addEventListener('click', () => {
  for (const d of visiveisAgora()) selecionados.add(d.dominio);
  render();
});

$('sel-antigos').addEventListener('click', () => {
  for (const d of dominios) {
    if (!protegidos.has(d.dominio) && d.bucket === 'antigo') selecionados.add(d.dominio);
  }
  render();
});

$('sel-pouco').addEventListener('click', () => {
  for (const d of dominios) {
    if (!protegidos.has(d.dominio) && usoDe(d) === 'raro') selecionados.add(d.dominio);
  }
  render();
});

$('sel-nenhum').addEventListener('click', () => { selecionados.clear(); render(); });

$('corpo').addEventListener('click', (e) => {
  if (e.target.id === 'mais') {
    limiteLinhas += LINHAS_POR_PAGINA;
    return render();
  }
  const lock = e.target.closest('[data-protege]');
  if (lock) return alternarProtecao(lock.dataset.protege);
  const dom = e.target.closest('[data-expandir]');
  if (dom) expandir(dom.dataset.expandir, dom.parentElement);
});

$('corpo').addEventListener('change', (e) => {
  if (!e.target.classList.contains('sel')) return;
  if (e.target.checked) selecionados.add(e.target.dataset.dominio);
  else selecionados.delete(e.target.dataset.dominio);
  atualizarSelecao();
});

$('deletar').addEventListener('click', deletar);
$('restaurar-ultimo').addEventListener('click', restaurarUltimo);
$('apagar-backup').addEventListener('click', apagarBackupGuardado);
$('restaurar').addEventListener('click', () => $('arquivo').click());
$('arquivo').addEventListener('change', (e) => {
  if (e.target.files[0]) restaurarArquivo(e.target.files[0]);
  e.target.value = '';
});

analisar();
