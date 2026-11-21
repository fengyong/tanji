package tests

import (
	"encoding/json"
	"fmt"
	"testing"
)

// 邀请→接受→建立联系(最小资料,不共享订单)。
func contactLink(t *testing.T, owner, partner *client) {
	t.Helper()
	code, resp := owner.post("/v1/contact-invites", map[string]any{"invitee_user_id": partner.userID})
	if code != 200 {
		t.Fatalf("发起邀请: %d %v", code, resp)
	}
	token, _ := resp["token"].(string)
	code, resp = partner.post("/v1/contact-invites/accept", map[string]any{"token": token})
	if code != 200 {
		t.Fatalf("接受邀请: %d %v", code, resp)
	}
	code, contacts := partner.get("/v1/contacts")
	if code != 200 {
		t.Fatalf("contacts: %d %v", code, contacts)
	}
	list, _ := contacts["contacts"].([]any)
	if len(list) != 1 {
		t.Fatalf("接受后应有 1 个联系人: %v", contacts)
	}
}

// grantSet 聚合 ID:UUIDv5(NAMESPACE_URL, "tanji-grant:"+owner+":"+order+":"+recipient)。
// 与后端 engine.grantSetID 一致。
func grantSetAggregate(owner, orderID, recipient string) string {
	return uuidV5URL("tanji-grant:" + owner + ":" + orderID + ":" + recipient)
}

func opGrant(t *testing.T, c *client, orderID, recipientID, role, opID string) map[string]any {
	t.Helper()
	return pushOp(t, c, map[string]any{
		"op_id": opID, "aggregate_type": "grant_set",
		"aggregate_id": grantSetAggregate(c.userID, orderID, recipientID),
		"type":         "schedule.grant",
		"payload": map[string]any{
			"order_id": orderID, "recipient_user_id": recipientID, "role": role,
		},
	})
}

func pullEvents(t *testing.T, c *client, cursor string, limit int) (map[string]any, string) {
	t.Helper()
	path := fmt.Sprintf("/v1/sync/pull?limit=%d", limit)
	if cursor != "" {
		path += "&cursor=" + cursor
	}
	code, page := c.get(path)
	if code != 200 {
		t.Fatalf("pull: %d %v", code, page)
	}
	next, _ := page["next_cursor"].(string)
	return page, next
}

// AC08:搭档只看到白名单字段;金额/流水/渠道/备注等不下发。
func TestPartnerSeesWhitelistOnly(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "owner@example.com", "店长", "11111111-1111-4111-8111-111111111111")
	partner := registerAndLogin(t, env, "partner@example.com", "搭档", "22222222-2222-4222-8222-222222222222")
	contactLink(t, owner, partner)

	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000a1")
	res := pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-0000000000a2",
		"白名单奶茶店", 12800, 3000)
	if res["result"] != "applied" {
		t.Fatalf("create: %v", res)
	}
	// 记收款(财务变更)。
	pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000a3", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "1"},
		"payload": map[string]any{"kind": "deposit", "method": "微信",
			"paid_at": "2026-11-20T10:00:00Z", "amount_cents": 3000},
	})
	// 授权账号搭档。
	res = opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000a4")
	if res["result"] != "applied" {
		t.Fatalf("grant: %v", res)
	}

	// 搭档拉取:应看到 share.granted(完整投影),绝不能看到本人 order.changed(含财务)。
	page, _ := pullEvents(t, partner, "", 100)
	events := page["events"].([]any)
	foundGrant := false
	for _, e := range events {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.granted" {
			foundGrant = true
			raw, _ := json.Marshal(ev["payload"])
			text := string(raw)
			forbidden := []string{"price_cents", "deposit_cents", "payment", "contact", "note", "channel",
				"order_version", "amount_cents", "微信"}
			for _, f := range forbidden {
				if containsFold(text, f) {
					t.Fatalf("共享投影泄露禁止字段 %q: %s", f, text)
				}
			}
			var proj map[string]any
			if err := json.Unmarshal([]byte(text), &proj); err != nil {
				t.Fatalf("投影 JSON: %v", err)
			}
			for _, need := range []string{"store", "starts_at", "timezone", "owner_display",
				"share_id", "generation", "auth_relation_id", "auth_relation_generation"} {
				if _, ok := proj[need]; !ok {
					t.Fatalf("投影缺少白名单字段 %s: %s", need, text)
				}
			}
			if proj["store"] != "白名单奶茶店" {
				t.Fatalf("投影店名错误: %v", proj["store"])
			}
		}
		if ev["event_type"] == "order.changed" || ev["event_type"] == "order.deleted" {
			t.Fatalf("接收者流绝不能出现本人订单事件: %v", ev["event_type"])
		}
	}
	if !foundGrant {
		t.Fatalf("搭档应收到 share.granted: %v", events)
	}
	// 仅改价/收款不产生新的接收者事件(纯财务变更不侧漏)。
	pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000a5", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "payment.record",
		"precondition": map[string]any{"expected_version": "2"},
		"payload": map[string]any{"kind": "final", "method": "支付宝",
			"paid_at": "2026-11-20T11:00:00Z", "amount_cents": 9800},
	})
	_, next := pullEvents(t, partner, "", 100)
	code, page2 := partner.get("/v1/sync/pull?limit=100&cursor=" + next)
	_ = code
	if evs := page2["events"].([]any); len(evs) != 0 {
		t.Fatalf("纯财务变更不得向搭档发事件: %v", evs)
	}
}

