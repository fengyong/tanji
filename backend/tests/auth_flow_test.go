package tests

import (
	"testing"
)

// AC06 服务端身份部分:新登录使旧会话失效;旧设备任意请求 401。
func TestSingleSessionReplacesOld(t *testing.T) {
	env := newEnv(t)
	deviceA := "11111111-1111-4111-8111-111111111111"
	deviceB := "22222222-2222-4222-8222-222222222222"

	ca := registerAndLogin(t, env, "single@example.com", "甲", deviceA)
	code, _ := ca.get("/v1/session")
	if code != 200 {
		t.Fatalf("设备 A 会话应有效, got %d", code)
	}
	// 设备 B 同账号登录(新登录替换旧会话)。
	cb := loginExisting(t, env, "single@example.com", deviceB)
	code, _ = cb.get("/v1/session")
	if code != 200 {
		t.Fatalf("设备 B 会话应有效, got %d", code)
	}
	// 设备 A 的旧会话失效。
	code, body := ca.get("/v1/session")
	if code != 401 {
		t.Fatalf("旧会话必须失效(401), got %d %v", code, body)
	}
	// 旧设备带有效收款的写请求也应被拒绝(会话边界)。
	code, _ = ca.post("/v1/sync/push", map[string]any{
		"protocol_version": 1, "account_id": ca.userID, "device_id": deviceA, "operations": []any{}})
	if code != 401 {
		t.Fatalf("旧会话 push 必须 401, got %d", code)
	}
}

// 登录失败不泄露邮箱是否注册。
func TestLoginDoesNotRevealRegistration(t *testing.T) {
	env := newEnv(t)
	registerAndLogin(t, env, "known@example.com", "知", "11111111-1111-4111-8111-111111111111")
	c := &client{t: t, base: env.server.URL}
	code1, b1 := c.post("/v1/auth/login", map[string]any{
		"email": "known@example.com", "password": "wrong-password-x", "device_id": "11111111-1111-4111-8111-111111111111"})
	code2, b2 := c.post("/v1/auth/login", map[string]any{
		"email": "ghost@example.com", "password": "wrong-password-x", "device_id": "11111111-1111-4111-8111-111111111111"})
	if code1 != code2 || b1["message"] != b2["message"] {
		t.Fatalf("登录失败提示必须一致, got %d/%v vs %d/%v", code1, b1, code2, b2)
	}
}

// 重复注册返回同一文案,不泄露已注册状态。
func TestRegisterDuplicateNoLeak(t *testing.T) {
	env := newEnv(t)
	c := &client{t: t, base: env.server.URL}
	code1, b1 := c.post("/v1/auth/register", map[string]any{
		"email": "dup@example.com", "password": "password-123456", "nickname": "一"})
	code2, b2 := c.post("/v1/auth/register", map[string]any{
		"email": "dup@example.com", "password": "password-123456", "nickname": "二"})
	if code1 != code2 || b1["message"] != b2["message"] {
		t.Fatalf("注册响应必须一致, got %d/%v vs %d/%v", code1, b1, code2, b2)
	}
}

// 找回密码:重置后全部会话失效,旧令牌不能再上传。
func TestPasswordResetRevokesSessions(t *testing.T) {
	env := newEnv(t)
	device := "11111111-1111-4111-8111-111111111111"
	ca := registerAndLogin(t, env, "reset@example.com", "重", device)

	c := &client{t: t, base: env.server.URL}
	code, resp := c.post("/v1/auth/password/forgot", map[string]any{"email": "reset@example.com"})
	if code != 200 {
		t.Fatalf("forgot: %d %v", code, resp)
	}
	devCode, _ := resp["dev_code"].(string)
	if devCode == "" {
		t.Fatalf("dev 模式应返回验证码")
	}
	code, resp = c.post("/v1/auth/password/reset", map[string]any{
		"email": "reset@example.com", "code": devCode, "new_password": "new-password-654321"})
	if code != 200 {
		t.Fatalf("reset: %d %v", code, resp)
	}
	// 旧会话失效。
	code, _ = ca.get("/v1/session")
	if code != 401 {
		t.Fatalf("重置密码后旧会话必须失效, got %d", code)
	}
	// 新密码可登录。
	cb := loginExistingWithPassword(t, env, "reset@example.com", "new-password-654321", device)
	if code, _ := cb.get("/v1/session"); code != 200 {
		t.Fatalf("新密码登录后应有效")
	}
}

func loginExistingWithPassword(t *testing.T, env *testEnv, email, password, device string) *client {
	t.Helper()
	c := &client{t: t, base: env.server.URL, device: device}
	code, resp := c.post("/v1/auth/login", map[string]any{
		"email": email, "password": password, "device_id": device})
	if code != 200 {
		t.Fatalf("登录失败: %d %v", code, resp)
	}
	c.userID, _ = resp["user_id"].(string)
	return c
}

// 登出后令牌失效。
func TestLogout(t *testing.T) {
	env := newEnv(t)
	c := registerAndLogin(t, env, "bye@example.com", "别", "11111111-1111-4111-8111-111111111111")
	if code, _ := c.post("/v1/auth/logout", nil); code != 200 {
		t.Fatalf("logout 应成功")
	}
	if code, _ := c.get("/v1/session"); code != 401 {
		t.Fatalf("登出后请求应 401, got %d", code)
	}
}

// 密码策略:最少 12 字符。
func TestPasswordPolicy(t *testing.T) {
	env := newEnv(t)
	c := &client{t: t, base: env.server.URL}
	code, _ := c.post("/v1/auth/register", map[string]any{
		"email": "short@example.com", "password": "short-pass!", "nickname": "短"})
	if code == 200 {
		t.Fatalf("短于 12 字符的密码应被拒绝")
	}
}
