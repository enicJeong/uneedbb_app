// ── 전화번호 포맷 ─────────────────────────────────────
function formatPhone(phone) {
  const d = (phone || '').replace(/[^0-9]/g, '');
  if (d.length < 8) return d;
  return d.slice(0, d.length - 8) + '-' + d.slice(d.length - 8, d.length - 4) + '-' + d.slice(d.length - 4);
}

// ── Toast ──────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── 상태 메시지 ────────────────────────────────────────
function setStatus(id, msg, isErr = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? '#dc2626' : '#6b7280';
}

// ── 선택된 고객 렌더 ───────────────────────────────────
function renderSelectedCustomer(divId, customer, onClear) {
  const div = document.getElementById(divId);
  div.style.display = '';
  div.innerHTML = `
    <div class="selected-customer">
      <div class="info">
        <div class="name">${customer.name}</div>
        <div class="phone">${customer.phone}</div>
        ${customer.memo ? `<div style="font-size:11px;color:#f59e0b;font-weight:600;margin-top:2px">📝 ${customer.memo}</div>` : ''}
      </div>
      <button class="btn-clear-x" id="${divId}-clear">✕</button>
    </div>`;
  document.getElementById(`${divId}-clear`).addEventListener('click', onClear);
}

// ── 신규 고객 인라인 폼 ────────────────────────────────
function showInlineForm(defaultVal, formWrapperId, onSaved) {
  const wrap = document.getElementById(formWrapperId);
  wrap.innerHTML = '';

  // 010으로 시작하거나 숫자만이면 전화번호로 판단
  const isPhone = /^01[0-9]/.test(defaultVal) || /^[0-9\-]+$/.test(defaultVal);
  const defaultName  = isPhone ? '' : defaultVal;
  const defaultPhone = isPhone ? defaultVal.replace(/[^0-9]/g, '') : '';

  const form = document.createElement('div');
  form.className = 'inline-form';
  form.innerHTML = `
    <div class="form-title">+ 신규 고객 등록</div>
    <label>이름</label>
    <input type="text" id="if-name" value="${defaultName}" placeholder="홍길동">
    <label>전화번호</label>
    <input type="text" id="if-phone" value="${defaultPhone}" placeholder="01012345678">
    <label>특이사항</label>
    <input type="text" id="if-memo" placeholder="선택사항">
    <div class="btn-row">
      <button class="btn-save" id="if-save">저장 후 선택</button>
      <button class="btn-cancel" id="if-cancel">취소</button>
    </div>`;
  wrap.appendChild(form);

  // 비어있는 칸에 포커스
  document.getElementById(defaultName ? 'if-phone' : 'if-name').focus();

  document.getElementById('if-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
  document.getElementById('if-save').addEventListener('click', async () => {
    const name = document.getElementById('if-name').value.trim();
    const phone = document.getElementById('if-phone').value.trim().replace(/[^0-9]/g, '');
    const memo = document.getElementById('if-memo').value.trim();
    if (!name || !phone) { showToast('이름과 전화번호를 입력하세요'); return; }
    const btn = document.getElementById('if-save');
    btn.disabled = true;
    btn.textContent = '저장 중...';
    const res = await fetch(`${BB_CONFIG.API}/api/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, memo })
    });
    const data = await res.json();
    if (data.id) {
      wrap.innerHTML = '';
      onSaved({ id: data.id, name, phone, memo });
      showToast('✅ 신규 고객 등록 완료');
    } else {
      showToast('오류: ' + (data.error || '알 수 없음'));
      btn.disabled = false;
      btn.textContent = '저장 후 선택';
    }
  });
}

// ── 고객 검색 ──────────────────────────────────────────
function setupSearch(inputId, searchBtnId, dropdownId, inlineFormId, onSelect) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(searchBtnId);
  const dropdown = document.getElementById(dropdownId);

  async function doSearch() {
    const q = input.value.trim();
    if (!q) return;
    const res = await fetch(`${BB_CONFIG.API}/api/customers?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    dropdown.innerHTML = '';

    if (!data.length) {
      const div = document.createElement('div');
      div.className = 'dropdown-item';
      div.style.color = '#2563eb';
      div.style.fontWeight = '700';
      div.innerHTML = `<div>+ "${q}" 신규 등록</div><div style="font-size:11px;color:#9ca3af;font-weight:400">아래 폼에서 입력하세요</div>`;
      div.addEventListener('click', () => {
        dropdown.style.display = 'none';
        if (inlineFormId) showInlineForm(q, inlineFormId, onSelect);
        input.value = '';
      });
      dropdown.appendChild(div);
    } else {
      data.forEach(c => {
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.innerHTML = `<div class="name">${c.name}</div><div class="phone">${c.phone}</div>`;
        div.addEventListener('click', () => {
          onSelect(c);
          dropdown.style.display = 'none';
          input.value = '';
        });
        dropdown.appendChild(div);
      });
    }
    dropdown.style.display = '';
  }

  btn.addEventListener('click', doSearch);
  let isComposing = false;
  let debounceTimer = null;
  input.addEventListener('compositionstart', () => { isComposing = true; });
  input.addEventListener('compositionend', () => {
    isComposing = false;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing) doSearch(); });
  input.addEventListener('input', () => {
    if (isComposing) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 400);
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

// ── 주소 렌더 ──────────────────────────────────────────
function renderAddresses(addresses, recentAddressId = null, onSelect) {
  const list = document.getElementById('address-list');
  list.innerHTML = '';
  if (!addresses.length) {
    list.innerHTML = '<div style="color:#9ca3af;font-size:13px;margin-bottom:8px">등록된 주소 없음</div>';
    if (onSelect) onSelect(null);
    return;
  }
  const autoSelectId = recentAddressId
    || addresses.find(a => a.is_default)?.id
    || addresses[0].id;
  if (onSelect) onSelect(autoSelectId);

  addresses.forEach(a => {
    const isSelected = a.id === autoSelectId;
    const tag = a.id === recentAddressId
      ? '<span style="font-size:11px;color:#2563eb;margin-left:6px">최근사용</span>'
      : a.is_default
        ? '<span style="font-size:11px;color:#9ca3af;margin-left:6px">기본</span>'
        : '';
    const div = document.createElement('div');
    div.className = 'addr-item' + (isSelected ? ' selected' : '');
    div.innerHTML = `<div><div class="addr-text">${a.address}${tag}</div><div class="addr-label">${a.label || ''}</div></div>`;
    div.addEventListener('click', () => {
      document.querySelectorAll('.addr-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      if (onSelect) onSelect(a.id);
    });
    list.appendChild(div);
  });
}

async function loadAddresses(customerId, onSelect) {
  const [detailRes, recentRes] = await Promise.all([
    fetch(`${BB_CONFIG.API}/api/customers/${customerId}`),
    fetch(`${BB_CONFIG.API}/api/customers/${customerId}/recent-address`)
  ]);
  const detail = await detailRes.json();
  const recent = await recentRes.json();
  renderAddresses(detail.addresses || [], recent?.id || null, onSelect);
}

// ── 상품 렌더 ──────────────────────────────────────────
function renderItems(items, onUpdate) {
  const tbody = document.getElementById('items-body');
  tbody.innerHTML = '';
  items.forEach((item, i) => {
    const opts = BB_CONFIG.PRODUCTS.map(p =>
      `<option value="${p.name}" data-price="${p.price}" ${p.name === item.product ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    const tr = document.createElement('tr');
    const productPresets = BB_CONFIG.PRODUCTS.map(p => {
      const c = p.color || { bg:'#f3f4f6', border:'#d1d5db', text:'#374151' };
      const isSelected = item.product === p.name;
      const bg     = isSelected ? c.bg     : '#fff';
      const border = isSelected ? c.border : '#e5e7eb';
      const color  = isSelected ? c.text   : '#6b7280';
      const fw     = isSelected ? '700'    : '500';
      return `<button class="product-preset" data-idx="${i}" data-name="${p.name}" data-price="${p.price}" style="padding:3px 10px;border:1px solid ${border};border-radius:4px;background:${bg};color:${color};font-size:11px;font-weight:${fw};cursor:pointer;white-space:nowrap;width:100%;text-align:left">${p.name}</button>`;
    }).join('');
    tr.innerHTML = `
      <td>
        <div style="display:flex;flex-direction:column;gap:3px">${productPresets}</div>
        <select class="item-product" data-idx="${i}" style="display:none">${opts}</select>
      </td>
      <td><input type="number" class="item-price" data-idx="${i}" value="${item.unit_price}" min="0" step="1000" style="width:90px"></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <button class="qty-btn qty-minus" data-idx="${i}" style="width:28px;height:28px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;font-size:16px;cursor:pointer;line-height:1">−</button>
          <input type="text" class="qty-display" data-idx="${i}" value="${item.qty_expr || item.qty}" style="width:64px;text-align:center;font-weight:700;font-size:14px;border:1px solid #d1d5db;border-radius:6px;padding:3px 4px">
          <button class="qty-btn qty-plus" data-idx="${i}" style="width:28px;height:28px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;font-size:16px;cursor:pointer;line-height:1">+</button>
          <div style="display:flex;flex-direction:column;gap:3px;margin-left:4px">
            ${[[1,2,3],[4,5,6],[7,8,9],[10]].map(row =>
              `<div style="display:flex;gap:3px">${row.map(n =>
                `<button class="qty-preset" data-idx="${i}" data-val="${n}" style="padding:4px 12px;border:1px solid ${item.qty===n?'#2563eb':'#e5e7eb'};border-radius:4px;background:${item.qty===n?'#eff6ff':'#fff'};color:${item.qty===n?'#2563eb':'#6b7280'};font-size:22px;font-weight:600;cursor:pointer">${n}</button>`
              ).join('')}</div>`
            ).join('')}
          </div>
        </div>
      </td>
      <td><button class="btn-del" data-idx="${i}">✕</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.product-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      items[i].product = btn.dataset.name;
      items[i].unit_price = +btn.dataset.price;
      renderItems(items, onUpdate);
      if (onUpdate) onUpdate(items);
    });
  });
  document.querySelectorAll('.item-product').forEach(sel => {
    sel.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      const opt = e.target.selectedOptions[0];
      items[i].product = opt.value;
      items[i].unit_price = +opt.dataset.price;
      renderItems(items, onUpdate);
      if (onUpdate) onUpdate(items);
    });
  });
  document.querySelectorAll('.item-price').forEach(inp => {
    inp.addEventListener('input', e => {
      items[+e.target.dataset.idx].unit_price = +e.target.value;
      if (onUpdate) onUpdate(items);
    });
  });
  function evalQty(expr) {
    const n = String(expr).replace(/[^0-9\*]/g, '');
    try { return Math.max(1, n.split('*').reduce((a, b) => a * (+b || 1), 1)); } catch { return 1; }
  }

  document.querySelectorAll('.qty-display').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.idx;
      const val = inp.value.trim();
      items[i].qty_expr = val;
      items[i].qty = evalQty(val);
      inp.value = val;
      if (onUpdate) onUpdate(items);
    });
    inp.addEventListener('click', e => e.stopPropagation());
  });
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      if (items[i].qty > 1) {
        items[i].qty--;
        items[i].qty_expr = String(items[i].qty);
        renderItems(items, onUpdate);
        if (onUpdate) onUpdate(items);
      }
    });
  });
  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      items[i].qty++;
      items[i].qty_expr = String(items[i].qty);
      renderItems(items, onUpdate);
      if (onUpdate) onUpdate(items);
    });
  });
  document.querySelectorAll('.qty-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      items[i].qty = +btn.dataset.val;
      items[i].qty_expr = btn.dataset.val;
      renderItems(items, onUpdate);
      if (onUpdate) onUpdate(items);
    });
  });
  document.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', e => {
      items.splice(+e.target.dataset.idx, 1);
      renderItems(items, onUpdate);
      if (onUpdate) onUpdate(items);
    });
  });
}

