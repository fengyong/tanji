-- +goose Up
-- 探记 TanJi 云端版 · 初始结构 (MySQL 8.4, utf8mb4, UTC)
-- 版本/序号以 BIGINT 存储,接口层一律以十进制字符串传输,避免 JavaScript 精度损失。

SET character_set_client = utf8mb4;

CREATE TABLE users (
  id                BINARY(16)     NOT NULL PRIMARY KEY,
  email_norm        VARCHAR(255)   NOT NULL,
  email_display     VARCHAR(255)   NOT NULL,
  nickname          VARCHAR(64)    NOT NULL,
  password_hash     VARCHAR(255)   NOT NULL,
  status            VARCHAR(16)    NOT NULL DEFAULT 'pending',
  active_session_id BINARY(16)     NULL,
  auth_epoch        BIGINT         NOT NULL DEFAULT 0,
  ledger_timezone   VARCHAR(64)    NOT NULL DEFAULT 'Asia/Shanghai',
  collect_threshold_days INT        NOT NULL DEFAULT 15,
  created_at        DATETIME(3)    NOT NULL,
  updated_at        DATETIME(3)    NOT NULL,
  UNIQUE KEY uk_users_email (email_norm),
  CONSTRAINT ck_users_status CHECK (status IN ('pending','active','disabled','deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sessions (
  id          BINARY(16)  NOT NULL PRIMARY KEY,
  user_id     BINARY(16)  NOT NULL,
  device_id   BINARY(16)  NOT NULL,
  auth_epoch  BIGINT      NOT NULL,
  token_hash  BINARY(32)  NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  revoked_at  DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_sessions_token (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE verification_challenges (
  id           BINARY(16)  NOT NULL PRIMARY KEY,
  purpose      VARCHAR(32) NOT NULL,
  email_norm   VARCHAR(255) NOT NULL,
  code_hash    BINARY(32)  NOT NULL,
  expires_at   DATETIME(3) NOT NULL,
  consumed_at  DATETIME(3) NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 5,
  last_sent_at DATETIME(3) NOT NULL,
  created_at   DATETIME(3) NOT NULL,
  KEY idx_vc_email (email_norm, purpose, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contact_links (
  id          BINARY(16)  NOT NULL PRIMARY KEY,
  user_low    BINARY(16)  NOT NULL,
  user_high   BINARY(16)  NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'active',
  generation  BIGINT      NOT NULL DEFAULT 1,
  created_at  DATETIME(3) NOT NULL,
  deleted_at  DATETIME(3) NULL,
  UNIQUE KEY uk_contact_pair (user_low, user_high),
  CONSTRAINT ck_contact_status CHECK (status IN ('active','deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE contact_invites (
  id          BINARY(16)  NOT NULL PRIMARY KEY,
  inviter_id  BINARY(16)  NOT NULL,
  invitee_id  BINARY(16)  NULL,
  invitee_email_norm VARCHAR(255) NULL,
  token_hash  BINARY(32)  NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending',
  expires_at  DATETIME(3) NOT NULL,
  handled_at  DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL,
  KEY idx_ci_inviter (inviter_id, created_at),
  KEY idx_ci_invitee (invitee_id, status),
  CONSTRAINT ck_ci_status CHECK (status IN ('pending','accepted','declined','expired','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE orders (
  id             BINARY(16)   NOT NULL PRIMARY KEY,
  owner_user_id  BINARY(16)   NOT NULL,
  version        BIGINT       NOT NULL DEFAULT 0,
  store          VARCHAR(120) NOT NULL,
  category       VARCHAR(64)  NOT NULL DEFAULT '其他',
  contact        VARCHAR(255) NOT NULL DEFAULT '',
  note           VARCHAR(2000) NOT NULL DEFAULT '',
  price_cents    BIGINT       NOT NULL,
  deposit_cents  BIGINT       NOT NULL DEFAULT 0,
  appt_start     DATETIME(3)  NOT NULL,
  appt_end       DATETIME(3)  NULL,
  timezone       VARCHAR(64)  NOT NULL DEFAULT 'Asia/Shanghai',
  settle_via     VARCHAR(16)  NOT NULL DEFAULT 'private',
  channel        VARCHAR(64)  NOT NULL DEFAULT '直客',
  shot_at        DATETIME(3)  NULL,
  submitted_at   DATETIME(3)  NULL,
  short_sent_at  DATETIME(3)  NULL,
  long_sent_at   DATETIME(3)  NULL,
  remind_at      DATETIME(3)  NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'active',
  deleted_at     DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  KEY idx_orders_owner (owner_user_id, status, appt_start),
  CONSTRAINT fk_orders_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT ck_orders_status CHECK (status IN ('active','cancelled','archived','deleted')),
  CONSTRAINT ck_orders_money CHECK (price_cents >= 0 AND deposit_cents >= 0 AND deposit_cents <= price_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_places (
  order_id      BINARY(16)  NOT NULL PRIMARY KEY,
  address_text  VARCHAR(500) NOT NULL DEFAULT '',
  latitude      DECIMAL(9,6) NULL,
  longitude     DECIMAL(9,6) NULL,
  coord_system  VARCHAR(16)  NULL,
  provider      VARCHAR(32)  NULL,
  poi_id        VARCHAR(128) NULL,
  updated_at    DATETIME(3) NOT NULL,
  CONSTRAINT fk_places_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE order_partner (
  order_id       BINARY(16)  NOT NULL PRIMARY KEY,
  partner_type   VARCHAR(8)  NOT NULL,
  partner_user_id BINARY(16) NULL,
  external_name  VARCHAR(64) NULL,
  updated_at     DATETIME(3) NOT NULL,
  CONSTRAINT fk_partner_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT ck_partner_type CHECK (partner_type IN ('account','external')),
  CONSTRAINT ck_partner_xor CHECK ( (partner_type='account' AND partner_user_id IS NOT NULL AND external_name IS NULL)
                                 OR (partner_type='external' AND external_name IS NOT NULL AND partner_user_id IS NULL) )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_entries (
  id            BINARY(16)  NOT NULL PRIMARY KEY,
  owner_user_id BINARY(16)  NOT NULL,
  order_id      BINARY(16)  NOT NULL,
  kind          VARCHAR(8)  NOT NULL,
  entry_type    VARCHAR(8)  NOT NULL,
  amount_cents  BIGINT      NOT NULL,
  method        VARCHAR(32) NOT NULL,
  paid_at       DATETIME(3) NOT NULL,
  reverses_id   BINARY(16)  NULL,
  created_op_id BINARY(16)  NOT NULL,
  created_at    DATETIME(3) NOT NULL,
  KEY idx_pay_order (owner_user_id, order_id),
  CONSTRAINT fk_pay_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT ck_pay_kind CHECK (kind IN ('deposit','final')),
  CONSTRAINT ck_pay_type CHECK (entry_type IN ('receipt','reversal')),
  CONSTRAINT ck_pay_amount CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE active_receipts (
  owner_user_id BINARY(16) NOT NULL,
  order_id      BINARY(16) NOT NULL,
  kind          VARCHAR(8) NOT NULL,
  receipt_id    BINARY(16) NOT NULL,
  PRIMARY KEY (owner_user_id, order_id, kind),
  CONSTRAINT fk_ar_receipt FOREIGN KEY (receipt_id) REFERENCES payment_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE schedule_grants (
  id                BINARY(16)  NOT NULL PRIMARY KEY,
  owner_user_id     BINARY(16)  NOT NULL,
  order_id          BINARY(16)  NOT NULL,
  recipient_user_id BINARY(16)  NOT NULL,
  role              VARCHAR(8)  NOT NULL,
  share_id          BINARY(16)  NOT NULL,
  grant_revision    BIGINT      NOT NULL DEFAULT 1,
  generation        BIGINT      NOT NULL DEFAULT 1,
  status            VARCHAR(8)  NOT NULL DEFAULT 'active',
  source            VARCHAR(16) NOT NULL,
  contact_link_id   BINARY(16)  NOT NULL,
  contact_generation BIGINT     NOT NULL,
  created_at        DATETIME(3) NOT NULL,
  revoked_at        DATETIME(3) NULL,
  UNIQUE KEY uk_grant_order_recipient (order_id, recipient_user_id),
  UNIQUE KEY uk_grant_share (share_id),
  KEY idx_grant_recipient (recipient_user_id, status),
  CONSTRAINT fk_grant_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_grant_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CONSTRAINT ck_grant_role CHECK (role IN ('partner','viewer','both')),
  CONSTRAINT ck_grant_status CHECK (status IN ('active','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE schedule_projections (
  share_id          BINARY(16)  NOT NULL PRIMARY KEY,
  generation        BIGINT      NOT NULL,
  revision          BIGINT      NOT NULL DEFAULT 1,
  owner_display     VARCHAR(64) NOT NULL,
  store             VARCHAR(120) NOT NULL,
  starts_at         DATETIME(3) NOT NULL,
  ends_at           DATETIME(3) NULL,
  timezone          VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  address_text      VARCHAR(500) NOT NULL DEFAULT '',
  latitude          DECIMAL(9,6) NULL,
  longitude         DECIMAL(9,6) NULL,
  coord_system      VARCHAR(16)  NULL,
  provider          VARCHAR(32)  NULL,
  poi_id            VARCHAR(128) NULL,
  schedule_status   VARCHAR(16) NOT NULL DEFAULT 'normal',
  updated_at        DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE mutation_receipts (
  user_id           BINARY(16)  NOT NULL,
  op_id             BINARY(16)  NOT NULL,
  payload_hash      BINARY(32)  NOT NULL,
  aggregate_type    VARCHAR(32) NOT NULL,
  aggregate_id      BINARY(16)  NOT NULL,
  op_type           VARCHAR(48) NOT NULL,
  result            VARCHAR(24) NOT NULL,
  error_code        VARCHAR(48) NULL,
  resulting_version BIGINT      NULL,
  result_payload    JSON        NULL,
  created_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, op_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE account_domain_guards (
  user_id    BINARY(16)  NOT NULL PRIMARY KEY,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_stream_heads (
  user_id     BINARY(16)  NOT NULL PRIMARY KEY,
  seq         BIGINT      NOT NULL DEFAULT 0,
  stream_epoch BIGINT     NOT NULL DEFAULT 1,
  updated_at  DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_changes (
  recipient_user_id BINARY(16)  NOT NULL,
  seq               BIGINT      NOT NULL,
  event_type        VARCHAR(32) NOT NULL,
  entity_id         BINARY(16)  NULL,
  share_id          BINARY(16)  NULL,
  generation        BIGINT      NULL,
  origin_op_id      BINARY(16)  NULL,
  payload           JSON        NULL,
  created_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (recipient_user_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE entity_tombstones (
  owner_user_id BINARY(16)  NOT NULL,
  entity_id     BINARY(16)  NOT NULL,
  entity_type   VARCHAR(32) NOT NULL,
  deleted_version BIGINT    NOT NULL,
  deleted_at    DATETIME(3) NOT NULL,
  PRIMARY KEY (owner_user_id, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bootstrap_snapshots (
  id          BINARY(16)  NOT NULL PRIMARY KEY,
  owner_user_id BINARY(16) NOT NULL,
  session_id  BINARY(16)  NOT NULL,
  stream_epoch BIGINT     NOT NULL,
  high_water  BIGINT      NOT NULL,
  total_pages INT         NOT NULL,
  page_size   INT         NOT NULL,
  manifest    JSON        NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'ready',
  expires_at  DATETIME(3) NOT NULL,
  created_at  DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bootstrap_pages (
  snapshot_id BINARY(16)  NOT NULL,
  page_no     INT         NOT NULL,
  payload     JSON        NOT NULL,
  checksum    BINARY(32)  NOT NULL,
  PRIMARY KEY (snapshot_id, page_no),
  CONSTRAINT fk_bp_snapshot FOREIGN KEY (snapshot_id) REFERENCES bootstrap_snapshots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_events (
  id         BINARY(16)  NOT NULL PRIMARY KEY,
  user_id    BINARY(16)  NULL,
  event_type VARCHAR(48) NOT NULL,
  detail     JSON        NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- +goose Down
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS bootstrap_pages;
DROP TABLE IF EXISTS bootstrap_snapshots;
DROP TABLE IF EXISTS entity_tombstones;
DROP TABLE IF EXISTS user_changes;
DROP TABLE IF EXISTS user_stream_heads;
DROP TABLE IF EXISTS account_domain_guards;
DROP TABLE IF EXISTS mutation_receipts;
DROP TABLE IF EXISTS schedule_projections;
DROP TABLE IF EXISTS schedule_grants;
DROP TABLE IF EXISTS active_receipts;
DROP TABLE IF EXISTS payment_entries;
DROP TABLE IF EXISTS order_partner;
DROP TABLE IF EXISTS order_places;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS contact_invites;
DROP TABLE IF EXISTS contact_links;
DROP TABLE IF EXISTS verification_challenges;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
