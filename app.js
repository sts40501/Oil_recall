// --- E-Recall System Logic Engine ---

document.addEventListener("DOMContentLoaded", () => {
  // Global App State
  const state = {
    recallList: [],
    downstreamVendors: [],
    taisunLatest: [],
    activeTab: 'carrier-tab',
    
    // Manual database browser pagination
    dbCurrentTab: 'recall', // 'recall' or 'vendor'
    dbCurrentPage: 1,
    dbPageSize: 10,
    dbFilteredData: [],
    
    // Current query results
    queryResults: null
  };

  // UI Elements
  const tabs = document.querySelectorAll(".nav-tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const dataUpdated = document.getElementById("data-updated");
  const recallCount = document.getElementById("recall-count");
  const vendorCount = document.getElementById("vendor-count");
  
  // CSV Dropzone
  const csvDropzone = document.getElementById("csv-dropzone");
  const csvFileInput = document.getElementById("csv-file-input");
  
  // QR scanner
  const startCameraBtn = document.getElementById("start-camera-btn");
  const stopCameraBtn = document.getElementById("stop-camera-btn");
  const scannerPlaceholder = document.getElementById("scanner-placeholder");
  let html5QrcodeScanner = null;

  // QR Text Paste
  const qrTextInput = document.getElementById("qr-text-input");
  const parseQrBtn = document.getElementById("parse-qr-btn");

  // Search
  const searchInput = document.getElementById("search-input");
  const filterDbType = document.getElementById("filter-db-type");
  const filterCity = document.getElementById("filter-city");
  const filterBrand = document.getElementById("filter-brand");

  // Flow Chart Container
  const flowTreeContainer = document.getElementById("flow-tree-container");
  const flowSelectBtns = document.querySelectorAll(".flow-select-btn");

  // Database Tab table elements
  const dbSubTabs = document.querySelectorAll(".db-tab");
  const dbTableHeaders = document.getElementById("db-table-headers");
  const dbTableBody = document.getElementById("db-table-body");
  const prevPageBtn = document.getElementById("prev-page-btn");
  const nextPageBtn = document.getElementById("next-page-btn");
  const pageIndicator = document.getElementById("page-indicator");

  // Results Panel
  const resultsPanel = document.getElementById("results-panel");
  const resultsMetadata = document.getElementById("results-metadata");
  const statusBanner = document.getElementById("status-banner");
  const invoiceDetailsCard = document.getElementById("invoice-details-card");
  const resInvNum = document.getElementById("res-inv-num");
  const resInvDate = document.getElementById("res-inv-date");
  const resInvSrc = document.getElementById("res-inv-src");
  const analysisResultsBody = document.getElementById("analysis-results-body");
  const clearResultsBtn = document.getElementById("clear-results-btn");

  // Initialize Lucide Icons
  lucide.createIcons();

  // Load JSON Databases
  async function loadDatabases() {
    try {
      const [recallRes, vendorRes, taisunRes] = await Promise.all([
        fetch('data/recall_list.json'),
        fetch('data/downstream_vendors.json'),
        fetch('data/taisun_downstream_20260712.json')
      ]);
      
      state.recallList = await recallRes.json();
      state.downstreamVendors = await vendorRes.json();
      state.taisunLatest = await taisunRes.json();
      recallCount.innerText = `${state.recallList.length} 項`;
      vendorCount.innerText = `${(state.downstreamVendors.length + state.taisunLatest.length).toLocaleString()} 筆`;
      dataUpdated.innerText = '食藥署 + 泰山 115/07/12 同步';
      
      console.log(`Loaded ${state.recallList.length} recalls, ${state.downstreamVendors.length} official vendors, and ${state.taisunLatest.length} latest Taisun routes.`);
      
      // Populate filters and tables
      populateCityFilter();
      updateDBTable();
      renderFlowChart('315'); // default flow chart
    } catch (e) {
      console.error("Failed to load recall databases. Make sure they are copied to data/ directory.", e);
    }
  }

  // --- Tab Navigation Logic ---
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(tc => tc.classList.remove("active"));
      
      tab.classList.add("active");
      const tabId = tab.getAttribute("data-tab");
      document.getElementById(tabId).classList.add("active");
      state.activeTab = tabId;

      // Stop camera if navigating away from scan tab
      if (tabId !== 'scan-tab' && html5QrcodeScanner) {
        stopCamera();
      }
    });
  });

  // --- E-Invoice QR Code Parsing Logic ---
  function parseInvoiceQRCode(text) {
    if (!text || text.trim() === "") return null;
    
    // Typical invoice QR code can be parsed
    // Match structure: 2 letters + 8 digits Invoice Number, then Date, then random code...
    // Look for separators like "**"
    const parts = text.split("**");
    if (parts.length < 2) {
      // Try parsing anyway if text contains colons
      if (text.includes(":")) {
        return parseProductsFromRaw(text);
      }
      return null;
    }

    const header = parts[0];
    const details = parts.slice(1).join("**");

    // Header extraction
    // Chars 0-10: Inv Num (e.g. AB12345678)
    // Chars 10-17: Date in ROC (e.g. 1050709)
    let invNum = "";
    let invDate = "";
    if (header.length >= 17) {
      invNum = header.substring(0, 10);
      const rocDate = header.substring(10, 17); // yyyMMdd
      
      const yearMatch = rocDate.match(/^(\d{3})(\d{2})(\d{2})$/);
      if (yearMatch) {
        const gregorianYear = parseInt(yearMatch[1]) + 1911;
        invDate = `${gregorianYear}/${yearMatch[2]}/${yearMatch[3]}`;
      } else {
        invDate = rocDate;
      }
    }

    const products = [];
    const detailParts = details.split(":");
    
    // Heuristic parsing: Products are separated by colons. 
    // Quantity and Price are digit-only fields. Chinese/word segments are products.
    for (let i = 0; i < detailParts.length; i++) {
      let item = detailParts[i].trim();
      if (item.length > 1 && !/^\d+$/.test(item)) {
        // Exclude system fields
        if (item !== "**" && !item.startsWith(":") && !item.includes("==")) {
          // If product name has trailing/leading **, clean it
          item = item.replace(/^\*\*|\*\*$/g, "");
          products.push({
            name: item,
            qty: detailParts[i+1] && /^\d+$/.test(detailParts[i+1]) ? detailParts[i+1] : "1",
            price: detailParts[i+2] && /^\d+$/.test(detailParts[i+2]) ? detailParts[i+2] : "0"
          });
        }
      }
    }

    return {
      invNum,
      invDate,
      products,
      source: "電子發票 QR Code 掃描"
    };
  }

  function parseProductsFromRaw(text) {
    // Try splitting raw string with colons
    const items = text.split(":");
    const products = [];
    for (let item of items) {
      item = item.trim().replace(/^\*\*|\*\*$/g, "");
      if (item.length > 1 && !/^\d+$/.test(item) && item !== "品名") {
        products.push({
          name: item,
          qty: "1",
          price: "0"
        });
      }
    }
    return {
      invNum: "手動輸入",
      invDate: "N/A",
      products,
      source: "手動輸入明細"
    };
  }

  // 品項是主要判斷依據；店家只用來縮小「熟食、麵包、沙拉油」等通用詞。
  // 單純店家出現在流向名單時，不應把該店的非相關商品標成警示。
  function checkRecallStatus(productName, sellerName = "") {
    return ERecallMatcher.checkRecallStatus(productName, sellerName, {
      recalls: state.recallList,
      downstream: state.downstreamVendors,
      latest: state.taisunLatest,
    });
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function formatInvoiceDate(value = "") {
    const raw = String(value).trim();
    if (!raw) return "未提供";
    const compactDate = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) return `${compactDate[1]}/${compactDate[2]}/${compactDate[3]}`;
    const separatedDate = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (separatedDate) return `${separatedDate[1]}/${separatedDate[2].padStart(2, '0')}/${separatedDate[3].padStart(2, '0')}`;
    return raw.split(/[ T]/)[0];
  }

  // --- Display Results Panel ---
  function displayResults(invoiceData) {
    if (!invoiceData || invoiceData.products.length === 0) {
      alert("無法從此發票解析出任何品名明細，請重新檢查發票格式！");
      return;
    }

    state.queryResults = invoiceData;
    resultsPanel.classList.remove("hidden");
    
    // Scroll to results panel
    resultsPanel.scrollIntoView({ behavior: 'smooth' });

    // Header metadata
    resultsMetadata.innerText = `來源: ${invoiceData.source} | 解析出 ${invoiceData.products.length} 項商品`;
    
    // Invoice Summary
    if (invoiceData.invNum && invoiceData.invNum !== "手動輸入") {
      invoiceDetailsCard.classList.remove("hidden");
      resInvNum.innerText = invoiceData.invNum;
      resInvDate.innerText = invoiceData.invDate;
      resInvSrc.innerText = invoiceData.source;
    } else {
      invoiceDetailsCard.classList.add("hidden");
    }

    // 先分析再排序：公告候選、流向候選、未命中，並保留同組原始順序。
    const statusPriority = { danger: 0, warning: 1, safe: 2 };
    const analyzedProducts = invoiceData.products
      .map((product, originalIndex) => ({
        product,
        originalIndex,
        recall: checkRecallStatus(product.name, product.sellerName),
      }))
      .sort((a, b) => (statusPriority[a.recall.status] ?? 2) - (statusPriority[b.recall.status] ?? 2) || a.originalIndex - b.originalIndex);
    const dangerCount = analyzedProducts.filter(item => item.recall.status === 'danger').length;
    const warningCount = analyzedProducts.filter(item => item.recall.status === 'warning').length;
    const matchedCount = dangerCount + warningCount;
    resultsMetadata.innerText = `來源：${invoiceData.source}｜共 ${invoiceData.products.length} 項｜${matchedCount ? `${matchedCount} 項候選已置頂` : '未命中公告品項'}`;
    analysisResultsBody.innerHTML = "";

    analyzedProducts.forEach(({ product: p, recall }) => {
      let statusBadge = `<span class="badge neutral">未命中清單</span>`;
      let actionInfo = "未比對到目前載入的公告品項；此結果不等同食品安全保證。";

      if (recall.status === 'danger') {
        statusBadge = `<span class="badge danger">公告品項相符</span>`;
        actionInfo = recall.info;
      } else if (recall.status === 'warning') {
        statusBadge = `<span class="badge warning">流向品項相符</span>`;
        actionInfo = recall.info;
      }

      const invoiceNumber = p.invoiceNumber || (invoiceData.invNum && !invoiceData.invNum.includes('批次') ? invoiceData.invNum : '未提供');
      const invoiceDate = formatInvoiceDate(p.invoiceDate || invoiceData.invDate);
      const tr = document.createElement("tr");
      tr.className = recall.status === 'safe' ? '' : `matched-row ${recall.status}`;
      tr.innerHTML = `
        <td data-label="比對結果">${statusBadge}</td>
        <td data-label="發票品名"><strong>${escapeHtml(p.name)}</strong></td>
        <td data-label="發票號碼"><code class="invoice-number">${escapeHtml(invoiceNumber)}</code></td>
        <td data-label="發票日期"><time>${escapeHtml(invoiceDate)}</time></td>
        <td data-label="購買店家">${escapeHtml(p.sellerName || '未提供')}</td>
        <td data-label="數量">${escapeHtml(p.qty || 1)}</td>
        <td data-label="判斷依據" class="result-reason">${escapeHtml(actionInfo)}</td>
      `;
      analysisResultsBody.appendChild(tr);
    });

    // Update Status summary banner
    statusBanner.className = "status-summary-banner";
    if (dangerCount > 0) {
      statusBanner.classList.add("alert-danger");
      statusBanner.innerHTML = `<i data-lucide="shield-alert"></i> <span><strong>${dangerCount}</strong> 項發票品名與公告品項相符。CSV 沒有商品效期／批號，請先核對包裝或公告，再決定是否退貨。</span>`;
    } else if (warningCount > 0) {
      statusBanner.classList.add("alert-warning");
      statusBanner.innerHTML = `<i data-lucide="scan-search"></i> <span><strong>${warningCount}</strong> 項發票品名與公開流向品項相符，需進一步核對品牌、規格與批號。</span>`;
    } else {
      statusBanner.classList.add("alert-success");
      statusBanner.innerHTML = `<i data-lucide="circle-check"></i> <span>目前未比對到公告品項。這表示「清單沒有命中」，不代表所有商品皆無食品安全風險。</span>`;
    }

    lucide.createIcons({ attrs: { class: 'banner-icon' } });
  }

  // Clear results button
  clearResultsBtn.addEventListener("click", () => {
    resultsPanel.classList.add("hidden");
    state.queryResults = null;
  });

  // --- CSV File Import Logic ---
  csvDropzone.addEventListener("click", () => csvFileInput.click());
  csvDropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      csvFileInput.click();
    }
  });

  csvDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    csvDropzone.classList.add("drag-over");
  });

  csvDropzone.addEventListener("dragleave", () => {
    csvDropzone.classList.remove("drag-over");
  });

  csvDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    csvDropzone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) {
      handleCSVFiles(e.dataTransfer.files);
    }
  });

  csvFileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleCSVFiles(e.target.files);
    }
  });

  function readCSVFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(parseCSVText(event.target.result, file.name, false));
      reader.onerror = () => reject(new Error(`無法讀取 ${file.name}`));
      reader.readAsText(file, "utf-8");
    });
  }

  async function handleCSVFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || files.some(file => !file.name.toLowerCase().endsWith(".csv"))) {
      alert("請只匯入副檔名為 .csv 的發票消費明細檔案！");
      return;
    }
    try {
      const parsedFiles = (await Promise.all(files.map(readCSVFile))).filter(Boolean);
      const products = parsedFiles.flatMap(result => result.products);
      if (!products.length) throw new Error("CSV 內沒有可解析的消費品名");
      displayResults({
        invNum: "CSV 檔案批次匯入",
        invDate: "依檔案明細為準",
        products,
        source: `本機匯入 ${files.length} 個 CSV（${products.length} 筆商品）`,
      });
      csvFileInput.value = "";
    } catch (error) {
      alert(`CSV 匯入失敗：${error.message}`);
    }
  }

  function parseCSVText(text, filename, shouldDisplay = true) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      if (shouldDisplay) alert("CSV 檔案內容為空！");
      return null;
    }

    let headers = [];
    const products = [];
    
    // Find header index
    // MOF standard CSV columns usually contain "發票號碼", "品名", "明細品名" or "商品名稱"
    let nameIdx = -1;
    let qtyIdx = -1;
    let sellerIdx = -1;
    let invoiceIdx = -1;
    let invoiceDateIdx = -1;
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cols = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
      let hasName = cols.findIndex(c => c.includes("品名") || c.includes("商品"));
      if (hasName === -1) {
        hasName = cols.findIndex(c => c.includes("名稱") && !c.includes("載具") && !c.includes("自訂"));
      }
      if (hasName !== -1) {
        headers = cols;
        nameIdx = hasName;
        qtyIdx = cols.findIndex(c => c.includes("數量") || c.includes("件數"));
        sellerIdx = cols.findIndex(c => c.includes("賣方名稱") || c.includes("公司") || c.includes("商店") || c.includes("店家") || c.includes("業者"));
        invoiceIdx = cols.findIndex(c => c.includes("發票號碼"));
        invoiceDateIdx = cols.findIndex(c => c.includes("發票日期") || c.includes("交易時間") || c.includes("開立時間"));
        // Remove prior index lines as metadata
        lines.splice(0, i + 1);
        break;
      }
    }

    // Default if not found
    if (nameIdx === -1) {
      nameIdx = 0; // fallback first column
    }

    lines.forEach(line => {
      const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/"/g, "").trim());
      if (cols.length > nameIdx && cols[nameIdx] !== "") {
        const prodName = cols[nameIdx];
        const sellerName = sellerIdx !== -1 && cols[sellerIdx] ? cols[sellerIdx] : "";
        // skip common footer or header row duplicate
        if (prodName !== "品名" && prodName !== "商品名稱" && !prodName.startsWith("---")) {
          products.push({
            name: prodName,
            qty: qtyIdx !== -1 && cols[qtyIdx] ? cols[qtyIdx] : "1",
            sellerName: sellerName,
            invoiceNumber: invoiceIdx !== -1 && cols[invoiceIdx] ? cols[invoiceIdx] : "",
            invoiceDate: invoiceDateIdx !== -1 && cols[invoiceDateIdx] ? cols[invoiceDateIdx] : "",
            sourceFile: filename,
          });
        }
      }
    });

    const result = {
      invNum: "CSV 檔案批次匯入",
      invDate: "依檔案明細為準",
      products,
      source: `匯入檔案: ${filename}`
    };
    if (shouldDisplay) displayResults(result);
    return result;
  }

  // --- Webcam Scan QR Code Scanner Logic ---
  startCameraBtn.addEventListener("click", () => {
    startCamera();
  });

  stopCameraBtn.addEventListener("click", () => {
    stopCamera();
  });

  function startCamera() {
    scannerPlaceholder.classList.add("hidden");
    startCameraBtn.classList.add("hidden");
    stopCameraBtn.classList.remove("hidden");

    html5QrcodeScanner = new Html5Qrcode("scanner-reader");
    html5QrcodeScanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      (qrCodeMessage) => {
        // Scanned successfully!
        console.log(`QR Code Scanned: ${qrCodeMessage}`);
        stopCamera();
        
        const parsed = parseInvoiceQRCode(qrCodeMessage);
        if (parsed) {
          displayResults(parsed);
        } else {
          // fallback raw parse
          const rawParsed = parseProductsFromRaw(qrCodeMessage);
          displayResults(rawParsed);
        }
      },
      (errorMessage) => {
        // scan error, silent
      }
    ).catch(err => {
      console.error(err);
      alert("無法存取相機，請檢查瀏覽器相機授權。");
      stopCamera();
    });
  }

  function stopCamera() {
    if (html5QrcodeScanner) {
      html5QrcodeScanner.stop().then(() => {
        html5QrcodeScanner = null;
        scannerPlaceholder.classList.remove("hidden");
        startCameraBtn.classList.remove("hidden");
        stopCameraBtn.classList.add("hidden");
      }).catch(err => {
        console.error(err);
      });
    }
  }

  // Paste text parse
  parseQrBtn.addEventListener("click", () => {
    const text = qrTextInput.value;
    const parsed = parseInvoiceQRCode(text);
    if (parsed) {
      displayResults(parsed);
    } else {
      const raw = parseProductsFromRaw(text);
      if (raw.products.length > 0) {
        displayResults(raw);
      } else {
        alert("無法識別輸入的 QR Code 發票字串！");
      }
    }
  });

  // --- Manual Search Filter Logic ---
  function populateCityFilter() {
    const cities = new Set();
    state.recallList.forEach(r => { if (r.city) cities.add(r.city); });
    state.downstreamVendors.forEach(v => { if (v.city) cities.add(v.city); });
    state.taisunLatest.forEach(v => { if (v.city) cities.add(v.city); });
    
    // Sort cities
    const sortedCities = Array.from(cities).sort();
    sortedCities.forEach(city => {
      const opt = document.createElement("option");
      opt.value = city;
      opt.innerText = city;
      filterCity.appendChild(opt);
    });
  }

  function runManualSearch() {
    const query = searchInput.value.toLowerCase().trim();
    const dbType = filterDbType.value;
    const city = filterCity.value;
    const brand = filterBrand.value;

    let results = [];

    // Filter Recalls
    if (dbType === 'all' || dbType === 'recall') {
      state.recallList.forEach(r => {
        const matchQuery = !query || r.prod_name.toLowerCase().includes(query) || r.vendor.toLowerCase().includes(query);
        const matchCity = city === 'all' || r.city === city;
        const matchBrand = brand === 'all' || r.vendor.includes(brand) || r.prod_name.includes(brand);
        
        if (matchQuery && matchCity && matchBrand) {
          results.push({
            type: '預防性下架',
            city: r.city,
            vendor: r.vendor,
            name: r.prod_name,
            detail: `產品編號: ${r.prod_no} | 有效期限/批號: ${r.expiry}`,
            status: 'danger'
          });
        }
      });
    }

    // Filter official downstream vendors
    if (dbType === 'all' || dbType === 'vendor') {
      state.downstreamVendors.forEach(v => {
        const matchQuery = !query || v.item.toLowerCase().includes(query) || v.vendor.toLowerCase().includes(query);
        const matchCity = city === 'all' || v.city === city;
        const matchBrand = brand === 'all' || v.vendor.includes(brand) || v.item.includes(brand);

        if (matchQuery && matchCity && matchBrand) {
          results.push({
            type: '下游受影響業者',
            city: v.city,
            vendor: v.vendor,
            name: v.item,
            detail: `業者序號: ${v.seq} | 批號: ${v.batch} | 有效日期: ${v.expiry}`,
            status: 'warning'
          });
        }
      });
    }

    // Filter latest Taisun downstream routes (published 2026/07/12)
    if (dbType === 'all' || dbType === 'taisun') {
      state.taisunLatest.forEach(v => {
        const matchQuery = !query || v.item.toLowerCase().includes(query) || v.vendor.toLowerCase().includes(query);
        const matchCity = city === 'all' || v.city === city;
        const matchBrand = brand === 'all' || v.vendor.includes(brand) || v.item.includes(brand);
        if (matchQuery && matchCity && matchBrand) {
          results.push({
            type: '泰山 7/12 公開流向', city: v.city, vendor: v.vendor, name: v.item,
            detail: `批號：${v.batch} | 有效日期：${v.expiry} | 公開流向附件 115/07/12`, status: 'warning'
          });
        }
      });
    }

    displaySearchResults(results);
  }

  // Trigger search on inputs change
  searchInput.addEventListener("input", runManualSearch);
  filterDbType.addEventListener("change", runManualSearch);
  filterCity.addEventListener("change", runManualSearch);
  filterBrand.addEventListener("change", runManualSearch);

  function displaySearchResults(results) {
    // We will render results in the global results panel (reusing it for consistency)
    if (results.length === 0) {
      resultsPanel.classList.add("hidden");
      return;
    }

    resultsPanel.classList.remove("hidden");
    invoiceDetailsCard.classList.add("hidden"); // hide invoice summaries
    resultsMetadata.innerText = `關鍵字篩選找到 ${results.length} 筆項目`;

    // Alert banner style
    statusBanner.className = "status-summary-banner alert-warning";
    statusBanner.innerHTML = `<i data-lucide="search"></i> <span>搜尋符合關鍵字的產品明細如下：</span>`;

    analysisResultsBody.innerHTML = "";
    results.forEach(r => {
      const badge = r.status === 'danger' ? 
        `<span class="badge danger">下架回收</span>` : 
        `<span class="badge warning">下游警示</span>`;
      
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${r.name}</strong></td>
        <td>-</td>
        <td>${r.vendor} (${r.city})</td>
        <td>${badge}</td>
        <td class="text-secondary" style="font-size: 0.8rem;">${r.detail}</td>
      `;
      analysisResultsBody.appendChild(tr);
    });

    lucide.createIcons();
    resultsPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // --- Dynamic Flow Chart Visualizer ---
  function renderFlowChart(caseId) {
    flowTreeContainer.innerHTML = "";

    let flowData = {};
    if (caseId === '315') {
      flowData = {
        title: "中聯油脂股份有限公司 (油槽 315)",
        desc: "原料：大豆沙拉油 約 1,300 公噸 (批號: 315-1150404)",
        refineries: [
          {
            name: "福壽實業股份有限公司",
            products: ["福壽大豆沙拉油 3L", "福壽大豆沙拉油 18L", "福壽健味香油 3L", "一級黃豆油"]
          },
          {
            name: "福懋油脂股份有限公司",
            products: ["一級黃豆油 (散裝)", "益康大豆沙拉油 18L", "益康烹調油 18L", "益康大豆沙拉油 18kg"]
          },
          {
            name: "泰山企業股份有限公司",
            products: ["金酥耐炸油", "沙拉油", "泰山不飽和大豆沙拉油", "泰山精選蔬菜油", "泰山大豆沙拉油", "泰山好理調合油", "泰山花生風味調和油"]
          }
        ]
      };
    } else {
      flowData = {
        title: "中聯油脂股份有限公司 (油槽 313)",
        desc: "原料：大豆沙拉油 約 1,309.52 公噸 (批號: 313-1150512)",
        refineries: [
          {
            name: "福壽實業股份有限公司",
            products: ["沙拉油 3L", "沙拉油 18kg", "沙拉油 18L", "胡麻油 18kg", "福壽炸酥油 18L", "健味香油 3L"]
          },
          {
            name: "福懋油脂股份有限公司",
            products: ["益康大豆沙拉油 18L", "益康大豆沙拉油 18kg", "一級黃豆油 (散裝)"]
          },
          {
            name: "泰山企業股份有限公司",
            products: ["泰山好理調合油 (超標)", "泰山花生風味調合油", "泰山不飽和調合油", "油炸專用油", "泰山料理油"]
          }
        ]
      };
    }

    // Build DOM elements for node trees
    // Level 1: Source
    const lvl1 = document.createElement("div");
    lvl1.className = "flow-level";
    lvl1.innerHTML = `
      <div class="flow-node source-node">
        <div class="node-title text-red">${flowData.title}</div>
        <div class="node-desc">${flowData.desc}</div>
      </div>
    `;
    flowTreeContainer.appendChild(lvl1);

    // Level 2: Refineries
    const lvl2 = document.createElement("div");
    lvl2.className = "flow-level";
    flowData.refineries.forEach(r => {
      const refNode = document.createElement("div");
      refNode.className = "flow-node refinery-node";
      refNode.innerHTML = `
        <div class="node-title text-orange">${r.name}</div>
        <div class="node-desc">產出產品 ${r.products.length} 項 (按以檢視)</div>
      `;
      
      // Click refinery node to automatically filter that brand's products
      refNode.addEventListener("click", () => {
        tabs[2].click(); // switch to search tab
        filterBrand.value = r.name.substring(2, 4); // set filter (e.g. 泰山, 福壽)
        runManualSearch();
      });

      lvl2.appendChild(refNode);
    });
    flowTreeContainer.appendChild(lvl2);
  }

  // Switch flow chart cases
  flowSelectBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      flowSelectBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderFlowChart(btn.getAttribute("data-flow"));
    });
  });

  // --- Database Table Paginated Rendering ---
  function updateDBTable() {
    const list = state.dbCurrentTab === 'recall' ? state.recallList : state.dbCurrentTab === 'taisun' ? state.taisunLatest : state.downstreamVendors;
    state.dbFilteredData = list;
    
    // Clear Headers
    dbTableHeaders.innerHTML = "";
    if (state.dbCurrentTab === 'recall') {
      dbTableHeaders.innerHTML = `
        <th>縣市</th>
        <th>下架製造商 / 銷售商</th>
        <th>產品名稱</th>
        <th>預定下架期限 / 批號</th>
      `;
    } else if (state.dbCurrentTab === 'vendor') {
      dbTableHeaders.innerHTML = `
        <th>縣市</th>
        <th>下游業者</th>
        <th>使用查核品項</th>
        <th>受影響批號</th>
        <th>有效日期</th>
      `;
    } else {
      dbTableHeaders.innerHTML = `
        <th>縣市</th><th>流向業者／門市</th><th>受影響品項</th><th>批號</th><th>有效日期</th>
      `;
    }

    renderTableRows();
  }

  function renderTableRows() {
    dbTableBody.innerHTML = "";
    const startIdx = (state.dbCurrentPage - 1) * state.dbPageSize;
    const endIdx = startIdx + state.dbPageSize;
    const pageData = state.dbFilteredData.slice(startIdx, endIdx);

    const totalPages = Math.ceil(state.dbFilteredData.length / state.dbPageSize) || 1;
    pageIndicator.innerText = `第 ${state.dbCurrentPage} / ${totalPages} 頁 (總計 ${state.dbFilteredData.length} 筆)`;

    pageData.forEach(r => {
      const tr = document.createElement("tr");
      if (state.dbCurrentTab === 'recall') {
        tr.innerHTML = `
          <td><span class="badge danger">${r.city}</span></td>
          <td><strong>${r.vendor}</strong></td>
          <td>${r.prod_name}</td>
          <td><span class="text-orange">${r.expiry}</span></td>
        `;
      } else {
        tr.innerHTML = `
          <td><span class="badge warning">${r.city}</span></td>
          <td><strong>${r.vendor}</strong></td>
          <td>${r.item}</td>
          <td><code class="text-secondary">${r.batch}</code></td>
          <td>${r.expiry}</td>
        `;
      }
      dbTableBody.appendChild(tr);
    });

    // Update buttons disabled status
    prevPageBtn.disabled = state.dbCurrentPage === 1;
    nextPageBtn.disabled = state.dbCurrentPage >= totalPages;
  }

  // Prev / Next Page
  prevPageBtn.addEventListener("click", () => {
    if (state.dbCurrentPage > 1) {
      state.dbCurrentPage--;
      renderTableRows();
    }
  });

  nextPageBtn.addEventListener("click", () => {
    const totalPages = Math.ceil(state.dbFilteredData.length / state.dbPageSize);
    if (state.dbCurrentPage < totalPages) {
      state.dbCurrentPage++;
      renderTableRows();
    }
  });

  // Database sub tabs switch
  dbSubTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      dbSubTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.dbCurrentTab = tab.getAttribute("data-db");
      state.dbCurrentPage = 1;
      updateDBTable();
    });
  });

  // Launch initial checks
  loadDatabases();
});
