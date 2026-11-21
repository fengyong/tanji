// 独立迁移工具:与应用账号分离的迁移入口(运维约定:迁移账号与应用账号分离)。
package main

import (
	"context"
	"database/sql"
	"flag"
	"log/slog"
	"os"

	"github.com/pressly/goose/v3"

	"tanji/backend/internal/store"
)

func main() {
	host := flag.String("db-host", envOr("TANJI_DB_HOST", "127.0.0.1"), "MySQL host")
	port := flag.Int("db-port", 33306, "MySQL port")
	dbName := flag.String("db-name", envOr("TANJI_DB_NAME", "tanji"), "database name")
	dbUser := flag.String("db-user", envOr("TANJI_MIGRATE_USER", "root"), "migrate user")
	dbPass := flag.String("db-pass", envOr("TANJI_MIGRATE_PASS", ""), "migrate password")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	dsn := store.DefaultDSN(*host, *port, *dbName, *dbUser, *dbPass, map[string]string{"charset": "utf8mb4"})
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Error("open failed", "err", err.Error())
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Error("ping failed", "err", err.Error())
		os.Exit(1)
	}
	if err := goose.SetDialect("mysql"); err != nil {
		log.Error("dialect", "err", err.Error())
		os.Exit(1)
	}
	if err := goose.UpContext(context.Background(), db, "migrations"); err != nil {
		log.Error("migrations failed", "err", err.Error())
		os.Exit(1)
	}
	log.Info("migrations applied")
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
