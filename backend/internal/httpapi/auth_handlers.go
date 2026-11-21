package httpapi

import (	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/store"
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`)
var nicknameRe = regexp.MustCompile(`^[\p{Han}\p{L}\p{N}_\- ]{1,64}$`)

type registerReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

// handleRegister:响应不泄露邮箱是否已注册(统一提示)。
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := decodeJSON(r, &req, 8<<10); err != nil {
		writeErr(w, err, s.Log, "register")
		return
	}
	email := auth.NormalizeEmail(strings.TrimSpace(req.Email))
	if !emailRe.MatchString(email) || len(email) > 254 {
		writeJSON(w, 400, apiErr(400, "invalid_email", "邮箱格式无效"))
		return
	}
	nickname := strings.TrimSpace(req.Nickname)
	if !nicknameRe.MatchString(nickname) {
		writeJSON(w, 400, apiErr(400, "invalid_nickname", "昵称须为 1~64 个字符(汉字/字母/数字/空格/连字符)"))
		return
	}
	hash, err := auth.HashPassword(req.Password, auth.DefaultArgonParams())
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_password", err.Error()))
		return
	}
	now := time.Now().UTC()
	var code string
	err = store.WithTx(r.Context(), s.DB, func(tx *sql.Tx) error {
		var existing int
		if err := tx.QueryRowContext(r.Context(),
			`SELECT 1 FROM users WHERE email_norm = ?`, email).Scan(&existing); err == nil {
			// 已注册:走同一发送路径但始终失败于挑战?不——为避免重发验证码滥用,静默成功提示。
			return errEmailTaken
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(r.Context(),
			`INSERT INTO users (id, email_norm, email_display, nickname, password_hash, status, created_at, updated_at)
			 VALUES (?,?,?,?,?, 'pending', ?, ?)`,
			store.NewID().Slice(), email, strings.TrimSpace(req.Email), nickname, hash, now, now); err != nil {
			return err
		}
		return nil
	})
	switch {
	case err == errEmailTaken:
		// 与成功路径同一文案,不泄露注册状态;但执行一次假耗时验证码生成以均衡时序。
		_, _ = s.Auth.IssueChallenge(r.Context(), auth.PurposeRegister, "timing-balance@invalid")
		s.respondChallenge(w, r, "", "", nil)
		return
	case err != nil:
		writeErr(w, err, s.Log, "register")
		return
	}
	code, err = s.Auth.IssueChallenge(r.Context(), auth.PurposeRegister, email)
	if err != nil {
		writeErr(w, err, s.Log, "register-challenge")
		return
	}
	if serr := s.Mailer.SendVerification(email, nickname, code, auth.PurposeRegister); serr != nil {
		s.Log.Warn("verification mail failed", "err", serr.Error())
	}
	s.respondChallenge(w, r, email, nickname, &code)
}

var errEmailTaken = errors.New("email taken")

// respondChallenge:开发环境把验证码带回给客户端(仅 DevMode),生产绝不返回。
func (s *Server) respondChallenge(w http.ResponseWriter, r *http.Request, email, nickname string, code *string) {
	resp := map[string]any{"ok": true, "message": "如果该邮箱可用于注册,验证码已发送;请在 10 分钟内完成验证"}
	if s.DevMode && code != nil {
		resp["dev_code"] = *code
		resp["dev_email"] = email
		resp["dev_nickname"] = nickname
	}
	writeJSON(w, 200, resp)
}

type verifyEmailReq struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailReq
	if err := decodeJSON(r, &req, 4<<10); err != nil {
		writeErr(w, err, s.Log, "verify-email")
		return
	}
	email := auth.NormalizeEmail(strings.TrimSpace(req.Email))
	if err := s.Auth.ConsumeChallenge(r.Context(), auth.PurposeRegister, email, strings.TrimSpace(req.Code)); err != nil {
		writeJSON(w, 400, apiErr(400, "code_invalid", err.Error()))
		return
	}
	now := time.Now().UTC()
	res, err := s.DB.ExecContext(r.Context(),
		`UPDATE users SET status='active', updated_at=? WHERE email_norm=? AND status='pending'`,
		now, email)
	if err != nil {
		writeErr(w, err, s.Log, "verify-email-activate")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, 400, apiErr(400, "code_invalid", "验证码不正确或已过期"))
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": "账号已激活,请登录"})
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	DeviceID string `json:"device_id"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := decodeJSON(r, &req, 8<<10); err != nil {
		writeErr(w, err, s.Log, "login")
		return
	}
	deviceID, err := store.ParseID(req.DeviceID)
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_device", "device_id 必须是 UUID"))
		return
	}
	token, sess, _, err := s.Auth.Login(r.Context(), req.Email, req.Password, deviceID)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			writeJSON(w, 401, apiErr(401, "invalid_credentials", "邮箱或密码不正确"))
			return
		}
		if errors.Is(err, auth.ErrUserDisabled) {
			writeJSON(w, 403, apiErr(403, "account_disabled", "账号不可用,请先完成邮箱验证或联系支持"))
			return
		}
		writeErr(w, err, s.Log, "login")
		return
	}
	s.setSessionCookie(w, r, token, sess.ExpiresAt)
	writeJSON(w, 200, sessionView(sess, auth.CSRFToken(token)))
}

