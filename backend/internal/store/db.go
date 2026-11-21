package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Config 是服务端数据库连接配置。
type Config struct {
	DSN             string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

func DefaultDSN(host string, port int, db, user, pass string, params map[string]string) string {
	c := mysql.Config{
		User:                 user,
		Passwd:               pass,
		Net:                  "tcp",
		Addr:                 fmt.Sprintf("%s:%d", host, port),
		DBName:               db,
		AllowNativePasswords: true,
		ParseTime:            true,
		Loc:                  time.UTC,
		Collation:            "utf8mb4_0900_ai_ci",
		Params:               params,
	}
	return c.FormatDSN()
}

// Open 打开连接池。连接时区固定 UTC。
func Open(cfg Config, logger *slog.Logger) (*sql.DB, error) {
	db, err := sql.Open("mysql", cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	if cfg.MaxOpenConns > 0 {
		db.SetMaxOpenConns(cfg.MaxOpenConns)
	} else {
		db.SetMaxOpenConns(20)
	}
	if cfg.MaxIdleConns > 0 {
		db.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetime > 0 {
		db.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	}
	if err := db.PingContext(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	if logger != nil {
		logger.Info("store: mysql connected")
	}
	return db, nil
}

// WithTx 在单个事务中执行 fn;fn 返回错误则整体回滚。
// 死锁或锁等待超时错误原样返回给调用方,由调用方决定是否重试。
func WithTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// IsDeadlock 判断错误是否为死锁/锁等待超时,可以安全重试。
func IsDeadlock(err error) bool {
	if err == nil {
		return false
	}
	var merr *mysql.MySQLError
	if errorsAs(err, &merr) {
		return merr.Number == 1213 || merr.Number == 1205
	}
	return false
}

func errorsAs(err error, target **mysql.MySQLError) bool {
	for err != nil {
		if m, ok := err.(*mysql.MySQLError); ok {
			*target = m
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