// AC11:改期更新同一投影(revision+1),搭档收到 share.updated 且不重复。
func TestRescheduleUpdatesProjection(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "rs-owner@example.com", "改", "11111111-1111-4111-8111-111111111111")
	partner := registerAndLogin(t, env, "rs-partner@example.com", "接", "22222222-2222-4222-8222-222222222222")
	contactLink(t, owner, partner)
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000b1")
	pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-0000000000b2", "改期店", 5000, 0)
	res := opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000b3")
	if res["result"] != "applied" {
		t.Fatalf("grant: %v", res)
	}
	_, next := pullEvents(t, partner, "", 100) // 消费掉 granted
	// 改期。
	res = pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000b4", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.reschedule",
		"precondition": map[string]any{"expected_version": "1"},
		"payload":       map[string]any{"appt_start": "2026-11-27T06:00:00Z"},
	})
	if res["result"] != "applied" {
		t.Fatalf("reschedule: %v", res)
	}
	code, page := partner.get("/v1/sync/pull?limit=10&cursor=" + next)
	_ = code
	events := page["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("改期应恰好 1 条 share.updated: %v", events)
	}
	ev := events[0].(map[string]any)
	if ev["event_type"] != "share.updated" {
		t.Fatalf("应为 share.updated: %v", ev["event_type"])
	}
	var proj map[string]any
	raw, _ := json.Marshal(ev["payload"])
	_ = json.Unmarshal(raw, &proj)
	if proj["starts_at"] != "2026-11-27T06:00:00.000Z" {
		t.Fatalf("投影时间应更新: %v", proj["starts_at"])
	}
	if proj["generation"] != "1" {
		t.Fatalf("改期不应改变 generation: %v", proj["generation"])
	}
}

// AC11/AC12:撤销共享 → share.purged;拉历史页不再返回内容投影,只得到 purge。
func TestRevokePurgesAndFiltersHistory(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "rv-owner@example.com", "撤", "11111111-1111-4111-8111-111111111111")
	partner := registerAndLogin(t, env, "rv-partner@example.com", "受", "22222222-2222-4222-8222-222222222222")
	contactLink(t, owner, partner)
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000c1")
	pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-0000000000c2", "撤销店", 6000, 0)
	opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000c3")

	// 撤销前:搭档从头拉取,记录 granted。
	page1, _ := pullEvents(t, partner, "", 100)
	var shareID string
	for _, e := range page1["events"].([]any) {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.granted" {
			shareID = ev["share_id"].(string)
		}
	}
	if shareID == "" {
		t.Fatalf("未找到 share_id")
	}
	// 撤销。
	res := pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000c4", "aggregate_type": "grant_set",
		"aggregate_id": grantSetAggregate(owner.userID, orderID, partner.userID),
		"type":         "schedule.revoke",
		"payload":      map[string]any{"share_id": shareID},
	})
	if res["result"] != "applied" {
		t.Fatalf("revoke: %v", res)
	}
	// 拉取增量:应得到 purge。
	page2, _ := pullEvents(t, partner, "", 100)
	found := false
	for _, e := range page2["events"].([]any) {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.purged" && ev["share_id"] == shareID {
			found = true
			if ev["generation"] != "1" {
				t.Fatalf("purge generation: %v", ev["generation"])
			}
			// purge 允许且仅允许携带 share_id/generation,不含任何业务内容。
			if ev["payload"] != nil {
				var pm map[string]any
				rawP, _ := json.Marshal(ev["payload"])
				_ = json.Unmarshal(rawP, &pm)
				for k := range pm {
					if k != "share_id" && k != "generation" {
						t.Fatalf("purge payload 含非法字段 %s: %v", k, pm)
					}
				}
			}
		}
	}
	if !found {
		t.Fatalf("应收到 share.purged: %v", page2)
	}
	// AC12:从历史(游标 0)重新拉取——旧 granted 投影必须被过滤为 purge,不能重新泄露。
	page3, _ := pullEvents(t, partner, "", 100)
	for _, e := range page3["events"].([]any) {
		ev := e.(map[string]any)
		if ev["share_id"] == shareID {
			if ev["event_type"] != "share.purged" {
				t.Fatalf("历史页中已撤销共享必须转为 purge: %v", ev)
			}
		}
	}
}

