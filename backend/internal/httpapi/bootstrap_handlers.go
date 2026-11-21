package httpapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// Bootstrap:在单个 REPEATABLE READ 一致性快照中物化全量数据 + 当前流头 + 请求中
// 待核对操作的回执;完整落库后关闭事务,再分页下载(10 分钟过期,绑定账号/会话)。
// 页内条目粒度分页;每页下载时对共享投影再次复核授权,失效条目替换为移除控制事件。
func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "bootstrap")
		return
	}
	var req struct {
		OpIDs    []string `json:"op_ids"`
		PageSize int      `json:"page_size,omitempty"`
	}
	if err := decodeJSON(r, &req, 128<<10); err != nil {
		writeErr(w, err, s.Log, "bootstrap")
		return
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 100
	}
	if pageSize > 500 {
		pageSize = 500
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	snapshotID := store.NewID()
	now := time.Now().UTC()
	var pageCount int
	var highWater int64
	var epoch int64

	err := store.WithTx(ctx, s.DB, func(tx *sql.Tx) error {
		// 锁定流头读取 epoch/high_water(同一事务内与数据一致)。
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_stream_heads (user_id, seq, stream_epoch, updated_at)
			 VALUES (?, 0, 1, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
			sess.UserID[:], now); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx,
			`SELECT seq, stream_epoch FROM user_stream_heads WHERE user_id = ? FOR UPDATE`,
			sess.UserID[:]).Scan(&highWater, &epoch); err != nil {
			return err
		}

		orders, err := s.snapshotOrders(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		var settings domain.SettingsDTO
		if err := tx.QueryRowContext(ctx,
			`SELECT collect_threshold_days, ledger_timezone FROM users WHERE id = ?`,
			sess.UserID[:]).Scan(&settings.CollectThresholdDays, &settings.Timezone); err != nil {
			return err
		}
		shares, err := s.snapshotShares(ctx, tx, sess.UserID)
		if err != nil {
			return err
		}
		receipts, err := s.snapshotReceipts(ctx, tx, sess.UserID, req.OpIDs)
		if err != nil {
			return err
		}

		// 条目粒度分页:每页 ≤ pageSize 条订单;最后一页附带 shares/settings/receipts。
		type tailDoc struct {
			Settings  domain.SettingsDTO `json:"settings"`
			Shares    []json.RawMessage  `json:"shares"`
			Epoch     int64              `json:"epoch"`
			HighWater string             `json:"high_water"`
			Receipts  []json.RawMessage  `json:"receipts,omitempty"`
		}
		type pageDoc struct {
			Orders []json.RawMessage `json:"orders,omitempty"`
			Tail   *tailDoc          `json:"tail,omitempty"`
		}
		var pages []pageDoc
		for i := 0; i < len(orders); i += pageSize {
			end := i + pageSize
			if end > len(orders) {
				end = len(orders)
			}
			pages = append(pages, pageDoc{Orders: orders[i:end]})
		}
		tail := &tailDoc{Settings: settings, Shares: shares, Epoch: epoch,
			HighWater: domain.FormatVersion(highWater), Receipts: receipts}
		if len(pages) == 0 {
			pages = []pageDoc{{Tail: tail}}
		} else {
			pages[len(pages)-1].Tail = tail
		}
		pageCount = len(pages)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO bootstrap_snapshots (id, owner_user_id, session_id, stream_epoch, high_water, total_pages, page_size, manifest, status, expires_at, created_at)
			 VALUES (?,?,?,?,?,?,?,?, 'ready', ?, ?)`,
			snapshotID[:], sess.UserID[:], sess.SessionID[:], epoch, highWater, pageCount, pageSize,
			json.RawMessage(fmt.Sprintf(`{"pages":%d,"orders":%d,"shares":%d}`, pageCount, len(orders), len(shares))),
			now.Add(10*time.Minute), now); err != nil {
			return err
		}
		for i, page := range pages {
			raw, err := json.Marshal(page)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(raw)
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO bootstrap_pages (snapshot_id, page_no, payload, checksum) VALUES (?,?,?,?)`,
				snapshotID[:], i, json.RawMessage(raw), sum[:]); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		writeErr(w, err, s.Log, "bootstrap")
		return
	}
	writeJSON(w, 200, map[string]any{
		"snapshot_id": snapshotID.String(),
		"pages":       pageCount,
		"stream_epoch": epoch,
		"high_water":  domain.FormatVersion(highWater),
		"expires_at":  now.Add(10 * time.Minute).UTC().Format(time.RFC3339),
	})
}

