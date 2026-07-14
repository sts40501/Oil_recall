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

// 公開流向表常以總公司、店號或門市名稱記載；電子發票則通常是公司＋分公司。
// 先保留完整名稱的精準比對，再以品牌名稱給出「待確認」提示，避免誤判為商品命中。
function brandName(value = '') {
  return normalize(value
    .split(/[-－—]/)[0]
    .replace(/(股份有限公司|有限公司|有限合夥|分公司|門市|物流|店|公司)/g, ''));
}

function addVendorMatches(records, source, page, add) {
  const possibleByBrand = new Map();
  records.forEach((record) => {
    const vendor = normalize(record.vendor);
    const detail = `${record.batch || ''} ${record.expiry || ''}`.trim();
    if (vendor.length >= 3 && page.includes(vendor)) {
      add('warning', source, record.vendor, record.item, detail, 'exact');
      return;
    }

    const brand = brandName(record.vendor);
    if (brand.length >= 3 && page.includes(brand)) {
      if (!possibleByBrand.has(brand)) possibleByBrand.set(brand, []);
      possibleByBrand.get(brand).push({ record, detail });
    }
  });

  possibleByBrand.forEach((_candidates, brand) => {
    add('warning', `${source}（品牌比對）`, `${brand}（可能相符）`, '請再確認門市、品項與批號', '', 'brand');
  });
}

function matchPage(text, { recalls, vendors, latest }) {
  const page = normalize(text);
  const matches = [];
  const add = (level, source, vendor, item, detail, matchType = 'exact') => {
    const key = `${source}:${vendor}:${item}:${matchType}`;
    if (!matches.some((match) => match.key === key)) matches.push({ key, level, source, vendor, item, detail, matchType });
  };
  recalls.forEach((record) => {
    const item = normalize(record.prod_name);
    if (item.length >= 3 && page.includes(item)) add('danger', '食藥署預防性下架', record.vendor, record.prod_name, record.expiry);
  });
  addVendorMatches(vendors, '食藥署下游業者', page, add);
  addVendorMatches(latest, '泰山 7/12 公開流向', page, add);
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
