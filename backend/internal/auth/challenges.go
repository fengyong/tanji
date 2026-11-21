package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"time"

	"tanji/backend/internal/store"
)

// 验证码策略:短时有效、单次消费、限制尝试次数与发送频率。
const (
	ChallengeTTL      = 10 * time.Minute
	ChallengeAttempts = 5
	ResendCooldown    = 60 * time.Second
	CodeDigits        = 6
)

const (
	PurposeRegister = "register"
	PurposeForgot   = "forgot"
)

var (
	ErrCodeInvalid   = errors.New("验证码不正确或已过期")
	ErrTooManyTries  = errors.New("尝试次数过多,请稍后重新获取验证码")
	ErrSendCooldown  = errors.New("发送过于频繁,请稍后再试")
)

// IssueChallenge 生成验证码并入库(只存哈希);返回明文码给邮件发送器。
// 发送频率限制持久化在数据库,重启不能重置。
func (s *Store) IssueChallenge(ctx context.Context, purpose, email string) (string, error) {
	now := s.Now().UTC()
	email = NormalizeEmail(email)
	// 频率:该邮箱+用途最近一次发送在冷却期内则拒绝。
	var lastSent time.Time
	err := s.DB.QueryRowContext(ctx,
		`SELECT last_sent_at FROM verification_challenges
		 WHERE email_norm = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1`,
		email, purpose).Scan(&lastSent)
	if err == nil && now.Sub(lastSent) < ResendCooldown {
		return "", ErrSendCooldown
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	code := generateCode(CodeDigits)
	sum := sha256.Sum256([]byte(code))
	_, err = s.DB.ExecContext(ctx,
		`INSERT INTO verification_challenges (id, purpose, email_norm, code_hash, expires_at, attempts, max_attempts, last_sent_at, created_at)
		 VALUES (?,?,?,?,?,0,?,?,?)`,
		store.NewID().Slice(), purpose, email, sum[:], now.Add(ChallengeTTL), ChallengeAttempts, now, now)
	if err != nil {
		return "", err
	}
	return code, nil
}

func generateCode(n int) string {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
	v, err := rand.Int(rand.Reader, max)
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("%0*d", n, v.Int64())
}

// ConsumeChallenge 校验并消费验证码(单次消费 + 尝试计数)。
func (s *Store) ConsumeChallenge(ctx context.Context, purpose, email, code string) error {
	now := s.Now().UTC()
	email = NormalizeEmail(email)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx,
		`SELECT id, code_hash, expires_at, attempts, max_attempts FROM verification_challenges
		 WHERE email_norm = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
		email, purpose)
	if err != nil {
		return err
	}
	var id store.ID
	var hash []byte
	var expires time.Time
	var attempts, maxAttempts int
	has := false
	if rows.Next() {
		if err = rows.Scan(&id, &hash, &expires, &attempts, &maxAttempts); err != nil {
			rows.Close()
			return err
		}
		has = true
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	if !has {
		return ErrCodeInvalid
	}
	sum := sha256.Sum256([]byte(code))
	if now.After(expires) {
		if _, err = tx.ExecContext(ctx,
			`UPDATE verification_challenges SET consumed_at = ? WHERE id = ?`, now, id[:]); err != nil {
			return err
		}
		return commitTx(tx, ErrCodeInvalid)
	}
	if attempts >= maxAttempts {
		return commitTx(tx, ErrTooManyTries)
	}
	if sha256SumEqual(hash, sum[:]) {
		if _, err = tx.ExecContext(ctx,
			`UPDATE verification_challenges SET consumed_at = ? WHERE id = ?`, now, id[:]); err != nil {
			return err
		}
		return tx.Commit()
	}
	if _, err = tx.ExecContext(ctx,
		`UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?`, id[:]); err != nil {
		return err
	}
	return commitTx(tx, ErrCodeInvalid)
}

func sha256SumEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func commitTx(tx *sql.Tx, err error) error {
	if cerr := tx.Commit(); cerr != nil && err == nil {
		return cerr
	}
	return err
}
