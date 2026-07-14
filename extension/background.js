let dataPromise;

async function getData() {
  if (!dataPromise) {
    dataPromise = Promise.all(['recall_list.json', 'downstream_vendors.json', 'taisun_downstream_20260712.json']
      .map((file) => fetch(chrome.runtime.getURL(`data/${file}`)).then((response) => response.json())));
  }
  const [recalls, vendors, latest] = await dataPromise;
  return { recalls, vendors, latest };
}

function normalize(value = '') { return value.toLowerCase().replace(/[\s()（）\-*]/g, ''); }

function matchPage(text, { recalls, vendors, latest }) {
  const page = normalize(text);
  const matches = [];
  const add = (level, source, vendor, item, detail) => {
    const key = `${source}:${vendor}:${item}`;
    if (!matches.some((match) => match.key === key)) matches.push({ key, level, source, vendor, item, detail });
  };
  recalls.forEach((record) => {
    const item = normalize(record.prod_name);
    if (item.length >= 3 && page.includes(item)) add('danger', '食藥署預防性下架', record.vendor, record.prod_name, record.expiry);
  });
  vendors.forEach((record) => {
    const vendor = normalize(record.vendor);
    if (vendor.length >= 3 && page.includes(vendor)) add('warning', '食藥署下游業者', record.vendor, record.item, `${record.batch || ''} ${record.expiry || ''}`.trim());
  });
  latest.forEach((record) => {
    const vendor = normalize(record.vendor);
    if (vendor.length >= 3 && page.includes(vendor)) add('warning', '泰山 7/12 公開流向', record.vendor, record.item, `${record.batch || ''} ${record.expiry || ''}`.trim());
  });
  return matches.slice(0, 100);
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.url?.startsWith('https://www.einvoice.nat.gov.tw/')) chrome.tabs.sendMessage(tab.id, { type: 'COMPARE_CURRENT_PAGE' });
  else chrome.tabs.create({ url: 'https://www.einvoice.nat.gov.tw/' });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'MATCH_VISIBLE_INVOICE_PAGE') return;
  getData().then((data) => sendResponse({ matches: matchPage(message.text, data) })).catch(() => sendResponse({ matches: [], error: '無法載入本機比對資料。' }));
  return true;
});