// 授权代次:撤销后重新授权 generation+1;迟到旧 purge 不影响新代次(服务端事件语义)。
func TestRegrantGeneration(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "rg-owner@example.com", "再", "11111111-1111-4111-8111-111111111111")
	partner := registerAndLogin(t, env, "rg-partner@example.com", "代", "22222222-2222-4222-8222-222222222222")
	contactLink(t, owner, partner)
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000d1")
	pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-0000000000d2", "代次店", 7000, 0)
	opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000d3")

	page, _ := pullEvents(t, partner, "", 100)
	var shareID string
	for _, e := range page["events"].([]any) {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.granted" {
			shareID = ev["share_id"].(string)
			if ev["generation"] != "1" {
				t.Fatalf("首次授权 generation 应为 1: %v", ev["generation"])
			}
		}
	}
	// 撤销。
	pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000d4", "aggregate_type": "grant_set",
		"aggregate_id": grantSetAggregate(owner.userID, orderID, partner.userID),
		"type":         "schedule.revoke",
		"payload":      map[string]any{"share_id": shareID},
	})
	// 重新授权(同 order+recipient):generation=2,projection revision=1。
	res := opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000d5")
	if res["result"] != "applied" {
		t.Fatalf("regrant: %v", res)
	}
	page2, _ := pullEvents(t, partner, "", 100)
	sawPurge, sawGrant2 := false, false
	for _, e := range page2["events"].([]any) {
		ev := e.(map[string]any)
		switch ev["event_type"] {
		case "share.purged":
			if ev["generation"] == "1" {
				sawPurge = true
			}
		case "share.granted":
			if ev["generation"] == "2" && ev["share_id"] == shareID {
				sawGrant2 = true
			}
		}
	}
	if !sawPurge || !sawGrant2 {
		t.Fatalf("应看到 purge(gen1) + granted(gen2): %v", page2)
	}
	// 服务端当前投影 generation=2。
	var gen int64
	if err := env.db.QueryRow(`SELECT generation FROM schedule_grants WHERE share_id = UUID_TO_BIN(?)`, shareID).
		Scan(&gen); err != nil {
		t.Fatal(err)
	}
	if gen != 2 {
		t.Fatalf("重新授权后 generation 应为 2, got %d", gen)
	}
}

// AC10:外部搭档(纯文本)与同名注册账号不自动绑定。
func TestExternalPartnerNotAutoLinked(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "ext-owner@example.com", "外", "11111111-1111-4111-8111-111111111111")
	// 注册账号昵称与外部搭档同名。
	other := registerAndLogin(t, env, "ext-other@example.com", "花花", "22222222-2222-4222-8222-222222222222")
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000e1")
	// partner.assign 到外部搭档"花花"(恰好与注册账号昵称相同)。
	res := pushOp(t, owner, map[string]any{
		"op_id": "aaaaaaaa-0000-4000-8000-0000000000e2", "aggregate_type": "order",
		"aggregate_id": orderID, "type": "order.create",
		"precondition": map[string]any{"expected_version": "0"},
		"payload": map[string]any{"store": "外部店", "price_cents": 8000, "deposit_cents": 0,
			"appt_start": "2026-11-25T02:00:00Z", "settle_via": "private",
			"partner": map[string]any{"type": "external", "external_name": "花花"}},
	})
	if res["result"] != "applied" {
		t.Fatalf("create external: %v", res)
	}
	var ptype string
	var uid []byte
	err := env.db.QueryRow(`SELECT partner_type, partner_user_id FROM order_partner WHERE order_id = UUID_TO_BIN(?)`, orderID).
		Scan(&ptype, &uid)
	if err != nil {
		t.Fatal(err)
	}
	if ptype != "external" {
		t.Fatalf("搭档类型应为 external, got %s", ptype)
	}
	if uid != nil {
		t.Fatalf("外部搭档不得自动绑定注册账号")
	}
	// 同名注册账号的流里不应有任何共享事件。
	page, _ := pullEvents(t, other, "", 100)
	for _, e := range page["events"].([]any) {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.granted" {
			t.Fatalf("同名不得自动共享: %v", ev)
		}
	}
}

