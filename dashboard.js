// Cookie Janitor — painel.
// Cruza os cookies de todos os cookie stores com o histórico e mede duas coisas
// diferentes: QUANDO você visitou pela última vez e o QUANTO você usa.

const DIA = 24 * 60 * 60 * 1000;
const DIAS_DETALHE = 30;   // período varrido dia a dia, para medir frequência
const LIMITE_ATIVO = 30;
const LIMITE_OCIOSO = 90;
const LINHAS_POR_PAGINA = 300;
const TETO_BUSCA = 10000;
const TETO_DOMINIO = 300;

const TLDS_COMPOSTOS = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'blog.br',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.ar', 'com.mx', 'com.pt',
  'com.au', 'co.jp', 'co.kr', 'com.co', 'com.es', 'co.in'
]);

// Domínios que nunca vêm pré-marcados: perder esses cookies dá dor de cabeça.
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

function dominioBase(host) {
  host = String(host).replace(/^\./, '').toLowerCase();
  const p = host.split('.');
  if (p.length <= 2) return host;
  if (TLDS_COMPOSTOS.has(p.slice(-2).join('.'))) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

function bucketDe(diasSemVisita) {
  if (diasSemVisita === null) return 'morto';
  if (diasSemVisita <= LIMITE_ATIVO) return 'ativo';
  if (diasSemVisita <= LIMITE_OCIOSO) return 'ocioso';
  return 'antigo';
}

// Frequência = em quantos dias distintos da janela houve visita.
function classificarUso(diasAtivos, janela) {
  if (!diasAtivos) return 'nenhum';
  const frac = diasAtivos / janela;
  if (frac >= 0.5) return 'frequente';
  if (frac >= 1 / 6) return 'regular';
  return 'raro';
}

const ROTULO_USO = { frequente: 'frequente', regular: 'regular', raro: 'usei pouco', nenhum: 'nada na janela' };

function rotuloVisita(ultimaVisita, dias) {
  if (ultimaVisita === null) return 'nunca visitado';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) return `há ${Math.round(dias / 30)} meses`;
  return 'há mais de 1 ano';
}

