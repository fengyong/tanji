package httpapi

import (
	"errors"
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// HTTP 处理器内直接操作变更流的辅助(contact 关系变化、账号停用等)。
// 与 engine 一致的锁序:guard → 关系 → 授权 → stream heads(按 id 排序)。

type ownerGrant struct {
	id         store.ID
	recipient  []byte
	shareID    store.ID
	generation int64
}

func queryOwnerActiveGrants(ctx context.Context, tx *sql.Tx, owner store.ID) ([]ownerGrant, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, recipient_user_id, share_id, generation FROM schedule_grants
		 WHERE owner_user_id = ? AND status='active' FOR UPDATE`, owner[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ownerGrant
	for rows.Next() {
		var g ownerGrant
		if err := rows.Scan(&g.id, &g.recipient, &g.shareID, &g.generation); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// allocateSeqs 锁定接收者 stream head(排序)并返回分配器。
func allocateSeqs(ctx context.Context, tx *sql.Tx, recipients [][]byte, now any) (func(recipient []byte) (int64, error), error) {
	sorted := make([][]byte, len(recipients))
	copy(sorted, recipients)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && string(sorted[j]) < string(sorted[j-1]); j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	for _, rid := range sorted {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_stream_heads (user_id, seq, stream_epoch, updated_at)
			 VALUES (?, 0, 1, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`, rid, now); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx,
			`SELECT seq FROM user_stream_heads WHERE user_id = ? FOR UPDATE`, rid); err != nil {
			return nil, err
		}
	}
	return func(recipient []byte) (int64, error) {
		if _, err := tx.ExecContext(ctx,
			`UPDATE user_stream_heads SET seq = seq + 1, updated_at = ? WHERE user_id = ?`, now, recipient); err != nil {
			return 0, err
		}
		var seq int64
		if err := tx.QueryRowContext(ctx,
			`SELECT seq FROM user_stream_heads WHERE user_id = ?`, recipient).Scan(&seq); err != nil {
			return 0, err
		}
		return seq, nil
	}, nil
}

// emitPurgeEvent 向接收者写 share.purged(仅 share_id/generation,不含内容)。
func emitPurgeEvent(ctx context.Context, tx *sql.Tx, recipient []byte, shareID store.ID, generation int64) error {
	next, err := allocateSeqs(ctx, tx, [][]byte{recipient}, time.Now().UTC())
	if err != nil {
		return err
	}
	seq, err := next(recipient)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{
		"share_id": shareID.String(), "generation": domain.FormatVersion(generation)})
	_, err = tx.ExecContext(ctx,
		`INSERT INTO user_changes (recipient_user_id, seq, event_type, share_id, generation, payload, created_at)
		 VALUES (?,?,?,?,?,?,?)`,
		recipient, seq, domain.EventSharePurged, shareID[:], generation, payload, time.Now().UTC())
	return err
}

// deleteContactsOf 删除某账号的全部联系关系(双向)并通知双方。
func deleteContactsOf(ctx context.Context, tx *sql.Tx, user store.ID, now time.Time) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM contact_links
		 WHERE (user_low = ? OR user_high = ?) AND status='active' FOR UPDATE`, user[:], user[:])
	if err != nil {
		return err
	}
	var ids []store.ID
	for rows.Next() {
		var id store.ID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	for _, id := range ids {
		if err := revokeContactLink(ctx, tx, id, now); err != nil {
			return err
		}
	}
	return nil
}

// revokeContactLink 删除一条联系关系:关系代次失效 → 派生授权全部撤销 →
// 双方收到 relation.purged(含精确代次)与各授权的 share.purged。
func revokeContactLink(ctx context.Context, tx *sql.Tx, linkID store.ID, now time.Time) error {
	var lo, hi []byte
	var generation int64
	err := tx.QueryRowContext(ctx,
		`SELECT user_low, user_high, generation FROM contact_links WHERE id = ? FOR UPDATE`,
		linkID[:]).Scan(&lo, &hi, &generation)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE contact_links SET status='deleted', deleted_at=? WHERE id=?`, now, linkID[:]); err != nil {
		return err
	}
	// 撤销派生于该关系代次的全部授权。
	grants, err := tx.QueryContext(ctx,
		`SELECT id, recipient_user_id, share_id, generation FROM schedule_grants
		 WHERE contact_link_id = ? AND contact_generation = ? AND status='active' FOR UPDATE`,
		linkID[:], generation)
	if err != nil {
		return err
	}
	type ginfo struct {
		id         store.ID
		recipient  []byte
		shareID    store.ID
		generation int64
	}
	var revokes []ginfo
	for grants.Next() {
		var g ginfo
		if err := grants.Scan(&g.id, &g.recipient, &g.shareID, &g.generation); err != nil {
			grants.Close()
			return err
		}
		revokes = append(revokes, g)
	}
	grants.Close()
	if grants.Err() != nil {
		return grants.Err()
	}
	both := [][]byte{lo, hi}
	next, err := allocateSeqs(ctx, tx, both, now)
	if err != nil {
		return err
	}
	for _, from := range both {
		seq, err := next(from)
		if err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{
			"auth_relation_id":         linkID.String(),
			"auth_relation_generation": domain.FormatVersion(generation)})
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_changes (recipient_user_id, seq, event_type, payload, created_at)
			 VALUES (?,?,?,?,?)`, from, seq, domain.EventRelationPurged, payload, now); err != nil {
			return err
		}
	}
	for _, g := range revokes {
		if _, err := tx.ExecContext(ctx,
			`UPDATE schedule_grants SET status='revoked', revoked_at=? WHERE id=?`, now, g.id[:]); err != nil {
			return err
		}
		for _, from := range both {
			if err := emitPurgeEvent(ctx, tx, from, g.shareID, g.generation); err != nil {
				return err
			}
		}
	}
	return nil
}
