package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ---- 协议版本与操作类型 ----

const ProtocolVersion = 1

const (
	MaxOpsPerBatch     = 50
	MaxPayloadBytes    = 1 << 20 // 1 MiB 整个批次
	MaxBatchSizeBytes  = 1 << 20
	MaxTextOrderStore  = 120
	MaxTextCategory    = 64
	MaxTextContact     = 255
	MaxTextNote        = 2000
	MaxTextChannel     = 64
	MaxTextPartnerName = 64
	MaxTextAddress     = 500
	MaxPageSizePull    = 500
	DefaultPullLimit   = 200
)

// 业务操作白名单(架构文档 §9)。
const (
	OpOrderCreate      = "order.create"
	OpOrderUpdate      = "order.update"
	OpOrderReschedule  = "order.reschedule"
	OpOrderCancel      = "order.cancel"
	OpOrderArchive     = "order.archive"
	OpOrderDelete      = "order.delete"
	OpPaymentRecord    = "payment.record"
	OpPaymentReverse   = "payment.reverse"
	OpPartnerAssign    = "partner.assign"
	OpScheduleGrant    = "schedule.grant"
	OpScheduleRevoke   = "schedule.revoke"
	OpSettingsUpdate   = "settings.update"
)

var OpTypes = map[string]bool{
	OpOrderCreate: true, OpOrderUpdate: true, OpOrderReschedule: true, OpOrderCancel: true,
	OpOrderArchive: true, OpOrderDelete: true, OpPaymentRecord: true, OpPaymentReverse: true,
	OpPartnerAssign: true, OpScheduleGrant: true, OpScheduleRevoke: true, OpSettingsUpdate: true,
}

// 下行事件类型。
const (
	EventOrderChanged  = "order.changed"
	EventOrderDeleted  = "order.deleted"
	EventSettings      = "settings.changed"
	EventShareGranted  = "share.granted"
	EventShareUpdated  = "share.updated"
	EventSharePurged   = "share.purged"
	EventRelationPurged = "relation.purged"
)

// 操作结果类型。
const (
	ResultApplied          = "applied"
	ResultAlreadyApplied   = "already_applied"
	ResultConflict         = "conflict"
	ResultRejected         = "rejected"
	ResultDependencyPending = "dependency_pending"
)

var Results = map[string]bool{
	ResultApplied: true, ResultAlreadyApplied: true, ResultConflict: true,
	ResultRejected: true, ResultDependencyPending: true,
}

// 错误码。
const (
	CodeVersionMismatch    = "version_mismatch"
	CodeEntityDeleted      = "entity_deleted"
	CodeEntityNotFound     = "entity_not_found"
	CodeDependencyFailed   = "dependency_failed"
	CodeHashMismatch       = "payload_hash_mismatch"
	CodeInvalidPayload     = "invalid_payload"
	CodeRelationMissing    = "relation_missing"
	CodeGrantExists        = "grant_exists"
	CodeGrantMissing       = "grant_missing"
	CodeBusinessRule       = "business_rule"
	CodeProtocol           = "protocol_mismatch"
	CodeSessionExpired     = "session_expired"
	CodeCursorExpired      = "cursor_expired"
)

// Precondition 版本条件:expected_version 与 after_op_id 二选一;新建订单期望版本 "0"。
type Precondition struct {
	ExpectedVersion string `json:"expected_version,omitempty"`
	AfterOpID       string `json:"after_op_id,omitempty"`
}

func (p *Precondition) Validate() error {
	hasV := p != nil && p.ExpectedVersion != ""
	hasA := p != nil && p.AfterOpID != ""
	if hasV == hasA {
		return fmt.Errorf("precondition 必须且只能提供 expected_version / after_op_id 之一")
	}
	if hasV {
		if _, ok := ParseVersion(p.ExpectedVersion); !ok {
			return fmt.Errorf("expected_version 不是合法版本号")
		}
	}
	return nil
}

// OpEnvelope 是上传的单个业务操作,创建后 payload 与 op_id 不可变。
type OpEnvelope struct {
	OpID           string          `json:"op_id"`
	AggregateType  string          `json:"aggregate_type"`
	AggregateID    string          `json:"aggregate_id"`
	Type           string          `json:"type"`
	Precondition   *Precondition   `json:"precondition,omitempty"`
	RequiresSuccess []string       `json:"requires_success,omitempty"`
	Payload        json.RawMessage `json:"payload"`
}

type PushRequest struct {
	ProtocolVersion int          `json:"protocol_version"`
	AccountID       string       `json:"account_id"`
	DeviceID        string       `json:"device_id"`
	Operations      []OpEnvelope `json:"operations"`
}

