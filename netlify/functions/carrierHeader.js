const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');
const { requireIdentityUser } = require('./identity');

function generateSignature(params, apiKey) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(paramString);
  return hmac.digest('base64');
}

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

exports.handler = async function(event, context) {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  // Handle preflight options request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  if (!await requireIdentityUser()) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Sign in is required before querying carrier invoices.' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { cardNo, cardEncrypt, startDate, endDate, uuid } = body;
    // Production requests must never carry an AppID/APIKey from a browser.
    const resolvedAppID = process.env.EINVOICE_APP_ID;
    const resolvedApiKey = process.env.EINVOICE_API_KEY;
    
    if (!cardNo || !cardEncrypt || !startDate || !endDate || !resolvedAppID || !resolvedApiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required parameters" })
      };
    }
    
    const timeStamp = Math.floor(Date.now() / 1000) + 15;
    const queryUuid = uuid || crypto.randomUUID().substring(0, 10);
    
    const params = {
      action: 'carrierInvChk',
      appID: resolvedAppID,
      cardEncrypt: cardEncrypt,
      cardNo: cardNo,
      cardType: '3J0002',
      endDate: endDate,
      expTimeStamp: '2147483647',
      onlyWinningInv: 'N',
      startDate: startDate,
      timeStamp: timeStamp,
      uuid: queryUuid,
      version: '0.5'
    };
    
    params.signature = generateSignature(params, resolvedApiKey);
    
    const apiUrl = "https://api.einvoice.nat.gov.tw/PB2CAPIVAN/invServ/InvServ";
    const data = await makePostRequest(apiUrl, params);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to query MOF API", details: error.message })
    };
  }
};
