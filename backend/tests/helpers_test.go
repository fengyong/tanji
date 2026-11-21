package tests

import (
	"crypto/sha1" // UUIDv5 规范要求 SHA-1,仅用于确定性 ID 派生,非安全用途
)

// uuidV5URL 与 google/uuid 的 NewSHA1(NameSpaceURL, name) 一致;
// 客户端 TypeScript 侧用相同算法派生授权聚合 ID。
func uuidV5URL(name string) string {
	return uuidV5(uuidNameSpaceURL, name)
}

var uuidNameSpaceURL = [16]byte{0x6b, 0xa7, 0xb8, 0x11, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8}

func uuidV5(ns [16]byte, name string) string {
	h := sha1.New()
	h.Write(ns[:])
	h.Write([]byte(name))
	sum := h.Sum(nil)
	var b [16]byte
	copy(b[:], sum[:16])
	b[6] = (b[6] & 0x0f) | 0x50 // version 5
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122
	return formatUUID(b)
}

func formatUUID(b [16]byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, 0, 36)
	for i, v := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out = append(out, '-')
		}
		out = append(out, hexdigits[v>>4], hexdigits[v&0x0f])
	}
	return string(out)
}
