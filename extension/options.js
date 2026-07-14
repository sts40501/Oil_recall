const form = document.getElementById('settings-form');
const originInput = document.getElementById('service-origin');
const status = document.getElementById('settings-status');

chrome.storage.local.get('serviceOrigin', ({ serviceOrigin }) => {
  originInput.value = serviceOrigin || '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let origin;
  try {
    origin = new URL(originInput.value).origin;
    if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') throw new Error();
  } catch (_) {
    status.textContent = '請填入 HTTPS 網址（本機測試可使用 localhost）。';
    return;
  }
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    status.textContent = '需要授權此網站，才能安全呼叫登入與查詢服務。';
    return;
  }
  await chrome.storage.local.set({ serviceOrigin: origin });
  await chrome.storage.session.remove(['identityToken', 'identityEmail']);
  status.textContent = '設定完成。請從工具列開啟 E-Recall 後登入。';
});
