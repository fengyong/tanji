package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// lockGuard 锁定账本级 domain guard(INSERT 保证存在,再 FOR UPDATE 串行化)。
func lockGuard(ctx context.Context, tx *sql.Tx, userID store.ID, now any) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT IGNORE INTO account_domain_guards (user_id, updated_at) VALUES (?, ?)`,
		userID[:], now); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx,
		`SELECT updated_at FROM account_domain_guards WHERE user_id = ? FOR UPDATE`, userID[:])
	return err
}

// loadOrderForUpdate 读取并锁定订单行(校验归属);deleted 订单仍返回用于墓碑判断。
func loadOrderForUpdate(ctx context.Context, tx *sql.Tx, owner, orderID store.ID) (*orderRow, error) {
	row := &orderRow{}
	err := tx.QueryRowContext(ctx,
		`SELECT id, owner_user_id, version, store, category, contact, note, price_cents, deposit_cents,
		        appt_start, appt_end, timezone, settle_via, channel,
		        shot_at, submitted_at, short_sent_at, long_sent_at, remind_at, status, created_at, updated_at
		 FROM orders WHERE id = ? AND owner_user_id = ? FOR UPDATE`,
		orderID[:], owner[:],
	).Scan(&row.ID, &row.Owner, &row.Version, &row.Store, &row.Category, &row.Contact, &row.Note,
		&row.PriceCents, &row.DepositCents, &row.ApptStart, &row.ApptEnd, &row.Timezone,
		&row.SettleVia, &row.Channel, &row.ShotAt, &row.SubmittedAt, &row.ShortSentAt,
		&row.LongSentAt, &row.RemindAt, &row.Status, &row.CreatedAt, &row.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return row, err
}

type orderRow struct {
	ID           store.ID
	Owner        store.ID
	Version      int64
	Store        string
	Category     string
	Contact      string
	Note         string
	PriceCents   int64
	DepositCents int64
	ApptStart    sql.NullTime
	ApptEnd      sql.NullTime
	Timezone     string
	SettleVia    string
	Channel      string
	ShotAt       sql.NullTime
	SubmittedAt  sql.NullTime
	ShortSentAt  sql.NullTime
	LongSentAt   sql.NullTime
	RemindAt     sql.NullTime
	Status       string
	CreatedAt    sql.NullTime
	UpdatedAt    sql.NullTime
}

func nullTimePtr(t sql.NullTime) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format("2006-01-02T15:04:05.000Z")
	return &s
}

// hasActiveReceipt 返回指定 kind 的有效收款(未撤销);同时返回其 ID。
func hasActiveReceipt(ctx context.Context, tx *sql.Tx, owner, orderID store.ID, kind string) (store.ID, bool, error) {
	var receiptID store.ID
	err := tx.QueryRowContext(ctx,
		`SELECT receipt_id FROM active_receipts WHERE owner_user_id = ? AND order_id = ? AND kind = ?`,
		owner[:], orderID[:], kind).Scan(&receiptID)
	if errors.Is(err, sql.ErrNoRows) {
		return store.ID{}, false, nil
	}
	return receiptID, err == nil, err
}

// checkTombstone 命中删除墓碑时返回 true。
func checkTombstone(ctx context.Context, tx *sql.Tx, owner, entityID store.ID) (bool, error) {
	var one int
	err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM entity_tombstones WHERE owner_user_id = ? AND entity_id = ?`,
		owner[:], entityID[:]).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return one == 1, err
}

