function createPanel() {
  const panel = document.createElement('section');
  panel.id = 'erecall-panel';
  panel.innerHTML = '<button id="erecall-compare">E-Recall 比對目前頁面</button><div id="erecall-result" aria-live="polite"></div>';
  document.documentElement.appendChild(panel);
  panel.querySelector('#erecall-compare').addEventListener('click', compareCurrentPage);
  return panel;
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
});

createPanel();
