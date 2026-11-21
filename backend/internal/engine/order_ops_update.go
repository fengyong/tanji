package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// projectionAffecting 判断更新是否影响共享白名单内容。
func projectionAffecting(p *domain.OrderUpdatePayload) bool {
	return p.Store != nil || p.ApptStart != nil || p.ApptEnd != nil || p.ClearApptEnd ||
		p.Timezone != nil || p.Place != nil
}

// activeGrants 返回订单当前有效授权(锁定 grant 行)。
func activeGrants(ctx context.Context, tx *sql.Tx, orderID store.ID, forUpdate bool) ([]grantRow, error) {
	q := `SELECT id, owner_user_id, order_id, recipient_user_id, role, share_id, grant_revision, generation, status, source, contact_link_id, contact_generation
	      FROM schedule_grants WHERE order_id = ? AND status = 'active'`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	rows, err := tx.QueryContext(ctx, q, orderID[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []grantRow
	for rows.Next() {
		var g grantRow
		if err := rows.Scan(&g.ID, &g.Owner, &g.OrderID, &g.Recipient, &g.Role, &g.ShareID,
			&g.Revision, &g.Generation, &g.Status, &g.Source, &g.ContactLinkID, &g.ContactGeneration); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

type grantRow struct {
	ID                store.ID
	Owner             store.ID
	OrderID           store.ID
	Recipient         store.ID
	Role              string
	ShareID           store.ID
	Revision          int64
	Generation        int64
	Status            string
	Source            string
	ContactLinkID     store.ID
	ContactGeneration int64
}

func (e *Engine) opOrderUpdate(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.OrderUpdatePayload
	if err := domain.DecodeJSON(oc.payload, &p, 64<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if err := validateUpdatePayload(&p, oc.op.Type == domain.OpOrderReschedule); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
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
		return reject(oc, domain.CodeEntityDeleted, "订单已删除,不能修改"), nil
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
		return conflict(oc, domain.CodeVersionMismatch,
			"订单版本不匹配:云端当前版本 "+domain.FormatVersion(row.Version), cur), nil
	}

	// 有有效收款时禁止改总价/定金。
	if p.PriceCents != nil || p.DepositCents != nil {
		if p.PriceCents != nil && !domain.ValidAmountCents(*p.PriceCents) {
			return reject(oc, domain.CodeInvalidPayload, "总价金额无效"), nil
		}
		if p.DepositCents != nil && !domain.ValidAmountCents(*p.DepositCents) {
			return reject(oc, domain.CodeInvalidPayload, "定金金额无效"), nil
		}
		newPrice := row.PriceCents
		if p.PriceCents != nil {
			newPrice = *p.PriceCents
		}
		newDeposit := row.DepositCents
		if p.DepositCents != nil {
			newDeposit = *p.DepositCents
		}
		if newDeposit > newPrice {
			return reject(oc, domain.CodeBusinessRule, "定金不能超过总价"), nil
		}
		for _, kind := range []string{domain.PayKindDeposit, domain.PayKindFinal} {
			if _, ok, _ := hasActiveReceipt(ctx, tx, oc.sess.UserID, oc.aggID, kind); ok {
				return reject(oc, domain.CodeBusinessRule,
					"已有有效收款,不能修改总价或定金;请先撤销错误收款"), nil
			}
		}
	}

	newVersion := row.Version + 1
	if err := applyOrderUpdateFields(ctx, tx, oc, row, &p, newVersion); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}

	affectProjection := projectionAffecting(&p)
	if affectProjection {
		if err := e.refreshProjections(ctx, tx, oc, oc.aggID); err != nil {
			return domain.OpResult{}, wrapRetry(err)
		}
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

func validateUpdatePayload(p *domain.OrderUpdatePayload, rescheduleOnly bool) error {
	if rescheduleOnly {
		if p.Store != nil || p.Category != nil || p.Contact != nil || p.Note != nil ||
			p.Channel != nil || p.PriceCents != nil || p.DepositCents != nil ||
			p.SettleVia != nil || p.Place != nil {
			return errors.New("reschedule 只允许修改档期字段")
		}
		if p.ApptStart == nil && p.Timezone == nil && p.ApptEnd == nil && !p.ClearApptEnd {
			return errors.New("reschedule 缺少档期字段")
		}
	}
	if p.ApptStart != nil {
		if _, err := domain.ParseRFC3339UTC(*p.ApptStart); err != nil {
			return errors.New("预约时间无效")
		}
	}
	if p.ApptEnd != nil && *p.ApptEnd != "" {
		if _, err := domain.ParseRFC3339UTC(*p.ApptEnd); err != nil {
			return errors.New("结束时间无效")
		}
	}
	if p.Timezone != nil && !domain.ValidTimezone(*p.Timezone) {
		return errors.New("时区无效")
	}
	if p.SettleVia != nil && !domain.Settlements[*p.SettleVia] {
		return errors.New("结算方式无效")
	}
	if p.Category != nil && (p.Category == nil || !domain.Categories[*p.Category]) {
		return errors.New("店铺类型无效")
	}
	if p.Store != nil && strings.TrimSpace(*p.Store) == "" {
		return errors.New("商家名称不能为空")
	}
	for _, check := range []struct {
		s *string
		n int
		l string
	}{
		{p.Store, domain.MaxTextOrderStore, "商家名称"},
		{p.Contact, domain.MaxTextContact, "联系方式"},
		{p.Note, domain.MaxTextNote, "备注"},
		{p.Channel, domain.MaxTextChannel, "渠道"},
	} {
		if check.s != nil {
			if err := boundedTextEngine(*check.s, check.n, check.l); err != nil {
				return err
			}
		}
	}
	if p.Place != nil {
		if err := domain.ValidatePlace(p.Place); err != nil {
			return err
		}
	}
	return nil
}

func boundedTextEngine(s string, max int, label string) error {
	if len(s) > max {
		return errors.New(label + " 超过长度上限")
	}
	return nil
}

func applyOrderUpdateFields(ctx context.Context, tx *sql.Tx, oc *opContext, row *orderRow, p *domain.OrderUpdatePayload, newVersion int64) error {
	store_, category, contact, note, channel, settleVia := row.Store, row.Category, row.Contact, row.Note, row.Channel, row.SettleVia
	priceCents, depositCents := row.PriceCents, row.DepositCents
	timezone := row.Timezone
	if p.Store != nil {
		store_ = strings.TrimSpace(*p.Store)
	}
	if p.Category != nil {
		category = *p.Category
	}
	if p.Contact != nil {
		contact = *p.Contact
	}
	if p.Note != nil {
		note = *p.Note
	}
	if p.Channel != nil {
		channel = strings.TrimSpace(*p.Channel)
		if channel == "" {
			channel = "直客"
		}
	}
	if p.SettleVia != nil {
		settleVia = *p.SettleVia
	}
	if p.PriceCents != nil {
		priceCents = *p.PriceCents
	}
	if p.DepositCents != nil {
		depositCents = *p.DepositCents
	}
	if p.Timezone != nil {
		timezone = *p.Timezone
	}
	apptStart := row.ApptStart
	if p.ApptStart != nil {
		t, _ := domain.ParseRFC3339UTC(*p.ApptStart)
		apptStart = sql.NullTime{Time: t, Valid: true}
	}
	apptEnd := row.ApptEnd
	if p.ClearApptEnd {
		apptEnd = sql.NullTime{}
	} else if p.ApptEnd != nil {
		if *p.ApptEnd == "" {
			apptEnd = sql.NullTime{}
		} else {
			t, _ := domain.ParseRFC3339UTC(*p.ApptEnd)
			apptEnd = sql.NullTime{Time: t, Valid: true}
		}
	}
	_, err := tx.ExecContext(ctx,
		`UPDATE orders SET version=?, store=?, category=?, contact=?, note=?, price_cents=?, deposit_cents=?,
		   appt_start=?, appt_end=?, timezone=?, settle_via=?, channel=?, updated_at=?
		 WHERE id=?`,
		newVersion, store_, category, contact, note, priceCents, depositCents,
		apptStart, apptEnd, timezone, settleVia, channel, oc.now, oc.aggID[:])
	return err
}

func (e *Engine) rejectFromDomain(oc *opContext, err error) domain.OpResult {
	var dr *domain.DomainRejection
	if errors.As(err, &dr) {
		if dr.IsConflict {
			return conflict(oc, dr.Code, dr.Message, nil)
		}
		return reject(oc, dr.Code, dr.Message)
	}
	return reject(oc, domain.CodeBusinessRule, err.Error())
}

func (e *Engine) opOrderCancel(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	if len(oc.payload) > 0 {
		var p struct{}
		if err := domain.DecodeJSON(oc.payload, &p, 1024); err != nil {
			return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
		}
	}
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
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
	if row.Status == domain.StatusCancelled {
		return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied,
			ResultingVersion: domain.FormatVersion(row.Version)}, nil
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
	newVersion := row.Version + 1
	if _, err := tx.ExecContext(ctx,
		`UPDATE orders SET version=?, status='cancelled', updated_at=? WHERE id=?`,
		newVersion, oc.now, oc.aggID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if err := e.refreshProjectionsStatus(ctx, tx, oc, oc.aggID, domain.StatusCancelled); err != nil {
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

func (e *Engine) opOrderArchive(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
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
	if row.Status == domain.StatusArchived {
		return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied,
			ResultingVersion: domain.FormatVersion(row.Version)}, nil
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
	newVersion := row.Version + 1
	if _, err := tx.ExecContext(ctx,
		`UPDATE orders SET version=?, status='archived', updated_at=? WHERE id=?`,
		newVersion, oc.now, oc.aggID[:]); err != nil {
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

// opOrderDelete:有有效收款的订单只能归档,不能删除(防止抹掉实际收款)。
func (e *Engine) opOrderDelete(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	row, err := loadOrderForUpdate(ctx, tx, oc.sess.UserID, oc.aggID)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if row == nil {
		if dead, terr := checkTombstone(ctx, tx, oc.sess.UserID, oc.aggID); terr == nil && dead {
			return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied}, nil
		}
		return reject(oc, domain.CodeEntityNotFound, "订单不存在"), nil
	}
	if row.Status == domain.StatusDeleted {
		return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultAlreadyApplied,
			ResultingVersion: domain.FormatVersion(row.Version)}, nil
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
	for _, kind := range []string{domain.PayKindDeposit, domain.PayKindFinal} {
		if _, ok, _ := hasActiveReceipt(ctx, tx, oc.sess.UserID, oc.aggID, kind); ok {
			return reject(oc, domain.CodeBusinessRule,
				"该订单有实际收款,只能归档不能删除;如为误记请先撤销收款"), nil
		}
	}
	newVersion := row.Version + 1
	if _, err := tx.ExecContext(ctx,
		`UPDATE orders SET version=?, status='deleted', deleted_at=?, updated_at=? WHERE id=?`,
		newVersion, oc.now, oc.now, oc.aggID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO entity_tombstones (owner_user_id, entity_id, entity_type, deleted_version, deleted_at)
		 VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE deleted_version=VALUES(deleted_version), deleted_at=VALUES(deleted_at)`,
		oc.sess.UserID[:], oc.aggID[:], "order", newVersion, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	// 撤销该订单全部授权并向接收者发送 purge。
	grants, err := activeGrants(ctx, tx, oc.aggID, true)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if err := e.revokeGrants(ctx, tx, oc, grants, "order_deleted"); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	deletedPayload, _ := json.Marshal(map[string]any{"id": oc.aggID.String(), "deleted_version": domain.FormatVersion(newVersion)})
	e.emitSelf(oc, domain.EventOrderDeleted, &oc.aggID, deletedPayload)
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
		ResultingVersion: domain.FormatVersion(newVersion), Payload: deletedPayload}, nil
}