function urlDoCookie(c) {
  return (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + (c.path || '/');
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

// Frequência: os últimos 30 dias, um dia por vez. Aparecer numa janela é prova de
// visita naquele dia — serve tanto para contar dias ativos quanto como piso de recência.
async function coletarFrequencia(aoProgredir) {
  const agora = Date.now();
  const reg = new Map();

  for (let i = 0; i < DIAS_DETALHE; i++) {
    if (aoProgredir) aoProgredir(`frequência — dia ${i + 1} de ${DIAS_DETALHE}`);
    await respirar();
    const fim = agora - i * DIA;

    let itens = [];
    try {
      itens = await chrome.history.search({
        text: '', startTime: fim - DIA, endTime: fim, maxResults: TETO_BUSCA
      });
    } catch { continue; }

    for (const item of itens) {
      let host;
      try { host = new URL(item.url).hostname; } catch { continue; }
      if (!host) continue;
      const d = dominioBase(host);
      let r = reg.get(d);
      if (!r) { r = { dias: new Set(), piso: 0 }; reg.set(d, r); }
      r.dias.add(i);
      if (fim - DIA > r.piso) r.piso = fim - DIA;
    }
  }
  return reg;
}

// Última visita EXATA. Consultando por domínio sem recorte de tempo, o lastVisitTime
// devolvido é a última visita real da página — sem janela, sem aproximação.
// (Sem `startTime` o Chrome assume só as últimas 24h; daí o startTime: 0.)
async function precisarUltimaVisita(lista, aoProgredir) {
  const out = new Map();
  let n = 0;

  for (const dominio of lista) {
    n++;
    if (n % 20 === 0) {
      if (aoProgredir) aoProgredir(`última visita — ${n} de ${lista.length} domínios`);
      await respirar();
    }

    let itens = [];
    try {
      itens = await chrome.history.search({ text: dominio, startTime: 0, maxResults: TETO_DOMINIO });
    } catch { /* segue com o piso da frequência */ }

    let ultima = 0, visitas = 0;
    for (const item of itens) {
      let host;
      try { host = new URL(item.url).hostname; } catch { continue; }
      if (dominioBase(host) !== dominio) continue;   // o texto casa com título também
      if (item.lastVisitTime > ultima) ultima = item.lastVisitTime;
      visitas += item.visitCount || 0;
    }
    out.set(dominio, { ultima, visitas });
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

    const aviso = (onde) => setStatus(`Lendo histórico: ${onde} — ${cookies.length} cookies lidos`);
    const freq = await coletarFrequencia(aviso);
    const exato = await precisarUltimaVisita([...porDominio.keys()], aviso);

    setStatus('Cruzando os dados…');
    await respirar();

    const agora = Date.now();
    dominios = [...porDominio].map(([dominio, cs]) => {
      const f = freq.get(dominio);
      const e = exato.get(dominio);
      const piso = f ? f.piso : 0;                       // rede de segurança
      const ms = Math.max(e ? e.ultima : 0, piso);
      const ultima = ms > 0 ? ms : null;
      const dias = ultima === null ? null : Math.max(0, Math.floor((agora - ultima) / DIA));
      const diasSet = f ? f.dias : new Set();
      return {
        dominio,
        cookies: cs,
        total: cs.length,
        ultima,
        aproximado: !!(ultima && (!e || !e.ultima)),     // veio só do piso diário
        dias,
        dias30: diasSet.size,
        dias7: [...diasSet].filter((i) => i < 7).length,
        visitas: e ? e.visitas : 0,
        bucket: bucketDe(dias)
      };
    });

    selecionados = new Set(
      dominios.filter((d) => d.bucket === 'morto' && !protegidos.has(d.dominio)).map((d) => d.dominio)
    );

    limiteLinhas = LINHAS_POR_PAGINA;
    render();

    if (!cookies.length) {
      setStatus('Nenhum cookie encontrado. Se isso parece errado, recarregue a extensão em brave://extensions.', 'erro');
    } else {
      setStatus(
        `${cookies.length} cookies em ${dominios.length} domínios. ` +
        `Os ${selecionados.size} sem nenhuma visita registrada já vêm marcados — revise antes de deletar.` +
        (precisaRecarregar
          ? ' ⚠️ Recarregue a extensão em brave://extensions para ativar a lista de protegidos salva e a limpeza de dados de site.'
          : ''),
        precisaRecarregar ? 'erro' : 'ok'
      );
    }
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
const usoDe = (d) => classificarUso(diasNaJanela(d), janelaAtual());

function render() {
  const busca = $('busca').value.trim().toLowerCase();
  const ordem = $('ordem').value;
  const filtroUso = $('uso').value;
  const janela = janelaAtual();

  const contagem = { ativo: 0, ocioso: 0, antigo: 0, morto: 0 };
  let cookiesRemoviveis = 0;
  let pouco = 0;
  for (const d of dominios) {
    contagem[d.bucket]++;
    if (!protegidos.has(d.dominio) && (d.bucket === 'morto' || d.bucket === 'antigo')) {
      cookiesRemoviveis += d.total;
    }
    if (usoDe(d) === 'raro') pouco++;
  }

  $('c-cookies').textContent = dominios.reduce((s, d) => s + d.total, 0);
  $('c-dominios').textContent = dominios.length;
  $('c-mortos').textContent = contagem.morto + contagem.antigo;
  $('c-pouco').textContent = pouco;
  $('c-recuperaveis').textContent = cookiesRemoviveis;
  $('c-protegidos').textContent = dominios.filter((d) => protegidos.has(d.dominio)).length;

  const barra = $('barra');
  barra.replaceChildren();
  const totalDom = dominios.length || 1;
  for (const [b, cor] of [['ativo', 'var(--ok)'], ['ocioso', 'var(--morno)'], ['antigo', 'var(--frio)'], ['morto', 'var(--morto)']]) {
    if (!contagem[b]) continue;
    const seg = document.createElement('div');
    seg.style.flexGrow = contagem[b];
    seg.style.background = cor;
    seg.style.color = b === 'morto' ? '#fff' : '#14161b';
    const pct = Math.round(contagem[b] / totalDom * 100);
    seg.textContent = pct >= 7 ? String(contagem[b]) : '';
    seg.title = `${b}: ${contagem[b]} domínios (${pct}%)`;
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

  const peso = { morto: 0, antigo: 1, ocioso: 2, ativo: 3 };
  visiveis.sort((a, b) => {
    if (ordem === 'cookies') return b.total - a.total;
    if (ordem === 'nome') return a.dominio.localeCompare(b.dominio);
    if (ordem === 'menos-usado') {
      return diasNaJanela(a) - diasNaJanela(b) || a.visitas - b.visitas || b.total - a.total;
    }
    return peso[a.bucket] - peso[b.bucket] || (b.dias ?? 1e9) - (a.dias ?? 1e9);
  });

  const pagina = visiveis.slice(0, limiteLinhas);
  const frag = document.createDocumentFragment();

  for (const d of pagina) {
    const prot = protegidos.has(d.dominio);
    const ativos = diasNaJanela(d);
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
    tdDom.title = 'Clique para ver os cookies';
    tdDom.dataset.expandir = d.dominio;

    const tdN = document.createElement('td');
    tdN.className = 'num';
    tdN.textContent = String(d.total);

    const tdVisita = document.createElement('td');
    const rel = document.createElement('div');
    rel.textContent = rotuloVisita(d.ultima, d.dias);
    tdVisita.appendChild(rel);
    if (d.ultima) {
      const exatoEl = document.createElement('div');
      exatoEl.className = 'exato';
      const quando = new Date(d.ultima).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      exatoEl.textContent = d.aproximado ? `~ ${quando}` : quando;
      exatoEl.title = d.aproximado
        ? 'Data aproximada: houve visita neste dia, mas o horário exato não foi encontrado.'
        : 'Data e hora exatas da última visita.';
      tdVisita.appendChild(exatoEl);
    }

    const tdUso = document.createElement('td');
    const cx = document.createElement('div');
    cx.className = 'uso-cel';
    const txt = document.createElement('span');
    txt.className = `uso-txt ${uso}`;
    txt.textContent = `${ativos}/${janela} dias · ${ROTULO_USO[uso]}`;
    const barraUso = document.createElement('div');
    barraUso.className = 'uso-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(ativos / janela * 100)}%`;
    barraUso.appendChild(fill);
    cx.append(txt, barraUso);
    tdUso.title = `Visitou em ${ativos} dia(s) distinto(s) dos últimos ${janela}.`;
    tdUso.appendChild(cx);

    const tdVisitas = document.createElement('td');
    tdVisitas.className = 'num';
    tdVisitas.textContent = d.visitas ? String(d.visitas) : '—';
    tdVisitas.title = 'Total de visitas registradas no histórico (todo o período).';

    const tdTag = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = `tag ${d.bucket}`;
    tag.textContent = { ativo: 'ativo', ocioso: 'ocioso', antigo: 'antigo', morto: 'nunca' }[d.bucket];
    tdTag.appendChild(tag);

    tr.append(tdSel, tdLock, tdDom, tdN, tdVisita, tdUso, tdVisitas, tdTag);
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

function baixarBackup(cookies) {
  const blob = new Blob([JSON.stringify({ criado: new Date().toISOString(), cookies }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cookies-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function deletar() {
  const alvos = dominios.filter((d) => selecionados.has(d.dominio));
  if (!alvos.length) return;
  const cookies = alvos.flatMap((d) => d.cookies);

  if (!confirm(`Deletar ${cookies.length} cookies de ${alvos.length} domínios?\n\nVocê será deslogado desses sites.`)) return;

  $('deletar').disabled = true;
  try {
    if ($('opt-backup').checked) baixarBackup(cookies);

    let ok = 0, falhas = 0;
    for (const c of cookies) {
      try {
        await chrome.cookies.remove({ url: urlDoCookie(c), name: c.name, storeId: c.storeId });
        ok++;
      } catch { falhas++; }
    }

    if ($('opt-sitedata').checked) {
      const origens = alvos.flatMap((d) => [`https://${d.dominio}`, `http://${d.dominio}`]);
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
    setStatus(`🧹 ${ok} cookies deletados de ${alvos.length} domínios${falhas ? ` (${falhas} falharam)` : ''}.`, 'ok');
    await analisar();
  } catch (e) {
    console.error(e);
    setStatus(`Falha ao deletar: ${e.message}`, 'erro');
    $('deletar').disabled = false;
  }
}

async function restaurar(arquivo) {
  let dados;
  try {
    dados = JSON.parse(await arquivo.text());
  } catch {
    return setStatus('Arquivo de backup inválido.', 'erro');
  }
  const lista = Array.isArray(dados) ? dados : dados.cookies;
  if (!Array.isArray(lista)) return setStatus('Backup sem lista de cookies.', 'erro');

  let ok = 0, falhas = 0;
  for (const c of lista) {
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
    try { await chrome.cookies.set(det); ok++; } catch { falhas++; }
  }
  setStatus(`♻️ ${ok} cookies restaurados${falhas ? ` (${falhas} falharam — provavelmente expirados)` : ''}.`, 'ok');
  await analisar();
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
    .map((c) => `${c.name}${c.session ? ' (sessão)' : ''} → ${c.domain}`)
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

$('sel-mortos').addEventListener('click', () => {
  for (const d of dominios) {
    if (!protegidos.has(d.dominio) && (d.bucket === 'morto' || d.bucket === 'antigo')) {
      selecionados.add(d.dominio);
    }
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
$('restaurar').addEventListener('click', () => $('arquivo').click());
$('arquivo').addEventListener('change', (e) => {
  if (e.target.files[0]) restaurar(e.target.files[0]);
  e.target.value = '';
});

analisar();
