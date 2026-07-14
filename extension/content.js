function createPanel() {
  const panel = document.createElement('section');
  panel.id = 'erecall-panel';
  panel.innerHTML = '<button id="erecall-export">下載所有頁 CSV</button><button id="erecall-open-csv" class="erecall-secondary">前往比對 CSV 檔案</button><div id="erecall-result" aria-live="polite">已就緒：尚未開始下載。</div>';
  document.documentElement.appendChild(panel);
  panel.querySelector('#erecall-export').addEventListener('click', startCsvExport);
  panel.querySelector('#erecall-open-csv').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_CSV_COMPARISON_SITE' }));
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
  let downloadedPages = 0;
  try {
    status('正在設定每頁 100 筆…');
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
      downloadedPages += 1;
      await delay(1200);

      const refreshedPageSelect = findPageSelect();
      const refreshedMaxPage = refreshedPageSelect ? Math.max(...Array.from(refreshedPageSelect.options).map((option) => Number(option.value || option.text))) : 1;
      if (!refreshedPageSelect || Number(currentPage) >= refreshedMaxPage) break;
      const next = findNextPage();
      if (!next) throw new Error('找不到下一頁按鈕，已停止後續下載。');
      next.click();
      if (!await waitForPageChange(currentPage)) throw new Error('切換下一頁逾時，已停止後續下載。');
    }
    status(`CSV 下載完成：共 ${downloadedPages} 頁。點擊「前往比對 CSV 檔案」在網站本機判讀。`);
  } catch (error) {
    status(`CSV 批次下載暫停：已下載 ${downloadedPages} 頁。${error.message}`);
  } finally {
    exporting = false;
    chrome.storage.session.remove('csvExportPending');
  }
}

chrome.runtime.onMessage.addListener((message) => {
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
