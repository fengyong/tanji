// Package auth 实现账号、密码、验证码与单有效会话。
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id 参数:服务端按实际性能评估;此处取中等安全档,禁止明文与自制算法。
type ArgonParams struct {
	Time    uint32
	Memory  uint32
	Threads uint8
	KeyLen  uint32
	SaltLen uint32
}

func DefaultArgonParams() ArgonParams {
	return ArgonParams{Time: 3, Memory: 64 * 1024, Threads: 2, KeyLen: 32, SaltLen: 16}
}

// HashPassword 返回 PHC 格式串:$argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
func HashPassword(password string, p ArgonParams) (string, error) {
	if len(password) < MinPasswordLen || len(password) > MaxPasswordLen {
		return "", ErrPasswordLength
	}
	salt := make([]byte, p.SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, p.Time, p.Memory, p.Threads, p.KeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.Memory, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

var ErrPasswordMismatch = errors.New("auth: 密码不正确")

// VerifyPassword 校验密码与 PHC 哈希;参数不一致时返回 false。
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errors.New("auth: hash 格式无效")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, err
	}
	var m uint32
	var t uint32
	var pp uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &pp); err != nil {
		return false, err
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(password), salt, t, m, pp, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

const (
	MinPasswordLen = 12
	MaxPasswordLen = 256
)

var ErrPasswordLength = errors.New("密码长度须为 12~256 个字符,允许密码管理器长口令")

// HashToken 返回令牌查找哈希(SHA-256);服务端绝不存明文令牌。
func HashToken(token []byte) []byte {
	h := sha256.Sum256(token)
	return h[:]
}
