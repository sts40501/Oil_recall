document.getElementById('open-official').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.einvoice.nat.gov.tw/portal/btc/mobile/btc502w' });
});
