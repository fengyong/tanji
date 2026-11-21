package tests

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
)

// 测试辅助:构造并 push 一个 order.create。
func pushCreate(t *testing.T, c *client, orderID, opID, storeName string, priceCents, depositCents int64) map[string]any {
	t.Helper()
	code, resp := c.post("/v1/sync/push", map[string]any{
		"protocol_version": 1, "account_id": c.userID, "device_id": c.device,
		"operations": []map[string]any{{
			"op_id": opID, "aggregate_type": "order", "aggregate_id": orderID,
			"type": "order.create", "precondition": map[string]any{"expected_version": "0"},
			"payload": map[string]any{
				"store": storeName, "category": "茶饮", "contact": "", "note": "",
				"price_cents": priceCents, "deposit_cents": depositCents,
				"appt_start": "2026-11-25T02:00:00Z", "timezone": "Asia/Shanghai",
				"settle_via": "private", "channel": "直客",
			},
		}},
	})
	if code != 200 {
		t.Fatalf("push 失败: %d %v", code, resp)
	}
	results, _ := resp["results"].([]any)
	if len(results) != 1 {
		t.Fatalf("应返回 1 个结果: %v", resp)
	}
	return results[0].(map[string]any)
}

func pushOp(t *testing.T, c *client, op map[string]any) map[string]any {
	t.Helper()
	code, resp := c.post("/v1/sync/push", map[string]any{
		"protocol_version": 1, "account_id": c.userID, "device_id": c.device,
		"operations": []map[string]any{op},
	})
	if code != 200 {
		t.Fatalf("push 失败: %d %v", code, resp)
	}
	results, _ := resp["results"].([]any)
	return results[0].(map[string]any)
}

func uuid(id string) string { return id }

