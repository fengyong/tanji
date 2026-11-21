package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// opPartnerAssign 更新本人订单的主要搭档选择,并在同一事务撤销旧搭档的授权来源。
// 新搭档的共享授权由独立的 schedule.grant 命令完成(等待 assign 成功)。
func (e *Engine) opPartnerAssign(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.PartnerAssignPayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if p.Type != "account" && p.Type != "external" {
		return reject(oc, domain.CodeInvalidPayload, "搭档类型无效"), nil
	}
	var partnerUserID store.ID
	if p.Type == "account" {
		var err error
		partnerUserID, err = store.ParseID(p.UserID)
		if err != nil {
			return reject(oc, domain.CodeInvalidPayload, "账号搭档 user_id 无效"), nil
		}
	} else {
		if err := domain.ValidateExternalName(p.ExternalName); err != nil {
			return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
		}
	}

	// 锁双方账本 guard(排序)。外部搭档只锁本人。
	if err := lockGuardsSorted(ctx, tx, oc.sess.UserID, partnerUserID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	row, err := loadOrderForUpdate(ctx, tx, oc.sess.UserID, oc.aggID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if row == nil {
		return reject(oc, domain.CodeEntityNotFound, "订单不存在"), nil
	}
	if row.Status == domain.StatusDeleted {
		return reject(oc, domain.CodeEntityDeleted, "订单已删除"), nil
	}
	expected, err := e.resolveExpectedVersion(tx, oc)
	if err != nil {
		return e.rejectFromDomain(oc, err), nil
	}
	if row.Version != expected {
		dto, derr := e.buildOrderDTO(ctx, tx, oc.aggID, row.Version)
		if derr != nil {
			return domain.OpResult{}, wrapRetry(derr)
		}
		cur, _ := json.Marshal(dto)
		return conflict(oc, domain.CodeVersionMismatch, "订单版本不匹配", cur), nil
	}

	var newPartnerUserID store.ID
	if p.Type == "account" {
		active, err := e.contactLinkActive(ctx, tx, oc.sess.UserID, partnerUserID)
		if err != nil {
			return domain.OpResult{}, wrapRetry(err)
		}
		if !active {
			return reject(oc, domain.CodeRelationMissing, "与该账号没有有效的搭档联系关系"), nil
		}
		newPartnerUserID = partnerUserID
	}

	oldPartner, err := loadPartner(ctx, tx, oc.aggID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	// 旧账号搭档的 partner 来源授权撤销(保留其独立 viewer 授权,按并集规则)。
	if oldPartner != nil && oldPartner.Type == "account" && oldPartner.UserID != "" {
		oldID, _ := store.ParseID(oldPartner.UserID)
		if p.Type != "account" || oldID != newPartnerUserID {
			grants, err := activeGrants(ctx, tx, oc.aggID, true)
			if err != nil {
				return domain.OpResult{}, wrapRetry(err)
			}
			var revoke []grantRow
			for _, g := range grants {
				if g.Recipient == oldID && g.Source == "partner_assign" {
					revoke = append(revoke, g)
				}
			}
			if err := e.revokeGrants(ctx, tx, oc, revoke, "partner_replaced"); err != nil {
				return domain.OpResult{}, wrapRetry(err)
			}
		}
	}

	newVersion := row.Version + 1
	if err := e.setPartnerRow(ctx, tx, oc.aggID, &domain.PartnerRef{
		Type: p.Type, UserID: p.UserID, ExternalName: p.ExternalName}, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE orders SET version=?, updated_at=? WHERE id=?`, newVersion, oc.now, oc.aggID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	dto, err := e.buildOrderDTO(ctx, tx, oc.aggID, newVersion)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	payload, _ := json.Marshal(dto)
	e.emitSelf(oc, domain.EventOrderChanged, &oc.aggID, payload)
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
		ResultingVersion: domain.FormatVersion(newVersion), Payload: payload}, nil
}

// opScheduleGrant 新建或升级 (order,recipient) 授权;每次撤销后重新授权 generation+1。
func (e *Engine) opScheduleGrant(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.ScheduleGrantPayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	orderID, err := store.ParseID(p.OrderID)
	if err != nil {
		return reject(oc, domain.CodeInvalidPayload, "order_id 无效"), nil
	}
	recipientID, err := store.ParseID(p.RecipientID)
	if err != nil {
		return reject(oc, domain.CodeInvalidPayload, "recipient_user_id 无效"), nil
	}
	if p.Role != domain.GrantRolePartner && p.Role != domain.GrantRoleViewer {
		return reject(oc, domain.CodeInvalidPayload, "角色必须是 partner 或 viewer"), nil
	}
	if recipientID == oc.sess.UserID {
		return reject(oc, domain.CodeInvalidPayload, "不能授权给自己"), nil
	}
	// grant_set 聚合以 (owner,order,recipient) 标识。
	if oc.aggID != grantSetID(oc.sess.UserID, orderID, recipientID) {
		return reject(oc, domain.CodeInvalidPayload, "aggregate_id 与授权三元组不一致"), nil
	}

	if err := lockGuardsSorted(ctx, tx, oc.sess.UserID, recipientID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	row, err := loadOrderForUpdate(ctx, tx, oc.sess.UserID, orderID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if row == nil {
		return reject(oc, domain.CodeEntityNotFound, "订单不存在"), nil
	}
	if row.Status == domain.StatusDeleted {
		return reject(oc, domain.CodeEntityDeleted, "订单已删除,不能共享"), nil
	}
	link, err := e.contactLinkActiveRow(ctx, tx, oc.sess.UserID, recipientID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if link == nil {
		return reject(oc, domain.CodeRelationMissing, "尚未建立有效的联系关系,不能授权"), nil
	}

	// 现有授权(任意状态)。
	existing, err := grantByOrderRecipient(ctx, tx, orderID, recipientID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if existing != nil && existing.Status == domain.StatusActive {
		switch {
		case existing.Role == p.Role:
			return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied,
				ResultingVersion: domain.FormatVersion(existing.Revision)}, nil
		case existing.Role == domain.GrantRoleViewer && p.Role == domain.GrantRolePartner:
			newRevision := existing.Revision + 1
			if _, err := tx.ExecContext(ctx,
				`UPDATE schedule_grants SET role=?, grant_revision=? WHERE id=?`,
				domain.GrantRolePartner, newRevision, existing.ID[:]); err != nil {
				return domain.OpResult{}, wrapRetry(err)
			}
			if err := e.rebuildProjection(ctx, tx, oc, existing, row); err != nil {
				return domain.OpResult{}, wrapRetry(err)
			}
			if err := e.emitGrantEvents(ctx, tx, oc, existing, row, link); err != nil {
				return domain.OpResult{}, wrapRetry(err)
			}
			return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
				ResultingVersion: domain.FormatVersion(newRevision)}, nil
		default:
			return reject(oc, domain.CodeGrantExists, "该接收者已有更高或相同级别的授权;如需调整请先撤销"), nil
		}
	}

	newRow := existing
	newGeneration := int64(1)
	if newRow != nil {
		newGeneration = newRow.Generation + 1
	}
	shareID := store.NewID()
	if newRow != nil {
		shareID = newRow.ShareID // 撤销后重新授权沿用 share_id,generation 前进。
	}
	newRevision := int64(1)

	if newRow != nil {
		if _, err := tx.ExecContext(ctx,
			`UPDATE schedule_grants SET share_id=?, grant_revision=?, generation=?, status='active',
			   source=?, contact_link_id=?, contact_generation=?, revoked_at=NULL, created_at=?
			 WHERE id=?`,
			shareID[:], newRevision, newGeneration, p.Role, link.ID[:], link.Generation, oc.now, newRow.ID[:]); err != nil {
			return domain.OpResult{}, wrapRetry(err)
		}
	} else {
		grantID := store.NewID()
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schedule_grants (id, owner_user_id, order_id, recipient_user_id, role, share_id,
			   grant_revision, generation, status, source, contact_link_id, contact_generation, created_at)
			 VALUES (?,?,?,?,?,?,?,?, 'active', ?,?,?,?)`,
			grantID[:], oc.sess.UserID[:], orderID[:], recipientID[:], p.Role, shareID[:],
			newRevision, newGeneration, p.Role, link.ID[:], link.Generation, oc.now); err != nil {
			return domain.OpResult{}, wrapRetry(err)
		}
		newRow = &grantRow{ID: grantID, Owner: oc.sess.UserID, OrderID: orderID,
			Recipient: recipientID, Role: p.Role, ShareID: shareID,
			Revision: newRevision, Generation: newGeneration, Status: domain.StatusActive,
			Source: p.Role, ContactLinkID: link.ID, ContactGeneration: link.Generation}
	}
	g := &grantRow{ID: newRow.ID, Owner: oc.sess.UserID, OrderID: orderID, Recipient: recipientID,
		Role: p.Role, ShareID: shareID, Revision: newRevision, Generation: newGeneration,
		Status: domain.StatusActive, Source: p.Role, ContactLinkID: link.ID, ContactGeneration: link.Generation}
	if err := e.rebuildProjection(ctx, tx, oc, g, row); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if err := e.emitGrantEvents(ctx, tx, oc, g, row, link); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
		ResultingVersion: domain.FormatVersion(newRevision)}, nil
}

// opScheduleRevoke 按 share_id 撤销授权;已撤销幂等。
func (e *Engine) opScheduleRevoke(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.ScheduleRevokePayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	shareID, err := store.ParseID(p.ShareID)
	if err != nil {
		return reject(oc, domain.CodeInvalidPayload, "share_id 无效"), nil
	}
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	g, err := grantByShareID(ctx, tx, shareID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if g == nil || g.Owner != oc.sess.UserID {
		return reject(oc, domain.CodeGrantMissing, "共享不存在或不属于当前账号"), nil
	}
	if g.Status == "revoked" {
		return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied}, nil
	}
	var recipientGuard store.ID
	if err := lockGuard(ctx, tx, g.Recipient, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	_ = recipientGuard
	if _, err := tx.ExecContext(ctx,
		`UPDATE schedule_grants SET status='revoked', revoked_at=? WHERE id=?`, oc.now, g.ID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	gen := g.Generation
	sid := g.ShareID
	e.emitTo(oc, g.Recipient, domain.EventSharePurged, nil, &sid, &gen,
		mustJSON(map[string]any{"share_id": sid.String(), "generation": domain.FormatVersion(gen)}))
	e.emitTo(oc, oc.sess.UserID, domain.EventSharePurged, nil, &sid, &gen,
		mustJSON(map[string]any{"share_id": sid.String(), "generation": domain.FormatVersion(gen),
			"order_id": g.OrderID.String(), "recipient_user_id": g.Recipient.String(), "role": g.Role}))
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied}, nil
}

func (e *Engine) opSettingsUpdate(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.SettingsUpdatePayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if p.CollectThresholdDays != nil {
		if !validThreshold(*p.CollectThresholdDays) {
			return reject(oc, domain.CodeInvalidPayload, "催收阈值应为 7、15、30 或 45 天"), nil
		}
	}
	if p.Timezone != nil && !domain.ValidTimezone(*p.Timezone) {
		return reject(oc, domain.CodeInvalidPayload, "时区无效"), nil
	}
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	var threshold int
	var timezone string
	if err := tx.QueryRowContext(ctx,
		`SELECT collect_threshold_days, ledger_timezone FROM users WHERE id = ?`,
		oc.sess.UserID[:]).Scan(&threshold, &timezone); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if p.CollectThresholdDays != nil {
		threshold = *p.CollectThresholdDays
	}
	if p.Timezone != nil {
		timezone = *p.Timezone
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET collect_threshold_days=?, ledger_timezone=?, updated_at=? WHERE id=?`,
		threshold, timezone, oc.now, oc.sess.UserID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	payload, _ := json.Marshal(domain.SettingsDTO{CollectThresholdDays: threshold, Timezone: timezone})
	e.emitSelf(oc, domain.EventSettings, nil, payload)
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
		ResultingVersion: "1", Payload: payload}, nil
}

func validThreshold(d int) bool { return d == 7 || d == 15 || d == 30 || d == 45 }

// ---- 辅助:联系关系与授权行 ----

type contactLinkRow struct {
	ID         store.ID
	Generation int64
}

// contactLinkActiveRow 读取两人之间有效联系(锁定行);user_low/high 规范化。
func (e *Engine) contactLinkActiveRow(ctx context.Context, tx *sql.Tx, a, b store.ID) (*contactLinkRow, error) {
	lo, hi := pairOrder(a, b)
	var row contactLinkRow
	err := tx.QueryRowContext(ctx,
		`SELECT id, generation FROM contact_links WHERE user_low = ? AND user_high = ? AND status='active' FOR UPDATE`,
		lo[:], hi[:]).Scan(&row.ID, &row.Generation)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (e *Engine) contactLinkActive(ctx context.Context, tx *sql.Tx, a, b store.ID) (bool, error) {
	row, err := e.contactLinkActiveRow(ctx, tx, a, b)
	if err != nil {
		return false, err
	}
	return row != nil, nil
}

func pairOrder(a, b store.ID) (store.ID, store.ID) {
	if b.String() < a.String() {
		return b, a
	}
	return a, b
}

// grantSetID 计算授权聚合的确定性 ID:UUIDv5(NAMESPACE_URL, "tanji-grant:"+owner+":"+order+":"+recipient)。
// 客户端必须用同一算法派生(见 packages/domain/grant.ts)。
func grantSetID(owner, orderID, recipient store.ID) store.ID {
	name := "tanji-grant:" + owner.String() + ":" + orderID.String() + ":" + recipient.String()
	u := uuid.NewSHA1(uuid.NameSpaceURL, []byte(name))
	var out store.ID
	copy(out[:], u[:])
	return out
}

func grantByOrderRecipient(ctx context.Context, tx *sql.Tx, orderID, recipient store.ID) (*grantRow, error) {
	row := &grantRow{}
	err := tx.QueryRowContext(ctx,
		`SELECT id, owner_user_id, order_id, recipient_user_id, role, share_id, grant_revision, generation, status, source, contact_link_id, contact_generation
		 FROM schedule_grants WHERE order_id = ? AND recipient_user_id = ? FOR UPDATE`,
		orderID[:], recipient[:]).Scan(&row.ID, &row.Owner, &row.OrderID, &row.Recipient, &row.Role,
		&row.ShareID, &row.Revision, &row.Generation, &row.Status, &row.Source, &row.ContactLinkID, &row.ContactGeneration)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return row, nil
}

func grantByShareID(ctx context.Context, tx *sql.Tx, shareID store.ID) (*grantRow, error) {
	row := &grantRow{}
	err := tx.QueryRowContext(ctx,
		`SELECT id, owner_user_id, order_id, recipient_user_id, role, share_id, grant_revision, generation, status, source, contact_link_id, contact_generation
		 FROM schedule_grants WHERE share_id = ? FOR UPDATE`, shareID[:]).Scan(
		&row.ID, &row.Owner, &row.OrderID, &row.Recipient, &row.Role, &row.ShareID,
		&row.Revision, &row.Generation, &row.Status, &row.Source, &row.ContactLinkID, &row.ContactGeneration)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return row, nil
}

func lockGuardsSorted(ctx context.Context, tx *sql.Tx, a, b store.ID, now any) error {
	first, second := a, b
	if b.String() < a.String() {
		first, second = b, a
	}
	if err := lockGuard(ctx, tx, first, now); err != nil {
		return err
	}
	if second != first {
		return lockGuard(ctx, tx, second, now)
	}
	return nil
}

// revokeGrants 撤销一组授权并发送 purge 事件(接收者 + 本人)。
func (e *Engine) revokeGrants(ctx context.Context, tx *sql.Tx, oc *opContext, grants []grantRow, reason string) error {
	for _, g := range grants {
		if _, err := tx.ExecContext(ctx,
			`UPDATE schedule_grants SET status='revoked', revoked_at=? WHERE id=?`, oc.now, g.ID[:]); err != nil {
			return err
		}
		gen := g.Generation
		sid := g.ShareID
		_ = reason
		e.emitTo(oc, g.Recipient, domain.EventSharePurged, nil, &sid, &gen,
			mustJSON(map[string]any{"share_id": sid.String(), "generation": domain.FormatVersion(gen)}))
		e.emitTo(oc, oc.sess.UserID, domain.EventSharePurged, nil, &sid, &gen,
			mustJSON(map[string]any{"share_id": sid.String(), "generation": domain.FormatVersion(gen),
				"order_id": g.OrderID.String(), "recipient_user_id": g.Recipient.String(), "role": g.Role}))
	}
	return nil
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
