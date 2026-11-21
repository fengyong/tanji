// 探记云端版服务入口。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/pressly/goose/v3"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/engine"
	"tanji/backend/internal/httpapi"
	"tanji/backend/internal/notify"
	"tanji/backend/internal/store"
)

func main() {
	addr := flag.String("addr", envOr("TANJI_ADDR", "127.0.0.1:8080"), "listen address")
	host := flag.String("db-host", envOr("TANJI_DB_HOST", "127.0.0.1"), "MySQL host")
	port := flag.Int("db-port", 33306, "MySQL port")
	dbName := flag.String("db-name", envOr("TANJI_DB_NAME", "tanji"), "database name")
	dbUser := flag.String("db-user", envOr("TANJI_DB_USER", "tanji_app"), "db user")
	dbPass := flag.String("db-pass", envOr("TANJI_DB_PASS", "tanji_app_dev"), "db password")
	mailpit := flag.String("mailpit", envOr("TANJI_MAILPIT", "127.0.0.1:1025"), "Mailpit SMTP address")
	devMode := flag.Bool("dev", os.Getenv("TANJI_DEV") == "1", "dev mode (return codes in response)")
	secure := flag.Bool("secure-cookies", os.Getenv("TANJI_SECURE_COOKIES") == "1", "force Secure cookies")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	dsn := store.DefaultDSN(*host, *port, *dbName, *dbUser, *dbPass, map[string]string{"charset": "utf8mb4"})
	db, err := store.Open(store.Config{DSN: dsn, MaxOpenConns: 24}, log)
	if err != nil {
		log.Error("db open failed", "err", err.Error())
		os.Exit(1)
	}
	defer db.Close()

	// 启动时执行迁移(goose;失败不启动,不自动抹库)。
	if err := goose.SetDialect("mysql"); err != nil {
		log.Error("goose dialect", "err", err.Error())
		os.Exit(1)
	}
	goose.SetLogger(goose.NopLogger())
	if err := goose.UpContext(context.Background(), db, "migrations"); err != nil {
		log.Error("migrations failed", "err", err.Error())
		os.Exit(1)
	}

	var mailer auth.EmailSender = auth.NewMailpit(*mailpit, "tanji@dev.local", log)
	authStore := auth.NewStore(db, log)
	eng := engine.New(db, log)
	hub := notify.NewHub(log)
	srv := httpapi.NewServer(db, authStore, eng, hub, mailer, log, *devMode)
	if *secure {
		srv.SetSecureCookies()
	}

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      0, // SSE 长连接
		MaxHeaderBytes:    1 << 16,
	}
	go func() {
		log.Info("server listening", "addr", *addr, "mailer", mailer.Kind(), "dev_mode", *devMode)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listen failed", "err", err.Error())
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var _ = fmt.Sprintf
