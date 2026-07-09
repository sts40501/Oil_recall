// --- E-Recall System Logic Engine ---

document.addEventListener("DOMContentLoaded", () => {
  // Global App State
  const state = {
    recallList: [],
    downstreamVendors: [],
    proxyAlive: false,
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
  // Dynamic API Base URL detection
  const isLocalDirect = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const apiBase = (window.location.protocol === 'file:' || (isLocalDirect && window.location.port !== '8888'))
    ? 'http://localhost:3000/api'
    : '/api';

  const tabs = document.querySelectorAll(".nav-tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const proxyStatus = document.getElementById("proxy-status");
  const apiQueryForm = document.getElementById("api-query-form");
  const apiSubmitBtn = document.getElementById("api-submit-btn");
  
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
      const [recallRes, vendorRes] = await Promise.all([
        fetch('data/recall_list.json'),
        fetch('data/downstream_vendors.json')
      ]);
      
      state.recallList = await recallRes.json();
      state.downstreamVendors = await vendorRes.json();
      
      console.log(`Loaded ${state.recallList.length} recalls and ${state.downstreamVendors.length} vendors.`);
      
      // Populate filters and tables
      populateCityFilter();
      updateDBTable();
      renderFlowChart('315'); // default flow chart
    } catch (e) {
      console.error("Failed to load recall databases. Make sure they are copied to data/ directory.", e);
    }
  }

  // Check Proxy Health
  async function checkProxyHealth() {
    try {
      const res = await fetch(`${apiBase}/health`);
      const data = await res.json();
      if (data.status === "alive") {
        state.proxyAlive = true;
        proxyStatus.className = "connection-banner online";
        proxyStatus.querySelector(".status-text").innerText = "已連線至載具發票 API 代理服務 - API 功能可用";
        apiSubmitBtn.disabled = false;
      }
    } catch (e) {
      state.proxyAlive = false;
      proxyStatus.className = "connection-banner offline";
      proxyStatus.querySelector(".status-text").innerText = "未連線至載具發票 API 代理服務 - 方案 B 停用 (方案 A 仍可用)";
      apiSubmitBtn.disabled = true;
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

  // --- Fuzzy Check Recall Matcher ---
  // Returns match details if found in recallList or downstreamVendors
  function checkRecallStatus(productName) {
    if (!productName) return { status: 'safe' };
    
    const cleanName = productName.replace(/[\(\)\（\）\s]/g, "")
                                 .replace(/金馬|離|區|金/g, ""); // strip common prefixes
    
    if (cleanName.length < 2) return { status: 'safe' };

    // 1. Check against Pre-emptive Recall List
    for (const r of state.recallList) {
      const cleanRecall = r.prod_name.replace(/[\(\)\（\）\s]/g, "")
                                      .replace(/金馬|離|區|金/g, "");
      
      // Match if one contains the other (e.g. "雙蔬鮪魚飯糰" and "(金馬)雙蔬鮪魚飯糰" or "鮪魚飯糰")
      if (cleanName.includes(cleanRecall) || cleanRecall.includes(cleanName)) {
        return {
          status: 'danger',
          type: '預防性下架',
          vendor: r.vendor,
          city: r.city,
          info: `此為官方公告之預防性下架品項。有效日期批號：${r.expiry}`
        };
      }
    }

    // 2. Check against Downstream Vendors list (e.g., if user bought oil or ingredients from affected vendors)
    for (const v of state.downstreamVendors) {
      const cleanItem = v.item.replace(/[\(\)\（\）\s]/g, "");
      const cleanVendor = v.vendor.replace(/[\(\)\（\）\s]/g, "");
      
      if (cleanName.includes(cleanItem) || cleanItem.includes(cleanName) || cleanName.includes(cleanVendor)) {
        return {
          status: 'warning',
          type: '下游受影響業者產油/食品',
          vendor: v.vendor,
          city: v.city,
          info: `此品項購自或內含油脂大廠下游受檢業者「${v.vendor}」查核品項「${v.item}」，可能存在風險。批號/效期：${v.batch} (${v.expiry})`
        };
      }
    }

    return { status: 'safe' };
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

    // Process all products
    let dangerCount = 0;
    let warningCount = 0;
    analysisResultsBody.innerHTML = "";

    invoiceData.products.forEach(p => {
      const recall = checkRecallStatus(p.name);
      
      let statusBadge = `<span class="badge success">安全</span>`;
      let actionInfo = "未在食藥署回收/警告清單中檢出。";
      let manufacturer = "-";

      if (recall.status === 'danger') {
        dangerCount++;
        statusBadge = `<span class="badge danger">下架回收</span>`;
        actionInfo = recall.info;
        manufacturer = recall.vendor;
      } else if (recall.status === 'warning') {
        warningCount++;
        statusBadge = `<span class="badge warning">警示</span>`;
        actionInfo = recall.info;
        manufacturer = recall.vendor;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${p.name}</strong></td>
        <td>數量: ${p.qty || 1}</td>
        <td>${manufacturer}</td>
        <td>${statusBadge}</td>
        <td class="text-secondary" style="font-size: 0.8rem;">${actionInfo}</td>
      `;
      analysisResultsBody.appendChild(tr);
    });

    // Update Status summary banner
    statusBanner.className = "status-summary-banner";
    if (dangerCount > 0) {
      statusBanner.classList.add("alert-danger");
      statusBanner.innerHTML = `<i data-lucide="shield-x"></i> <span>發現 <strong>${dangerCount}</strong> 項商品名列公告回收下架清單！請立即停止食用，並保留商品與發票至購買門市辦理退貨！</span>`;
    } else if (warningCount > 0) {
      statusBanner.classList.add("alert-warning");
      statusBanner.innerHTML = `<i data-lucide="alert-triangle"></i> <span>有 <strong>${warningCount}</strong> 項商品屬於受影響下游品牌/原料大廠之產品，請謹慎確認批號並注意後續公告！</span>`;
    } else {
      statusBanner.classList.add("alert-success");
      statusBanner.innerHTML = `<i data-lucide="check-circle"></i> <span>安全無虞！此張發票所有產品未檢出任何回收或受影響業者項目。</span>`;
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
      handleCSVFile(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleCSVFile(e.target.files[0]);
    }
  });

  function handleCSVFile(file) {
    if (!file.name.endsWith(".csv")) {
      alert("請匯入副檔名為 .csv 的發票消費明細檔案！");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const csvText = event.target.result;
      parseCSVText(csvText, file.name);
    };
    reader.readAsText(file, "utf-8");
  }

  function parseCSVText(text, filename) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      alert("CSV 檔案內容為空！");
      return;
    }

    let headers = [];
    const products = [];
    
    // Find header index
    // MOF standard CSV columns usually contain "發票號碼", "品名", "明細品名" or "商品名稱"
    let nameIdx = -1;
    let qtyIdx = -1;
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cols = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
      const hasName = cols.findIndex(c => c.includes("品名") || c.includes("商品") || c.includes("名稱"));
      if (hasName !== -1) {
        headers = cols;
        nameIdx = hasName;
        qtyIdx = cols.findIndex(c => c.includes("數量") || c.includes("件數"));
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
        // skip common footer or header row duplicate
        if (prodName !== "品名" && prodName !== "商品名稱" && !prodName.startsWith("---")) {
          products.push({
            name: prodName,
            qty: qtyIdx !== -1 && cols[qtyIdx] ? cols[qtyIdx] : "1"
          });
        }
      }
    });

    displayResults({
      invNum: "CSV 檔案批次匯入",
      invDate: "依檔案明細為準",
      products,
      source: `匯入檔案: ${filename}`
    });
  }

  // --- API Proxy Submission Logic ---
  apiQueryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.proxyAlive) {
      alert("請確保您的本地 Node.js 代理伺服器已啟動！(指令: npm start)");
      return;
    }

    const cardNo = document.getElementById("cardNo").value;
    const cardEncrypt = document.getElementById("cardEncrypt").value;
    const startDate = document.getElementById("startDate").value.replace(/-/g, "/");
    const endDate = document.getElementById("endDate").value.replace(/-/g, "/");
    const appID = document.getElementById("appID").value;
    const apiKey = document.getElementById("apiKey").value;

    apiSubmitBtn.disabled = true;
    apiSubmitBtn.innerHTML = `<i data-lucide="refresh-cw" class="animate-spin"></i> 載入中...`;
    lucide.createIcons();

    try {
      // Step 1: Query Invoice Headers
      const headerRes = await fetch(`${apiBase}/carrierHeader`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardNo, cardEncrypt, startDate, endDate, appID, apiKey })
      });
      
      const headerData = await headerRes.json();
      if (headerData.code !== "200" || !headerData.details) {
        alert(`API 查詢錯誤: ${headerData.msg || "無法查詢表頭"}`);
        resetApiBtn();
        return;
      }

      const invoices = headerData.details;
      console.log(`Fetched ${invoices.length} invoices. Querying details...`);
      
      // Step 2: Fetch details for each invoice and extract product list
      const allProducts = [];
      
      for (const inv of invoices) {
        const detailRes = await fetch(`${apiBase}/carrierDetail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardNo,
            cardEncrypt,
            invNum: inv.invNum,
            invDate: inv.invDate,
            appID,
            apiKey
          })
        });
        
        const detailData = await detailRes.json();
        if (detailData.code === "200" && detailData.details) {
          detailData.details.forEach(item => {
            allProducts.push({
              name: item.description,
              qty: item.quantity,
              price: item.unitPrice,
              invNum: inv.invNum,
              invDate: inv.invDate
            });
          });
        }
      }

      displayResults({
        invNum: `載具發票批次明細`,
        invDate: `${startDate} ~ ${endDate}`,
        products: allProducts,
        source: `手機載具 ${cardNo} API 同步`
      });

    } catch (err) {
      console.error(err);
      alert("連線後端代理 API 時發生未預期錯誤，請檢查終端機輸出。");
    } finally {
      resetApiBtn();
    }
  });

  function resetApiBtn() {
    apiSubmitBtn.disabled = false;
    apiSubmitBtn.innerHTML = `<i data-lucide="refresh-cw"></i> 啟動 API 自動查詢與比對`;
    lucide.createIcons();
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

    // Filter Vendors
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
    const list = state.dbCurrentTab === 'recall' ? state.recallList : state.downstreamVendors;
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
    } else {
      dbTableHeaders.innerHTML = `
        <th>縣市</th>
        <th>下游業者</th>
        <th>使用查核品項</th>
        <th>受影響批號</th>
        <th>有效日期</th>
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
  checkProxyHealth();

  // Polling proxy server health every 15 seconds
  setInterval(checkProxyHealth, 15000);
});
