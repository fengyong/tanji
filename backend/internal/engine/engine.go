// Package engine 实现业务操作的云端事务执行:幂等回执、版本条件、变更日志、共享投影。
//
// 锁顺序(架构文档 §6.4):
//  1. 当前鉴权用户行(users,由 push 处理器先行锁定)
//  2. account_domain_guards(按 user_id 排序)
//  3. 订单聚合行(按 order id 排序)
//  4. 关系/授权行
//  5. user_stream_heads(按 user_id 排序)
//
// 任何路径不得逆序持锁;死锁返回 ErrRetryable 由调用方重试。
package engine

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/domain"
	"tanji/backend/internal/store"
)

// ErrRetryable 表示事务死锁/超时,可整体重试。
var ErrRetryable = errors.New("engine: retryable transaction failure")

type Engine struct {
	DB     *sql.DB
	Logger *slog.Logger
	Now    func() time.Time
}

func New(db *sql.DB, logger *slog.Logger) *Engine {
	if logger == nil {
		logger = slog.Default()
	}
	return &Engine{DB: db, Logger: logger, Now: time.Now}
}

// SessionCtx 由中间件在锁定 users 行并核验单会话后构造;与 auth.SessionCtx 同一类型。
type SessionCtx = auth.SessionCtx

type opContext struct {
	sess       SessionCtx
	op         domain.OpEnvelope
	opID       store.ID
	aggID      store.ID
	payload    json.RawMessage
	payloadHash [32]byte
	now        time.Time
	selfEvents []pendingEvent // 按 recipient 去重后统一分配序号
}

type pendingEvent struct {
	recipient  store.ID
	eventType  string
	entityID   *store.ID
	shareID    *store.ID
	generation *int64
	payload    json.RawMessage
}

// ApplyOp 在已锁定 users 行的事务中处理单个操作。
// 返回领域结果;内部错误(如死锁)以 ErrRetryable 包装返回。
func (e *Engine) ApplyOp(ctx context.Context, tx *sql.Tx, sess SessionCtx, op domain.OpEnvelope) (domain.OpResult, error) {
	oc := opContext{sess: sess, op: op, now: e.Now().UTC()}

	if !domain.OpTypes[op.Type] {
		return reject(&oc, domain.CodeProtocol, "未知操作类型"), nil
	}
	var err error
	oc.opID, err = store.ParseID(op.OpID)
	if err != nil {
		return reject(&oc, domain.CodeInvalidPayload, "op_id 无效"), nil
	}
	oc.aggID, err = store.ParseID(op.AggregateID)
	if err != nil {
		return reject(&oc, domain.CodeInvalidPayload, "aggregate_id 无效"), nil
	}
	if err := validateEnvelope(&oc); err != nil {
		return reject(&oc, domain.CodeInvalidPayload, err.Error()), nil
	}
	oc.payload = op.Payload
	oc.payloadHash = sha256.Sum256(op.Payload)

	// 幂等:已处理且内容一致 → 返回已存结果;同 ID 内容不同 → 拒绝。
	res, found, err := e.lookupReceipt(tx, &oc)
	if err != nil {
		return domain.OpResult{}, err
	}
	if found {
		return res, nil
	}

	// 依赖检查:requires_success 前置必须已成功;否则 dependency_pending(不入回执,可重试)。
	if done, code, msg, err := e.checkRequires(tx, &oc); err != nil {
		return domain.OpResult{}, err
	} else if !done {
		return domain.OpResult{OpID: op.OpID, Result: domain.ResultDependencyPending,
			ErrorCode: code, Message: msg}, nil
	}

	// 领域处理。
	var result domain.OpResult
	switch op.Type {
	case domain.OpOrderCreate:
		result, err = e.opOrderCreate(ctx, tx, &oc)
	case domain.OpOrderUpdate, domain.OpOrderReschedule:
		result, err = e.opOrderUpdate(ctx, tx, &oc)
	case domain.OpOrderCancel:
		result, err = e.opOrderCancel(ctx, tx, &oc)
	case domain.OpOrderArchive:
		result, err = e.opOrderArchive(ctx, tx, &oc)
	case domain.OpOrderDelete:
		result, err = e.opOrderDelete(ctx, tx, &oc)
	case domain.OpPaymentRecord:
		result, err = e.opPaymentRecord(ctx, tx, &oc)
	case domain.OpPaymentReverse:
		result, err = e.opPaymentReverse(ctx, tx, &oc)
	case domain.OpPartnerAssign:
		result, err = e.opPartnerAssign(ctx, tx, &oc)
	case domain.OpScheduleGrant:
		result, err = e.opScheduleGrant(ctx, tx, &oc)
	case domain.OpScheduleRevoke:
		result, err = e.opScheduleRevoke(ctx, tx, &oc)
	case domain.OpSettingsUpdate:
		result, err = e.opSettingsUpdate(ctx, tx, &oc)
	default:
		result = reject(&oc, domain.CodeProtocol, "未知操作类型")
	}
	if err != nil {
		return domain.OpResult{}, err
	}

	// dependency_pending 不落回执,保持可重试。
	if result.Result == domain.ResultDependencyPending {
		return result, nil
	}

	if err := e.saveReceipt(tx, &oc, result); err != nil {
		return domain.OpResult{}, err
	}
	if err := e.flushEvents(tx, &oc); err != nil {
		return domain.OpResult{}, err
	}
	return result, nil
}

