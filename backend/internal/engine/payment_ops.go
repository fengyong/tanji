package engine

import (
	"context"
	"database/sql"
	"encoding/json"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// opPaymentRecord 记一笔收款:金额必须等于当前待收(整笔定金/整笔尾款),
// 同一 kind 只允许一笔有效收款;重复点击/重试由 mutation_receipts 幂等去重。
func (e *Engine) opPaymentRecord(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.PaymentRecordPayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if p.Kind != domain.PayKindDeposit && p.Kind != domain.PayKindFinal {
		return reject(oc, domain.CodeInvalidPayload, "收款类型无效"), nil
	}
	if !domain.ReceiptMethods[p.Method] {
		return reject(oc, domain.CodeInvalidPayload, "收款方式无效"), nil
	}
	if _, err := domain.ParseRFC3339UTC(p.PaidAt); err != nil {
		return reject(oc, domain.CodeInvalidPayload, "到账时间无效"), nil
	}
	if !domain.ValidAmountCents(p.AmountCents) || p.AmountCents <= 0 {
		return reject(oc, domain.CodeInvalidPayload, "收款金额必须为正整数分"), nil
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
		return reject(oc, domain.CodeEntityDeleted, "订单已删除,不能记账"), nil
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
		return conflict(oc, domain.CodeVersionMismatch, "订单版本不匹配,收款未入账", cur), nil
	}
	// 业务级约束:同 kind 最多一笔有效收款。
	if _, ok, err := hasActiveReceipt(ctx, tx, oc.sess.UserID, oc.aggID, p.Kind); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	} else if ok {
		return reject(oc, domain.CodeBusinessRule, "该笔款项已存在有效收款,请勿重复记账"), nil
	}
	// 整笔规则:金额必须等于当前待收。
	var due int64
	if p.Kind == domain.PayKindDeposit {
		due = row.DepositCents
	} else {
		due = row.PriceCents - row.DepositCents
	}
	if due <= 0 {
		return reject(oc, domain.CodeBusinessRule, "该笔款项没有待收金额(零元单不生成流水)"), nil
	}
	if p.AmountCents != due {
		return reject(oc, domain.CodeBusinessRule,
			"收款金额必须等于当前待收金额(第一版为整笔定金/尾款记账)"), nil
	}

	receiptID := store.NewID()
	paidAt, _ := domain.ParseRFC3339UTC(p.PaidAt)
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO payment_entries (id, owner_user_id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, created_op_id, created_at)
		 VALUES (?,?,?,?,'receipt',?,?,?,?,?,?)`,
		receiptID[:], oc.sess.UserID[:], oc.aggID[:], p.Kind, p.AmountCents, p.Method, paidAt,
		nil, oc.opID[:], oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO active_receipts (owner_user_id, order_id, kind, receipt_id) VALUES (?,?,?,?)`,
		oc.sess.UserID[:], oc.aggID[:], p.Kind, receiptID[:]); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	newVersion := row.Version + 1
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

// opPaymentReverse 撤销错误收款:保留原记录,新增明确撤销流水,不是删除历史。
func (e *Engine) opPaymentReverse(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.PaymentReversePayload
	if err := domain.DecodeJSON(oc.payload, &p, 8<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if p.Kind != domain.PayKindDeposit && p.Kind != domain.PayKindFinal {
		return reject(oc, domain.CodeInvalidPayload, "收款类型无效"), nil
	}
	if len(p.Reason) > 500 {
		return reject(oc, domain.CodeInvalidPayload, "撤销原因过长"), nil
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
		return conflict(oc, domain.CodeVersionMismatch, "订单版本不匹配,撤销未执行", cur), nil
	}
	receiptID, ok, err := hasActiveReceipt(ctx, tx, oc.sess.UserID, oc.aggID, p.Kind)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if !ok {
		return reject(oc, domain.CodeBusinessRule, "没有可撤销的有效收款"), nil
	}
	var amount int64
	var method string
	var origPaidAt any
	if err := tx.QueryRowContext(ctx,
		`SELECT amount_cents, method, paid_at FROM payment_entries WHERE id = ?`,
		receiptID[:]).Scan(&amount, &method, &origPaidAt); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	reversalID := store.NewID()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO payment_entries (id, owner_user_id, order_id, kind, entry_type, amount_cents, method, paid_at, reverses_id, created_op_id, created_at)
		 VALUES (?,?,?,?,'reversal',?,?,?,?,?,?)`,
		reversalID[:], oc.sess.UserID[:], oc.aggID[:], p.Kind, amount, method, oc.now,
		receiptID[:], oc.opID[:], oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM active_receipts WHERE owner_user_id=? AND order_id=? AND kind=?`,
		oc.sess.UserID[:], oc.aggID[:], p.Kind); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	newVersion := row.Version + 1
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