// ── 금액 계산 ──────────────────────────────────────────
function calcAmount(items, shippingFeeId = 'shipping-fee') {
  const sum = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const fee = +document.getElementById(shippingFeeId)?.value || 0;
  const sumEl = document.getElementById('sum-items');
  const totalEl = document.getElementById('sum-total');
  if (sumEl) sumEl.textContent = sum.toLocaleString() + '원';
  if (totalEl) totalEl.textContent = (sum + fee).toLocaleString() + '원';
  return { sum, fee, total: sum + fee };
}

function autoShipping(items, deliveryType, shippingFeeId = 'shipping-fee') {
  const feeEl = document.getElementById(shippingFeeId);
  if (!feeEl) return;
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
  const hasShipping = deliveryType === '택배' && totalQty < 4;
  feeEl.value = hasShipping ? 5000 : 0;
  const onBtn = document.getElementById('shipping-on');
  const offBtn = document.getElementById('shipping-off');
  if (onBtn && offBtn) {
    onBtn.classList.toggle('active', hasShipping);
    offBtn.classList.toggle('active', !hasShipping);
  }
  calcAmount(items, shippingFeeId);
}

// ── 주문번호 중복 체크 ─────────────────────────────────
function setupOrderNoCheck(inputId, msgId, excludeId = null) {
  let timer;
  const input = document.getElementById(inputId);
  const msg = document.getElementById(msgId);
  let valid = true;

  input.addEventListener('input', e => {
    clearTimeout(timer);
    const val = e.target.value.trim();
    msg.textContent = '';
    valid = false;
    if (!val) return;
    timer = setTimeout(async () => {
      const url = `${BB_CONFIG.API}/api/orders/check-no?order_no=${encodeURIComponent(val)}`
        + (excludeId ? `&exclude_id=${excludeId}` : '');
      const res = await fetch(url);
      const data = await res.json();
      if (data.exists) {
        msg.textContent = '⚠️ 이미 사용 중인 주문번호';
        msg.style.color = '#ef4444';
        valid = false;
      } else {
        msg.textContent = '✅ 사용 가능';
        msg.style.color = '#16a34a';
        valid = true;
      }
    }, 400);
  });

  return { isValid: () => valid, setValid: (v) => { valid = v; } };
}

async function fetchNextOrderNo(inputId) {
  const res = await fetch(`${BB_CONFIG.API}/api/orders/next-no`);
  const data = await res.json();
  const input = document.getElementById(inputId);
  if (input) input.value = data.order_no;
  return data.order_no;
}