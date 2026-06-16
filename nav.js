(function () {
  const NAV_ITEMS = [
    { href: 'index.html',      icon: '🏠', label: '홈' },
    { href: 'order-new.html',  icon: '➕', label: '주문' },
    { href: 'order-list.html', icon: '📋', label: '목록' },
    { href: 'customers.html',  icon: '👥', label: '고객' },
    { href: 'order-bulk.html', icon: '📥', label: '일괄' },
    { href: 'sms-queue.html',  icon: '💬', label: '문자' },
  ];

  const currentPage = location.pathname.split('/').pop() || 'index.html';

  const nav = document.createElement('nav');
  nav.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #fff; border-top: 1px solid #e5e7eb;
    display: flex; justify-content: space-around;
    padding: 10px 0; z-index: 100;
  `;

  nav.innerHTML = NAV_ITEMS.map(item => `
    <a href="${item.href}" style="
      text-decoration: none;
      color: ${currentPage === item.href ? '#2563eb' : '#6b7280'};
      font-size: 11px; font-weight: 600;
      display: flex; flex-direction: column;
      align-items: center; gap: 3px;
    ">
      <span style="font-size: 20px">${item.icon}</span>
      ${item.label}
    </a>
  `).join('');

  document.body.appendChild(nav);
})();