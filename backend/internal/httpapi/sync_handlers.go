package httpapi

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/domain"
	"tanji/backend/internal/engine"
	"tanji/backend/internal/store"
)

func base64URLEncode(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func base64URLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// handlePush:唯一业务写入入口。每个操作独立事务、独立结果;401 停止整轮,死锁重试后继续。
func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "push")
		return
	}
	var req domain.PushRequest
	if err := decodeJSON(r, &req, domain.MaxBatchSizeBytes); err != nil {
		writeErr(w, err, s.Log, "push")
		return
	}
	if req.ProtocolVersion != domain.ProtocolVersion {
		writeJSON(w, 409, apiErr(409, domain.CodeProtocol, "协议版本不匹配,请升级客户端"))
		return
	}
	// 信封账号必须等于鉴权用户,阻断切号串账(先于批内容校验)。
	if req.AccountID != sess.UserID.String() {
		writeJSON(w, 403, apiErr(403, "account_mismatch", "account_id 与当前会话不匹配"))
		return
	}
	if len(req.Operations) == 0 || len(req.Operations) > domain.MaxOpsPerBatch {
		writeJSON(w, 400, apiErr(400, "invalid_batch", "操作数量必须在 1~50 之间"))
		return
	}

	results := make([]domain.OpResult, 0, len(req.Operations))
	for _, op := range req.Operations {
		res, err := s.applyOneOp(r, sess, op)
		if err != nil {
			if errors.Is(err, engine.ErrRetryable) {
				// 死锁:同 op_id 重试一次。
				res, err = s.applyOneOp(r, sess, op)
			}
			if err != nil {
				writeErr(w, err, s.Log, "push-op")
				return
			}
		}
		results = append(results, res)
		// 会话失效:停止整轮上传。
		if res.Result == domain.ResultRejected && res.ErrorCode == domain.CodeSessionExpired {
			break
		}
	}
	s.Notify.NotifyUsers(nil)
	writeJSON(w, 200, domain.PushResponse{Results: results})
}

func (s *Server) applyOneOp(r *http.Request, sess auth.SessionCtx, op domain.OpEnvelope) (domain.OpResult, error) {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	var result domain.OpResult
	err := store.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		// 锁 users 行,重新核验单会话(新登录提交后旧事务必须失败)。
		authSess := engine.SessionCtx{UserID: sess.UserID, SessionID: sess.SessionID,
			DeviceID: sess.DeviceID, AuthEpoch: sess.AuthEpoch}
		if err := s.Auth.LockUserForWrite(ctx, tx, authSess); err != nil {
			return err
		}
		res, aerr := s.Engine.ApplyOp(ctx, tx, authSess, op)
		if aerr != nil {
			return aerr
		}
		if res.Result == domain.ResultRejected && res.ErrorCode == domain.CodeSessionExpired {
			result = res
			return nil
		}
		result = res
		return nil
	})
	if err != nil {
		return domain.OpResult{}, err
	}
	return result, nil
}

// handleReceipts:恢复网络后按 op_id 查询不确定操作的处理结果。
func (s *Server) handleReceipts(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "receipts")
		return
	}
	var req struct {
		OpIDs []string `json:"op_ids"`
	}
	if err := decodeJSON(r, &req, 64<<10); err != nil {
		writeErr(w, err, s.Log, "receipts")
		return
	}
	if len(req.OpIDs) > 200 {
		writeJSON(w, 400, apiErr(400, "invalid_batch", "op_ids 数量超限"))
		return
	}
	out := make([]domain.OpResult, 0, len(req.OpIDs))
	for _, raw := range req.OpIDs {
		id, err := store.ParseID(raw)
		if err != nil {
			continue
		}
		var result string
		var errCode sql.NullString
		var version sql.NullInt64
		var payload []byte
		err = s.DB.QueryRowContext(r.Context(),
			`SELECT result, error_code, resulting_version, result_payload
			 FROM mutation_receipts WHERE user_id = ? AND op_id = ?`,
			sess.UserID[:], id[:]).Scan(&result, &errCode, &version, &payload)
		if errors.Is(err, sql.ErrNoRows) {
			out = append(out, domain.OpResult{OpID: raw, Result: "unknown"})
			continue
		}
		if err != nil {
			writeErr(w, err, s.Log, "receipts")
			return
		}
		res := domain.OpResult{OpID: raw, Result: result, ErrorCode: errCode.String}
		if version.Valid {
			res.ResultingVersion = domain.FormatVersion(version.Int64)
		}
		if len(payload) > 0 {
			res.Payload = json.RawMessage(payload)
		}
		out = append(out, res)
	}
	writeJSON(w, 200, map[string]any{"receipts": out})
}

// ---- 下行游标:不透明串,绑定 account/protocol/epoch ----

type pullCursor struct {
	V       int    `json:"v"`
	Account string `json:"account"`
	Epoch   int64  `json:"epoch"`
	Seq     int64  `json:"seq"`
}

func encodeCursor(c pullCursor) string {
	raw, _ := json.Marshal(c)
	return base64URLEncode(raw)
}

func decodeCursor(s string) (*pullCursor, error) {
	raw, err := base64URLDecode(s)
	if err != nil {
		return nil, err
	}
	var c pullCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.V != 1 {
		return nil, errors.New("bad cursor")
	}
	return &c, nil
}

