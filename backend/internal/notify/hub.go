// Package notify 提供进程内 SSE 通知 hub:仅提示数据变化/会话失效,不承载业务数据。
// 通知丢失可补偿(pull 游标才是事实来源),因此允许合并/丢弃。
package notify

import (
	"log/slog"
	"net/http"
	"sync"
)

type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan string]struct{}
	Log  *slog.Logger
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{subs: map[string]map[chan string]struct{}{}, Log: log}
}

func userKey(id []byte) string { return string(id) }

func (h *Hub) subscribe(userID []byte) (chan string, func()) {
	ch := make(chan string, 8)
	h.mu.Lock()
	defer h.mu.Unlock()
	key := userKey(userID)
	if h.subs[key] == nil {
		h.subs[key] = map[chan string]struct{}{}
	}
	h.subs[key][ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if set, ok := h.subs[key]; ok {
			delete(set, ch)
			if len(set) == 0 {
				delete(h.subs, key)
			}
		}
	}
}

// NotifyUsers 唤醒一批账号的 SSE 连接(changes_available)。
func (h *Hub) NotifyUsers(ids [][]byte) {
	if h == nil || len(ids) == 0 {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, id := range ids {
		for ch := range h.subs[userKey(id)] {
			select {
			case ch <- "changes_available":
			default:
			}
		}
	}
}

// NotifySessionRevoked 向持有给定会话令牌哈希的连接发送踢出事件由 sessions 层调用;
// 这里按 user id 粗粒度唤醒,客户端在收到 notify 后主动 GET /v1/session 复核,发现失效即锁屏。
// HandleSSE 是 GET /v1/events:连接建立与存活期间都要校验会话。
// sessionDead 由调用方定期核验会话后关闭;连接随即断开,客户端下个请求将得到 401。
func (h *Hub) HandleSSE(w http.ResponseWriter, r *http.Request, userID []byte, sessionDead <-chan struct{}) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch, cancel := h.subscribe(userID)
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	if _, err := w.Write([]byte("event: hello\ndata: {}\n\n")); err != nil {
		return
	}
	flusher.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-sessionDead:
			_, _ = w.Write([]byte("event: session_revoked\ndata: {}\n\n"))
			flusher.Flush()
			return
		case msg := <-ch:
			if _, err := w.Write([]byte("event: notify\ndata: {\"type\":\"" + msg + "\"}\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
