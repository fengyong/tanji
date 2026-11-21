package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"tanji/backend/internal/store"
)

var (
	ErrSessionInvalid = errors.New("会话无效或已失效")
	ErrUserNotFound   = errors.New("账号不存在")
	ErrUserDisabled   = errors.New("账号不可用")
)

// Store 封装会话与账号数据访问。所有会话变更锁 users 行,保证单有效会话原子性。
type Store struct {
	DB        *sql.DB
	Logger    *slog.Logger
	SessionTTL time.Duration
	Now       func() time.Time
}

func NewStore(db *sql.DB, logger *slog.Logger) *Store {
	return &Store{DB: db, Logger: logger, SessionTTL: 30 * 24 * time.Hour, Now: time.Now}
}

// NormalizeEmail 邮箱标准化:去空格、小写本地+域名(仅 ASCII;不处理 unusual 大小写规则)。
func NormalizeEmail(raw string) string {
	s := ""
	for _, r := range raw {
		if r != ' ' && r != '\t' {
			s += string(r)
		}
	}
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out = append(out, c)
	}
	return string(out)
}

type userRow struct {
	ID          store.ID
	EmailNorm   string
	Nickname    string
	Status      string
	ActiveSess  sql.Null[[]byte]
	AuthEpoch   int64
	Threshold   int
	Timezone    string
}

func (s *Store) userByColumn(ctx context.Context, col string, val any) (*userRow, error) {
	if col != "id" && col != "email_norm" {
		return nil, fmt.Errorf("auth: bad lookup column")
	}
	u := &userRow{}
	var active sql.Null[[]byte]
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, email_norm, nickname, status, active_session_id, auth_epoch, collect_threshold_days, ledger_timezone
		 FROM users WHERE `+col+` = ?`, val).Scan(
		&u.ID, &u.EmailNorm, &u.Nickname, &u.Status, &active, &u.AuthEpoch, &u.Threshold, &u.Timezone)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	u.ActiveSess = active
	return u, nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (*userRow, error) {
	return s.userByColumn(ctx, "email_norm", NormalizeEmail(email))
}

func (s *Store) UserByID(ctx context.Context, id store.ID) (*userRow, error) {
	return s.userByColumn(ctx, "id", id[:])
}

type SessionInfo struct {
	SessionID store.ID
	UserID    store.ID
	DeviceID  store.ID
	AuthEpoch int64
	ExpiresAt time.Time
}

// Login 校验密码并以原子方式替换单有效会话:
// 锁 users 行 → 校验状态/密码 → 创建新 session → active_session_id 指向新会话 → 旧会话标记撤销。
func (s *Store) Login(ctx context.Context, email, password string, deviceID store.ID) (token []byte, sess *SessionInfo, u *userRow, err error) {
	now := s.Now().UTC()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var uid store.ID
	var hash string
	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT id, password_hash, status FROM users WHERE email_norm = ? FOR UPDATE`,
		NormalizeEmail(email)).Scan(&uid, &hash, &status)
	if errors.Is(err, sql.ErrNoRows) {
		// 不泄露邮箱是否注册:统一耗时路径。
		_, _ = VerifyPassword(password, dummyHash)
		return nil, nil, nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, nil, nil, err
	}
	ok, perr := VerifyPassword(password, hash)
	if perr != nil || !ok {
		return nil, nil, nil, ErrInvalidCredentials
	}
	if status != "active" {
		return nil, nil, nil, ErrUserDisabled
	}

	raw, terr := store.RandomToken()
	if terr != nil {
		return nil, nil, nil, terr
	}
	// Cookie/Authorization 传输使用 base64url 文本形式;哈希针对传输形式。
	rawToken := []byte(base64.RawURLEncoding.EncodeToString(raw))
	sessionID := store.NewID()
	expires := now.Add(s.SessionTTL)
	if _, err = tx.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, device_id, auth_epoch, token_hash, expires_at, created_at, last_seen_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		sessionID[:], uid[:], deviceID[:], 0, HashToken(rawToken), expires, now, now); err != nil {
		return nil, nil, nil, err
	}
	var authEpoch int64
	if _, err = tx.ExecContext(ctx,
		`UPDATE users SET active_session_id = ?, updated_at = ? WHERE id = ?`,
		sessionID[:], now, uid[:]); err != nil {
		return nil, nil, nil, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT auth_epoch FROM users WHERE id = ?`, uid[:]).Scan(&authEpoch); err != nil {
		return nil, nil, nil, err
	}
	if _, err = tx.ExecContext(ctx,
		`UPDATE sessions SET auth_epoch = ? WHERE id = ?`, authEpoch, sessionID[:]); err != nil {
		return nil, nil, nil, err
	}
	if _, err = tx.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL`,
		now, uid[:], sessionID[:]); err != nil {
		return nil, nil, nil, err
	}
	if _, err = tx.ExecContext(ctx,
		`INSERT INTO audit_events (id, user_id, event_type, detail, created_at)
		 VALUES (?,?,?,?,?)`,
		store.NewID().Slice(), uid[:], "session.replaced", `{"reason":"new_login"}`, now); err != nil {
		return nil, nil, nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, nil, nil, err
	}
	return rawToken, &SessionInfo{SessionID: sessionID, UserID: uid, DeviceID: deviceID,
		AuthEpoch: authEpoch, ExpiresAt: expires}, nil, nil
}