// sessionView 统一的会话/账号标识视图。
func sessionView(sess *auth.SessionInfo, csrf string) map[string]any {
	return map[string]any{
		"user_id":    sess.UserID.String(),
		"session_id": sess.SessionID.String(),
		"device_id":  sess.DeviceID.String(),
		"auth_epoch": sess.AuthEpoch,
		"expires_at": sess.ExpiresAt.UTC().Format(time.RFC3339),
		"csrf":       csrf,
	}
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token []byte, expires time.Time) {
	secure := r.TLS != nil || s.ForceSecureCookies()
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    string(token),
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
	})
	// CSRF 双提交令牌:JS 可读,不含会话令牌本身。
	http.SetCookie(w, &http.Cookie{
		Name:     "tanji_csrf",
		Value:    auth.CSRFToken(token),
		Path:     "/",
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName, Value: "", Path: "/", HttpOnly: true,
		MaxAge: -1, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: "tanji_csrf", Value: "", Path: "/",
		MaxAge: -1, SameSite: http.SameSiteLaxMode})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "logout")
		return
	}
	if err := s.Auth.Logout(r.Context(), sess); err != nil {
		writeErr(w, err, s.Log, "logout")
		return
	}
	s.clearSessionCookie(w)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "get-session")
		return
	}
	u, err := s.Auth.UserByID(r.Context(), sess.UserID)
	if err != nil {
		writeErr(w, err, s.Log, "get-session")
		return
	}
	writeJSON(w, 200, map[string]any{
		"user_id": u.ID.String(), "nickname": u.Nickname, "email": u.EmailNorm,
		"session_id": sess.SessionID.String(), "device_id": sess.DeviceID.String(),
		"auth_epoch": sess.AuthEpoch,
		"settings":   map[string]any{"collect_threshold_days": u.Threshold, "timezone": u.Timezone},
	})
}

type forgotReq struct{ Email string `json:"email"` }

func (s *Server) handleForgot(w http.ResponseWriter, r *http.Request) {
	var req forgotReq
	if err := decodeJSON(r, &req, 4<<10); err != nil {
		writeErr(w, err, s.Log, "forgot")
		return
	}
	email := auth.NormalizeEmail(strings.TrimSpace(req.Email))
	u, err := s.Auth.UserByEmail(r.Context(), email)
	resp := map[string]any{"ok": true, "message": "如果该邮箱已注册,找回验证码已发送"}
	if err == nil && (u.Status == "active" || u.Status == "pending") {
		code, cerr := s.Auth.IssueChallenge(r.Context(), auth.PurposeForgot, email)
		if cerr == nil {
			if serr := s.Mailer.SendVerification(email, u.Nickname, code, auth.PurposeForgot); serr != nil {
				s.Log.Warn("forgot mail failed", "err", serr.Error())
			}
			if s.DevMode {
				resp["dev_code"] = code
			}
		}
	}
	writeJSON(w, 200, resp)
}

type resetReq struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