func validateEnvelope(oc *opContext) error {
	switch oc.op.AggregateType {
	case "order":
		if oc.op.Type == domain.OpScheduleGrant || oc.op.Type == domain.OpScheduleRevoke {
			return fmt.Errorf("授权操作的 aggregate_type 必须是 grant_set")
		}
	case "grant_set":
		if oc.op.Type != domain.OpScheduleGrant && oc.op.Type != domain.OpScheduleRevoke {
			return fmt.Errorf("授权命令 aggregate_type 必须是 grant_set")
		}
	case "settings":
		if oc.op.Type != domain.OpSettingsUpdate {
			return fmt.Errorf("settings 聚合只接受 settings.update")
		}
	default:
		return fmt.Errorf("未知 aggregate_type %q", oc.op.AggregateType)
	}
	// settings/grant 允许无版本条件(它们是低冲突独立聚合);订单操作必须有条件。
	if oc.op.AggregateType == "order" {
		if err := oc.op.Precondition.Validate(); err != nil {
			return err
		}
	} else if oc.op.Precondition != nil {
		if err := oc.op.Precondition.Validate(); err != nil {
			return err
		}
	}
	if len(oc.op.RequiresSuccess) > 16 {
		return fmt.Errorf("requires_success 数量超限")
	}
	for _, dep := range oc.op.RequiresSuccess {
		if _, err := store.ParseID(dep); err != nil {
			return fmt.Errorf("requires_success 含非法 op_id")
		}
		if dep == oc.op.OpID {
			return fmt.Errorf("requires_success 不能引用自身")
		}
	}
	return nil
}

