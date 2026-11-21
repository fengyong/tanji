package httpapi

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// ---- 联系邀请:建立"可被授权"的关系,本身不共享任何订单 ----

type createInviteReq struct {
	// 二选一:精确账号标识(不开放模糊搜索)或一次性邀请凭据。
	InviteeUserID string `json:"invitee_user_id,omitempty"`
	InviteeEmail  string `json:"invitee_email,omitempty"`
}

func (s *Server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "invite")
		return
	}
	var req createInviteReq
	if err := decodeJSON(r, &req, 4<<10); err != nil {
		writeErr(w, err, s.Log, "invite")
		return
	}
	if !s.limiter.allow("invite:" + sess.UserID.String()) {
		writeJSON(w, 429, apiErr(429, "rate_limited", "邀请发送过于频繁"))
		return
	}
	now := time.Now().UTC()
	inviteID := store.NewID()
	var inviteeID store.ID
	if req.InviteeUserID != "" {
		var err error
		inviteeID, err = store.ParseID(req.InviteeUserID)
		if err != nil {
			writeJSON(w, 400, apiErr(400, "invalid_payload", "invitee_user_id 必须是 UUID"))
			return
		}
		var status string
		err = s.DB.QueryRowContext(r.Context(),
			`SELECT status FROM users WHERE id = ?`, inviteeID[:]).Scan(&status)
		if err != nil || status != "active" {
			// 不泄露账号是否存在:统一返回已创建待接受。
			inviteeID = store.ID{}
		}
	} else if req.InviteeEmail != "" {
		email := auth.NormalizeEmail(strings.TrimSpace(req.InviteeEmail))
		if !emailRe.MatchString(email) {
			writeJSON(w, 400, apiErr(400, "invalid_email", "邮箱格式无效"))
			return
		}
		var found []byte
		err := s.DB.QueryRowContext(r.Context(),
			`SELECT id FROM users WHERE email_norm = ? AND status='active'`, email).Scan(&found)
		if err != nil {
			inviteeID = store.ID{} // 不存在:占位邀请,接受时按邮箱匹配。
		} else {
			copy(inviteeID[:], found)
		}
	} else {
		writeJSON(w, 400, apiErr(400, "invalid_payload", "需要 invitee_user_id 或 invitee_email"))
		return
	}
	raw, terr := store.RandomToken()
	if terr != nil {
		writeErr(w, terr, s.Log, "invite")
		return
	}
	// 传输形式为 base64url 文本(与会话令牌一致);哈希针对传输形式。
	token := base64.RawURLEncoding.EncodeToString(raw)
	_, err := s.DB.ExecContext(r.Context(),
		`INSERT INTO contact_invites (id, inviter_id, invitee_id, token_hash, status, expires_at, created_at)
		 VALUES (?,?,?,?,'pending',?,?)`,
		inviteID[:], sess.UserID[:], inviteeID[:], auth.HashToken([]byte(token)), now.Add(72*time.Hour), now)
	if err != nil {
		writeErr(w, err, s.Log, "invite")
		return
	}
	// 邀请凭据只返回一次给发起者转达(不可枚举)。
	writeJSON(w, 200, map[string]any{
		"invite_id":  inviteID.String(),
		"token":      string(token),
		"expires_at": now.Add(72 * time.Hour).UTC().Format(time.RFC3339),
		"message":    "请把邀请凭据直接转达对方;接受后才能相互选择为搭档",
	})
}

type acceptInviteReq struct {
	Token string `json:"token"`
}

