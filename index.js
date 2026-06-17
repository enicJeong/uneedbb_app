const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function normalizePhone(phone) {
  return (phone || '').replace(/[^0-9]/g, '');
}

// 주문번호 자동채번: 26주문-000
async function generateOrderNo(db) {
  const yy = String(new Date().getFullYear()).slice(2);
  const prefix = `${yy}주문-`;
  const row = await db.prepare(
    `SELECT order_no FROM orders
     WHERE order_no LIKE ?
     ORDER BY CAST(SUBSTR(order_no, LENGTH(?) + 1) AS INTEGER) DESC LIMIT 1`
  ).bind(`${prefix}%`, prefix).first();

  let next = 1;
  if (row?.order_no) {
    const last = parseInt(row.order_no.split('-')[1], 10);
    if (!isNaN(last)) next = last + 1;
  }
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// 배송완료 SMS 등록
async function insertDeliverySms(db, orderId) {
  const order = await db.prepare(`
    SELECT o.*,
      c.name AS orderer_name, c.phone AS orderer_phone, c.memo AS orderer_memo,
      r.name AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo
    FROM orders o
    LEFT JOIN customers c ON o.orderer_id = c.id
    LEFT JOIN customers r ON o.recipient_id = r.id
    WHERE o.id = ?
  `).bind(orderId).first();
  if (!order) return;

  const items = await db.prepare(
    `SELECT SUM(qty) AS total_qty FROM order_items WHERE order_id = ?`
  ).bind(orderId).first();
  const qty = items?.total_qty || 0;

  const recipientName  = order.recipient_name  || order.orderer_name;
  const recipientPhone = order.recipient_phone || order.orderer_phone;
  const trackingNo     = order.tracking_no || '';

  // 발송일 포맷: 6월 16일(화)
  const now = new Date();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const dayNames = ['일','월','화','수','목','금','토'];
  const dayName  = dayNames[now.getDay()];
  const dateStr  = `${month}월 ${day}일(${dayName})`;

  const makeMsg = (name) =>
    `[블루베리아침농원]\n<${order.orderer_name}>님이 주문하신 블루베리 ${qty}Kg 가\n<${name}>님께 ${dateStr} 저녁 택배로 발송하였습니다.\n로젠택배 [${trackingNo}]`;

  const sameRecipient = recipientPhone === order.orderer_phone;

  if (sameRecipient) {
    // 수신자 = 주문자 → 1건
    await db.prepare(
      `INSERT INTO sms_queue (order_id, customer_id, phone, message) VALUES (?, ?, ?, ?)`
    ).bind(orderId, order.orderer_id, order.orderer_phone, makeMsg(recipientName)).run();
  } else {
    // 주문자에게 1건
    await db.prepare(
      `INSERT INTO sms_queue (order_id, customer_id, phone, message) VALUES (?, ?, ?, ?)`
    ).bind(orderId, order.orderer_id, order.orderer_phone, makeMsg(recipientName)).run();
    // 수령자에게 1건
    await db.prepare(
      `INSERT INTO sms_queue (order_id, customer_id, phone, message) VALUES (?, ?, ?, ?)`
    ).bind(orderId, order.recipient_id, recipientPhone, makeMsg(recipientName)).run();
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {

      // ── 고객 ──────────────────────────────────────────
      if (path === '/api/customers' && method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const qn = normalizePhone(q);
        const rows = q
          ? qn
            ? await env.DB.prepare(
                `SELECT id, name, phone, memo FROM customers
                 WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 50`
              ).bind(`%${q}%`, `%${qn}%`).all()
            : await env.DB.prepare(
                `SELECT id, name, phone, memo FROM customers
                 WHERE name LIKE ? ORDER BY name LIMIT 50`
              ).bind(`%${q}%`).all()
          : await env.DB.prepare(
              `SELECT id, name, phone, memo FROM customers ORDER BY name LIMIT 200`
            ).all();
        return json(rows.results);
      }

      if (path === '/api/customers' && method === 'POST') {
        const body = await request.json();
        if (Array.isArray(body)) {
          let inserted = 0, skipped = 0, failed = [];
          for (const c of body) {
            const phone = normalizePhone(c.phone);
            if (!phone) { skipped++; continue; }
            try {
              await env.DB.prepare(
                `INSERT INTO customers (name, phone, memo, google_resource_name)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(phone) DO UPDATE SET
                   name = excluded.name,
                   google_resource_name = excluded.google_resource_name`
              ).bind(c.name || '', phone, c.memo || '', c.google_resource_name || '').run();
              inserted++;
            } catch (e) { failed.push({ phone, error: e.message }); }
          }
          return json({ inserted, skipped, failed });
        }
        const { name, memo, google_resource_name } = body;
        const phone = normalizePhone(body.phone);
        if (!name || !phone) return err('name, phone 필수');
        const result = await env.DB.prepare(
          `INSERT INTO customers (name, phone, memo, google_resource_name) VALUES (?, ?, ?, ?)`
        ).bind(name, phone, memo || '', google_resource_name || '').run();
        return json({ id: result.meta.last_row_id }, 201);
      }

      if (path.match(/^\/api\/customers\/\d+$/) && method === 'GET') {
        const id = path.split('/')[3];
        const customer = await env.DB.prepare(
          `SELECT * FROM customers WHERE id = ?`
        ).bind(id).first();
        if (!customer) return err('고객 없음', 404);
        const addresses = await env.DB.prepare(
          `SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC`
        ).bind(id).all();
        return json({ ...customer, addresses: addresses.results });
      }

      if (path.match(/^\/api\/customers\/\d+$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const body = await request.json();
        if (body.google_resource_name !== undefined) {
          await env.DB.prepare(
            `UPDATE customers SET google_resource_name=? WHERE id=?`
          ).bind(body.google_resource_name, id).run();
          return json({ ok: true });
        }
        const phone = normalizePhone(body.phone);
        const { name, memo } = body;
        await env.DB.prepare(
          `UPDATE customers SET name=?, phone=?, memo=? WHERE id=?`
        ).bind(name, phone, memo || '', id).run();
        return json({ ok: true });
      }

      if (path === '/api/customers/no-google' && method === 'GET') {
        const rows = await env.DB.prepare(
          `SELECT id, name, phone, memo FROM customers WHERE google_resource_name IS NULL OR google_resource_name = '' ORDER BY id DESC`
        ).all();
        return json(rows.results);
      }

      // ── 주소 ──────────────────────────────────────────
      if (path === '/api/addresses' && method === 'POST') {
        const { customer_id, label, address, is_default } = await request.json();
        if (!customer_id || !address) return err('customer_id, address 필수');
        if (is_default) {
          await env.DB.prepare(
            `UPDATE addresses SET is_default=0 WHERE customer_id=?`
          ).bind(customer_id).run();
        }
        const result = await env.DB.prepare(
          `INSERT INTO addresses (customer_id, label, address, is_default) VALUES (?,?,?,?)`
        ).bind(customer_id, label || '', address, is_default ? 1 : 0).run();
        return json({ id: result.meta.last_row_id }, 201);
      }

      if (path.match(/^\/api\/addresses\/\d+$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { customer_id, is_default } = await request.json();
        if (is_default && customer_id) {
          await env.DB.prepare(
            `UPDATE addresses SET is_default=0 WHERE customer_id=?`
          ).bind(customer_id).run();
        }
        await env.DB.prepare(
          `UPDATE addresses SET is_default=? WHERE id=?`
        ).bind(is_default ? 1 : 0, id).run();
        return json({ ok: true });
      }

      if (path.match(/^\/api\/addresses\/\d+$/) && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare(`DELETE FROM addresses WHERE id=?`).bind(id).run();
        return json({ ok: true });
      }

      // ── 송장출력용 목록 (수량 포함) ────────────────────
      if (path === '/api/orders/export' && method === 'GET') {
        const status = url.searchParams.get('status') || '송장출력';
        const rows = await env.DB.prepare(`
          SELECT o.*,
            c.name  AS orderer_name,  c.phone  AS orderer_phone,  c.memo AS orderer_memo,
            r.name  AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo,
            a.address,
            (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS total_qty
          FROM orders o
          LEFT JOIN customers c ON o.orderer_id  = c.id
          LEFT JOIN customers r ON o.recipient_id = r.id
          LEFT JOIN addresses a ON o.address_id   = a.id
          WHERE o.status = ? AND o.status != '삭제'
          ORDER BY o.order_no ASC
        `).bind(status).all();
        return json(rows.results);
      }

      // ── 주문번호로 조회 ────────────────────────────────
      if (path === '/api/orders/by-no' && method === 'GET') {
        const order_no = url.searchParams.get('order_no') || '';
        const row = await env.DB.prepare(
          `SELECT id FROM orders WHERE order_no = ?`
        ).bind(order_no).first();
        return json(row || { id: null });
      }

      // ── 주문번호 채번 ──────────────────────────────────
      if (path === '/api/orders/next-no' && method === 'GET') {
        const orderNo = await generateOrderNo(env.DB);
        return json({ order_no: orderNo });
      }

      // ── 주문번호 중복체크 ──────────────────────────────
      if (path === '/api/orders/check-no' && method === 'GET') {
        const order_no = url.searchParams.get('order_no') || '';
        const exclude_id = url.searchParams.get('exclude_id') || null;
        const row = exclude_id
          ? await env.DB.prepare(
              `SELECT id FROM orders WHERE order_no = ? AND id != ?`
            ).bind(order_no, exclude_id).first()
          : await env.DB.prepare(
              `SELECT id FROM orders WHERE order_no = ?`
            ).bind(order_no).first();
        return json({ exists: !!row });
      }

      // ── 주문 목록 ──────────────────────────────────────
      if (path === '/api/orders' && method === 'GET') {
        const status = url.searchParams.get('status') || '';
        const rows = status
          ? await env.DB.prepare(`
              SELECT o.*,
                c.name  AS orderer_name,  c.phone  AS orderer_phone,  c.memo AS orderer_memo,
                r.name  AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo,
                a.address,
                (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS total_qty,
                (SELECT GROUP_CONCAT(product || ' ' || qty || '개', ', ') FROM order_items WHERE order_id = o.id) AS items_summary
              FROM orders o
              LEFT JOIN customers c ON o.orderer_id  = c.id
              LEFT JOIN customers r ON o.recipient_id = r.id
              LEFT JOIN addresses a ON o.address_id   = a.id
              WHERE o.status = ? AND o.status != '삭제'
              ORDER BY o.order_no DESC
            `).bind(status).all()
          : await env.DB.prepare(`
              SELECT o.*,
                c.name  AS orderer_name,  c.phone  AS orderer_phone,  c.memo AS orderer_memo,
                r.name  AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo,
                a.address,
                (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS total_qty,
                (SELECT GROUP_CONCAT(product || ' ' || qty || '개', ', ') FROM order_items WHERE order_id = o.id) AS items_summary
              FROM orders o
              LEFT JOIN customers c ON o.orderer_id  = c.id
              LEFT JOIN customers r ON o.recipient_id = r.id
              LEFT JOIN addresses a ON o.address_id   = a.id
              WHERE o.status != '삭제'
              ORDER BY o.order_no DESC
            `).all();
        return json(rows.results);
      }

      // ── 주문확정 대기 목록 (외부 출력용) ──────────────
      // GET /api/orders/print-queue
      // 주문확정 상태이고 printed_at이 없는 주문 반환
      if (path === '/api/orders/print-queue' && method === 'GET') {
        const rows = await env.DB.prepare(`
          SELECT o.*,
            c.name  AS orderer_name,  c.phone  AS orderer_phone,  c.memo AS orderer_memo,
            r.name  AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo,
            a.address
          FROM orders o
          LEFT JOIN customers c ON o.orderer_id  = c.id
          LEFT JOIN customers r ON o.recipient_id = r.id
          LEFT JOIN addresses a ON o.address_id   = a.id
          WHERE o.status = '주문확정' AND o.printed_at IS NULL
          ORDER BY o.priority ASC, o.created_at ASC
        `).all();
        return json(rows.results);
      }

      // ── 주문 등록 ──────────────────────────────────────
      if (path === '/api/orders' && method === 'POST') {
        const b = await request.json();
        const { orderer_id, recipient_id, address_id, delivery_type, priority, memo, items, shipping_fee } = b;
        if (!orderer_id || !delivery_type || !items?.length) {
          return err('orderer_id, delivery_type, items 필수');
        }

        let order_no = b.order_no?.trim() || await generateOrderNo(env.DB);

        const dup = await env.DB.prepare(
          `SELECT id FROM orders WHERE order_no = ?`
        ).bind(order_no).first();
        if (dup) return err(`주문번호 중복: ${order_no}`, 409);

        const total_amount = items.reduce((s, i) => s + i.unit_price * i.qty, 0) + (shipping_fee || 0);
        const created_at = b.created_at || new Date().toISOString().slice(0, 10);

        const order = await env.DB.prepare(`
          INSERT INTO orders
            (order_no, orderer_id, recipient_id, address_id, delivery_type,
             status, payment_status, total_amount, shipping_fee, priority, memo, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          order_no,
          orderer_id, recipient_id || null, address_id || null,
          delivery_type, '주문입력', '미수',
          total_amount, shipping_fee || 0,
          priority || 3, memo || '',
          created_at
        ).run();
        const order_id = order.meta.last_row_id;
        for (const item of items) {
          await env.DB.prepare(
            `INSERT INTO order_items (order_id, product, unit_price, qty) VALUES (?,?,?,?)`
          ).bind(order_id, item.product, item.unit_price, item.qty).run();
        }
        return json({ id: order_id, order_no }, 201);
      }

      // ── 주문 상세 ──────────────────────────────────────
      if (path.match(/^\/api\/orders\/\d+$/) && method === 'GET') {
        const id = path.split('/')[3];
        const order = await env.DB.prepare(`
          SELECT o.*,
            c.name  AS orderer_name,  c.phone  AS orderer_phone,  c.memo AS orderer_memo,
            r.name  AS recipient_name, r.phone AS recipient_phone, r.memo AS recipient_memo,
            a.address
          FROM orders o
          LEFT JOIN customers c ON o.orderer_id  = c.id
          LEFT JOIN customers r ON o.recipient_id = r.id
          LEFT JOIN addresses a ON o.address_id   = a.id
          WHERE o.id = ?
        `).bind(id).first();
        if (!order) return err('주문 없음', 404);
        const items = await env.DB.prepare(
          `SELECT * FROM order_items WHERE order_id = ?`
        ).bind(id).all();
        return json({ ...order, items: items.results });
      }

      // ── 주문 수정 ──────────────────────────────────────
      if (path.match(/^\/api\/orders\/\d+$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const b = await request.json();
        const { orderer_id, recipient_id, address_id, delivery_type, priority, memo, items, shipping_fee, status, payment_status } = b;

        if (b.order_no) {
          const dup = await env.DB.prepare(
            `SELECT id FROM orders WHERE order_no = ? AND id != ?`
          ).bind(b.order_no.trim(), id).first();
          if (dup) return err(`주문번호 중복: ${b.order_no}`, 409);
        }

        const total_amount = items
          ? items.reduce((s, i) => s + i.unit_price * i.qty, 0) + (shipping_fee || 0)
          : undefined;

        await env.DB.prepare(`
          UPDATE orders SET
            order_no=?, orderer_id=?, recipient_id=?, address_id=?,
            delivery_type=?, priority=?, memo=?,
            shipping_fee=?, total_amount=?,
            status=?, payment_status=?,
            updated_at=datetime('now','localtime')
          WHERE id=?
        `).bind(
          b.order_no?.trim() || null,
          orderer_id, recipient_id || null, address_id || null,
          delivery_type, priority || 3, memo || '',
          shipping_fee || 0, total_amount || 0,
          status || '주문입력', payment_status || '미수',
          id
        ).run();

        if (items) {
          await env.DB.prepare(`DELETE FROM order_items WHERE order_id=?`).bind(id).run();
          for (const item of items) {
            await env.DB.prepare(
              `INSERT INTO order_items (order_id, product, unit_price, qty) VALUES (?,?,?,?)`
            ).bind(id, item.product, item.unit_price, item.qty).run();
          }
        }
        return json({ ok: true });
      }

      // ── 주문 삭제 (소프트) ─────────────────────────────
      if (path.match(/^\/api\/orders\/\d+$/) && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare(
          `UPDATE orders SET status='삭제', updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(id).run();
        return json({ ok: true });
      }

      // ── 주문 상태 변경 ─────────────────────────────────
      if (path.match(/^\/api\/orders\/\d+\/status$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { status } = await request.json();
        await env.DB.prepare(
          `UPDATE orders SET status=?, updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(status, id).run();

        // 배송완료 시 SMS 등록
        if (status === '배송완료') {
          await insertDeliverySms(env.DB, id);
        }

        return json({ ok: true });
      }

      // ── 주문확정 처리 (상태변경 + SMS 등록) ───────────
      if (path.match(/^\/api\/orders\/\d+\/confirm$/) && method === 'PUT') {
        const id = path.split('/')[3];

        // 주문 정보 조회
        const order = await env.DB.prepare(`
          SELECT o.*,
            c.name AS orderer_name, c.phone AS orderer_phone,
            r.name AS recipient_name, r.phone AS recipient_phone
          FROM orders o
          LEFT JOIN customers c ON o.orderer_id = c.id
          LEFT JOIN customers r ON o.recipient_id = r.id
          WHERE o.id = ?
        `).bind(id).first();
        if (!order) return err('주문 없음', 404);

        // 주문량 합산
        const items = await env.DB.prepare(
          `SELECT SUM(qty) AS total_qty FROM order_items WHERE order_id = ?`
        ).bind(id).first();
        const qty = items?.total_qty || 0;

        // 수령자 (없으면 주문자)
        const recipientName = order.recipient_name || order.orderer_name;
        const recipientPhone = order.recipient_phone || order.orderer_phone;
        const orderDate = (order.created_at || '').slice(0, 10);

        // SMS 메시지 생성
        const message = `${order.orderer_name}님이 > ${recipientName}님에게 주문하신 블루베리 ${qty}kg가 ${orderDate}에 택배 접수되었습니다.`;

        // sms_queue 등록
        await env.DB.prepare(`
          INSERT INTO sms_queue (order_id, customer_id, phone, message)
          VALUES (?, ?, ?, ?)
        `).bind(id, order.orderer_id, recipientPhone, message).run();

        // 상태 변경
        await env.DB.prepare(
          `UPDATE orders SET status='주문확정', updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(id).run();

        return json({ ok: true });
      }

      // ── 주문서 출력 처리 (외부 출력기용) ──────────────
      // PUT /api/orders/:id/printed
      // printed: 1 → printed_at = now, 상태 → 주문출력
      // printed: 0 → printed_at = NULL
      if (path.match(/^\/api\/orders\/\d+\/printed$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { printed } = await request.json();
        if (printed) {
          await env.DB.prepare(`
            UPDATE orders SET
              printed_at=datetime('now','localtime'),
              status='주문출력',
              updated_at=datetime('now','localtime')
            WHERE id=?
          `).bind(id).run();
        } else {
          await env.DB.prepare(`
            UPDATE orders SET
              printed_at=NULL,
              updated_at=datetime('now','localtime')
            WHERE id=?
          `).bind(id).run();
        }
        return json({ ok: true });
      }

      // ── 송장번호 저장 ──────────────────────────────────
      if (path.match(/^\/api\/orders\/\d+\/tracking_no$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { tracking_no } = await request.json();
        await env.DB.prepare(
          `UPDATE orders SET tracking_no=?, updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(tracking_no || '', id).run();
        return json({ ok: true });
      }

      // ── 문자 큐 목록 ───────────────────────────────────
      if (path === '/api/sms-queue' && method === 'GET') {
        const status = url.searchParams.get('status') || '';
        const rows = status
          ? await env.DB.prepare(
              `SELECT * FROM sms_queue WHERE status = ? ORDER BY id DESC`
            ).bind(status).all()
          : await env.DB.prepare(
              `SELECT * FROM sms_queue ORDER BY id DESC`
            ).all();
        return json(rows.results);
      }

      // ── 문자 큐 수정 ───────────────────────────────────
      if (path.match(/^\/api\/sms-queue\/\d+$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { phone, message } = await request.json();
        await env.DB.prepare(
          `UPDATE sms_queue SET phone=?, message=?, updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(phone, message, id).run();
        return json({ ok: true });
      }

      // ── 문자 큐 상태 변경 ──────────────────────────────
      if (path.match(/^\/api\/sms-queue\/\d+\/status$/) && method === 'PUT') {
        const id = path.split('/')[3];
        const { status } = await request.json();
        await env.DB.prepare(
          `UPDATE sms_queue SET status=?, updated_at=datetime('now','localtime') WHERE id=?`
        ).bind(status, id).run();

        if (status === '완료' || status === '실패') {
          const q = await env.DB.prepare(`SELECT * FROM sms_queue WHERE id=?`).bind(id).first();
          if (q) {
            await env.DB.prepare(`
              INSERT INTO sms_logs (queue_id, order_id, customer_id, phone, message, status, sent_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
            `).bind(q.id, q.order_id, q.customer_id, q.phone, q.message, status).run();
          }
        }

        return json({ ok: true });
      }

      // ── 문자 큐 삭제 ───────────────────────────────────
      if (path.match(/^\/api\/sms-queue\/\d+$/) && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare(`DELETE FROM sms_queue WHERE id=?`).bind(id).run();
        return json({ ok: true });
      }

      // ── 최근 사용 주소 ─────────────────────────────────
      if (path.match(/^\/api\/customers\/\d+\/recent-address$/) && method === 'GET') {
        const id = path.split('/')[3];
        const recent = await env.DB.prepare(`
          SELECT a.id, a.address, a.label, a.is_default
          FROM orders o
          JOIN addresses a ON o.address_id = a.id
          WHERE o.orderer_id = ? OR o.recipient_id = ?
          ORDER BY o.created_at DESC
          LIMIT 1
        `).bind(id, id).first();
        if (!recent) {
          const def = await env.DB.prepare(`
            SELECT id, address, label, is_default
            FROM addresses
            WHERE customer_id = ?
            ORDER BY is_default DESC, id DESC
            LIMIT 1
          `).bind(id).first();
          return json(def || null);
        }
        return json(recent);
      }

      return err('Not found', 404);

    } catch (e) {
      return err(e.message, 500);
    }
  }
};
