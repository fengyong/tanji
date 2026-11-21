package tests

import (
	"encoding/json"
	"fmt"
	"testing"
)

// bootstrap:全量快照 + 分页下载 + 回执同切点;AC14/AC18 服务端部分。
func TestBootstrapSnapshotAndPages(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "boot@example.com", "快", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000a1")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000a2", "快照店", 12000, 2000)
	pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000a3", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "1"},
		"payload": map[string]any{"kind": "deposit", "method": "微信",
			"paid_at": "2026-11-20T10:00:00Z", "amount_cents": 2000},
	})
	// 已删除订单也要以墓碑形态出现。
	deadID := uuid("aaaaaaaa-0000-4000-8000-0000000000a4")
	pushCreate(t, c, deadID, "aaaaaaaa-0000-4000-8000-0000000000a5", "已删店", 100, 0)
	pushOp(t, c, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000a6", "aggregate_type": "order",
		"aggregate_id": deadID, "type": "order.delete",
		"precondition": map[string]any{"expected_version": "1"},
		"payload":       map[string]any{},
	})
	// 一个"已提交但响应丢失"的操作:服务端已有回执。
	lostOp := "aaaaaaaa-0000-4000-8000-0000000000a7"
	pushOp(t, c, map[string]any{
		"op_id": lostOp, "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.update",
		"precondition": map[string]any{"expected_version": "2"},
		"payload":       map[string]any{"note": "响应丢失的修改"},
	})

	code, snap := c.post("/v1/sync/bootstrap", map[string]any{
		"op_ids":    []string{lostOp},
		"page_size": 1,
	})
	if code != 200 {
		t.Fatalf("bootstrap: %d %v", code, snap)
	}
	snapID, _ := snap["snapshot_id"].(string)
	pages := int(snap["pages"].(float64))
	if pages != 2 { // 2 个订单,每页 1 条,尾页附带 tail
		t.Fatalf("page_size=1 + 2 订单应产生 2 页: %v", snap)
	}
	var orders []map[string]any
	var settings map[string]any
	var receipts []map[string]any
	var highWater string
	var sawTombstone bool
	for i := 0; i < pages; i++ {
		pc, page := c.get(fmt.Sprintf("/v1/sync/bootstrap/%s/pages/%d", snapID, i))
		if pc != 200 {
			t.Fatalf("page %d: %d %v", i, pc, page)
		}
		raw, _ := json.Marshal(page["payload"])
		var doc struct {
			Orders []json.RawMessage `json:"orders"`
			Tail   struct {
				Settings  map[string]any   `json:"settings"`
				Shares    []json.RawMessage `json:"shares"`
				HighWater string           `json:"high_water"`
				Epoch     int64            `json:"epoch"`
				Receipts  []map[string]any `json:"receipts"`
			} `json:"tail"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("page %d 解析: %v", i, err)
		}
		for _, o := range doc.Orders {
			var m map[string]any
			_ = json.Unmarshal(o, &m)
			if m["status"] == "deleted" {
				sawTombstone = true
			} else {
				orders = append(orders, m)
			}
		}
		if doc.Tail.Settings != nil {
			settings = doc.Tail.Settings
			highWater = doc.Tail.HighWater
			receipts = doc.Tail.Receipts
		}
	}
	if len(orders) != 1 || sawTombstone != true {
		t.Fatalf("快照应含 1 个活跃订单 + 1 个墓碑: orders=%d tombstone=%v", len(orders), sawTombstone)
	}
	if settings["collect_threshold_days"].(float64) != 15 {
		t.Fatalf("settings: %v", settings)
	}
	if highWater == "" {
		t.Fatalf("tail 缺 high_water")
	}
	foundLost := false
	for _, r := range receipts {
		if r["op_id"] == lostOp && r["result"] == "applied" {
			foundLost = true
		}
	}
	if !foundLost {
		t.Fatalf("快照必须带回执清单(与数据同一切点): %v", receipts)
	}
	// 页码越界 → 404;他人/他会话访问 → 拒绝。
	code, _ = c.get(fmt.Sprintf("/v1/sync/bootstrap/%s/pages/%d", snapID, 99))
	if code != 404 {
		t.Fatalf("越界页应 404, got %d", code)
	}
	other := registerAndLogin(t, env, "boot2@example.com", "他", "22222222-2222-4222-8222-222222222222")
	code, _ = other.get(fmt.Sprintf("/v1/sync/bootstrap/%s/pages/0", snapID))
	if code != 410 && code != 404 && code != 403 {
		t.Fatalf("他账号访问快照必须拒绝, got %d", code)
	}
}

// 游标世代:stream_epoch 变化后旧游标返回 cursor_expired(410),触发全量重建。
func TestCursorExpiredOnEpochChange(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "epoch@example.com", "世", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000b1")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000b2", "世代店", 2000, 0)
	_, next := pullEvents(t, c, "", 10)
	// 模拟灾备恢复:直接推进 stream_epoch(真实恢复流程会清会话+换 epoch)。
	if _, err := env.db.Exec(`UPDATE user_stream_heads SET stream_epoch = stream_epoch + 1, seq = 0`); err != nil {
		t.Fatal(err)
	}
	code, body := c.get("/v1/sync/pull?limit=10&cursor=" + next)
	if code != 410 || body["code"] != "cursor_expired" {
		t.Fatalf("世代变化后旧游标应 410 cursor_expired: %d %v", code, body)
	}
	// 无游标从头拉取可用(新游标重新开始)。
	page, _ := pullEvents(t, c, "", 10)
	if len(page["events"].([]any)) != 0 {
		// seq 重置为 0,旧事件不可达——这正是要求全量重建的原因;此处只验证不报错。
		_ = page
	}
}

// receipts 端点:按 op_id 查询已提交但响应丢失的操作结果。
func TestReceiptsQuery(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "rcpt@example.com", "执", "11111111-1111-4111-8111-111111111111")
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000c1")
	pushCreate(t, c, orderID, "aaaaaaaa-0000-4000-8000-0000000000c2", "回执店", 5000, 0)
	unknownOp := "aaaaaaaa-0000-4000-8000-0000000000c3"
	code, resp := c.post("/v1/sync/receipts", map[string]any{
		"op_ids": []string{"aaaaaaaa-0000-4000-8000-0000000000c2", unknownOp},
	})
	if code != 200 {
		t.Fatalf("receipts: %d %v", code, resp)
	}
	list := resp["receipts"].([]any)
	if len(list) != 2 {
		t.Fatalf("应返回 2 条: %v", resp)
	}
	byID := map[string]map[string]any{}
	for _, r := range list {
		m := r.(map[string]any)
		byID[m["op_id"].(string)] = m
	}
	if byID["aaaaaaaa-0000-4000-8000-0000000000c2"]["result"] != "applied" {
		t.Fatalf("已知 op 应 applied: %v", byID)
	}
	if byID[unknownOp]["result"] != "unknown" {
		t.Fatalf("未知 op 应 unknown: %v", byID)
	}
}