// handleReset:重置密码必须使此前全部会话失效并推进 auth_epoch(旧令牌不能复活)。
func (s *Server) handleReset(w http.ResponseWriter, r *http.Request) {
	var req resetReq
	if err := decodeJSON(r, &req, 8<<10); err != nil {
		writeErr(w, err, s.Log, "reset")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword, auth.DefaultArgonParams())
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_password", err.Error()))
		return
	}
	email := auth.NormalizeEmail(strings.TrimSpace(req.Email))
	if err := s.Auth.ConsumeChallenge(r.Context(), auth.PurposeForgot, email, strings.TrimSpace(req.Code)); err != nil {
		writeJSON(w, 400, apiErr(400, "code_invalid", err.Error()))
		return
	}
	now := time.Now().UTC()
	err = store.WithTx(r.Context(), s.DB, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(r.Context(),
			`UPDATE users SET password_hash=?, active_session_id=NULL, auth_epoch=auth_epoch+1, updated_at=?
			 WHERE email_norm=? AND status='active'`, hash, now, email)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return auth.ErrUserNotFound
		}
		if _, err := tx.ExecContext(r.Context(),
			`UPDATE sessions SET revoked_at=? WHERE user_id=(SELECT id FROM users WHERE email_norm=?) AND revoked_at IS NULL`,
			now, email); err != nil {
			return err
		}
		_, err = tx.ExecContext(r.Context(),
			`INSERT INTO audit_events (id, user_id, event_type, detail, created_at)
			 SELECT ?, id, 'password.reset', '{}', ? FROM users WHERE email_norm=?`,
			store.NewID().Slice(), now, email)
		return err
	})
	if errors.Is(err, auth.ErrUserNotFound) {
		writeJSON(w, 400, apiErr(400, "code_invalid", "验证码不正确或已过期"))
		return
	}
	if err != nil {
		writeErr(w, err, s.Log, "reset")
		return
	}
	s.Notify.NotifyUsers(nil)
	writeJSON(w, 200, map[string]any{"ok": true, "message": "密码已重置,请用新密码登录;原设备会话已全部失效"})
}

type deactivateReq struct{ Password string `json:"password"` }

// handleDeactivate:停用账号须联网 + 再次认证 + 会话失效;发出的共享授权全部撤销(接收者收到 purge)。
func (s *Server) handleDeactivate(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "deactivate")
		return
	}
	var req deactivateReq
	if err := decodeJSON(r, &req, 4<<10); err != nil {
		writeErr(w, err, s.Log, "deactivate")
		return
	}
	var hash string
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT password_hash FROM users WHERE id = ?`, sess.UserID[:]).Scan(&hash)
	if err != nil {
		writeErr(w, err, s.Log, "deactivate")
		return
	}
	if okPw, perr := auth.VerifyPassword(req.Password, hash); perr != nil || !okPw {
		writeJSON(w, 403, apiErr(403, "invalid_credentials", "密码不正确"))
		return
	}
	now := time.Now().UTC()
	err = store.WithTx(r.Context(), s.DB, func(tx *sql.Tx) error {
		ctx := r.Context()
		// 锁用户行,校验仍是当前会话。
		var active sql.Null[[]byte]
		if err := tx.QueryRowContext(ctx,
			`SELECT active_session_id FROM users WHERE id = ? FOR UPDATE`, sess.UserID[:]).Scan(&active); err != nil {
			return err
		}
		if !active.Valid || store.ID(active.V) != sess.SessionID {
			return auth.ErrSessionInvalid
		}
		// 撤销其发出的全部有效授权并通知接收者。
		grants, err := queryOwnerActiveGrants(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		for _, g := range grants {
			if _, err := tx.ExecContext(ctx,
				`UPDATE schedule_grants SET status='revoked', revoked_at=? WHERE id=?`, now, g.id[:]); err != nil {
				return err
			}
			if err := emitPurgeEvent(ctx, tx, g.recipient, g.shareID, g.generation); err != nil {
				return err
			}
			if err := emitPurgeEvent(ctx, tx, sess.UserID[:], g.shareID, g.generation); err != nil {
				return err
			}
		}
		// 删除其向他人发出的全部联系关系(双向),并通知对方。
		if err := deleteContactsOf(ctx, tx, sess.UserID, now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE users SET status='disabled', active_session_id=NULL, auth_epoch=auth_epoch+1, updated_at=? WHERE id=?`,
			now, sess.UserID[:]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, now, sess.UserID[:]); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx,
			`INSERT INTO audit_events (id, user_id, event_type, detail, created_at) VALUES (?,?,?,?,?)`,
			store.NewID().Slice(), sess.UserID[:], "account.deactivated", "{}", now)
		return err
	})
	if err != nil {
		writeErr(w, err, s.Log, "deactivate")
		return
	}
	s.clearSessionCookie(w)
	writeJSON(w, 200, map[string]any{"ok": true,
		"message": "账号已停用:会话全部失效,发出的共享已撤销。云端数据按保留策略处理,离线设备的数据不受远程控制。"})
}
