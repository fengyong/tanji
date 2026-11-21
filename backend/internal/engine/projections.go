package engine

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// rebuildProjection 用订单当前内容重建共享投影(白名单字段,绝不包含完整订单 JSON)。
// 只有白名单字段变化才 bump revision 并产生接收者事件(纯财务变更不会)。
func (e *Engine) rebuildProjection(ctx context.Context, tx *sql.Tx, oc *opContext, g *grantRow, order *orderRow) error {
	ownerName, err := e.nicknameOf(ctx, tx, oc.sess.UserID)
	if err != nil {
		return err
	}
	var addr sql.NullString
	var lat, lng sql.NullFloat64
	var coord, provider, poi sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT address_text, latitude, longitude, coord_system, provider, poi_id FROM order_places WHERE order_id = ?`,
		order.ID[:]).Scan(&addr, &lat, &lng, &coord, &provider, &poi)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO schedule_projections
		   (share_id, generation, revision, owner_display, store, starts_at, ends_at, timezone,
		    address_text, latitude, longitude, coord_system, provider, poi_id, schedule_status, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		 ON DUPLICATE KEY UPDATE
		   generation=VALUES(generation), revision=VALUES(revision), owner_display=VALUES(owner_display),
		   store=VALUES(store), starts_at=VALUES(starts_at), ends_at=VALUES(ends_at), timezone=VALUES(timezone),
		   address_text=VALUES(address_text), latitude=VALUES(latitude), longitude=VALUES(longitude),
		   coord_system=VALUES(coord_system), provider=VALUES(provider), poi_id=VALUES(poi_id),
		   schedule_status=VALUES(schedule_status), updated_at=VALUES(updated_at)`,
		g.ShareID[:], g.Generation, g.Revision, ownerName, order.Store,
		order.ApptStart, nullTimeAny(order.ApptEnd), order.Timezone,
		addr.String, nullFloatAny(lat), nullFloatAny(lng), nullStringAny(coord),
		nullStringAny(provider), nullStringAny(poi), projectionStatus(order.Status), oc.now)
	return err
}

func projectionStatus(orderStatus string) string {
	if orderStatus == domain.StatusCancelled {
		return domain.StatusCancelled
	}
	return "normal"
}