// AC09 服务端部分:未授权者拉不到任何共享;grant 缺联系关系被拒。
func TestGrantRequiresContactRelation(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "nc-owner@example.com", "无", "11111111-1111-4111-8111-111111111111")
	stranger := registerAndLogin(t, env, "nc-stranger@example.com", "陌", "22222222-2222-4222-8222-222222222222")
	orderID := uuid("aaaaaaaa-0000-4000-8000-0000000000f1")
	pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-0000000000f2", "陌生店", 4000, 0)
	res := opGrant(t, owner, orderID, stranger.userID, "partner", "aaaaaaaa-0000-4000-8000-0000000000f3")
	if res["result"] != "rejected" || res["error_code"] != "relation_missing" {
		t.Fatalf("无联系关系授权必须拒绝: %v", res)
	}
	// 陌生人拉取:无 share 事件。
	page, _ := pullEvents(t, stranger, "", 100)
	for _, e := range page["events"].([]any) {
		ev := e.(map[string]any)
		if ev["event_type"] == "share.granted" {
			t.Fatalf("未授权不得收到共享: %v", ev)
		}
	}
}

// 删除联系关系:该代次授权全部撤销,双方收到 relation.purged;重新接受是新代次。
func TestContactDeleteRevokesGrants(t *testing.T) {
	env := newEnv(t)
	owner := registerAndLogin(t, env, "cd-owner@example.com", "删", "11111111-1111-4111-8111-111111111111")
	partner := registerAndLogin(t, env, "cd-partner@example.com", "系", "22222222-2222-4222-8222-222222222222")
	contactLink(t, owner, partner)
	orderID := uuid("aaaaaaaa-0000-4000-8000-000000000101")
	pushCreate(t, owner, orderID, "aaaaaaaa-0000-4000-8000-000000000102", "联系店", 9000, 0)
	opGrant(t, owner, orderID, partner.userID, "partner", "aaaaaaaa-0000-4000-8000-000000000103")

	_, contacts := partner.get("/v1/contacts")
	list := contacts["contacts"].([]any)
	contactID := list[0].(map[string]any)["contact_id"].(string)
	delCode, delResp := partner.do("DELETE", "/v1/contacts/"+contactID, nil)
	if delCode != 200 {
		t.Fatalf("删除联系: %d %v", delCode, delResp)
	}
	// 双方都收到 relation.purged + share.purged。
	for _, cc := range []*client{owner, partner} {
		page, _ := pullEvents(t, cc, "", 100)
		sawRelation := false
		for _, e := range page["events"].([]any) {
			ev := e.(map[string]any)
			if ev["event_type"] == "relation.purged" {
				sawRelation = true
				var payload map[string]any
				raw, _ := json.Marshal(ev["payload"])
				_ = json.Unmarshal(raw, &payload)
				if payload["auth_relation_id"] != contactID {
					t.Fatalf("relation.purged 应携带精确关系 ID: %v", payload)
				}
			}
		}
		if !sawRelation {
			t.Fatalf("应收到 relation.purged: %v", page)
		}
	}
	// 授权已撤销。
	var active int
	if err := env.db.QueryRow(`SELECT COUNT(*) FROM schedule_grants WHERE status='active'`).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 0 {
		t.Fatalf("删除联系后不得有 active 授权, got %d", active)
	}
}

func containsFold(s, sub string) bool {
	return len(s) >= len(sub) && (indexOfFold(s, sub) >= 0)
}

func indexOfFold(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if equalFold(s[i:i+len(sub)], sub) {
			return i
		}
	}
	return -1
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
