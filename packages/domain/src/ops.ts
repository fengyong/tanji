// 操作信封与协议常量:与后端 internal/domain/ops.go 一致(契约一致测试见 tests)。

export const PROTOCOL_VERSION = 1;
export const MAX_OPS_PER_BATCH = 50;

export const OP_TYPES = {
  OrderCreate: 'order.create',
  OrderUpdate: 'order.update',
  OrderReschedule: 'order.reschedule',
  OrderCancel: 'order.cancel',
  OrderArchive: 'order.archive',
  OrderDelete: 'order.delete',
  PaymentRecord: 'payment.record',
  PaymentReverse: 'payment.reverse',
  PartnerAssign: 'partner.assign',
  ScheduleGrant: 'schedule.grant',
  ScheduleRevoke: 'schedule.revoke',
  SettingsUpdate: 'settings.update',
} as const;

export type OpType = (typeof OP_TYPES)[keyof typeof OP_TYPES];

export type OpResultType = 'applied' | 'already_applied' | 'conflict' | 'rejected' | 'dependency_pending';

export interface Precondition {
  expected_version?: string;
  after_op_id?: string;
}

export interface OpEnvelope {
  op_id: string;
  aggregate_type: 'order' | 'grant_set' | 'settings';
  aggregate_id: string;
  type: OpType;
  precondition?: Precondition;
  requires_success?: string[];
  payload: unknown;
}

export interface OpResult {
  op_id: string;
  result: OpResultType;
  error_code?: string;
  message?: string;
  resulting_version?: string;
  payload?: unknown;
}

export interface PushResponse {
  results: OpResult[];
}

// ---- 下行事件 ----

export const EVENT_TYPES = {
  OrderChanged: 'order.changed',
  OrderDeleted: 'order.deleted',
  Settings: 'settings.changed',
  ShareGranted: 'share.granted',
  ShareUpdated: 'share.updated',
  SharePurged: 'share.purged',
  RelationPurged: 'relation.purged',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface PullEvent {
  seq: string;
  event_type: EventType;
  entity_id?: string;
  share_id?: string;
  generation?: string;
  origin_op_id?: string;
  payload?: unknown;
}

export interface PullPage {
  events: PullEvent[];
  next_cursor: string;
  high_water: string;
  has_more: boolean;
  stream_epoch: number;
  reset?: boolean;
}

export interface ScheduleProjection {
  share_id: string;
  generation: string;
  projection_revision: string;
  owner_display: string;
  store: string;
  starts_at: string;
  ends_at?: string | null;
  timezone: string;
  address: string;
  latitude?: string;
  longitude?: string;
  coord_system?: string;
  provider?: string;
  poi_id?: string;
  schedule_status: 'normal' | 'cancelled';
  auth_relation_id: string;
  auth_relation_generation: string;
}

export interface SettingsDTO {
  collect_threshold_days: number;
  timezone: string;
}