// AC02:同一 op 重试 N 次只产生一次业务效果;payload 变化同 ID 拒绝。
func TestIdempotentRetry(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "idem@example.com", "幂", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000001")

	res := pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000a1", "幂等奶茶", 10000, 2000)
	if res["result"] != "applied" || res["resulting_version"] != "1" {
		t.Fatalf("首次应 applied v1: %v", res)
	}
	// 重试 100 次:结果不变,业务效果不变。
	for i := 0; i < 100; i++ {
		res = pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000a1", "幂等奶茶", 10000, 2000)
		if res["result"] != "already_applied" {
			t.Fatalf("重试应 already_applied, got %v", res["result"])
		}
	}
	var count int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM orders`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("重试 100 次必须只建 1 单, got %d", count)
	}
	// 同 op_id 不同 payload → 拒绝。
	bad := pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000a1", "改了名", 10000, 2000)
	if bad["result"] != "rejected" || bad["error_code"] != "payload_hash_mismatch" {
		t.Fatalf("同 ID 异内容必须拒绝: %v", bad)
	}
}

// AC03 服务端部分:after_op_id 链式版本;版本不匹配 → conflict 且不覆盖本地意图。
func TestVersionChainAndConflict(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "chain@example.com", "链", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000002")
	op1 := "aaaaaaaa-0000-4000-8000-0000000000b1"
	op2 := "aaaaaaaa-0000-4000-8000-0000000000b2"

	res := pushCreate(t, c, orderID, op1, "链式店", 10000, 1000)
	if res["result"] != "applied" {
		t.Fatalf("create: %v", res)
	}
	// 后继 op 用 after_op_id 引用前序。
	res = pushOp(t, c, map[string]any{
		"op_id": op2, "aggregate_type": "order", "aggregate_id": orderID,
		"type": "order.reschedule",
		"precondition": map[string]any{"after_op_id": op1},
		"payload": map[string]any{"appt_start": "2026-11-26T02:00:00Z"},
	})
	if res["result"] != "applied" || res["resulting_version"] != "2" {
		t.Fatalf("reschedule after_op_id: %v", res)
	}
	// 另一设备用过期 expected_version 提交 → conflict,并带云端当前内容。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b3",
		"aggregate_type": "order", "aggregate_id": orderID,
		"type": "order.update",
		"precondition": map[string]any{"expected_version": "1"},
		"payload": map[string]any{"note": "过期设备的修改"},
	})
	if res["result"] != "conflict" {
		t.Fatalf("过期版本应 conflict: %v", res)
	}
	payload, _ := res["payload"].(map[string]any)
	if payload == nil || payload["version"] != "2" {
		t.Fatalf("conflict 应携带云端当前版本: %v", payload)
	}
	// after_op_id 跨聚合引用拒绝。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b4",
		"aggregate_type": "order", "aggregate_id": uuid("aaaaaaaa-0000-4000-8000-000000000009"),
		"type": "order.create", "precondition": map[string]any{"expected_version": "0"},
		"payload": map[string]any{"store": "X", "price_cents": 1, "deposit_cents": 0,
			"appt_start": "2026-11-25T02:00:00Z", "settle_via": "private"},
	})
	if res["result"] != "applied" {
		t.Fatalf("新订单应成功: %v", res)
	}
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b5",
		"aggregate_type": "order", "aggregate_id": orderID,
		"type": "order.update",
		"precondition": map[string]any{"after_op_id": "aaaaaaaa-0000-4000-8000-0000000000b4"},
		"payload": map[string]any{"note": "跨聚合"},
	})
	if res["result"] != "rejected" {
		t.Fatalf("after_op_id 跨聚合必须拒绝: %v", res)
	}
}

// 收款规则:重复收款拒绝;金额必须等于待收;撤销后可重记;撤销保留历史。
func TestPaymentRules(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "pay@example.com", "款", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000003")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000c1", "收款店", 10000, 2000)

	record := func(opID string, amount int64) map[string]any {
		return pushOp(t, c, map[string]any{
			"op_id": opID, "aggregate_type": "order", "aggregate_id": orderID,
			"type": "payment.record",
			"precondition": map[string]any{"after_op_id": "aaaaaaaa-0000-4000-8000-0000000000c1"},
			"payload": map[string]any{"kind": "deposit", "method": "微信",
				"paid_at": "2026-11-20T10:00:00Z", "amount_cents": amount},
		})
	}
	res := record("aaaaaaaa-0000-4000-8000-0000000000c2", 2000)
	if res["result"] != "applied" {
		t.Fatalf("定金收款: %v", res)
	}
	// 重复收款(op_id 不同)→ 业务拒绝,不能重复入账。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c3", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "2"},
		"payload": map[string]any{"kind": "deposit", "method": "微信",
			"paid_at": "2026-11-20T10:00:00Z", "amount_cents": 2000},
	})
	if res["result"] != "rejected" {
		t.Fatalf("重复收款必须拒绝: %v", res)
	}
	// 金额不符 → 拒绝。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c4", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "2"},
		"payload": map[string]any{"kind": "deposit", "method": "微信",
			"paid_at": "2026-11-20T10:00:00Z", "amount_cents": 1500},
	})
	if res["result"] != "rejected" {
		t.Fatalf("金额不符必须拒绝: %v", res)
	}
	// 重试已成功的收款 op_id → already_applied(响应丢失场景)。
	res = record("aaaaaaaa-0000-4000-8000-0000000000c2", 2000)
	if res["result"] != "already_applied" {
		t.Fatalf("同 op 重试应 already_applied: %v", res)
	}
	var count int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM payment_entries WHERE entry_type='receipt'`).
		Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("只能有一笔定金流水, got %d", count)
	}
	// 撤销。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c5", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.reverse",
		"precondition": map[string]any{"expected_version": "2"},
		"payload":       map[string]any{"kind": "deposit", "reason": "误记"},
	})
	if res["result"] != "applied" {
		t.Fatalf("撤销: %v", res)
	}
	var reversals int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM payment_entries WHERE entry_type='reversal'`).
		Scan(&reversals); err != nil {
		t.Fatal(err)
	}
	if reversals != 1 {
		t.Fatalf("撤销应保留历史并新增撤销流水, got %d", reversals)
	}
	// 撤销后可重新记账(撤销后版本为 3)。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c6", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "3"},
		"payload": map[string]any{"kind": "deposit", "method": "支付宝",
			"paid_at": "2026-11-20T11:00:00Z", "amount_cents": 2000},
	})
	if res["result"] != "applied" {
		t.Fatalf("撤销后重记: %v", res)
	}
}

// AC13:删除墓碑——旧设备带着旧修改回来不能复活删除记录。
func TestTombstoneBlocksResurrection(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "tomb@example.com", "墓", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000004")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000d1", "待删店", 5000, 0)

	res := pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000d2", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.delete",
		"precondition": map[string]any{"expected_version": "1"},
		"payload":       map[string]any{},
	})
	if res["result"] != "applied" {
		t.Fatalf("删除: %v", res)
	}
	// 旧设备基于旧版本提交修改。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000d3", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.update",
		"precondition": map[string]any{"expected_version": "1"},
		"payload":       map[string]any{"note": "旧设备的修改"},
	})
	if res["result"] != "rejected" || res["error_code"] != "entity_deleted" {
		t.Fatalf("删除后修改必须 rejected entity_deleted: %v", res)
	}
	// 用同 ID 重建被拒绝。
	res = pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000d4", "复活店", 5000, 0)
	if res["result"] != "rejected" || res["error_code"] != "entity_deleted" {
		t.Fatalf("同 ID 复活必须拒绝: %v", res)
	}
	var status string
	if err := env.db.QueryRow(`SELECT status FROM orders WHERE id = UUID_TO_BIN(?)`, orderID).
		Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "deleted" {
		t.Fatalf("订单必须仍是 deleted, got %s", status)
	}
}

// AC05 服务端不变量:每个操作独立事务;单页失败不影响其他操作的结果一致性。
func TestOpsInSeparateTransactions(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "tx@example.com", "务", "11111111-1111-4111-8111-111111111111")
	// 批次中一个合法 + 一个非法(op_id 无效):非法者不影响合法者。
	code, resp := c.post("/v1/sync/push", map[string]any{
		"protocol_version": 1, "account_id": c.userID, "device_id": c.device,
		"operations": []map[string]any{
			{
				"op_id": "aaaaaaaa-0000-4000-8000-0000000000e1", "aggregate_type": "order",
				"aggregate_id": uuid("aaaaaaaa-0000-4000-8000-000000000005"),
				"type":         "order.create", "precondition": map[string]any{"expected_version": "0"},
				"payload": map[string]any{"store": "合法店", "price_cents": 100, "deposit_cents": 0,
					"appt_start": "2026-11-25T02:00:00Z", "settle_via": "private"},
			},
			{
				"op_id": "not-a-uuid", "aggregate_type": "order",
				"aggregate_id": uuid("aaaaaaaa-0000-4000-8000-000000000006"),
				"type":         "order.create", "precondition": map[string]any{"expected_version": "0"},
				"payload": map[string]any{"store": "非法店", "price_cents": 100, "deposit_cents": 0,
					"appt_start": "2026-11-25T02:00:00Z", "settle_via": "private"},
			},
		},
	})
	if code != 200 {
		t.Fatalf("push: %d %v", code, resp)
	}
	results := resp["results"].([]any)
	if results[0].(map[string]any)["result"] != "applied" {
		t.Fatalf("合法操作应独立成功: %v", results)
	}
	if results[1].(map[string]any)["result"] != "rejected" {
		t.Fatalf("非法操作应被拒: %v", results)
	}
	var count int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM orders`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("只应有 1 单, got %d", count)
	}
}

