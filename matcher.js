(function exposeMatcher(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ERecallMatcher = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const genericItems = new Set([
    '熟食', '麵包', '餐飲', '供門市餐飲用', '便當', '即食食品', '肉粽',
    '沙拉油', '一級黃豆油', '烹調使用', '員工餐廳', '沙拉醬', '香油',
    '大豆沙拉油', '烹調油', '調合油', '食品', '料理',
  ].map(normalizeProduct));

  function normalizeProduct(value = '') {
    return String(value).normalize('NFKC').toLowerCase()
      .replace(/[★☆◆●■•·・|｜\/\\,，.。:：;；_\-—~～()（）\[\]【】\s]/g, '');
  }

  function normalizeVendor(value = '') {
    return String(value).normalize('NFKC').toLowerCase()
      .replace(/\(股\)|股份有限公司|股份公司|有限公司|公司/g, '')
      .replace(/[\s()（）\-—,，.。\/\\]/g, '');
  }

  function isGenericItem(value = '') {
    const normalized = normalizeProduct(value);
    return genericItems.has(normalized) || normalized.length <= 3;
  }

  function vendorMatches(seller, listedVendor) {
    const a = normalizeVendor(seller);
    const b = normalizeVendor(listedVendor);
    if (!a || !b) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    return shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.8;
  }

  function specificProductMatches(product, listedItem) {
    const a = normalizeProduct(product);
    const b = normalizeProduct(listedItem);
    if (!a || !b || isGenericItem(b)) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    return shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.72;
  }

  function genericProductMatches(product, listedItem) {
    const a = normalizeProduct(product);
    const b = normalizeProduct(listedItem);
    return Boolean(a && b && (a === b || (b.length >= 2 && a.includes(b))));
  }

  function isAnonymizedVendor(vendor = '') {
    return /[○〇]/.test(vendor) || /(^|[^a-z])o([^a-z]|$)/i.test(vendor);
  }

  function makeResult(status, type, record, info) {
    return {
      status,
      type,
      vendor: record.vendor,
      city: record.city,
      matchedItem: record.prod_name || record.item,
      info,
    };
  }

  function checkRecallStatus(productName, sellerName = '', datasets = {}) {
    if (!normalizeProduct(productName)) return { status: 'safe' };
    const recalls = datasets.recalls || [];
    const downstream = datasets.downstream || [];
    const latest = datasets.latest || [];

    for (const record of recalls) {
      const generic = isGenericItem(record.prod_name);
      const itemMatch = generic
        ? genericProductMatches(productName, record.prod_name) && vendorMatches(sellerName, record.vendor)
        : specificProductMatches(productName, record.prod_name);
      if (itemMatch) {
        return makeResult(
          'danger',
          '公告品項相符',
          record,
          `發票品名與公告品項相符。公告有效日期／批號：${record.expiry || '請查閱公告'}。CSV 不含商品效期，請核對實物後再辦理退貨。`,
        );
      }
    }

    for (const record of downstream) {
      const generic = isGenericItem(record.item) || normalizeProduct(record.item).includes('沙拉油');
      const itemMatch = generic
        ? !isAnonymizedVendor(record.vendor) && vendorMatches(sellerName, record.vendor) && genericProductMatches(productName, record.item)
        : specificProductMatches(productName, record.item);
      if (itemMatch) {
        return makeResult(
          'warning',
          '流向品項相符',
          record,
          `發票品名與下游流向品項相符。公告品項：${record.item}；批號／效期：${record.batch || '未提供'}／${record.expiry || '未提供'}。請核對實物。`,
        );
      }
    }

    for (const record of latest) {
      const generic = isGenericItem(record.item) || /沙拉油|調合油/.test(normalizeProduct(record.item));
      const itemMatch = generic
        ? vendorMatches(sellerName, record.vendor) && genericProductMatches(productName, record.item)
        : specificProductMatches(productName, record.item);
      if (itemMatch) {
        return makeResult(
          'warning',
          '泰山流向品項相符',
          record,
          `發票品名與泰山公開流向品項相符。公告品項：${record.item}；批號／效期：${record.batch || '未提供'}／${record.expiry || '未提供'}。請核對實物。`,
        );
      }
    }

    return { status: 'safe' };
  }

  return {
    checkRecallStatus,
    isGenericItem,
    normalizeProduct,
    normalizeVendor,
    specificProductMatches,
    vendorMatches,
  };
}));
