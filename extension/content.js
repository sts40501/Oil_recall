function createPanel() {
  const panel = document.createElement('section');
  panel.id = 'erecall-panel';
  panel.innerHTML = '<button id="erecall-export">下載所有頁 CSV</button><button id="erecall-compare" class="erecall-secondary">比對目前頁面</button><div id="erecall-result" aria-live="polite"></div>';
  document.documentElement.appendChild(panel);
  panel.querySelector('#erecall-export').addEventListener('click', startCsvExport);
  panel.querySelector('#erecall-compare').addEventListener('click', compareCurrentPage);
  return panel;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function status(message) {
  document.querySelector('#erecall-result').textContent = message;
}

function isVisible(element) {
  return Boolean(element && element.getClientRects().length && !element.disabled && element.getAttribute('aria-disabled') !== 'true');
}

function textOf(element) {
  return (element.textContent || element.value || '').replace(/\s/g, '');
}

function findPageSizeSelect() {
  return Array.from(document.querySelectorAll('select')).find((select) =>
    Array.from(select.options).some((option) => option.value === '100' || option.text.trim() === '100') &&
    Array.from(select.options).some((option) => option.value === '10' || option.text.trim() === '10'));
}

function findApplyButton(select) {
  const container = select.closest('div, li, td, th') || select.parentElement;
  return Array.from(container?.querySelectorAll('button, input[type="button"], input[type="submit"]') || [])
    .find((button) => isVisible(button));
}

function findPageSelect() {
  return Array.from(document.querySelectorAll('select')).find((select) => select !== findPageSizeSelect() && (() => {
    const values = Array.from(select.options).map((option) => Number(option.value || option.text));
    return values.length > 0 && values.every((value) => Number.isInteger(value) && value >= 1);
  })());
}

function findDownloadButton() {
  return Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
    .find((element) => element.getClientRects().length && textOf(element).includes('下載CSV檔'));
}

function findCsvSelectAll() {
  // 第一欄是「捐贈」選取；CSV 選取欄固定在表格最後一欄。
  // 只接受每個表頭列最後一個可見核取方塊，無法明確辨識時寧可停止。
  const candidates = Array.from(document.querySelectorAll('table tr'))
    .filter((row) => row.querySelector('th'))
    .flatMap((row) => {
      const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'))
        .filter((checkbox) => isVisible(checkbox));
      return checkboxes.length ? [checkboxes.at(-1)] : [];
    });
  return candidates.at(-1) || null;
}

function findNextPage() {
  return Array.from(document.querySelectorAll('a, button')).find((element) =>
    isVisible(element) && textOf(element).includes('下一頁') && !element.classList.contains('disabled'));
}

async function setPageSizeTo100() {
  const select = findPageSizeSelect();
  if (!select || select.value === '100') return;
  select.value = Array.from(select.options).find((option) => option.value === '100' || option.text.trim() === '100').value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const apply = findApplyButton(select);
  if (!apply) throw new Error('找不到「顯示筆數」的執行按鈕。');
  apply.click();
  await delay(1200);
}

async function waitForPageChange(oldPage) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(250);
    // 官方頁面換頁時會重繪下拉控制項，不能繼續讀取舊節點。
    if (findPageSelect()?.value !== oldPage) return true;
  }
  return false;
}

let exporting = false;
async function startCsvExport() {
  if (exporting) return;
  if (!findDownloadButton()) {
    status('尚未找到查詢結果。請在官方頁面完成登入、驗證與查詢後，擴充功能才會下載 CSV。');
    return;
  }

  exporting = true;
  try {
    await setPageSizeTo100();
    for (;;) {
      const pageSelect = findPageSelect();
      const currentPage = pageSelect?.value || '1';
      const maxPage = pageSelect ? Math.max(...Array.from(pageSelect.options).map((option) => Number(option.value || option.text))) : 1;
      const selectAll = findCsvSelectAll();
      const download = findDownloadButton();
      if (!selectAll || !download) throw new Error('找不到全選或下載 CSV 按鈕，可能是官方頁面版面已更新。');

      if (!selectAll.checked) selectAll.click();
      await delay(250);
      status(`正在下載第 ${currentPage}／${maxPage} 頁 CSV…`);
      download.click();
      await delay(1200);

      if (!pageSelect || Number(currentPage) >= maxPage) break;
      const next = findNextPage();
      if (!next) throw new Error('找不到下一頁按鈕，已停止後續下載。');
      next.click();
      if (!await waitForPageChange(currentPage)) throw new Error('切換下一頁逾時，已停止後續下載。');
    }
    status('CSV 下載完成。請將下載的檔案拖曳到 E-Recall 網站，檔案會只在你的瀏覽器本機解析。');
  } catch (error) {
    status(`CSV 下載未完成：${error.message}`);
  } finally {
    exporting = false;
    chrome.storage.session.remove('csvExportPending');
  }
}

function renderResult(response) {
  const output = document.querySelector('#erecall-result');
  if (response.error) { output.textContent = response.error; return; }
  if (!response.matches.length) { output.textContent = '目前頁面未比對到公告品項或業者。此結果不等同食品安全保證。'; return; }
  output.replaceChildren(...response.matches.map((match) => {
    const row = document.createElement('article');
    row.className = `erecall-match ${match.level}`;
    const qualifier = match.matchType === 'brand' ? '｜業者名稱可能相符，請確認門市、品項與批號' : '';
    row.textContent = `${match.source}｜${match.vendor}｜${match.item}${match.detail ? `｜${match.detail}` : ''}${qualifier}`;
    return row;
  }));
}

function compareCurrentPage() {
  const output = document.querySelector('#erecall-result');
  output.textContent = '正在本機比對目前頁面…';
  chrome.runtime.sendMessage({ type: 'MATCH_VISIBLE_INVOICE_PAGE', text: document.body.innerText }, renderResult);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'COMPARE_CURRENT_PAGE') compareCurrentPage();
  if (message.type === 'START_CSV_EXPORT') startCsvExport();
});

createPanel();

// 工具列圖示是使用者對此批次下載操作的明確授權。登入與圖形驗證仍完全由官方網站處理。
chrome.storage.session.get('csvExportPending').then(({ csvExportPending }) => {
  if (!csvExportPending) return;
  const beginWhenResultsAppear = () => {
    if (!findDownloadButton() || exporting) return false;
    startCsvExport();
    return true;
  };
  if (beginWhenResultsAppear()) return;
  const observer = new MutationObserver(() => {
    if (beginWhenResultsAppear()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
