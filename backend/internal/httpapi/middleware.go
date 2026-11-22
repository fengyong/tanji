package httpapi

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/store"
)

type ctxKey int

const ctxSession ctxKey = 1

// SessionFrom 恢复中间件放入的会话。
func SessionFrom(r *http.Request) (auth.SessionCtx, []byte, bool) {
	v, ok := r.Context().Value(ctxSession).(*sessionValue)
	if !ok || v == nil {
		return auth.SessionCtx{}, nil, false
	}
	return v.ctx, v.token, true
}

type sessionValue struct {
	ctx   auth.SessionCtx
	token []byte
}

// bearerAuth:Authorization: Bearer <token>(原生端与集成测试)。
// cookieAuth:HttpOnly 会话 Cookie + CSRF 双提交(浏览器)。
func (s *Server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, viaCSRF, err := extractToken(r)
		if err != nil {
			writeErr(w, ErrUnauthorized, s.Log, "auth")
			return
		}
		sess, user, err := s.Auth.VerifySessionToken(r.Context(), token)
		if err != nil {
			writeErr(w, ErrUnauthorized, s.Log, "auth")
			return
		}
		// Cookie 认证必须过 CSRF(双提交 + Origin 校验);Bearer 不需要。
		if viaCSRF {
			if err := s.checkCSRF(r, token); err != nil {
				writeJSON(w, 403, apiErr(403, "csrf_failed", "CSRF 校验失败"))
				return
			}
		}
		_ = user
		ctx := context.WithValue(r.Context(), ctxSession, &sessionValue{
			ctx: auth.SessionCtx{UserID: sess.UserID, SessionID: sess.SessionID,
				DeviceID: sess.DeviceID, AuthEpoch: sess.AuthEpoch},
			token: token,
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractToken(r *http.Request) ([]byte, bool, error) {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		raw := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		if len(raw) < 32 || len(raw) > 128 {
			return nil, false, ErrUnauthorized
		}
		return []byte(raw), false, nil
	}
	c, err := r.Cookie(auth.CookieName)
	if err != nil || c.Value == "" {
		return nil, false, ErrUnauthorized
	}
	return []byte(c.Value), true, nil
}

func (s *Server) checkCSRF(r *http.Request, token []byte) error {
	if isSafeMethod(r.Method) {
		return nil
	}
	// Origin 必须与对外服务的主机同源。
	// 反向代理(vite dev / 生产 Caddy)会改写 Host;使用 X-Forwarded-Host(代理注入)兜底。
	origin := r.Header.Get("Origin")
	if origin != "" {
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		if !sameOrigin(origin, host) {
			return errOrigin
		}
	}
	header := r.Header.Get(auth.CSRFHeader)
	if header == "" || header != auth.CSRFToken(token) {
		return errCSRF
	}
	return nil
}

func isSafeMethod(m string) bool { return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions }

func sameOrigin(origin, host string) bool {
	o := strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	return strings.EqualFold(o, host)
}

var errOrigin = apiErr(403, "origin_rejected", "请求来源不被允许")
var errCSRF = apiErr(403, "csrf_failed", "缺少或错误的 CSRF 令牌")

// rateLimiter 进程级令牌桶(按 key);重启后桶清空,验证码尝试上限由数据库持久化兜底。
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(perMinute float64, burst float64) *rateLimiter {
	return &rateLimiter{buckets: map[string]*bucket{}, rate: perMinute / 60, burst: burst, now: time.Now}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) limitAuth(endpoint string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.limiter.allow("auth:" + endpoint + ":" + clientIP(r)) {
			writeJSON(w, 429, apiErr(429, "rate_limited", "请求过于频繁,请稍后再试"))
			return
		}
		next(w, r)
	}
}

var _ = store.NewID