var ErrInvalidCredentials = errors.New("auth: 邮箱或密码不正确")

var dummyHash = func() string {
	// 与真实哈希同格式,用于不存在账号时的恒定耗时路径。
	h, _ := HashPassword("dummy-password-0123456789", DefaultArgonParams())
	return h
}()

// VerifySessionToken 通过令牌查找哈希定位会话;不锁行(读路径)。
// 返回会话与用户状态;调用方在业务写入路径必须再次锁行核验(见 LockUserForWrite)。
func (s *Store) VerifySessionToken(ctx context.Context, token []byte) (*SessionInfo, *userRow, error) {
	hash := sha256.Sum256(token)
	now := s.Now().UTC()
	var sess SessionInfo
	var status string
	var active sql.Null[[]byte]
	err := s.DB.QueryRowContext(ctx,
		`SELECT se.id, se.user_id, se.device_id, se.auth_epoch, se.expires_at, u.status, u.active_session_id
		 FROM sessions se JOIN users u ON u.id = se.user_id
		 WHERE se.token_hash = ? AND se.revoked_at IS NULL`, hash[:]).Scan(
		&sess.SessionID, &sess.UserID, &sess.DeviceID, &sess.AuthEpoch, &sess.ExpiresAt, &status, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrSessionInvalid
	}
	if err != nil {
		return nil, nil, err
	}
	if now.After(sess.ExpiresAt) {
		return nil, nil, ErrSessionInvalid
	}
	if status != "active" {
		return nil, nil, ErrUserDisabled
	}
	// 单有效会话:token 未撤销但仍不是当前 active 会话 → 已被新登录替换。
	if !active.Valid || store.ID(active.V) != sess.SessionID {
		return nil, nil, ErrSessionInvalid
	}
	u, err := s.UserByID(ctx, sess.UserID)
	if err != nil {
		return nil, nil, err
	}
	if _, err = s.DB.ExecContext(ctx,
		`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, now, sess.SessionID[:]); err != nil {
		return nil, nil, err
	}
	return &sess, u, nil
}

// LockUserForWrite 在写事务内锁定 users 行并核验会话仍是当前有效会话。
// 新登录提交后旧事务必须在这里失败。
func (s *Store) LockUserForWrite(ctx context.Context, tx *sql.Tx, sess SessionCtx) error {
	var active sql.Null[[]byte]
	var status string
	var epoch int64
	now := s.Now().UTC()
	err := tx.QueryRowContext(ctx,
		`SELECT active_session_id, status, auth_epoch FROM users WHERE id = ? FOR UPDATE`,
		sess.UserID[:]).Scan(&active, &status, &epoch)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrSessionInvalid
	}
	if err != nil {
		return err
	}
	if status != "active" {
		return ErrUserDisabled
	}
	if epoch != sess.AuthEpoch {
		return ErrSessionInvalid
	}
	if !active.Valid || store.ID(active.V) != sess.SessionID {
		return ErrSessionInvalid
	}
	var revoked sql.NullTime
	var expires time.Time
	serr := tx.QueryRowContext(ctx,
		`SELECT expires_at, revoked_at FROM sessions WHERE id = ? FOR UPDATE`,
		sess.SessionID[:]).Scan(&expires, &revoked)
	if errors.Is(serr, sql.ErrNoRows) {
		return ErrSessionInvalid
	}
	if serr != nil {
		return serr
	}
	if revoked.Valid || now.After(expires) {
		return ErrSessionInvalid
	}
	return nil
}

// SessionCtx 是请求上下文里的已验证会话身份。
type SessionCtx struct {
	UserID    store.ID
	SessionID store.ID
	DeviceID  store.ID
	AuthEpoch int64
}

// Logout 撤销当前会话(锁行,清 active_session_id)。
func (s *Store) Logout(ctx context.Context, sess SessionCtx) error {
	now := s.Now().UTC()
	return withTx(ctx, s.DB, func(tx *sql.Tx) error {
		var active sql.Null[[]byte]
		err := tx.QueryRowContext(ctx,
			`SELECT active_session_id FROM users WHERE id = ? FOR UPDATE`, sess.UserID[:]).Scan(&active)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSessionInvalid
		}
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx,
			`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, sess.SessionID[:]); err != nil {
			return err
		}
		if active.Valid && store.ID(active.V) == sess.SessionID {
			if _, err = tx.ExecContext(ctx,
				`UPDATE users SET active_session_id = NULL, updated_at = ? WHERE id = ?`, now, sess.UserID[:]); err != nil {
				return err
			}
		}
		return nil
	})
}

func withTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// CreateSessionTokenCookieName 等常量供 HTTP 层使用。
const CookieName = "tanji_session"
const CSRFHeader = "X-Tanji-CSRF"
const CSRFTokenLen = 32

// CSRFToken 从会话令牌派生双提交 CSRF 令牌(SHA-256 前 16 字节 hex)。
// 明文会话令牌不出现在任何 JS 可读位置;CSRF 令牌单独以非 HttpOnly cookie 下发。
func CSRFToken(sessionToken []byte) string {
	h := sha256.Sum256(append([]byte("csrf:"), sessionToken...))
	return hex.EncodeToString(h[:16])
}