// handleAcceptInvite:接受后建立带代次的联系关系;重新接受(删除后)是新代次。
func (s *Server) handleAcceptInvite(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "accept-invite")
		return
	}
	var req acceptInviteReq
	if err := decodeJSON(r, &req, 4<<10); err != nil {
		writeErr(w, err, s.Log, "accept-invite")
		return
	}
	tokenHash := auth.HashToken([]byte(strings.TrimSpace(req.Token)))
	now := time.Now().UTC()
	var inviter store.ID
	err := store.WithTx(r.Context(), s.DB, func(tx *sql.Tx) error {
		var status string
		var inviteeID sql.Null[[]byte]
		var expires time.Time
		var inviteID store.ID
		ctx := r.Context()
		err := tx.QueryRowContext(ctx,
			`SELECT id, inviter_id, invitee_id, status, expires_at FROM contact_invites
			 WHERE token_hash = ? FOR UPDATE`, tokenHash[:]).Scan(&inviteID, &inviter, &inviteeID, &status, &expires)
		if errors.Is(err, sql.ErrNoRows) {
			return apiErr(400, "invite_invalid", "邀请凭据无效")
		}
		if err != nil {
			return err
		}
		if status != "pending" || now.After(expires) {
			return apiErr(400, "invite_invalid", "邀请已失效")
		}
		if inviteeID.Valid && store.ID(inviteeID.V) != sess.UserID {
			return apiErr(403, "invite_forbidden", "该邀请指定了其他账号")
		}
		// 建立或恢复联系关系(代次+1)。
		lo, hi := pairOrderBytes(sess.UserID[:], inviter[:])
		var linkID store.ID
		var generation int64
		var linkStatus string
		err = tx.QueryRowContext(ctx,
			`SELECT id, generation, status FROM contact_links WHERE user_low=? AND user_high=? FOR UPDATE`,
			lo, hi).Scan(&linkID, &generation, &linkStatus)
		if errors.Is(err, sql.ErrNoRows) {
			linkID = store.NewID()
			generation = 1
			if _, err = tx.ExecContext(ctx,
				`INSERT INTO contact_links (id, user_low, user_high, status, generation, created_at)
				 VALUES (?, ?, ?, 'active', 1, ?)`, linkID[:], lo, hi, now); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if linkStatus == "active" {
			return apiErr(400, "already_linked", "你们已经是联系关系")
		} else {
			generation++
			if _, err = tx.ExecContext(ctx,
				`UPDATE contact_links SET status='active', generation=?, deleted_at=NULL WHERE id=?`,
				generation, linkID[:]); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx,
			`UPDATE contact_invites SET status='accepted', invitee_id=?, handled_at=? WHERE id=?`,
			sess.UserID[:], now, inviteID[:]); err != nil {
			return err
		}
		// 双方各写一条最小事件(不携带任何订单数据)。
		if err = emitContactEvent(ctx, tx, sess.UserID[:], "contact.added", linkID, generation, map[string]any{
			"contact_user_id": inviter.String(),
		}, now); err != nil {
			return err
		}
		return emitContactEvent(ctx, tx, inviter[:], "contact.added", linkID, generation, map[string]any{
			"contact_user_id": sess.UserID.String(),
		}, now)
	})
	if err != nil {
		writeErr(w, err, s.Log, "accept-invite")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func emitContactEvent(ctx context.Context, tx *sql.Tx, recipient []byte, eventType string,
	linkID store.ID, generation int64, extra map[string]any, now time.Time) error {
	next, err := allocateSeqs(ctx, tx, [][]byte{recipient}, now)
	if err != nil {
		return err
	}
	seq, err := next(recipient)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"auth_relation_id":         linkID.String(),
		"auth_relation_generation": domain.FormatVersion(generation),
	}
	for k, v := range extra {
		payload[k] = v
	}
	raw, _ := json.Marshal(payload)
	_, err = tx.ExecContext(ctx,
		`INSERT INTO user_changes (recipient_user_id, seq, event_type, payload, created_at)
		 VALUES (?,?,?,?,?)`, recipient, seq, eventType, raw, now)
	return err
}

func pairOrderBytes(a, b []byte) ([]byte, []byte) {
	if string(b) < string(a) {
		return b, a
	}
	return a, b
}

// handleListInvites 我发出的待处理邀请。
func (s *Server) handleListInvites(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "list-invites")
		return
	}
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT id, status, created_at, expires_at FROM contact_invites
		 WHERE inviter_id = ? AND status='pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 100`,
		sess.UserID[:], time.Now().UTC())
	if err != nil {
		writeErr(w, err, s.Log, "list-invites")
		return
	}
	defer rows.Close()
	invites := []map[string]any{}
	for rows.Next() {
		var id store.ID
		var status string
		var created, expires time.Time
		if err := rows.Scan(&id, &status, &created, &expires); err != nil {
			writeErr(w, err, s.Log, "list-invites")
			return
		}
		invites = append(invites, map[string]any{
			"invite_id": id.String(), "status": status,
			"created_at": created.UTC().Format(time.RFC3339), "expires_at": expires.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, 200, map[string]any{"invites": invites})
}

// handleListContacts 最小联系人列表:仅账号标识与昵称。
func (s *Server) handleListContacts(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "contacts")
		return
	}
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT cl.id, cl.generation, u.id, u.nickname
		 FROM contact_links cl
		 JOIN users u ON u.id = CASE WHEN cl.user_low = ? THEN cl.user_high ELSE cl.user_low END
		 WHERE (cl.user_low = ? OR cl.user_high = ?) AND cl.status='active' AND u.status='active'`,
		sess.UserID[:], sess.UserID[:], sess.UserID[:])
	if err != nil {
		writeErr(w, err, s.Log, "contacts")
		return
	}
	defer rows.Close()
	contacts := []map[string]any{}
	for rows.Next() {
		var linkID, uid store.ID
		var generation int64
		var nickname string
		if err := rows.Scan(&linkID, &generation, &uid, &nickname); err != nil {
			writeErr(w, err, s.Log, "contacts")
			return
		}
		contacts = append(contacts, map[string]any{
			"contact_id": linkID.String(), "user_id": uid.String(),
			"nickname": nickname, "auth_relation_generation": domain.FormatVersion(generation),
		})
	}
	writeJSON(w, 200, map[string]any{"contacts": contacts})
}

func (s *Server) handleGetContact(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "contact")
		return
	}
	linkID, err := store.ParseID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_payload", "contact id 无效"))
		return
	}
	var generation int64
	var other []byte
	err = s.DB.QueryRowContext(r.Context(),
		`SELECT generation, CASE WHEN user_low = ? THEN user_high ELSE user_low END
		 FROM contact_links WHERE id = ? AND status='active'`,
		sess.UserID[:], linkID[:]).Scan(&generation, &other)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, apiErr(404, "not_found", "联系人不存在"))
		return
	}
	if err != nil {
		writeErr(w, err, s.Log, "contact")
		return
	}
	var nickname string
	var uid store.ID
	if err := s.DB.QueryRowContext(r.Context(),
		`SELECT id, nickname FROM users WHERE id = ?`, other).Scan(&uid, &nickname); err != nil {
		writeErr(w, err, s.Log, "contact")
		return
	}
	writeJSON(w, 200, map[string]any{
		"contact_id": linkID.String(), "user_id": uid.String(), "nickname": nickname,
		"auth_relation_generation": domain.FormatVersion(generation),
	})
}

// handleDeleteContact:删除联系使其代次的全部授权失效,双方收到 relation.purged + share.purged。
func (s *Server) handleDeleteContact(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "delete-contact")
		return
	}
	linkID, err := store.ParseID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_payload", "contact id 无效"))
		return
	}
	now := time.Now().UTC()
	err = store.WithTx(r.Context(), s.DB, func(tx *sql.Tx) error {
		ctx := r.Context()
		var lo, hi []byte
		var status string
		err := tx.QueryRowContext(ctx,
			`SELECT user_low, user_high, status FROM contact_links WHERE id = ? FOR UPDATE`,
			linkID[:]).Scan(&lo, &hi, &status)
		if errors.Is(err, sql.ErrNoRows) {
			return apiErr(404, "not_found", "联系人不存在")
		}
		if err != nil {
			return err
		}
		if string(lo) != string(sess.UserID[:]) && string(hi) != string(sess.UserID[:]) {
			return ErrForbidden
		}
		if status != "active" {
			return nil
		}
		return revokeContactLink(ctx, tx, linkID, now)
	})
	if err != nil {
		writeErr(w, err, s.Log, "delete-contact")
		return
	}
	s.Notify.NotifyUsers(nil)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleHealthReady(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.PingContext(r.Context()); err != nil {
		writeJSON(w, 503, map[string]string{"status": "db_down"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ready"})
}

var _ = context.Background
