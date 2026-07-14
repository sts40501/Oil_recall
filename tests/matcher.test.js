const assert = require('node:assert/strict');
const matcher = require('../matcher.js');
const recalls = require('../data/recall_list.json');
const downstream = require('../data/downstream_vendors.json');
const latest = require('../data/taisun_downstream_20260712.json');

const datasets = { recalls, downstream, latest };
const check = (product, seller) => matcher.checkRecallStatus(product, seller, datasets);

assert.equal(check('熟食', '冠樺生活股份有限公司').status, 'safe', '通用熟食不可跨店家命中');
assert.equal(check('熟食', '大買家股份有限公司大里國光分公司').status, 'danger', '通用品名與公告店家同時相符時應提示');
assert.equal(check('LG 雙變頻除濕機 16', '好市多股份有限公司').status, 'safe', '店家流向不可污染非食品商品');
assert.equal(check('起司貝果麵包8CT', '好市多股份有限公司汐止分公司').status, 'safe', '通用麵包不可跨店家命中');
assert.equal(check('★統一麵包鹽奶油厚菠蘿', '統一超商股份有限公司臺北市第１６１分公司').status, 'safe', '通用麵包不可只靠子字串命中');
assert.equal(check('餐飲', '愛家人事業股份有限公司').status, 'safe', '餐飲通用詞不可跨品牌命中');
assert.equal(check('阜杭豆漿-里肌肉蛋紫米飯糰', '統一超商股份有限公司台北市第七三六分公司').status, 'danger', '明確完整品名應保留候選');
assert.notEqual(check('泰山優選大豆沙拉油-5L*4', '好市多股份有限公司物流分公司').status, 'safe', '明確流向油品應提示核對');

console.log('matcher regression tests passed');
