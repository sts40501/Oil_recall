const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so the local frontend index.html can access the proxy
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to generate the signature required by the Ministry of Finance API
function generateSignature(params, apiKey) {
  // Sort parameters by key alphabetically
  const sortedKeys = Object.keys(params).sort();
  
  // Format as query-like string: key1=value1&key2=value2...
  const paramString = sortedKeys
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  // Sign using HMAC-SHA256 with the apiKey as secret
  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(paramString);
  return hmac.digest('base64');
}

// Helper to send HTTP requests
function makePostRequest(url, data) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(data);
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve({ code: "999", msg: "Invalid JSON response from server", raw: body });
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.write(postData);
    req.end();
  });
}

// 1. Endpoint: Fetch carrier invoice headers (發票表頭)
app.post('/api/carrierHeader', async (req, res) => {
  const { cardNo, cardEncrypt, startDate, endDate, appID, apiKey, uuid } = req.body;
  
  if (!cardNo || !cardEncrypt || !startDate || !endDate || !appID || !apiKey) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  
  const timeStamp = Math.floor(Date.now() / 1000) + 15; // API timestamp must be within a +/- 5 minute window
  const queryUuid = uuid || crypto.randomUUID().substring(0, 10);
  
  // Base parameters required for the API
  const params = {
    action: 'carrierInvHeader',
    appID: appID,
    cardEncrypt: cardEncrypt,
    cardNo: cardNo,
    cardType: '3G0001', // Phone barcode
    endDate: endDate,   // yyyy/MM/dd
    onlyActive: 'Y',
    pageNum: '1',
    pageSize: '500',
    startDate: startDate, // yyyy/MM/dd
    timeStamp: timeStamp,
    uuid: queryUuid,
    version: '0.5'
  };
  
  // Calculate signature
  params.signature = generateSignature(params, apiKey);
  
  const apiUrl = "https://api.einvoice.nat.gov.tw/PB2CAPIVAN/Carrier/Aggregate";
  
  try {
    const data = await makePostRequest(apiUrl, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to query MOF API", details: error.message });
  }
});

// 2. Endpoint: Fetch carrier invoice detail (發票明細)
app.post('/api/carrierDetail', async (req, res) => {
  const { cardNo, cardEncrypt, invNum, invDate, appID, apiKey, uuid } = req.body;
  
  if (!cardNo || !cardEncrypt || !invNum || !invDate || !appID || !apiKey) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  
  const timeStamp = Math.floor(Date.now() / 1000) + 15;
  const queryUuid = uuid || crypto.randomUUID().substring(0, 10);
  
  const params = {
    action: 'carrierInvDetail',
    appID: appID,
    cardEncrypt: cardEncrypt,
    cardNo: cardNo,
    cardType: '3G0001',
    invDate: invDate, // yyyy/MM/dd
    invNum: invNum,
    timeStamp: timeStamp,
    uuid: queryUuid,
    version: '0.5'
  };
  
  params.signature = generateSignature(params, apiKey);
  
  const apiUrl = "https://api.einvoice.nat.gov.tw/PB2CAPIVAN/Carrier/Detail";
  
  try {
    const data = await makePostRequest(apiUrl, params);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to query MOF API", details: error.message });
  }
});

// 3. Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: "alive" });
});

app.listen(PORT, () => {
  console.log(`E-invoice Proxy Server running on port ${PORT}`);
});