type OpResult struct {
	OpID             string          `json:"op_id"`
	Result           string          `json:"result"`
	ErrorCode        string          `json:"error_code,omitempty"`
	Message          string          `json:"message,omitempty"`
	ResultingVersion string          `json:"resulting_version,omitempty"`
	ServerSeq        string          `json:"server_seq,omitempty"`
	Payload          json.RawMessage `json:"payload,omitempty"`
}

type PushResponse struct {
	Results []OpResult `json:"results"`
}

// ---- 各操作 payload 结构 ----

type PlacePayload struct {
	Address     string  `json:"address"`
	Latitude    *string `json:"latitude,omitempty"`
	Longitude   *string `json:"longitude,omitempty"`
	CoordSystem string  `json:"coord_system,omitempty"`
	Provider    string  `json:"provider,omitempty"`
	POIID       string  `json:"poi_id,omitempty"`
}

type OrderCreatePayload struct {
	Store      string        `json:"store"`
	Category   string        `json:"category"`
	Contact    string        `json:"contact"`
	Note       string        `json:"note"`
	PriceCents int64         `json:"price_cents"`
	DepositCents int64       `json:"deposit_cents"`
	ApptStart  string        `json:"appt_start"`
	ApptEnd    string        `json:"appt_end,omitempty"`
	Timezone   string        `json:"timezone"`
	SettleVia  string        `json:"settle_via"`
	Channel    string        `json:"channel"`
	Place      *PlacePayload `json:"place,omitempty"`
	Partner    *PartnerRef   `json:"partner,omitempty"` // 仅允许 external;account 搭档必须走 partner.assign
}

type PartnerRef struct {
	Type         string  `json:"type"` // account | external
	UserID       string  `json:"user_id,omitempty"`
	ExternalName string  `json:"external_name,omitempty"`
}

type OrderUpdatePayload struct {
	Store      *string        `json:"store,omitempty"`
	Category   *string        `json:"category,omitempty"`
	Contact    *string        `json:"contact,omitempty"`
	Note       *string        `json:"note,omitempty"`
	Channel    *string        `json:"channel,omitempty"`
	PriceCents *int64         `json:"price_cents,omitempty"`
	DepositCents *int64       `json:"deposit_cents,omitempty"`
	ApptStart  *string        `json:"appt_start,omitempty"`
	ApptEnd    *string        `json:"appt_end,omitempty"`
	ClearApptEnd bool         `json:"clear_appt_end,omitempty"`
	Timezone   *string        `json:"timezone,omitempty"`
	SettleVia  *string        `json:"settle_via,omitempty"`
	Place      *PlacePayload  `json:"place,omitempty"`
}

type PaymentRecordPayload struct {
	Kind       string `json:"kind"` // deposit | final
	Method     string `json:"method"`
	PaidAt     string `json:"paid_at"`
	AmountCents int64 `json:"amount_cents"`
}

type PaymentReversePayload struct {
	Kind   string `json:"kind"` // 被撤销的有效收款类型
	Reason string `json:"reason,omitempty"`
}

type PartnerAssignPayload struct {
	Type         string `json:"type"` // account | external
	UserID       string `json:"user_id,omitempty"`
	ExternalName string `json:"external_name,omitempty"`
}

type ScheduleGrantPayload struct {
	OrderID    string `json:"order_id"`
	RecipientID string `json:"recipient_user_id"`
	Role       string `json:"role"` // partner | viewer
}

type ScheduleRevokePayload struct {
	ShareID string `json:"share_id"`
}

type SettingsUpdatePayload struct {
	CollectThresholdDays *int    `json:"collect_threshold_days,omitempty"`
	Timezone             *string `json:"timezone,omitempty"`
}

var ReceiptMethods = map[string]bool{"微信": true, "支付宝": true, "银行卡": true, "抖音商单": true, "其他": true}

var Settlements = map[string]bool{"private": true, "douyin": true}

var Categories = map[string]bool{
	"咖啡": true, "餐饮": true, "烧烤": true, "火锅": true, "茶饮": true, "甜品": true, "烘焙": true,
	"美发": true, "健身": true, "民宿": true, "零售": true, "体验馆": true, "服饰": true, "快餐": true, "其他": true,
}

var ErrPayload = errors.New("invalid payload")

// DomainRejection 是领域层明确拒绝/冲突,由引擎转成对应结果并入回执。
type DomainRejection struct {
	IsConflict bool
	Code       string
	Message    string
}

func (r *DomainRejection) Error() string { return r.Message }