// snapshotOrders 全量读取本人订单(含已删除的墓碑形态,防止旧设备复活删除记录)。
func (s *Server) snapshotOrders(ctx context.Context, tx *sql.Tx, owner store.ID) ([]json.RawMessage, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM orders WHERE owner_user_id = ? ORDER BY created_at, id`, owner[:])
	if err != nil {
		return nil, err
	}
	var ids []store.ID
	for rows.Next() {
		var id store.ID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	out := make([]json.RawMessage, 0, len(ids))
	for _, id := range ids {
		var version int64
		var status string
		if err := tx.QueryRowContext(ctx,
			`SELECT version, status FROM orders WHERE id = ?`, id[:]).Scan(&version, &status); err != nil {
			return nil, err
		}
		if status == domain.StatusDeleted {
			out = append(out, mustJSON(map[string]any{
				"id": id.String(), "status": "deleted", "version": domain.FormatVersion(version)}))
			continue
		}
		dto, err := s.Engine.SnapshotOrderDTO(ctx, tx, id, version)
		if err != nil {
			return nil, err
		}
		out = append(out, mustJSON(dto))
	}
	return out, nil
}

// snapshotShares 共享给我的有效投影(接收者视角,白名单内容)。
func (s *Server) snapshotShares(ctx context.Context, tx *sql.Tx, recipient store.ID) ([]json.RawMessage, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT g.share_id FROM schedule_grants g
		 WHERE g.recipient_user_id = ? AND g.status = 'active' ORDER BY g.created_at`, recipient[:])
	if err != nil {
		return nil, err
	}
	var shareIDs []store.ID
	for rows.Next() {
		var id store.ID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		shareIDs = append(shareIDs, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	var out []json.RawMessage
	for _, sid := range shareIDs {
		var g generation
		var ownerID store.ID
		var linkID store.ID
		var linkGen int64
		if err := tx.QueryRowContext(ctx,
			`SELECT generation, owner_user_id, contact_link_id, contact_generation FROM schedule_grants
			 WHERE share_id = ? AND status='active'`, sid[:]).Scan(&g.gen, &ownerID, &linkID, &linkGen); err != nil {
			return nil, err
		}
		dto, err := s.Engine.SnapshotShareProjection(ctx, tx, sid, g.gen, linkID, linkGen)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, err
		}
		out = append(out, mustJSON(dto))
	}
	return out, nil
}

type generation struct{ gen int64 }

func (s *Server) snapshotReceipts(ctx context.Context, tx *sql.Tx, user store.ID, opIDs []string) ([]json.RawMessage, error) {
	var out []json.RawMessage
	for _, raw := range opIDs {
		id, err := store.ParseID(raw)
		if err != nil {
			continue
		}
		var result, errCode string
		var version sql.NullInt64
		var payload []byte
		var opType string
		err = tx.QueryRowContext(ctx,
			`SELECT result, error_code, resulting_version, result_payload, op_type
			 FROM mutation_receipts WHERE user_id = ? AND op_id = ?`,
			user[:], id[:]).Scan(&result, &errCode, &version, &payload, &opType)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		m := map[string]any{"op_id": raw, "result": result, "error_code": errCode, "op_type": opType}
		if version.Valid {
			m["resulting_version"] = domain.FormatVersion(version.Int64)
		}
		if len(payload) > 0 {
			m["payload"] = json.RawMessage(payload)
		}
		out = append(out, mustJSON(m))
	}
	return out, nil
}

