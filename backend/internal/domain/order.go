package domain

import (
	"time"
)

// ---- 订单/收款的派生规则(与旧版 index.html 语义一致,金额单位为分) ----

const (
	SettlePrivate = "private"
	SettleDouyin  = "douyin"

	StatusActive    = "active"
	StatusCancelled = "cancelled"
	StatusArchived  = "archived"
	StatusDeleted   = "deleted"

	PayKindDeposit = "deposit"
	PayKindFinal   = "final"

	EntryReceipt  = "receipt"
	EntryReversal = "reversal"

	GrantRolePartner = "partner"
	GrantRoleViewer  = "viewer"
	GrantRoleBoth    = "both"
)

// WorkStage 工作线:待拍摄 → 后期中 → 发片中 → 已交付。
func WorkStage(shotAt, submittedAt, shortSentAt, longSentAt *time.Time) string {
	switch {
	case shotAt == nil:
		return "待拍摄"
	case submittedAt == nil:
		return "后期中"
	case shortSentAt != nil && longSentAt != nil:
		return "已交付"
	default:
		return "发片中"
	}
}

// PayStage 收款线:待定金 / 待尾款 / 平台结算 / 已结清(逾期在展示层叠加)。
func PayStage(priceCents, depositCents int64, hasDeposit, hasFinal bool, settleVia string) string {
	final := priceCents - depositCents
	if !hasDeposit && depositCents > 0 {
		return "待定金"
	}
	if hasFinal || final <= 0 {
		return "已结清"
	}
	if settleVia == SettleDouyin {
		return "平台结算"
	}
	return "待尾款"
}

// IsCollectExempt 平台结算免催收。
func IsCollectExempt(settleVia string) bool { return settleVia == SettleDouyin }

// OverdueDays 尾款自实际拍摄日起的欠款天数;非私收、无未付尾款或未拍摄返回 0。
// now 与 shotAt 应处在同一(账本)时区比较日期。
func OverdueDays(settleVia string, priceCents, depositCents int64, hasFinal bool, shotAt *time.Time, now time.Time) int {
	if IsCollectExempt(settleVia) || hasFinal {
		return 0
	}
	if priceCents-depositCents <= 0 || shotAt == nil {
		return 0
	}
	s := shotAt.In(now.Location())
	d1 := time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, now.Location())
	d2 := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	d := int(d2.Sub(d1).Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}

// ---- 规范化订单 DTO:云端事件、全量快照与客户端基线使用同一形状 ----

type OrderDTO struct {
	ID           string        `json:"id"`
	Version      string        `json:"version"`
	Store        string        `json:"store"`
	Category     string        `json:"category"`
	Contact      string        `json:"contact"`
	Note         string        `json:"note"`
	PriceCents   int64         `json:"price_cents"`
	DepositCents int64         `json:"deposit_cents"`
	ApptStart    string        `json:"appt_start"`
	ApptEnd      *string       `json:"appt_end"`
	Timezone     string        `json:"timezone"`
	SettleVia    string        `json:"settle_via"`
	Channel      string        `json:"channel"`
	ShotAt       *string       `json:"shot_at"`
	SubmittedAt  *string       `json:"submitted_at"`
	ShortSentAt  *string       `json:"short_sent_at"`
	LongSentAt   *string       `json:"long_sent_at"`
	RemindAt     *string       `json:"remind_at"`
	Status       string        `json:"status"`
	Place        *PlacePayload `json:"place,omitempty"`
	Partner      *PartnerRef   `json:"partner,omitempty"`
	Payments     []PaymentDTO  `json:"payments"`
	ActiveReceipts map[string]string `json:"active_receipts,omitempty"`
	CreatedAt    string        `json:"created_at"`
	UpdatedAt    string        `json:"updated_at"`
}

type PaymentDTO struct {
	ID          string  `json:"id"`
	OrderID     string  `json:"order_id"`
	Kind        string  `json:"kind"`
	EntryType   string  `json:"entry_type"`
	AmountCents int64   `json:"amount_cents"`
	Method      string  `json:"method"`
	PaidAt      string  `json:"paid_at"`
	ReversesID  *string `json:"reverses_id,omitempty"`
}

// SettingsDTO 账本级设置(催收阈值、时区)。
type SettingsDTO struct {
	CollectThresholdDays int    `json:"collect_threshold_days"`
	Timezone             string `json:"timezone"`
}

// ---- 共享投影白名单(架构文档 §7.1):只含完成赴约所需的最小信息 ----

type ScheduleProjectionDTO struct {
	ShareID        string  `json:"share_id"`
	Generation     string  `json:"generation"`
	Revision       string  `json:"projection_revision"`
	OwnerDisplay   string  `json:"owner_display"`
	Store          string  `json:"store"`
	StartsAt       string  `json:"starts_at"`
	EndsAt         *string `json:"ends_at"`
	Timezone       string  `json:"timezone"`
	Address        string  `json:"address"`
	Latitude       *string `json:"latitude,omitempty"`
	Longitude      *string `json:"longitude,omitempty"`
	CoordSystem    *string `json:"coord_system,omitempty"`
	Provider       *string `json:"provider,omitempty"`
	POIID          *string `json:"poi_id,omitempty"`
	ScheduleStatus string  `json:"schedule_status"`
	// auth_relation_id / auth_relation_generation 仅用于精确清除缓存,不是业务明细。
	AuthRelationID          string `json:"auth_relation_id"`
	AuthRelationGeneration  string `json:"auth_relation_generation"`
}
