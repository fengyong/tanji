// 集成测试基础设施:使用真实 MySQL(环境变量 TANJI_TEST_MYSQL_*,默认本机 33306 root)。
// 每个测试运行使用独立数据库并在结束时删除;不触碰开发库 tanji。
package tests

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/pressly/goose/v3"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/engine"
	"tanji/backend/internal/httpapi"
	"tanji/backend/internal/notify"
)

func testDSNConfig(t *testing.T) (adminDSN, dbDSN, dbName string, cleanup func()) {
	t.Helper()
	host := envOr("TANJI_TEST_MYSQL_HOST", "127.0.0.1")
	port := envOr("TANJI_TEST_MYSQL_PORT", "33306")
	user := envOr("TANJI_TEST_MYSQL_USER", "root")
	pass := envOr("TANJI_TEST_MYSQL_PASS", "")
	adminDSN = fmt.Sprintf("%s:%s@tcp(%s:%s)/?parseTime=true&loc=UTC&charset=utf8mb4&multiStatements=true", user, pass, host, port)
	dbName = fmt.Sprintf("%s%d", testDBPrefix, time.Now().UnixNano()%10000000)
	dbDSN = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=UTC&charset=utf8mb4&multiStatements=true", user, pass, host, port, dbName)
	return adminDSN, dbDSN, dbName, func() {}
}

const testDBPrefix = "tanji_test_"

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	adminDSN, dbDSN, dbName, _ := testDSNConfig(t)
	admin, err := sql.Open("mysql", adminDSN)
	if err != nil {
		t.Skipf("无法连接测试 MySQL: %v", err)
	}
	defer admin.Close()
	if err := admin.Ping(); err != nil {
		t.Skipf("测试 MySQL 不可用(%s): %v", adminDSN, err)
	}
	if _, err := admin.Exec("CREATE DATABASE IF NOT EXISTS " + dbName +
		" CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"); err != nil {
		t.Fatalf("创建测试数据库失败: %v", err)
	}
	db, err := sql.Open("mysql", dbDSN)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Skipf("测试库 ping 失败: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
		a2, _ := sql.Open("mysql", adminDSN)
		if a2 != nil {
			_, _ = a2.Exec("DROP DATABASE IF EXISTS " + dbName)
			a2.Close()
		}
	})
	return db
}

func migrateDB(t *testing.T, db *sql.DB) {
	t.Helper()
	if err := goose.SetDialect("mysql"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.UpContext(context.Background(), db, "../migrations"); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}
}

type testEnv struct {
	db     *sql.DB
	server *httptest.Server
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	db := openTestDB(t)
	migrateDB(t, db)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	authStore := auth.NewStore(db, log)
	eng := engine.New(db, log)
	hub := notify.NewHub(log)
	srv := httpapi.NewServer(db, authStore, eng, hub, &auth.LogSender{Log: log}, log, true)
	ts := httptest.NewServer(srv.Routes())
	t.Cleanup(ts.Close)
	return &testEnv{db: db, server: ts}
}

// ---- HTTP 测试客户端:从 Set-Cookie 提取会话令牌,以 Bearer 形式复用 ----

type client struct {
	t      *testing.T
	base   string
	token  string
	csrf   string
	device string
	userID string
}

func newClient(env *testEnv, device string) *client {
	return &client{t: nil, base: env.server.URL, device: device}
}

func (c *client) do(method, path string, body any) (int, map[string]any) {
	t := c.t
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.csrf != "" {
		req.Header.Set("X-Tanji-CSRF", c.csrf)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	for _, ck := range resp.Cookies() {
		if ck.Name == "tanji_session" && ck.Value != "" {
			c.token = ck.Value
		}
	}
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (c *client) get(path string) (int, map[string]any) { return c.do("GET", path, nil) }

func (c *client) post(path string, body any) (int, map[string]any) {
	return c.do("POST", path, body)
}

// registerAndLogin 走完整 注册→验证→登录 流程。
func registerAndLogin(t *testing.T, env *testEnv, email, nickname, device string) *client {
	t.Helper()
	c := &client{t: t, base: env.server.URL, device: device}
	code, resp := c.post("/v1/auth/register", map[string]any{
		"email": email, "password": "password-123456", "nickname": nickname})
	if code != 200 {
		t.Fatalf("注册失败: %d %v", code, resp)
	}
	devCode, _ := resp["dev_code"].(string)
	if devCode == "" {
		t.Fatalf("dev 模式应返回验证码: %v", resp)
	}
	code, resp = c.post("/v1/auth/verify-email", map[string]any{"email": email, "code": devCode})
	if code != 200 {
		t.Fatalf("验证失败: %d %v", code, resp)
	}
	code, resp = c.post("/v1/auth/login", map[string]any{
		"email": email, "password": "password-123456", "device_id": device})
	if code != 200 {
		t.Fatalf("登录失败: %d %v", code, resp)
	}
	c.userID, _ = resp["user_id"].(string)
	c.csrf, _ = resp["csrf"].(string)
	return c
}

func loginExisting(t *testing.T, env *testEnv, email, device string) *client {
	t.Helper()
	c := &client{t: t, base: env.server.URL, device: device}
	code, resp := c.post("/v1/auth/login", map[string]any{
		"email": email, "password": "password-123456", "device_id": device})
	if code != 200 {
		t.Fatalf("登录失败: %d %v", code, resp)
	}
	c.userID, _ = resp["user_id"].(string)
	return c
}

// truncateAll 清空业务表(测试库专用)。
func truncateAll(t *testing.T, db *sql.DB) {
	t.Helper()
	tables := []string{
		"audit_events", "bootstrap_pages", "bootstrap_snapshots", "entity_tombstones",
		"user_changes", "user_stream_heads", "account_domain_guards", "mutation_receipts",
		"schedule_projections", "schedule_grants", "active_receipts", "payment_entries",
		"order_partner", "order_places", "orders", "contact_invites", "contact_links",
		"verification_challenges", "sessions", "users",
	}
	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	for _, tb := range tables {
		if _, err := db.Exec("TRUNCATE TABLE " + tb); err != nil {
			t.Fatalf("truncate %s: %v", tb, err)
		}
	}
	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
}
