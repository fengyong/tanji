// Package httpapi 提供 HTTP 路由、中间件与处理器。
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"tanji/backend/internal/auth"
	"tanji/backend/internal/engine"
)

// 统一错误码(HTTP 层)。
const (
	CodeUnauthorized = http.StatusUnauthorized
	CodeForbidden    = http.StatusForbidden
	CodeRateLimited  = http.StatusTooManyRequests
)

type APIError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

func apiErr(status int, code, msg string) *APIError { return &APIError{Status: status, Code: code, Message: msg} }

var ErrUnauthorized = apiErr(401, "unauthorized", "会话无效或已失效")
var ErrForbidden = apiErr(403, "forbidden", "没有执行该操作的权限")
var ErrBadRequest = apiErr(400, "bad_request", "请求格式无效")
var ErrTooLarge = apiErr(413, "payload_too_large", "请求体超过限制")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error, log *slog.Logger, where string) {
	var api *APIError
	if errors.As(err, &api) {
		writeJSON(w, api.Status, api)
		return
	}
	switch {
	case errors.Is(err, auth.ErrSessionInvalid), errors.Is(err, auth.ErrUserNotFound):
		writeJSON(w, 401, apiErr(401, "unauthorized", "会话无效或已失效"))
	case errors.Is(err, auth.ErrUserDisabled):
		writeJSON(w, 403, apiErr(403, "account_disabled", "账号不可用"))
	case errors.Is(err, engine.ErrRetryable):
		writeJSON(w, 503, apiErr(503, "retryable", "服务暂时繁忙,请重试"))
	default:
		log.Error("internal error", "where", where, "err", err)
		writeJSON(w, 500, apiErr(500, "internal", "服务内部错误"))
	}
}

func decodeJSON(r *http.Request, v any, maxBytes int64) error {
	if r.Body == nil {
		return ErrBadRequest
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return apiErr(400, "bad_request", "请求 JSON 无效: "+err.Error())
	}
	return nil
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
