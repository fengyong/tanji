<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getLedger, app, toast, refreshOrders } from '../lib/session';
import {
  workStage, payStage, dueCents, overdueDays, daysBetween, hasActiveReceipt, activeReceiptOf,
  formatMoney, formatCents, RECEIPT_METHODS, type OrderDTO, type PaymentEntry, type ScheduleProjection,
} from '@tanji/domain';

const props = defineProps<{ id: string; privacy: boolean }>();
const emit = defineEmits<{ close: []; edit: [id: string]; pay: [v: { id: string; kind: 'deposit' | 'final' }]; changed: [] }>();

const order = ref<Record<string, unknown> | null>(null);
const grants = ref<Record<string, unknown>[]>([]);
const contacts = ref<Record<string, unknown>[]>([]);
const tz = ref('Asia/Shanghai');
const threshold = ref(15);
const shareBusy = ref(false);
const snoozePick = ref(false);

onMounted(async () => { await reload(); });

async function reload() {
  const l = getLedger();
  order.value = (await l.call('getOrder', { id: props.id })) as Record<string, unknown> | null;
  if (!order.value) { emit('close'); return; }
  grants.value = (await l.call('listGrants', { orderId: props.id })) as Record<string, unknown>[];
  contacts.value = (await l.call('listContacts')) as Record<string, unknown>[];
  const s = (await l.call('settings')) as { collect_threshold_days: number; timezone: string };
  tz.value = s.timezone || 'Asia/Shanghai';
  threshold.value = s.collect_threshold_days || 15;
}

const o = computed(() => order.value as never as {
  id: string; store: string; category: string; contact: string; note: string; channel: string;
  price_cents: number; deposit_cents: number; appt_local: string; settle_via: string;
  shot_at: string | null; submitted_at: string | null; short_sent_at: string | null; long_sent_at: string | null;
  remind_at: string | null; status: string; dirty: number; partner_name: string | null;
  payments: PaymentEntry[];
});

const pay = computed(() => payStage(o.value, o.value?.payments ?? []));
const work = computed(() => workStage(o.value ?? ({} as never)));
const owed = computed(() => (o.value ? dueCents(o.value as never, o.value.payments ?? [], 'deposit') + dueCents(o.value as never, o.value.payments ?? [], 'final') : 0));
const over = computed(() => o.value && pay.value === '待尾款' && o.value.settle_via !== 'douyin' && o.value.shot_at && overdueDays(o.value as never, o.value.payments ?? [], tz.value, (iso, t) => daysBetween(iso, t)) >= threshold.value);
const overDays = computed(() => (o.value?.shot_at ? overdueDays(o.value as never, o.value.payments ?? [], tz.value, (iso, t) => daysBetween(iso, t)) : 0));
const received = computed(() => (o.value?.payments ?? []).filter((p) => p.entry_type === 'receipt' && !p.reverses_id).reduce((s, p) => s + p.amount_cents, 0));
const milestones = computed(() => [
  ['shotAt', o.value?.shot_at, '拍摄'], ['submittedAt', o.value?.submitted_at, '提审'],
  ['shortSentAt', o.value?.short_sent_at, '发短片'], ['longSentAt', o.value?.long_sent_at, '发长片'],
] as [string, string | null, string][]);
const nextMileIdx = computed(() => milestones.value.findIndex((m) => !m[1]));

const money = (c: number) => (props.privacy ? '¥**' : formatMoney(c));

