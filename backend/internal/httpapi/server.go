package httpapi

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/engine"
	"tanji/backend/internal/notify"
)

// Server 汇集全部处理器。
type Server struct {
	DB            *sql.DB
	Auth          *auth.Store
	Engine        *engine.Engine
	Notify        *notify.Hub
	Mailer        auth.EmailSender
	Log           *slog.Logger
	limiter       *rateLimiter
	DevMode       bool // DEV:验证码无法投递时在响应中返回(仅本地开发环境)
	secureCookies bool // 生产/TLS 部署时必须开启
}

func (s *Server) ForceSecureCookies() bool { return s.secureCookies }

func NewServer(db *sql.DB, a *auth.Store, eng *engine.Engine, hub *notify.Hub,
	mailer auth.EmailSender, log *slog.Logger, devMode bool) *Server {
	return &Server{DB: db, Auth: a, Engine: eng, Notify: hub, Mailer: mailer, Log: log,
		limiter: newRateLimiter(30, 15), DevMode: devMode}
}

func (s *Server) SetSecureCookies() { s.secureCookies = true }

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/health/live", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "live"}) })
	r.Get("/health/ready", s.handleHealthReady)

	r.Route("/v1", func(r chi.Router) {
		// 认证类:限流。
		r.Post("/auth/register", s.limitAuth("register", s.handleRegister))
		r.Post("/auth/verify-email", s.limitAuth("verify-email", s.handleVerifyEmail))
		r.Post("/auth/login", s.limitAuth("login", s.handleLogin))
		r.Post("/auth/password/forgot", s.limitAuth("forgot", s.handleForgot))
		r.Post("/auth/password/reset", s.limitAuth("reset", s.handleReset))
		r.With(s.requireSession).Post("/auth/logout", s.handleLogout)
		r.With(s.requireSession).Post("/auth/deactivate", s.handleDeactivate)
		r.With(s.requireSession).Get("/session", s.handleGetSession)

		r.With(s.requireSession).Post("/contact-invites", s.handleCreateInvite)
		r.With(s.requireSession).Post("/contact-invites/accept", s.handleAcceptInvite)
		r.With(s.requireSession).Get("/contact-invites", s.handleListInvites)
		r.With(s.requireSession).Get("/contacts", s.handleListContacts)
		r.With(s.requireSession).Get("/contacts/{id}", s.handleGetContact)
		r.With(s.requireSession).Delete("/contacts/{id}", s.handleDeleteContact)

		r.With(s.requireSession).Post("/sync/push", s.handlePush)
		r.With(s.requireSession).Post("/sync/receipts", s.handleReceipts)
		r.With(s.requireSession).Get("/sync/pull", s.handlePull)
		r.With(s.requireSession).Post("/sync/bootstrap", s.handleBootstrap)
		r.With(s.requireSession).Get("/sync/bootstrap/{id}/pages/{page}", s.handleBootstrapPage)
		r.With(s.requireSession).Get("/shared", s.handleSharedList)
		r.With(s.requireSession).Get("/events", s.handleEvents)
	})
	return r
}
