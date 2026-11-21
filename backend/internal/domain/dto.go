// Package domain 定义跨端共享的业务语义:金额、时间、订单规则、操作信封。
// 客户端(TypeScript)与服务端通过契约和相同测试样例保持一致。
package domain

import (
	"fmt"
	"strconv"
	"strings"
)

// ---- 金额:一律为非负整数分,JSON 数字必须落在 JavaScript 安全整数范围 ----

const MaxAmountCents = 9_000_000_000 // 单笔 ≤ ¥90,000,000,远超业务范围,同时远离 2^53

func ValidAmountCents(c int64) bool { return c >= 0 && c <= MaxAmountCents }

// ParseYuanToCents 把形如 "123"、"12.5"、"12.34" 的金额文本转为分;拒绝空串(除非 blankZero)。
func ParseYuanToCents(text string, blankZero bool) (int64, bool) {
	t := strings.TrimSpace(text)
	if t == "" {
		if blankZero {
			return 0, true
		}
		return 0, false
	}
	if !validYuanFormat(t) {
		return 0, false
	}
	whole, frac := t, ""
	if dot := strings.IndexByte(t, '.'); dot >= 0 {
		whole, frac = t[:dot], t[dot+1:]
		frac = (frac + "00")[:2]
	}
	w, err1 := strconv.ParseInt(whole, 10, 64)
	f, err2 := strconv.ParseInt(frac, 10, 64)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	c := w*100 + f
	if !ValidAmountCents(c) {
		return 0, false
	}
	return c, true
}

func validYuanFormat(t string) bool {
	dot := strings.IndexByte(t, '.')
	whole, frac := t, ""
	if dot >= 0 {
		whole, frac = t[:dot], t[dot+1:]
		if len(frac) > 2 {
			return false
		}
	}
	if whole == "" || (len(whole) > 1 && whole[0] == '0') {
		if whole != "0" && whole != "" {
			return false
		}
	}
	for _, r := range whole {
		if r < '0' || r > '9' {
			return false
		}
	}
	for _, r := range frac {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func FormatCents(c int64) string {
	if c < 0 {
		return "-" + FormatCents(-c)
	}
	return fmt.Sprintf("%d.%02d", c/100, c%100)
}

// ---- 版本与序号:十进制字符串 ----

func FormatVersion(v int64) string { return strconv.FormatInt(v, 10) }

func ParseVersion(s string) (int64, bool) {
	if s == "" || len(s) > 19 {
		return 0, false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < 0 {
		return 0, false
	}
	return v, true
}