// refreshProjections 重新计算订单全部有效授权的投影;白名单内容变化才 revision+1 并发 share.updated。
func (e *Engine) refreshProjections(ctx context.Context, tx *sql.Tx, oc *opContext, orderID store.ID) error {
	row, err := loadOrderForUpdateNoLock(ctx, tx, orderID)
	if err != nil || row == nil {
		return err
	}
	grants, err := activeGrants(ctx, tx, orderID, true)
	if err != nil {
		return err
	}
	if len(grants) == 0 {
		return nil
	}
	type beforeSnap struct {
		rev      int64
		identity string
	}
	before := map[store.ID]beforeSnap{}
	for _, g := range grants {
		var snap beforeSnap
		err := tx.QueryRowContext(ctx,
			`SELECT revision, CONCAT_WS('\u0001', owner_display, store, UNIX_TIMESTAMP(starts_at), COALESCE(UNIX_TIMESTAMP(ends_at),0), timezone, address_text, latitude, longitude, coord_system, provider, poi_id, schedule_status)
			 FROM schedule_projections WHERE share_id = ?`, g.ShareID[:]).Scan(&snap.rev, &snap.identity)
		if err == nil {
			before[g.ShareID] = snap
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	for i := range grants {
		g := grants[i]
		g.Revision++
		if err := e.rebuildProjection(ctx, tx, oc, &g, row); err != nil {
			return err
		}
	}
	for _, g := range grants {
		var content string
		err := tx.QueryRowContext(ctx,
			`SELECT CONCAT_WS('\u0001', owner_display, store, UNIX_TIMESTAMP(starts_at), COALESCE(UNIX_TIMESTAMP(ends_at),0), timezone, address_text, latitude, longitude, coord_system, provider, poi_id, schedule_status)
			 FROM schedule_projections WHERE share_id = ?`, g.ShareID[:]).Scan(&content)
		if err != nil {
			return err
		}
		snap, ok := before[g.ShareID]
		if ok && snap.identity == content {
			// 白名单未变:回退 revision,不发事件。
			if _, err := tx.ExecContext(ctx,
				`UPDATE schedule_projections SET revision = ? WHERE share_id = ?`,
				snap.rev, g.ShareID[:]); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx,
				`UPDATE schedule_grants SET grant_revision = ? WHERE id = ?`,
				snap.rev, g.ID[:]); err != nil {
				return err
			}
			continue
		}
		if err := e.emitShareUpdated(ctx, tx, oc, &g, row); err != nil {
			return err
		}
	}
	return nil
}

// 简化:refreshProjections 先统一 revision+1 再按内容比对决定是否发事件。
// revision 的推进不影响客户端正确性(客户端只按事件应用),但为了避免无变化也推进版本,
// 上面在比对前记录 revision,无变化时回写原值。
func (e *Engine) emitShareUpdated(ctx context.Context, tx *sql.Tx, oc *opContext, g *grantRow, order *orderRow) error {
	link := &contactLinkRow{ID: g.ContactLinkID, Generation: g.ContactGeneration}
	return e.emitShareEvent(ctx, tx, oc, g, order, link, domain.EventShareUpdated)
}

func (e *Engine) refreshProjectionsStatus(ctx context.Context, tx *sql.Tx, oc *opContext, orderID store.ID, status string) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE schedule_projections p JOIN schedule_grants g ON p.share_id = g.share_id
		 SET p.schedule_status = ?, p.revision = p.revision + 1, p.updated_at = ?
		 WHERE g.order_id = ? AND g.status = 'active'`,
		projectionStatus(status), oc.now, orderID[:]); err != nil {
		return err
	}
	row, err := loadOrderForUpdateNoLock(ctx, tx, orderID)
	if err != nil || row == nil {
		return err
	}
	grants, err := activeGrants(ctx, tx, orderID, false)
	if err != nil {
		return err
	}
	for i := range grants {
		g := grants[i]
		g.Revision++
		if err := e.emitShareUpdated(ctx, tx, oc, &g, row); err != nil {
			return err
		}
	}
	return nil
}

// emitGrantEvents 向接收者发送完整最小投影,向所有者发送授权概要。
func (e *Engine) emitGrantEvents(ctx context.Context, tx *sql.Tx, oc *opContext, g *grantRow, order *orderRow, link *contactLinkRow) error {
	return e.emitShareEvent(ctx, tx, oc, g, order, link, domain.EventShareGranted)
}

func (e *Engine) emitShareEvent(ctx context.Context, tx *sql.Tx, oc *opContext, g *grantRow, order *orderRow, link *contactLinkRow, eventType string) error {
	ownerName, err := e.nicknameOf(ctx, tx, oc.sess.UserID)
	if err != nil {
		return err
	}
	var addr sql.NullString
	var lat, lng sql.NullFloat64
	var coord, provider, poi sql.NullString
	err = tx.QueryRowContext(ctx,
		`SELECT address_text, latitude, longitude, coord_system, provider, poi_id FROM order_places WHERE order_id = ?`,
		order.ID[:]).Scan(&addr, &lat, &lng, &coord, &provider, &poi)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	dto := domain.ScheduleProjectionDTO{
		ShareID: g.ShareID.String(), Generation: domain.FormatVersion(g.Generation),
		Revision: domain.FormatVersion(g.Revision), OwnerDisplay: ownerName,
		Store: order.Store,
		StartsAt: order.ApptStart.Time.UTC().Format("2006-01-02T15:04:05.000Z"),
		Timezone: order.Timezone, Address: addr.String,
		ScheduleStatus: projectionStatus(order.Status),
		AuthRelationID: link.ID.String(), AuthRelationGeneration: domain.FormatVersion(link.Generation),
	}
	if order.ApptEnd.Valid {
		s := order.ApptEnd.Time.UTC().Format("2006-01-02T15:04:05.000Z")
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
	payload, _ := json.Marshal(dto)
	sid := g.ShareID
	gen := g.Generation
	e.emitTo(oc, g.Recipient, eventType, nil, &sid, &gen, payload)
	// 本人其他设备需要同步授权状态。
	ownerPayload := map[string]any{
		"share_id": g.ShareID.String(), "generation": domain.FormatVersion(g.Generation),
		"revision": domain.FormatVersion(g.Revision),
		"order_id": g.OrderID.String(), "recipient_user_id": g.Recipient.String(),
		"role": g.Role, "event": eventType,
	}
	e.emitTo(oc, oc.sess.UserID, eventType, nil, &sid, &gen, mustJSON(ownerPayload))
	return nil
}

func (e *Engine) nicknameOf(ctx context.Context, tx *sql.Tx, userID store.ID) (string, error) {
	var name string
	if err := tx.QueryRowContext(ctx,
		`SELECT nickname FROM users WHERE id = ?`, userID[:]).Scan(&name); err != nil {
		return "", err
	}
	return name, nil
}

func nullTimeAny(t sql.NullTime) any {
	if t.Valid {
		return t.Time
	}
	return nil
}

func nullFloatAny(f sql.NullFloat64) any {
	if f.Valid {
		return f.Float64
	}
	return nil
}

func nullStringAny(s sql.NullString) any {
	if s.Valid && s.String != "" {
		return s.String
	}
	return nil
}