async function mark(key: string) {
  const idx = milestones.value.findIndex((m) => m[0] === key);
  const [k, cur, label] = milestones.value[idx];
  if (cur) {
    if (!window.confirm(`清除「${label}」标记?`)) return;
    await setMile(k, null);
  } else {
    if (idx !== nextMileIdx.value) {
      if (!window.confirm(`这会跳过前面的步骤,直接标记「${label}」。确认?`)) return;
    }
    await setMile(k, new Date().toISOString());
  }
}
async function setMile(field: string, value: string | null) {
  const l = getLedger();
  try {
    await l.call('updateOrder', { id: props.id, changes: { [camel(field)]: value } as never, sessionId: app.user?.session_id ?? null });
    await reload();
    emit('changed');
    toast(value ? '已标记(已保存本机)' : '已清除');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
function camel(field: string): string {
  return { shotAt: 'shot_at', submittedAt: 'submitted_at', shortSentAt: 'short_sent_at', longSentAt: 'long_sent_at', remindAt: 'remind_at' }[field] ?? field;
}

async function snooze(days: number) {
  const when = new Date(Date.now() + days * 86400000).toISOString();
  await setMile('remindAt', when);
  snoozePick.value = false;
}
async function clearRemind() { await setMile('remind_at' in {} ? 'remind_at' : 'remindAt', null); }

async function setPartner(userID: string) {
  const l = getLedger();
  try {
    await l.call('assignPartner', {
      id: props.id,
      ref: userID ? { type: 'account', user_id: userID } : { type: 'external', external_name: ' ' },
      sessionId: app.user?.session_id ?? null,
    });
    await reload();
    emit('changed');
    toast(userID ? '已选择账号搭档(共享待同步)' : '已清空搭档');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

async function revokeShare(shareID: string, gen: string) {
  if (!window.confirm('撤销后,该接收者联网后将清除缓存;撤销在云端确认前不显示"对方已不可见"。确认撤销?')) return;
  shareBusy.value = true;
  try {
    const { grantSetID } = await import('@tanji/domain');
    const g = grants.value.find((x) => x.share_id === shareID);
    const aggID = await grantSetID(String(app.user?.userID), String(g?.order_id ?? props.id), String(g?.recipient ?? ''));
    await getLedger().call('revokeSchedule', {
      shareId: shareID, sessionId: app.user?.session_id ?? null, aggregateID: aggID,
    });
    await reload();
    emit('changed');
    toast('已发起撤销(等待云端确认)');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

async function grantTo(recipientID: string, role: 'partner' | 'viewer') {
  shareBusy.value = true;
  try {
    const { grantSetID } = await import('@tanji/domain');
    const aggID = await grantSetID(String(app.user?.userID), props.id, recipientID);
    await getLedger().call('grantSchedule', {
      orderId: props.id, recipientID, role, sessionId: app.user?.session_id ?? null, aggregateID: aggID,
    });
    await reload();
    emit('changed');
    toast('已发起共享(等待云端确认)');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    shareBusy.value = false;
  }
}

async function reverse(kind: 'deposit' | 'final') {
  const label = kind === 'deposit' ? '定金' : '尾款';
  if (!window.confirm(`撤销${label}记录并新增撤销流水?仅用于纠正错误收款,不表示退款。`)) return;
  try {
    await getLedger().call('reversePayment', { id: props.id, kind, sessionId: app.user?.session_id ?? null });
    await reload();
    emit('changed');
    toast(`已撤销${label}记录(保留原流水)`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

async function archiveOrder() {
  if (!window.confirm('归档后不再出现在工作流,但保留收款统计。确认归档?')) return;
  try {
    await getLedger().call('archiveOrder', { id: props.id, sessionId: app.user?.session_id ?? null });
    emit('changed');
    emit('close');
    toast('已归档');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
async function deleteOrder() {
  if (!window.confirm('仅无有效收款的订单可删除;删除会同步到云端并阻止旧设备复活。确认删除?')) return;
  try {
    await getLedger().call('deleteOrder', { id: props.id, sessionId: app.user?.session_id ?? null });
    emit('changed');
    emit('close');
    toast('已删除(待同步)');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <div class="sheet show">
    <template v-if="o">
      <div class="sheet-head">
        <div style="min-width:0">
          <div class="sheet-title" style="font-size:19px">{{ o.store }}</div>
          <div class="hsub" style="margin-top:3px">{{ o.category }}<template v-if="o.contact"> · {{ o.contact }}</template></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="sheet-close" style="background:var(--brand-soft);color:var(--brand)" @click="emit('edit', props.id)">✎</button>
          <button class="sheet-close" @click="emit('close')">✕</button>
        </div>
      </div>

      <div class="chiprow">
        <span class="chip c-blue">{{ work }}</span>
        <span class="chip" :class="over ? 'c-red' : 'c-gray'">{{ over ? '已逾期' : pay }}</span>
        <span v-if="over" class="chip c-red">欠款 {{ overDays }} 天</span>
        <span v-if="o.dirty" class="chip c-orange">待同步</span>
        <span v-if="o.status === 'cancelled'" class="chip c-red">已取消</span>
        <span v-if="o.status === 'archived'" class="chip c-gray">已归档</span>
      </div>
      <div v-if="over" class="banner-red">
        <span>尾款自拍摄日({{ o.shot_at?.slice(0, 10) }})起已欠 <b>{{ overDays }} 天</b>,达到 {{ threshold }} 天催收阈值,建议电话跟进。</span>
      </div>

      <div class="mile">
        <button v-for="(m, i) in milestones" :key="m[0]" class="mstep" :class="{ done: !!m[1], now: i === nextMileIdx }" @click="mark(m[0])">
          <div class="mdot">{{ m[1] ? '✓' : i === nextMileIdx ? '·' : '' }}</div>
          <div class="mlab">{{ m[2] }}</div>
          <div class="mtime">{{ m[1] ? m[1].slice(5, 16).replace('T', ' ') : i === nextMileIdx ? '点击标记' : '' }}</div>
        </button>
      </div>

      <div class="sec-title">收款</div>
      <div class="btn2">
        <button v-if="dueCents(o as never, o.payments ?? [], 'deposit') > 0 && !hasActiveReceipt(o.payments ?? [], 'deposit')" class="btn tint-blue" @click="emit('pay', { id: props.id, kind: 'deposit' })">收定金 {{ money(dueCents(o as never, o.payments ?? [], 'deposit')) }}</button>
        <button v-if="dueCents(o as never, o.payments ?? [], 'final') > 0 && !hasActiveReceipt(o.payments ?? [], 'final')" class="btn" :class="over ? 'primary' : 'tint-green'" @click="emit('pay', { id: props.id, kind: 'final' })">收尾款 {{ money(dueCents(o as never, o.payments ?? [], 'final')) }}</button>
        <button v-if="activeReceiptOf(o.payments ?? [], 'deposit')" class="btn ghost" @click="reverse('deposit')">撤销定金记录</button>
        <button v-if="activeReceiptOf(o.payments ?? [], 'final')" class="btn ghost" @click="reverse('final')">撤销尾款记录</button>
        <div v-if="!o.payments?.length" class="rsub">暂无收款记录</div>
      </div>

      <div v-if="pay === '待尾款'" class="sec-title">催收备忘(打开 App 时查看)</div>
      <div v-if="pay === '待尾款'" class="btn2">
        <button v-for="d in [1, 3, 7]" :key="d" class="btn ghost" @click="snooze(d)">{{ d }}天后提醒</button>
        <button v-if="o.remind_at" class="btn ghost" @click="clearRemind">清除提醒({{ o.remind_at.slice(5, 10) }})</button>
      </div>

      <div class="info-grid">
        <div class="ig"><div class="k">预约时间</div><div class="v">{{ o.appt_local.replace('T', ' ') }}</div></div>
        <div class="ig"><div class="k">结算方式</div><div class="v">{{ o.settle_via === 'douyin' ? '抖音商单' : '私收' }}</div></div>
        <div class="ig"><div class="k">渠道</div><div class="v">{{ o.channel || '直客' }}</div></div>
        <div class="ig"><div class="k">出镜搭档</div><div class="v">{{ o.partner_name || '—' }}</div></div>
        <div class="ig"><div class="k">总价</div><div class="v">{{ money(o.price_cents) }}</div></div>
        <div class="ig"><div class="k">定金</div><div class="v">{{ money(o.deposit_cents) }}</div></div>
        <div class="ig"><div class="k">已收合计</div><div class="v" style="color:#239648">{{ received > 0 ? money(received) : '—' }}</div></div>
        <div class="ig"><div class="k">当前待收</div><div class="v" :style="owed > 0 ? 'color:var(--red)' : 'color:#239648'">{{ owed > 0 ? money(owed) : '已结清' }}</div></div>
      </div>
      <div v-if="o.note" class="card" style="margin-top:12px;background:#F8F8FA;box-shadow:none">
        <div class="rsub" style="white-space:normal;line-height:1.6">{{ o.note }}</div>
      </div>

      <!-- 搭档共享 -->
      <div class="sec-title">档期共享(白名单:店名/时间/地址)</div>
      <div class="card">
        <div v-for="g in grants" :key="String(g.share_id)" class="row" style="cursor:default">
          <div class="rmain">
            <div class="rname">{{ contacts.find((c) => c.user_id === g.recipient)?.nickname ?? '搭档' }} · {{ g.role === 'partner' ? '主要搭档' : '查看者' }}</div>
            <div class="rsub">代次 {{ g.generation }} · 修订 {{ g.revision }} · {{ g.status === 'active' ? '已授权' : '已撤销(待同步)' }}</div>
          </div>
          <button v-if="g.status === 'active'" class="mini-btn" style="background:var(--red-soft);color:var(--red);border:none;border-radius:10px;padding:7px 12px;font-weight:700" :disabled="shareBusy" @click="revokeShare(String(g.share_id), String(g.generation))">撤销</button>
        </div>
        <div class="frow" style="margin-top:8px">
          <label>添加已关联账号为查看者</label>
          <select @change="grantTo(($event.target as HTMLSelectElement).value, 'viewer'); ($event.target as HTMLSelectElement).value = ''">
            <option value="">选择账号…</option>
            <option v-for="c in contacts" :key="c.user_id as string" :value="c.user_id">{{ c.nickname }}</option>
          </select>
        </div>
        <div class="rsub" style="line-height:1.6;margin-top:6px">主要搭档通过「选择搭档」产生;只读查看者在此添加。金额、流水、备注、联系人不进入共享。</div>
      </div>

      <div class="btn2" style="margin-top:14px">
        <button class="btn ghost" @click="archiveOrder">归档订单</button>
        <button class="btn danger-ghost" @click="deleteOrder">删除订单</button>
      </div>
    </template>
  </div>
</template>