// resolveExpectedVersion 返回该订单聚合当前应有的版本(前置条件换算)。
func (e *Engine) resolveExpectedVersion(tx *sql.Tx, oc *opContext) (int64, error) {
	pre := oc.op.Precondition
	if pre == nil {
		return 0, nil
	}
	if pre.ExpectedVersion != "" {
		v, ok := domain.ParseVersion(pre.ExpectedVersion)
		if !ok {
			return 0, domain.Reject(domain.CodeInvalidPayload, "expected_version 无效")
		}
		return v, nil
	}
	// after_op_id:必须是同一账号、同一聚合、已成功提交的前序操作。
	afterID, err := store.ParseID(pre.AfterOpID)
	if err != nil {
		return 0, domain.Reject(domain.CodeInvalidPayload, "after_op_id 无效")
	}
	var aggID store.ID
	var result string
	var resultingVersion sql.NullInt64
	err = tx.QueryRowContext(context.Background(),
		`SELECT aggregate_id, result, resulting_version FROM mutation_receipts
		 WHERE user_id = ? AND op_id = ?`, oc.sess.UserID[:], afterID[:],
	).Scan(&aggID, &result, &resultingVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, domain.Reject(domain.ResultDependencyPending, "前置操作尚未到达")
	}
	if err != nil {
		return 0, err
	}
	if aggID != oc.aggID {
		return 0, domain.Reject(domain.CodeInvalidPayload, "after_op_id 不能跨聚合引用")
	}
	if result != domain.ResultApplied && result != domain.ResultAlreadyApplied {
		return 0, domain.Reject(domain.CodeDependencyFailed, "前置操作未成功,不能链接后继操作")
	}
	if !resultingVersion.Valid {
		return 0, domain.Reject(domain.CodeInvalidPayload, "前置操作缺少结果版本")
	}
	return resultingVersion.Int64, nil
}

func (e *Engine) lookupReceipt(tx *sql.Tx, oc *opContext) (domain.OpResult, bool, error) {
	var result, errCode string
	var hashBytes []byte
	var resultingVersion sql.NullInt64
	var resultPayload []byte
	err := tx.QueryRowContext(context.Background(),
		`SELECT payload_hash, result, error_code, resulting_version, result_payload
		 FROM mutation_receipts WHERE user_id = ? AND op_id = ?`,
		oc.sess.UserID[:], oc.opID[:],
	).Scan(&hashBytes, &result, &errCode, &resultingVersion, &resultPayload)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OpResult{}, false, nil
	}
	if err != nil {
		return domain.OpResult{}, false, err
	}
	if !bytes.Equal(hashBytes, oc.payloadHash[:]) {
		return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultRejected,
			ErrorCode: domain.CodeHashMismatch,
			Message:   "同 op_id 但内容不同:操作创建后 payload 不可变,请生成新 op_id"}, true, nil
	}
	res := domain.OpResult{OpID: oc.op.OpID, Result: result, ErrorCode: errCode}
	if resultingVersion.Valid {
		res.ResultingVersion = domain.FormatVersion(resultingVersion.Int64)
	}
	if len(resultPayload) > 0 {
		res.Payload = json.RawMessage(resultPayload)
	}
	return res, true, nil
}