func Reject(code, msg string) *DomainRejection {
	return &DomainRejection{Code: code, Message: msg}
}

func Conflict(code, msg string) *DomainRejection {
	return &DomainRejection{IsConflict: true, Code: code, Message: msg}
}

func DecodeJSON(raw json.RawMessage, v any, maxBytes int) error {
	if len(raw) == 0 {
		return fmt.Errorf("%w: payload 为空", ErrPayload)
	}
	if maxBytes > 0 && len(raw) > maxBytes {
		return fmt.Errorf("%w: payload 超限", ErrPayload)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrPayload, err)
	}
	return nil
}

func ValidateOrderCreatePayload(p *OrderCreatePayload) error {
	if strings.TrimSpace(p.Store) == "" {
		return fmt.Errorf("%w: 缺少商家名称", ErrPayload)
	}
	if err := boundedText(p.Store, MaxTextOrderStore, "商家名称"); err != nil {
		return err
	}
	if !ValidAmountCents(p.PriceCents) || !ValidAmountCents(p.DepositCents) || p.DepositCents > p.PriceCents {
		return fmt.Errorf("%w: 金额不合法或定金超过总价", ErrPayload)
	}
	if _, err := ParseRFC3339UTC(p.ApptStart); err != nil {
		return fmt.Errorf("%w: 预约时间无效", ErrPayload)
	}
	if p.ApptEnd != "" {
		if _, err := ParseRFC3339UTC(p.ApptEnd); err != nil {
			return fmt.Errorf("%w: 结束时间无效", ErrPayload)
		}
	}
	tz := p.Timezone
	if tz == "" {
		tz = DefaultTimezone
	}
	if !ValidTimezone(tz) {
		return fmt.Errorf("%w: 时区无效", ErrPayload)
	}
	if !Settlements[p.SettleVia] {
		return fmt.Errorf("%w: 结算方式无效", ErrPayload)
	}
	if p.Category == "" {
		p.Category = "其他"
	}
	if !Categories[p.Category] {
		return fmt.Errorf("%w: 店铺类型无效", ErrPayload)
	}
	if p.Channel == "" {
		p.Channel = "直客"
	}
	if err := boundedText(p.Contact, MaxTextContact, "联系方式"); err != nil {
		return err
	}
	if err := boundedText(p.Note, MaxTextNote, "备注"); err != nil {
		return err
	}
	if err := boundedText(p.Channel, MaxTextChannel, "渠道"); err != nil {
		return err
	}
	if p.Partner != nil {
		if p.Partner.Type != "external" {
			return fmt.Errorf("%w: 新建订单的搭档只能是外部搭档,账号搭档走 partner.assign", ErrPayload)
		}
		if err := ValidateExternalName(p.Partner.ExternalName); err != nil {
			return err
		}
	}
	if p.Place != nil {
		if err := ValidatePlace(p.Place); err != nil {
			return err
		}
	}
	return nil
}

func ValidateExternalName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("%w: 外部搭档名字不能为空", ErrPayload)
	}
	return boundedText(name, MaxTextPartnerName, "搭档名字")
}

func ValidatePlace(p *PlacePayload) error {
	if err := boundedText(p.Address, MaxTextAddress, "地址"); err != nil {
		return err
	}
	if p.Latitude != nil && p.Longitude != nil {
		lat, okLat := parseCoord(*p.Latitude)
		lng, okLng := parseCoord(*p.Longitude)
		if !okLat || !okLng || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			return fmt.Errorf("%w: 坐标无效", ErrPayload)
		}
		if p.CoordSystem == "" {
			return fmt.Errorf("%w: 坐标缺少坐标系声明", ErrPayload)
		}
		if p.CoordSystem != "GCJ-02" && p.CoordSystem != "WGS-84" {
			return fmt.Errorf("%w: 坐标系必须是 GCJ-02 或 WGS-84", ErrPayload)
		}
	} else if p.Latitude != nil || p.Longitude != nil {
		return fmt.Errorf("%w: 经纬度必须成对出现", ErrPayload)
	}
	if err := boundedText(p.Provider, 32, "地点来源"); err != nil {
		return err
	}
	return boundedText(p.POIID, 128, "POI ID")
}

func parseCoord(s string) (float64, bool) {
	var f float64
	if _, err := fmt.Sscanf(strings.TrimSpace(s), "%g", &f); err != nil {
		return 0, false
	}
	return f, true
}

func boundedText(s string, max int, label string) error {
	if len(s) > max {
		return fmt.Errorf("%w: %s 超过 %d 字节上限", ErrPayload, label, max)
	}
	return nil
}
