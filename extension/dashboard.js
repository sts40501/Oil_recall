const $ = (id) => document.getElementById(id);
const views = ['setup-view', 'login-view', 'query-view', 'results-view'];
let records = { recalls: [], vendors: [], latest: [] };

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function setStatus(id, message) { $(id).textContent = message; }
function openSettings() { chrome.runtime.openOptionsPage(); }
document.querySelectorAll('.open-settings').forEach((button) => button.addEventListener('click', openSettings));
$('open-settings').addEventListener('click', openSettings);

async function getConfig() { return chrome.storage.local.get('serviceOrigin'); }
async function getSession() { return chrome.storage.session.get(['identityToken', 'identityEmail']); }
async function loadRecords() {
  const [recalls, vendors, latest] = await Promise.all([
    fetch(chrome.runtime.getURL('data/recall_list.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/downstream_vendors.json')).then((r) => r.json()),
    fetch(chrome.runtime.getURL('data/taisun_downstream_20260712.json')).then((r) => r.json())
  ]);
  records = { recalls, vendors, latest };
}

async function initialise() {
  await loadRecords();
  const { serviceOrigin } = await getConfig();
  const { identityToken, identityEmail } = await getSession();
  if (!serviceOrigin) return show('setup-view');
  if (!identityToken) return show('login-view');
  $('signed-in-as').textContent = `已登入：${identityEmail || 'E-Recall 使用者'}`;
  show('query-view');
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { serviceOrigin } = await getConfig();
  setStatus('login-status', '登入中…');
  try {
    const payload = new URLSearchParams({ grant_type: 'password', username: $('email').value, password: $('password').value });
    const response = await fetch(`${serviceOrigin}/.netlify/identity/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: payload });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(data.msg || '帳號或密碼錯誤，或尚未完成信箱驗證。');
    await chrome.storage.session.set({ identityToken: data.access_token, identityEmail: data.email || $('email').value });
    hide('login-view');
    $('signed-in-as').textContent = `已登入：${data.email || $('email').value}`;
    show('query-view');
  } catch (error) { setStatus('login-status', error.message); }
});

$('logout').addEventListener('click', async () => { await chrome.storage.session.remove(['identityToken', 'identityEmail']); hide('query-view'); hide('results-view'); show('login-view'); });

function normalize(value = '') { return value.toLowerCase().replace(/[\s()（）\-*]/g, ''); }
function findMatch(name, seller = '') {
  const product = normalize(name); const shop = normalize(seller);
  const recall = records.recalls.find((r) => product.includes(normalize(r.prod_name)) || normalize(r.prod_name).includes(product));
  if (recall) return { level: 'danger', text: `食藥署預防性下架：${recall.vendor}｜${recall.prod_name}｜${recall.expiry}` };
  const latest = records.latest.find((r) => shop && (shop.includes(normalize(r.vendor)) || normalize(r.vendor).includes(shop)));
  if (latest) return { level: 'warning', text: `泰山 7/12 流向：${latest.vendor}｜${latest.item}｜批號 ${latest.batch}` };
  return { level: 'safe', text: '未比對到公告品項或店家；不等同食品安全保證。' };
}

async function api(path, body) {
  const [{ serviceOrigin }, { identityToken }] = await Promise.all([getConfig(), getSession()]);
  const response = await fetch(`${serviceOrigin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}` }, body: JSON.stringify(body) });
  const data = await response.json();
  if (response.status === 401) { await chrome.storage.session.remove(['identityToken', 'identityEmail']); throw new Error('登入已過期，請重新登入。'); }
  if (!response.ok || data.code && data.code !== '200') throw new Error(data.msg || data.error || '載具查詢失敗。');
  return data;
}

$('query-form').addEventListener('submit', async (event) => {
  event.preventDefault(); hide('results-view');
  const cardNo = $('card-no').value.trim(); const cardEncrypt = $('card-encrypt').value; const startDate = $('start-date').value.replaceAll('-', '/'); const endDate = $('end-date').value.replaceAll('-', '/');
  if (startDate.slice(0, 7) !== endDate.slice(0, 7)) return setStatus('query-status', '財政部 API 限制每次僅能查詢同一月份。');
  setStatus('query-status', '讀取發票表頭…');
  try {
    const header = await api('/api/carrierHeader', { cardNo, cardEncrypt, startDate, endDate });
    const invoices = header.details || [];
    const products = [];
    for (let i = 0; i < invoices.length; i += 1) {
      setStatus('query-status', `讀取明細 ${i + 1}/${invoices.length}…`);
      const invoice = invoices[i];
      const detail = await api('/api/carrierDetail', { cardNo, cardEncrypt, invNum: invoice.invNum, invDate: invoice.invDate });
      (detail.details || []).forEach((item) => products.push({ name: item.description, seller: invoice.sellerName || '' }));
    }
    $('card-encrypt').value = '';
    $('result-summary').textContent = `已在本機比對 ${products.length} 項發票明細。`;
    $('result-list').replaceChildren(...products.map((product) => { const match = findMatch(product.name, product.seller); const el = document.createElement('article'); el.className = `result ${match.level}`; el.innerHTML = `<strong>${product.name}</strong><p>${match.text}</p>`; return el; }));
    setStatus('query-status', `完成，共 ${invoices.length} 張發票。`); show('results-view');
  } catch (error) { setStatus('query-status', error.message); }
});

const today = new Date();
$('start-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
$('end-date').value = today.toISOString().slice(0, 10);
initialise();