func (e *Engine) saveReceipt(tx *sql.Tx, oc *opContext, result domain.OpResult) error {
	var resultingVersion any
	if result.ResultingVersion != "" {
		v, ok := domain.ParseVersion(result.ResultingVersion)
		if !ok {
			return fmt.Errorf("engine: bad resulting version %q", result.ResultingVersion)
		}
		resultingVersion = v
	}
	var payload any
	if len(result.Payload) > 0 {
		payload = json.RawMessage(result.Payload)
	}
	errCode := sqlNullString(result.ErrorCode)
	_, err := tx.ExecContext(context.Background(),
		`INSERT INTO mutation_receipts
		 (user_id, op_id, payload_hash, aggregate_type, aggregate_id, op_type, result, error_code, resulting_version, result_payload, created_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		oc.sess.UserID[:], oc.opID[:], oc.payloadHash[:], oc.op.AggregateType, oc.aggID[:],
		oc.op.Type, result.Result, errCode, resultingVersion, payload, oc.now)
	return err
}

func sqlNullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (e *Engine) checkRequires(tx *sql.Tx, oc *opContext) (bool, string, string, error) {
	for _, dep := range oc.op.RequiresSuccess {
		depID, err := store.ParseID(dep)
		if err != nil {
			return false, domain.CodeInvalidPayload, "requires_success 含非法 op_id", nil
		}
		var result string
		err = tx.QueryRowContext(context.Background(),
			`SELECT result FROM mutation_receipts WHERE user_id = ? AND op_id = ?`,
			oc.sess.UserID[:], depID[:]).Scan(&result)
		if errors.Is(err, sql.ErrNoRows) {
			return false, domain.ResultDependencyPending, "依赖操作尚未提交", nil
		}
		if err != nil {
			return false, "", "", err
		}
		if result != domain.ResultApplied && result != domain.ResultAlreadyApplied {
			return false, domain.CodeDependencyFailed, "依赖操作未成功", nil
		}
	}
	return true, "", "", nil
}

// flushEvents 统一分配序号:锁 user_stream_heads 按 recipient 排序,保证已提交前缀完整。
func (e *Engine) flushEvents(tx *sql.Tx, oc *opContext) error {
	if len(oc.selfEvents) == 0 {
		return nil
	}
	// 同一 recipient 的事件共享一次锁行。
	order := make([]store.ID, 0, len(oc.selfEvents))
	seen := map[store.ID]bool{}
	for _, ev := range oc.selfEvents {
		if !seen[ev.recipient] {
			seen[ev.recipient] = true
			order = append(order, ev.recipient)
		}
	}
	for i := 0; i < len(order); i++ {
		for j := i + 1; j < len(order); j++ {
			if order[j].String() < order[i].String() {
				order[i], order[j] = order[j], order[i]
			}
		}
	}
	ctx := context.Background()
	for _, rid := range order {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_stream_heads (user_id, seq, stream_epoch, updated_at)
			 VALUES (?, 0, 1, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
			rid[:], oc.now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`SELECT seq FROM user_stream_heads WHERE user_id = ? FOR UPDATE`, rid[:]); err != nil {
			return err
		}
	}
	// 统一分配序号;任何失败整体回滚。
	for _, ev := range oc.selfEvents {
		var head int64
		if _, err := tx.ExecContext(ctx,
			`UPDATE user_stream_heads SET seq = seq + 1, updated_at = ? WHERE user_id = ?`,
			oc.now, ev.recipient[:]); err != nil {
			return err
		}
		if err := tx.QueryRowContext(ctx,
			`SELECT seq FROM user_stream_heads WHERE user_id = ?`, ev.recipient[:]).Scan(&head); err != nil {
			return err
		}
		var entityID, shareID any
		var generation any
		if ev.entityID != nil {
			entityID = ev.entityID[:]
		}
		if ev.shareID != nil {
			shareID = ev.shareID[:]
		}
		if ev.generation != nil {
			generation = *ev.generation
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_changes (recipient_user_id, seq, event_type, entity_id, share_id, generation, origin_op_id, payload, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			ev.recipient[:], head, ev.eventType, entityID, shareID, generation,
			oc.opID[:], jsonOrNull(ev.payload), oc.now); err != nil {
			return err
		}
	}
	return nil
}

func jsonOrNull(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return json.RawMessage(raw)
}

func (e *Engine) emitSelf(oc *opContext, eventType string, entityID *store.ID, payload json.RawMessage) {
	oc.selfEvents = append(oc.selfEvents, pendingEvent{
		recipient: oc.sess.UserID, eventType: eventType, entityID: entityID, payload: payload})
}

func (e *Engine) emitTo(oc *opContext, recipient store.ID, eventType string, entityID *store.ID, shareID *store.ID, generation *int64, payload json.RawMessage) {
	oc.selfEvents = append(oc.selfEvents, pendingEvent{
		recipient: recipient, eventType: eventType, entityID: entityID,
		shareID: shareID, generation: generation, payload: payload})
}

func reject(oc *opContext, code, msg string) domain.OpResult {
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultRejected, ErrorCode: code, Message: msg}
}

func conflict(oc *opContext, code, msg string, payload json.RawMessage) domain.OpResult {
	return domain.OpResult{OpID: oc.op.OpID, Result: domain.ResultConflict, ErrorCode: code, Message: msg, Payload: payload}
}

func wrapRetry(err error) error {
	if err == nil {
		return nil
	}
	if store.IsDeadlock(err) {
		return fmt.Errorf("%w: %v", ErrRetryable, err)
	}
	return err
}