// handlePull:按用户流序号拉取增量;失效授权过滤为 purge;next_cursor 前进到最后扫描的 seq。
func (s *Server) handlePull(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "pull")
		return
	}
	q := r.URL.Query()
	limit := domain.DefaultPullLimit
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > domain.MaxPageSizePull {
			writeJSON(w, 400, apiErr(400, "invalid_limit", "limit 无效"))
			return
		}
		limit = n
	}
	var seq int64
	if cur := q.Get("cursor"); cur != "" {
		c, err := decodeCursor(cur)
		if err != nil {
			writeJSON(w, 400, apiErr(400, "invalid_cursor", "游标无效"))
			return
		}
		if c.Account != sess.UserID.String() {
			writeJSON(w, 403, apiErr(403, "cursor_account_mismatch", "游标不属于当前账号"))
			return
		}
		seq = c.Seq
	}
	var headSeq, epoch int64
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT seq, stream_epoch FROM user_stream_heads WHERE user_id = ?`,
		sess.UserID[:]).Scan(&headSeq, &epoch)
	if errors.Is(err, sql.ErrNoRows) {
		headSeq, epoch = 0, 1
	} else if err != nil {
		writeErr(w, err, s.Log, "pull")
		return
	}
	if cur := q.Get("cursor"); cur != "" {
		c, _ := decodeCursor(cur)
		if c != nil && c.Epoch != epoch {
			writeJSON(w, 410, apiErr(410, domain.CodeCursorExpired, "游标世代过期,需要全量重建"))
			return
		}
	}

	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT seq, event_type, entity_id, share_id, generation, origin_op_id, payload, created_at
		 FROM user_changes WHERE recipient_user_id = ? AND seq > ? AND seq <= ?
		 ORDER BY seq LIMIT ?`,
		sess.UserID[:], seq, headSeq, limit+1)
	if err != nil {
		writeErr(w, err, s.Log, "pull")
		return
	}
	type event struct {
		Seq       int64           `json:"_seq"`
		Type      string          `json:"event_type"`
		EntityID  string          `json:"entity_id,omitempty"`
		ShareID   string          `json:"share_id,omitempty"`
		Generation string         `json:"generation,omitempty"`
		OriginOp  string          `json:"origin_op_id,omitempty"`
		Payload   json.RawMessage `json:"payload"`
	}
	events := []map[string]any{}
	hasMore := false
	lastSeq := seq
	scan := func(rows *sql.Rows) error {
		for rows.Next() {
			var ev event
			var entity, share, origin sql.Null[[]byte]
			var generation sql.NullInt64
			var payload []byte
			var createdAt time.Time
			if err := rows.Scan(&ev.Seq, &ev.Type, &entity, &share, &generation, &origin, &payload, &createdAt); err != nil {
				return err
			}
			if len(events) == limit {
				hasMore = true
				return nil
			}
			lastSeq = ev.Seq
			m := map[string]any{
				"seq":        strconv.FormatInt(ev.Seq, 10),
				"event_type": ev.Type,
			}
			if entity.Valid {
				m["entity_id"] = store.ID(entity.V).String()
			}
			if share.Valid {
				ev.ShareID = store.ID(share.V).String()
				m["share_id"] = ev.ShareID
			}
			if generation.Valid {
				m["generation"] = domain.FormatVersion(generation.Int64)
			}
			if origin.Valid {
				m["origin_op_id"] = store.ID(origin.V).String()
			}
			if ev.Type == domain.EventShareGranted || ev.Type == domain.EventShareUpdated {
				// 拉历史事件页时再次验证当前授权:失效投影不能原样返回。
				valid, err := s.grantStillValid(r, ev.ShareID, generation.Int64)
				if err != nil {
					return err
				}
				if !valid {
					m["event_type"] = domain.EventSharePurged
					m["purged_reason"] = "grant_no_longer_valid"
					payload, _ = json.Marshal(map[string]any{
						"share_id": store.ID(share.V).String(),
						"generation": domain.FormatVersion(generation.Int64)})
				}
			}
			if payload != nil {
				m["payload"] = json.RawMessage(payload)
			}
			events = append(events, m)
		}
		return rows.Err()
	}
	if err := scan(rows); err != nil {
		rows.Close()
		writeErr(w, err, s.Log, "pull")
		return
	}
	rows.Close()

	nextCursor := encodeCursor(pullCursor{V: 1, Account: sess.UserID.String(), Epoch: epoch, Seq: lastSeq})
	resp := map[string]any{
		"events":      events,
		"next_cursor": nextCursor,
		"high_water":  domain.FormatVersion(headSeq),
		"has_more":    hasMore,
		"stream_epoch": epoch,
	}
	if seq == 0 {
		resp["reset"] = true
	}
	writeJSON(w, 200, resp)
}

// grantStillValid 校验事件里的授权在当前时刻仍有效(同 generation 且 active)。
func (s *Server) grantStillValid(r *http.Request, shareID string, generation int64) (bool, error) {
	sid, perr := store.ParseID(shareID)
	if perr != nil {
		return false, nil
	}
	var status string
	var gen int64
	err := s.DB.QueryRowContext(r.Context(),
		`SELECT status, generation FROM schedule_grants WHERE share_id = ?`,
		sid[:]).Scan(&status, &gen)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "active" && gen == generation, nil
}

// handleEvents:SSE。连接建立与存活期间须校验;仅通知,不承载业务数据。
// 服务端 goroutine 定期复核会话;失效即关闭连接,客户端随后的任意请求将得到 401。
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "events")
		return
	}
	sessID := sess.SessionID
	userID := sess.UserID
	watchCtx, cancelWatch := context.WithCancel(r.Context())
	defer cancelWatch()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-watchCtx.Done():
				return
			case <-ticker.C:
				var active sql.Null[[]byte]
				var status string
				err := s.DB.QueryRow(`SELECT active_session_id, status FROM users WHERE id = ?`,
					userID[:]).Scan(&active, &status)
				if err != nil || status != "active" || !active.Valid || store.ID(active.V) != sessID {
					return // 关闭监视即可;连接由写失败或客户端断开结束。
				}
			}
		}
	}()
	s.Notify.HandleSSE(w, r, userID[:])
}