func (e *Engine) opOrderCreate(ctx context.Context, tx *sql.Tx, oc *opContext) (domain.OpResult, error) {
	var p domain.OrderCreatePayload
	if err := domain.DecodeJSON(oc.payload, &p, 64<<10); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	if err := domain.ValidateOrderCreatePayload(&p); err != nil {
		return reject(oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	pre := oc.op.Precondition
	if pre == nil || pre.ExpectedVersion != "0" {
		return reject(oc, domain.CodeInvalidPayload, "新建订单必须使用 expected_version=\"0\""), nil
	}
	if err := lockGuard(ctx, tx, oc.sess.UserID, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if dead, err := checkTombstone(ctx, tx, oc.sess.UserID, oc.aggID); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	} else if dead {
		return reject(oc, domain.CodeEntityDeleted, "该订单 ID 已被删除,不能复活;请用新 ID 重新创建"), nil
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM orders WHERE id = ?`, oc.aggID[:]).Scan(&exists); err == nil {
		return reject(oc, domain.CodeBusinessRule, "订单 ID 已存在"), nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return domain.OpResult{}, wrapRetry(err)
	}

	apptStart, _ := domain.ParseRFC3339UTC(p.ApptStart)
	timezone := p.Timezone
	if timezone == "" {
		timezone = domain.DefaultTimezone
	}
	var apptEnd any
	if p.ApptEnd != "" {
		t, err := domain.ParseRFC3339UTC(p.ApptEnd)
		if err != nil {
			return reject(oc, domain.CodeInvalidPayload, "结束时间无效"), nil
		}
		apptEnd = t
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO orders (id, owner_user_id, version, store, category, contact, note, price_cents, deposit_cents,
		   appt_start, appt_end, timezone, settle_via, channel, status, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?)`,
		oc.aggID[:], oc.sess.UserID[:], 1, strings.TrimSpace(p.Store), p.Category, p.Contact, p.Note,
		p.PriceCents, p.DepositCents, apptStart, apptEnd, timezone, p.SettleVia, p.Channel,
		domain.StatusActive, oc.now, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if err := e.upsertPlace(ctx, tx, oc.aggID, p.Place, oc.now); err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	if p.Partner != nil {
		if err := e.setPartnerRow(ctx, tx, oc.aggID, p.Partner, oc.now); err != nil {
			return domain.OpResult{}, wrapRetry(err)
		}
	}
	dto, err := e.buildOrderDTO(ctx, tx, oc.aggID, 1)
	if err != nil {
		return domain.OpResult{}, wrapRetry(err)
	}
	payload, _ := json.Marshal(dto)
	e.emitSelf(oc, domain.EventOrderChanged, &oc.aggID, payload)
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultApplied,
		ResultingVersion: domain.FormatVersion(1), Payload: payload}, nil
}

func (e *Engine) upsertPlace(ctx context.Context, tx *sql.Tx, orderID store.ID, p *domain.PlacePayload, now any) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM order_places WHERE order_id = ?`, orderID[:]); err != nil {
		return err
	}
	if p == nil {
		return nil
	}
	var lat, lng any
	var coord, provider, poi any
	if p.Latitude != nil && p.Longitude != nil {
		lat = parseCoordForDB(*p.Latitude)
		lng = parseCoordForDB(*p.Longitude)
		coord = p.CoordSystem
	}
	if p.Provider != "" {
		provider = p.Provider
	}
	if p.POIID != "" {
		poi = p.POIID
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO order_places (order_id, address_text, latitude, longitude, coord_system, provider, poi_id, updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		orderID[:], p.Address, lat, lng, coord, provider, poi, now)
	return err
}

func parseCoordForDB(s string) any {
	var f float64
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &f); err != nil {
		return nil
	}
	return f
}

func (e *Engine) setPartnerRow(ctx context.Context, tx *sql.Tx, orderID store.ID, ref *domain.PartnerRef, now any) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM order_partner WHERE order_id = ?`, orderID[:]); err != nil {
		return err
	}
	if ref == nil {
		return nil
	}
	if ref.Type == "external" {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO order_partner (order_id, partner_type, partner_user_id, external_name, updated_at)
			 VALUES (?, 'external', NULL, ?, ?)`, orderID[:], ref.ExternalName, now)
		return err
	}
	uid, err := store.ParseID(ref.UserID)
	if err != nil {
		return fmt.Errorf("partner user_id 无效: %w", err)
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO order_partner (order_id, partner_type, partner_user_id, external_name, updated_at)
		 VALUES (?, 'account', ?, NULL, ?)`, orderID[:], uid[:], now)
	return err
}