// 并发:两个设备并发对同一订单收款/更新——恰好一次业务效果,无重复流水。
func TestConcurrentPaymentSingleEffect(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "race@example.com", "竞", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000007")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000f1", "并发店", 10000, 2000)

	var wg sync.WaitGroup
	results := make([]map[string]any, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cc := &client{t: t, base: env.server.URL, token: c.token, device: c.device, userID: c.userID}
			results[i] = pushOp(t, cc, map[string]any{
				"op_id":           fmt.Sprintf("aaaaaaaa-0000-4000-8000-0000000001%02d", i),
				"aggregate_type":  "order",
				"aggregate_id":    orderID,
				"type":            "payment.record",
				"precondition":    map[string]any{"expected_version": "1"},
				"payload": map[string]any{"kind": "deposit", "method": "微信",
					"paid_at": "2026-11-20T10:00:00Z", "amount_cents": 2000},
			})
		}(i)
	}
	wg.Wait()
	applied := 0
	for _, r := range results {
		if r["result"] == "applied" {
			applied++
		}
	}
	if applied != 1 {
		t.Fatalf("并发收款必须恰好一次 applied, got %d: %v", applied, results)
	}
	var count int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM payment_entries WHERE entry_type='receipt'`).
		Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("并发后只能有一笔流水, got %d", count)
	}
}

// 下行游标:next_cursor 严格前进;事件按 seq 有序;空过滤页也推进游标。
func TestPullCursorMonotonic(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "cursor@example.com", "标", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000008")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000e1", "游标店", 3000, 0)

	code, page1 := c.get("/v1/sync/pull?limit=1")
	if code != 200 {
		t.Fatalf("pull: %d", code)
	}
	if len(page1["events"].([]any)) != 1 {
		t.Fatalf("第一页应有 1 条: %v", page1)
	}
	next, _ := page1["next_cursor"].(string)
	code, page2 := c.get("/v1/sync/pull?limit=10&cursor="+next)
	if code != 200 {
		t.Fatalf("pull2: %d", code)
	}
	if len(page2["events"].([]any)) != 0 {
		t.Fatalf("第二页应为空: %v", page2)
	}
	// 再次更新订单后再拉,只得到新事件。
	pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000e2", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.update",
		"precondition": map[string]any{"expected_version": "1"},
		"payload":       map[string]any{"note": "第二笔修改"},
	})
	code, page3 := c.get("/v1/sync/pull?limit=10&cursor="+next)
	if code != 200 {
		t.Fatalf("pull3: %d", code)
	}
	events := page3["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("游标后应只有新事件, got %d", len(events))
	}
	ev := events[0].(map[string]any)
	if ev["seq"].(string) != "2" {
		t.Fatalf("seq 应为 2, got %v", ev["seq"])
	}
	if ev["origin_op_id"] != "aaaaaaaa-0000-4000-8000-0000000000e2" {
		t.Fatalf("本人事件应带 origin_op_id: %v", ev)
	}
}

// 越权:account_id 与会话不匹配立即拒绝(阻断切号串账)。
func TestPushAccountMismatch(t *testing.T) {
	env := newEnv(t)
	ca := registerAndLogin(t, env, "acc-a@example.com", "甲", "11111111-1111-4111-8111-111111111111")
	cb := registerAndLogin(t, env, "acc-b@example.com", "乙", "22222222-2222-4222-8222-222222222222")
	code, resp := ca.post("/v1/sync/push", map[string]any{
		"protocol_version": 1, "account_id": cb.userID, "device_id": ca.device,
		"operations": []map[string]any{},
	})
	if code != 403 {
		t.Fatalf("跨账号信封必须 403, got %d %v", code, resp)
	}
}

// 协议版本不匹配。
func TestProtocolMismatch(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "proto@example.com", "议", "11111111-1111-4111-8111-111111111111")
	code, resp := c.post("/v1/sync/push", map[string]any{
		"protocol_version": 99, "account_id": c.userID, "device_id": c.device,
		"operations": []map[string]any{},
	})
	if code != 409 {
		t.Fatalf("协议不匹配应 409, got %d %v", code, resp)
	}
}

// settings.update:阈值校验 + 事件下发。
func TestSettingsUpdate(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "set@example.com", "置", "11111111-1111-4111-8111-111111111111")
	res := pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b1", "aggregate_type": "settings",
		"aggregate_id": c.userID, "type": "settings.update",
		"payload": map[string]any{"collect_threshold_days": 30},
	})
	if res["result"] != "applied" {
		t.Fatalf("settings: %v", res)
	}
	var threshold int
	if err := env.db.QueryRow(`SELECT collect_threshold_days FROM users WHERE id = UUID_TO_BIN(?)`,
		c.userID).Scan(&threshold); err != nil {
		t.Fatal(err)
	}
	if threshold != 30 {
		t.Fatalf("阈值应为 30, got %d", threshold)
	}
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b2", "aggregate_type": "settings",
		"aggregate_id": c.userID, "type": "settings.update",
		"payload": map[string]any{"collect_threshold_days": 13},
	})
	if res["result"] != "rejected" {
		t.Fatalf("非法阈值应拒绝: %v", res)
	}
}

// 依赖:requires_success 前置未提交 → dependency_pending 且不入回执;前置失败 → dependency_failed。
func TestRequiresSuccess(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "req@example.com", "赖", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000009")
	res := pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c1", "aggregate_type": "settings",
		"aggregate_id": c.userID, "type": "settings.update",
		"requires_success": []string{"aaaaaaaa-0000-4000-8000-0000000000c9"},
		"payload":          map[string]any{"collect_threshold_days": 45},
	})
	if res["result"] != "dependency_pending" {
		t.Fatalf("前置未到应 dependency_pending: %v", res)
	}
	// dependency_pending 不落回执 → 重试仍 pending 而非 already_applied。
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c1", "aggregate_type": "settings",
		"aggregate_id": c.userID, "type": "settings.update",
		"requires_success": []string{"aaaaaaaa-0000-4000-8000-0000000000c9"},
		"payload":          map[string]any{"collect_threshold_days": 45},
	})
	if res["result"] != "dependency_pending" {
		t.Fatalf("重试仍应 pending: %v", res)
	}
	// 前置失败(冲突) → dependency_failed。
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000c2", "依赖店", 100, 0)
	pushOp(t, c, map[string]any{ // 制造冲突
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c3", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.update",
		"precondition": map[string]any{"expected_version": "99"},
		"payload":       map[string]any{"note": "x"},
	})
	res = pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c4", "aggregate_type": "settings",
		"aggregate_id": c.userID, "type": "settings.update",
		"requires_success": []string{"aaaaaaaa-0000-4000-8000-0000000000c3"},
		"payload":          map[string]any{"collect_threshold_days": 45},
	})
	if res["result"] != "rejected" || res["error_code"] != "dependency_failed" {
		t.Fatalf("前置失败应 dependency_failed: %v", res)
	}
}

// DTO 序列化健全性:金额/版本都是数字或字符串,无浮点金额。
func TestOrderDTOShape(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "shape@example.com", "形", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-00000000000a")
	res := pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000d1", "形状店", 12345, 6789)
	payload, _ := res["payload"].(map[string]any)
	if payload["price_cents"].(float64) != 12345 {
		t.Fatalf("price_cents 必须是整数分: %v", payload["price_cents"])
	}
	if payload["version"].(string) != "1" {
		t.Fatalf("version 必须是字符串: %v", payload["version"])
	}
	raw, _ := json.Marshal(res)
	if json.Valid(raw) != true {
		t.Fatalf("必须是合法 JSON")
	}
}
