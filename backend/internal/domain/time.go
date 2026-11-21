package domain

import (
	"fmt"
	"time"
)

// 时间约定:API 层一律 RFC3339 UTC;MySQL DATETIME(3) 以 UTC 存储;
// 预约另存 IANA 时区,默认 Asia/Shanghai;派生(今天/本月/逾期天数)按账本时区计算。

const DefaultTimezone = "Asia/Shanghai"

func ValidRFC3339UTC(s string) bool {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return false
	}
	// 拒绝明显超出业务范围的时间(1970..2999)。
	y := t.UTC().Year()
	return y >= 1970 && y <= 2999
}

func ParseRFC3339UTC(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("时间格式无效: %w", err)
	}
	if !ValidRFC3339UTC(s) {
		return time.Time{}, fmt.Errorf("时间超出允许范围")
	}
	return t.UTC(), nil
}

func ValidTimezone(name string) bool {
	if name == "" {
		return false
	}
	if name == DefaultTimezone {
		return true
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

// ParseLegacyLocalTime 解析旧版本无时区时间 "2006-01-02T15:04" / "2006-01-02T15:04:05",
// 按 tz 解释。旧数据迁移时必须显式选择时区,不能当作 UTC。
func ParseLegacyLocalTime(s, tz string) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, fmt.Errorf("时区无效: %w", err)
	}
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02T15:04"} {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("旧时间格式无效")
}