// loadPartner 读取订单当前搭档。
func loadPartner(ctx context.Context, tx *sql.Tx, orderID store.ID) (*domain.PartnerRef, error) {
	var ptype string
	var uid sql.Null[[]byte]
	var name sql.NullString
	err := tx.QueryRowContext(ctx,
		`SELECT partner_type, partner_user_id, external_name FROM order_partner WHERE order_id = ?`,
		orderID[:]).Scan(&ptype, &uid, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	ref := &domain.PartnerRef{Type: ptype}
	if ptype == "account" && uid.Valid {
		ref.UserID = store.ID(uid.V).String()
	}
	if ptype == "external" && name.Valid {
		ref.ExternalName = name.String
	}
	return ref, nil
}

func (e *Engine) buildOrderDTO(ctx context.Context, tx *sql.Tx, orderID store.ID, version int64) (*domain.OrderDTO, error) {
	row, err := loadOrderForUpdateNoLock(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("engine: order %s missing", orderID)
	}
	var place *domain.PlacePayload
	var addr sql.NullString
	var lat, lng sql.NullFloat64
	var coord, provider, poi sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT address_text, latitude, longitude, coord_system, provider, poi_id FROM order_places WHERE order_id = ?`,
		orderID[:]).Scan(&addr, &lat, &lng, &coord, &provider, &poi)
	if err == nil {
		place = &domain.PlacePayload{Address: addr.String, Provider: provider.String, POIID: poi.String}
		if lat.Valid && lng.Valid {
			ls := fmt.Sprintf("%g", lat.Float64)
			lgs := fmt.Sprintf("%g", lng.Float64)
			place.Latitude = &ls
			place.Longitude = &lgs
			cs := coord.String
			place.CoordSystem = cs
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	partner, err := loadPartner(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	payments, err := e.listPayments(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if payments == nil {
		payments = []domain.PaymentDTO{}
	}
	active := map[string]string{}
	for _, pm := range payments {
		if pm.EntryType == domain.EntryReceipt {
			if _, ok := active[pm.Kind]; !ok {
				active[pm.Kind] = pm.ID
			}
		} else {
			for k, v := range active {
				if v == *pm.ReversesID {
					delete(active, k)
				}
			}
		}
	}
	dto := &domain.OrderDTO{
		ID: orderID.String(), Version: domain.FormatVersion(version),
		Store: row.Store, Category: row.Category, Contact: row.Contact, Note: row.Note,
		PriceCents: row.PriceCents, DepositCents: row.DepositCents,
		ApptStart: row.ApptStart.Time.UTC().Format("2006-01-02T15:04:05.000Z"),
		Timezone:  row.Timezone, SettleVia: row.SettleVia, Channel: row.Channel,
		Status: row.Status, Place: place, Partner: partner, Payments: payments,
		ActiveReceipts: active,
		CreatedAt:      row.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:      row.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if row.ApptEnd.Valid {
		s := row.ApptEnd.Time.UTC().Format("2006-01-02T15:04:05.000Z")
		dto.ApptEnd = &s
	}
	for _, pair := range []struct {
		src sql.NullTime
		dst **string
	}{
		{row.ShotAt, &dto.ShotAt}, {row.SubmittedAt, &dto.SubmittedAt},
		{row.ShortSentAt, &dto.ShortSentAt}, {row.LongSentAt, &dto.LongSentAt},
		{row.RemindAt, &dto.RemindAt},
	} {
		if pair.src.Valid {
			s := pair.src.Time.UTC().Format("2006-01-02T15:04:05.000Z")
			*pair.dst = &s
		}
	}
	return dto, nil
}

func loadOrderForUpdateNoLock(ctx context.Context, tx *sql.Tx, orderID store.ID) (*orderRow, error) {
	row := &orderRow{}
	err := tx.QueryRowContext(ctx,
		`SELECT id, owner_user_id, version, store, category, contact, note, price_cents, deposit_cents,
		        appt_start, appt_end, timezone, settle_via, channel,
		        shot_at, submitted_at, short_sent_at, long_sent_at, remind_at, status, created_at, updated_at
		 FROM orders WHERE id = ?`, orderID[:],
	).Scan(&row.ID, &row.Owner, &row.Version, &row.Store, &row.Category, &row.Contact, &row.Note,
		&row.PriceCents, &row.DepositCents, &row.ApptStart, &row.ApptEnd, &row.Timezone,
		&row.SettleVia, &row.Channel, &row.ShotAt, &row.SubmittedAt, &row.ShortSentAt,
		&row.LongSentAt, &row.RemindAt, &row.Status, &row.CreatedAt, &row.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return row, err
}

// SnapshotOrderDTO / SnapshotShareProjection 供 bootstrap 复用(不要求行锁)。
func (e *Engine) SnapshotOrderDTO(ctx context.Context, tx *sql.Tx, orderID store.ID, version int64) (*domain.OrderDTO, error) {
	return e.buildOrderDTO(ctx, tx, orderID, version)
}

func (e *Engine) SnapshotShareProjection(ctx context.Context, tx *sql.Tx, shareID store.ID, generation int64, linkID store.ID, linkGeneration int64) (*domain.ScheduleProjectionDTO, error) {
	var revision int64
	var ownerDisplay, storeName string
	var startsAt time.Time
	var endsAt sql.NullTime
	var timezone string
	var addr sql.NullString
	var lat, lng sql.NullFloat64
	var coord, provider, poi sql.NullString
	var scheduleStatus string
	err := tx.QueryRowContext(ctx,
		`SELECT revision, owner_display, store, starts_at, ends_at, timezone, address_text, latitude, longitude,
		        coord_system, provider, poi_id, schedule_status
		 FROM schedule_projections WHERE share_id = ?`, shareID[:]).Scan(
		&revision, &ownerDisplay, &storeName, &startsAt, &endsAt, &timezone, &addr, &lat, &lng,
		&coord, &provider, &poi, &scheduleStatus)
	if err != nil {
		return nil, err
	}
	dto := &domain.ScheduleProjectionDTO{
		ShareID: shareID.String(), Generation: domain.FormatVersion(generation),
		Revision: domain.FormatVersion(revision), OwnerDisplay: ownerDisplay,
		Store: storeName,
		StartsAt: startsAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Timezone: timezone, Address: addr.String,
		ScheduleStatus: scheduleStatus,
		AuthRelationID: linkID.String(), AuthRelationGeneration: domain.FormatVersion(linkGeneration),
	}
	if endsAt.Valid {
		s := endsAt.Time.UTC().Format("2006-01-02T15:04:05.000Z")
		dto.EndsAt = &s
	}
	if lat.Valid && lng.Valid {
		ls := fmt.Sprintf("%g", lat.Float64)
		lgs := fmt.Sprintf("%g", lng.Float64)
		dto.Latitude, dto.Longitude = &ls, &lgs
		cs := coord.String
		dto.CoordSystem = &cs
	}
	if provider.Valid && provider.String != "" {
		dto.Provider = &provider.String
	}
	if poi.Valid && poi.String != "" {
		dto.POIID = &poi.String
	}
	return dto, nil
}

func (e *Engine) listPayments(ctx context.Context, tx *sql.Tx, orderID store.ID) ([]domain.PaymentDTO, error) {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, kind, entry_type, amount_cents, method, paid_at, reverses_id
		 FROM payment_entries WHERE order_id = ? ORDER BY created_at, id`, orderID[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.PaymentDTO
	for rows.Next() {
		var pm domain.PaymentDTO
		var id, rev sql.Null[[]byte]
		var paidAt sql.NullTime
		if err := rows.Scan(&id, &pm.Kind, &pm.EntryType, &pm.AmountCents, &pm.Method, &paidAt, &rev); err != nil {
			return nil, err
		}
		pm.ID = store.ID(id.V).String()
		pm.OrderID = orderID.String()
		pm.PaidAt = paidAt.Time.UTC().Format("2006-01-02T15:04:05.000Z")
		if rev.Valid {
			s := store.ID(rev.V).String()
			pm.ReversesID = &s
		}
		out = append(out, pm)
	}
	return out, rows.Err()
}