// handleBootstrapPage 分页下载;复核快照归属/过期。
func (s *Server) handleBootstrapPage(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "bootstrap-page")
		return
	}
	snapID, err := store.ParseID(r.PathValue("id"))
	if err != nil {
		writeJSON(w, 400, apiErr(400, "invalid_payload", "snapshot id 无效"))
		return
	}
	pageNo, perr := strconv.Atoi(r.PathValue("page"))
	if perr != nil || pageNo < 0 {
		writeJSON(w, 400, apiErr(400, "invalid_payload", "page 无效"))
		return
	}
	var owner store.ID
	var expires time.Time
	var status string
	err = s.DB.QueryRowContext(r.Context(),
		`SELECT owner_user_id, expires_at, status FROM bootstrap_snapshots WHERE id = ? AND session_id = ?`,
		snapID[:], sess.SessionID[:]).Scan(&owner, &expires, &status)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 410, apiErr(410, "snapshot_gone", "快照不存在或已过期,请重新发起全量重建"))
		return
	}
	if err != nil {
		writeErr(w, err, s.Log, "bootstrap-page")
		return
	}
	if owner != sess.UserID {
		writeErr(w, ErrForbidden, s.Log, "bootstrap-page")
		return
	}
	if status != "ready" || time.Now().UTC().After(expires) {
		writeJSON(w, 410, apiErr(410, "snapshot_gone", "快照已过期,请重新发起全量重建"))
		return
	}
	var payload []byte
	var checksum []byte
	err = s.DB.QueryRowContext(r.Context(),
		`SELECT payload, checksum FROM bootstrap_pages WHERE snapshot_id = ? AND page_no = ?`,
		snapID[:], pageNo).Scan(&payload, &checksum)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, 404, apiErr(404, "page_not_found", "页码超出范围"))
		return
	}
	if err != nil {
		writeErr(w, err, s.Log, "bootstrap-page")
		return
	}
	writeJSON(w, 200, map[string]any{
		"page":     pageNo,
		"payload":  json.RawMessage(payload),
		"checksum": fmt.Sprintf("%x", checksum),
	})
}

// handleSharedList:接收者主动查询共享给我的列表(拉取兜底,事件之外的恢复路径)。
func (s *Server) handleSharedList(w http.ResponseWriter, r *http.Request) {
	sess, _, ok := SessionFrom(r)
	if !ok {
		writeErr(w, ErrUnauthorized, s.Log, "shared")
		return
	}
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT share_id FROM schedule_grants WHERE recipient_user_id = ? AND status='active'`,
		sess.UserID[:])
	if err != nil {
		writeErr(w, err, s.Log, "shared")
		return
	}
	var ids []store.ID
	for rows.Next() {
		var id store.ID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			writeErr(w, err, s.Log, "shared")
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		writeErr(w, rows.Err(), s.Log, "shared")
		return
	}
	shares := []map[string]any{}
	for _, sid := range ids {
		var gen int64
		var linkID store.ID
		var linkGen int64
		if err := s.DB.QueryRowContext(r.Context(),
			`SELECT generation, contact_link_id, contact_generation FROM schedule_grants
			 WHERE share_id = ? AND status='active'`, sid[:]).Scan(&gen, &linkID, &linkGen); err != nil {
			continue
		}
		dto, err := s.Engine.SnapshotShareProjection(r.Context(), nil, sid, gen, linkID, linkGen)
		if err != nil {
			continue
		}
		raw, _ := json.Marshal(dto)
		shares = append(shares, map[string]any{"projection": json.RawMessage(raw)})
	}
	writeJSON(w, 200, map[string]any{"shares": shares})
}
