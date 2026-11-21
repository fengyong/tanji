# 探记云端版后端镜像:多阶段构建,运行层 alpine + 非 root 用户
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOFLAGS=-trimpath go build -o /out/tanji-server ./cmd/server \
 && CGO_ENABLED=0 GOFLAGS=-trimpath go build -o /out/tanji-migrate ./cmd/migrate

FROM alpine:3.20
RUN adduser -D -u 10001 tanji \
 && apk add --no-cache ca-certificates tzdata
COPY --from=build /out/tanji-server /usr/local/bin/tanji-server
COPY --from=build /out/tanji-migrate /usr/local/bin/tanji-migrate
COPY migrations /app/migrations
WORKDIR /app
USER tanji
EXPOSE 8080
# 健康检查用 /health/ready(数据库就绪)
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=10 \
  CMD wget -qO- http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["/usr/local/bin/tanji-server"]
CMD ["-addr", "0.0.0.0:8080"]
