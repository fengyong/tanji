// 本地 SQLite 结构:业务工作视图 + 服务端基线 + outbox + 同步元数据 + 冲突 + 迁移映射。
// SCHEMA_VERSION 独立于服务端(MySQL goose 迁移);迁移失败必须明确报错,不得清库。

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_meta (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  account_id         TEXT,
  protocol_version   INTEGER NOT NULL DEFAULT 1,
  schema_version     INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION},
  stream_epoch       INTEGER NOT NULL DEFAULT 1,
  cursor             TEXT,
  high_water         TEXT,
  last_pull_at       TEXT,
  last_push_at       TEXT,
  runtime_generation INTEGER NOT NULL DEFAULT 1
);

-- 本人订单工作视图(基线 + 未确认操作叠加);dirty=1 表示存在待同步修改。
-- appt_local 是 appt_start 按账本时区的本地化派生(非第二真相,写入时同步更新),用于"今天/本月"查询。
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  version        TEXT NOT NULL DEFAULT '0',
  store          TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT '其他',
  contact        TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  price_cents    INTEGER NOT NULL,
  deposit_cents  INTEGER NOT NULL DEFAULT 0,
  appt_start     TEXT NOT NULL,
  appt_local     TEXT NOT NULL,
  appt_end       TEXT,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  settle_via     TEXT NOT NULL DEFAULT 'private',
  channel        TEXT NOT NULL DEFAULT '直客',
  shot_at        TEXT,
  submitted_at   TEXT,
  short_sent_at  TEXT,
  long_sent_at   TEXT,
  remind_at      TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  place_address  TEXT NOT NULL DEFAULT '',
  place_lat      TEXT,
  place_lng      TEXT,
  place_coord    TEXT,
  place_provider TEXT,
  place_poi      TEXT,
  partner_type   TEXT,
  partner_user   TEXT,
  partner_name   TEXT,
  dirty          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_appt_local ON orders (appt_local);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status, dirty);

-- 服务端已确认基线(重放与冲突比较的唯一事实);content 为规范化 OrderDTO JSON
CREATE TABLE IF NOT EXISTS server_base (
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  version        TEXT NOT NULL,
  content        TEXT NOT NULL,
  PRIMARY KEY (aggregate_type, aggregate_id)
);

-- 收款流水工作视图:confirmed 来自基线,pending 来自本地未同步操作
CREATE TABLE IF NOT EXISTS payment_entries (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  entry_type   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method       TEXT NOT NULL,
  paid_at      TEXT NOT NULL,
  reverses_id  TEXT,
  state        TEXT NOT NULL DEFAULT 'confirmed',
  origin_op_id TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_order ON payment_entries (order_id);

-- 待同步操作队列:与业务修改同事务写入
CREATE TABLE IF NOT EXISTS outbox (
  op_id          TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  precondition   TEXT,
  requires_success TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  session_id     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  result_code    TEXT,
  resulting_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status, aggregate_id);

-- 冲突:服务端基线 + 本地意图 + 拒绝原因,等待用户决定
CREATE TABLE IF NOT EXISTS conflicts (
  id           TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  op_id        TEXT NOT NULL,
  intent       TEXT NOT NULL,
  server_content TEXT,
  error_code   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL
);

-- 接收者共享缓存:只存白名单投影,不含完整订单
CREATE TABLE IF NOT EXISTS shared_schedules (
  share_id      TEXT NOT NULL,
  generation    TEXT NOT NULL,
  revision      TEXT NOT NULL,
  owner_display TEXT NOT NULL,
  store         TEXT NOT NULL,
  starts_at     TEXT NOT NULL,
  ends_at       TEXT,
  timezone      TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  latitude      TEXT,
  longitude     TEXT,
  coord_system  TEXT,
  provider      TEXT,
  poi_id        TEXT,
  schedule_status TEXT NOT NULL DEFAULT 'normal',
  auth_relation_id TEXT NOT NULL,
  auth_relation_generation TEXT NOT NULL,
  synced_at     TEXT NOT NULL,
  verified_at   TEXT,
  PRIMARY KEY (share_id, generation)
);

-- 本人发出的授权(经本人事件同步到其他设备)
CREATE TABLE IF NOT EXISTS grants_state (
  share_id   TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  role       TEXT NOT NULL,
  generation TEXT NOT NULL,
  revision   TEXT NOT NULL,
  status     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 已关联联系人(最小资料)
CREATE TABLE IF NOT EXISTS contacts (
  user_id    TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  synced_at  TEXT NOT NULL
);

-- 旧数据迁移映射(重复导入去重的关键)
CREATE TABLE IF NOT EXISTS migration_map (
  source_dataset TEXT NOT NULL,
  kind           TEXT NOT NULL,
  old_id         TEXT NOT NULL,
  new_id         TEXT NOT NULL,
  PRIMARY KEY (source_dataset, kind, old_id)
);
`;
