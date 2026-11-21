package auth

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"
)

// EmailSender 发送验证邮件。生产环境在发布前配置真实邮件服务;
// 开发环境使用 Mailpit(SMTP 1025),不可用时降级为服务端日志输出并明确标记 DEV-ONLY。
type EmailSender interface {
	SendVerification(email, nickname, code, purpose string) error
	Kind() string
}

type MailpitSender struct {
	Addr     string // host:port
	From     string
	Log      *slog.Logger
	fallback LogSender
	kind     string
}

type LogSender struct{ Log *slog.Logger }

func (l LogSender) SendVerification(email, _, code, purpose string) error {
	l.Log.Warn("DEV-ONLY: 验证码走日志输出(未配置邮件服务)",
		"email", email, "code", code, "purpose", purpose)
	return nil
}

func (l LogSender) Kind() string { return "dev-log" }

func NewMailpit(addr, from string, log *slog.Logger) *MailpitSender {
	return &MailpitSender{Addr: addr, From: from, Log: log, kind: "mailpit"}
}

func (m *MailpitSender) Kind() string { return m.kind }

func (m *MailpitSender) SendVerification(email, nickname, code, purpose string) error {
	subject := map[string]string{
		PurposeRegister: "探记注册验证码",
		PurposeForgot:   "探记密码找回验证码",
	}[purpose]
	body := fmt.Sprintf("%s 你好:\n\n你的验证码是 %s,10 分钟内有效,单次使用。\n如果这不是你本人的操作,请忽略本邮件。\n\n探记 TanJi",
		nickname, code)
	msg := strings.Join([]string{
		"From: " + m.From,
		"To: " + email,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")
	if err := smtp.SendMail(m.Addr, nil, m.From, []string{email}, []byte(msg)); err != nil {
		m.Log.Warn("邮件服务不可用,降级输出验证码(DEV-ONLY)", "email", email, "err", err.Error())
		m.kind = "dev-log"
		return LogSender{Log: m.Log}.SendVerification(email, nickname, code, purpose)
	}
	return nil
}
