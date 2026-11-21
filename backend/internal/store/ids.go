// Package store 提供数据库访问基础能力。
package store

import (
	"crypto/rand"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ID 是 BINARY(16) 的可扫描类型,接口层一律使用 UUID 字符串。
type ID [16]byte

var ErrEmptyID = errors.New("store: empty id")

func NewID() ID {
	var b ID
	// uuid.NewRandom 使用 crypto/rand,失败即拒绝。
	u, err := uuid.NewRandom()
	if err != nil {
		panic(fmt.Sprintf("store: entropy unavailable: %v", err))
	}
	copy(b[:], u[:])
	return b
}

func ParseID(s string) (ID, error) {
	var b ID
	u, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return b, fmt.Errorf("store: invalid uuid %q: %w", s, err)
	}
	copy(b[:], u[:])
	return b, nil
}

func (i ID) String() string { return uuid.UUID(i).String() }

// Slice 返回 16 字节切片(可寻址副本),便于内联传参。
func (i ID) Slice() []byte {
	b := i
	return b[:]
}

func (i ID) IsZero() bool {
	for _, v := range i {
		if v != 0 {
			return false
		}
	}
	return true
}

func (i ID) Value() (driver.Value, error) {
	if i.IsZero() {
		return nil, ErrEmptyID
	}
	return []byte(i[:]), nil
}

func (i *ID) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*i = ID{}
		return nil
	case []byte:
		if len(v) == 0 {
			*i = ID{}
			return nil
		}
		if len(v) != 16 {
			return fmt.Errorf("store: id column must be 16 bytes, got %d", len(v))
		}
		copy((*i)[:], v)
		return nil
	case string:
		// 驱动一般返回 []byte;容忍字符串形式便于调试查询。
		raw, err := hex.DecodeString(v)
		if err != nil || len(raw) != 16 {
			return fmt.Errorf("store: bad id string %q", v)
		}
		copy((*i)[:], raw)
		return nil
	default:
		return fmt.Errorf("store: unsupported id scan type %T", src)
	}
}

// RandomToken 生成 32 字节高熵随机令牌(会话令牌/邀请凭据)。
func RandomToken() ([]byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}
