document.getElementById('abrir').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});

chrome.storage.local.get('ultimaLimpeza').then(({ ultimaLimpeza }) => {
  if (!ultimaLimpeza) return;
  const dias = Math.floor((Date.now() - ultimaLimpeza.quando) / 86400000);
  const quando = dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`;
  document.getElementById('ultima').textContent =
    `Última faxina ${quando}: ${ultimaLimpeza.cookies} cookies de ${ultimaLimpeza.dominios} domínios.`;
});
