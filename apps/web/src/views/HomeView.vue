<script setup lang="ts">
import { computed } from 'vue';
import { work, app } from '../lib/session';
import { workStage, payStage, dueCents, overdueDays, hasActiveReceipt, formatMoney, todayISO, daysBetween, type OrderDTO, type PaymentEntry } from '@tanji/domain';

const props = defineProps<{ privacy: boolean }>();
const emit = defineEmits<{ openDetail: [id: string]; goto: [tab: string] }>();

const tz = computed(() => (work.settings.timezone as string) || 'Asia/Shanghai');
const now = new Date();
const today = todayISO(tz.value, now);

interface Row { id: string; store: string; appt_local: string; price_cents: number; status: string; payments: PaymentEntry[]; dirty: number; shot_at: string | null; submitted_at: string | null; short_sent_at: string | null; long_sent_at: string | null; deposit_cents: number; settle_via: string; category: string; channel: string }

const rows = computed(() => work.orders as unknown as Row[]);
const todays = computed(() =>
  rows.value.filter((o) => o.appt_local?.slice(0, 10) === today && o.status === 'active' && !o.shot_at));
const sending = computed(() =>
  rows.value.filter((o) => ['后期中', '发片中'].includes(workStage(o as never)) && o.status === 'active'));
const threshold = computed(() => Number(work.settings.collect_threshold_days ?? 15));

function overdueOf(o: Row): number {
  return overdueDays(o as never, o.payments ?? [], tz.value, (iso, tzv) => daysBetween(iso, tzv, now));
}
function isOver(o: Row): boolean {
  return o.settle_via !== 'douyin' && dueCents(o as never, o.payments ?? [], 'final') > 0 && overdueOf(o) >= threshold.value;
}
function owedOf(o: Row): number {
  return dueCents(o as never, o.payments ?? [], 'deposit') + dueCents(o as never, o.payments ?? [], 'final');
}
const overList = computed(() => rows.value.filter(isOver).filter((o) => !o.remind_at || o.remind_at < new Date().toISOString()));
const overSum = computed(() => overList.value.reduce((s, o) => s + owedOf(o), 0));
const totOwed = computed(() => rows.value.reduce((s, o) => s + owedOf(o), 0));

const monthPaid = computed(() => {
  const month = today.slice(0, 7);
  const inMonth = (iso: string) => (iso ?? '').slice(0, 7) === month;
  const paid = rows.value.flatMap((o) => (o.payments ?? []) as PaymentEntry[])
    .filter((p) => p.entry_type === 'receipt' && !p.reverses_id && inMonth(p.paid_at));
  return { sum: paid.reduce((s, p) => s + p.amount_cents, 0), count: paid.length };
});
const monthDeals = computed(() => {
  const month = today.slice(0, 7);
  const deals = rows.value.filter((o) => o.appt_local?.slice(0, 7) === month);
  return { sum: deals.reduce((s, o) => s + o.price_cents, 0), count: deals.length };
});

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 19) return '下午好';
  return '晚上好';
});

const money = (c: number) => (props.privacy ? '¥**' : formatMoney(c));
const label = (o: Row) => {
  const stage = payStage(o as never, o.payments ?? []);
  return isOver(o) ? '已逾期' : stage;
};
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div>
        <div class="eyebrow">{{ today }}</div>
        <h1 class="big">{{ greeting }},达人</h1>
        <div class="hsub">今日 {{ todays.length }} 单拍摄 · {{ overList.length ? `${overList.length} 笔待催收` : '收款正常' }}</div>
      </div>
      <button class="btn-pill" @click="emit('new-order')">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约
      </button>
    </div>

    <div
      v-if="overList.length"
      class="alert-card"
      @click="emit('goto', 'orders')"
    >
      <svg class="ic" viewBox="0 0 24 24"><path d="M12 3.5a6 6 0 0 0-6 6v3.2l-1.6 3a1 1 0 0 0 .9 1.5h13.4a1 1 0 0 0 .9-1.5l-1.6-3V9.5a6 6 0 0 0-6-6z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>
      <div class="alert-main">
        <div class="alert-t">{{ overList.length }} 笔尾款逾期 · 待催收 {{ money(overSum) }}</div>
        <div class="alert-s">最长已欠 {{ Math.max(...overList.map(overdueOf)) }} 天 · 点击进入订单清单</div>
      </div>
      <svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>
    </div>
    <div v-else class="alert-card calm">
      <svg class="ic" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      <div class="alert-main">
        <div class="alert-t">收款状态健康</div>
        <div class="alert-s">暂无逾期尾款,共待收 {{ money(totOwed) }}</div>
      </div>
    </div>

    <div class="sec-title">今日拍摄 <span class="more" @click="emit('goto', 'trip')">行程 ›</span></div>
    <div class="card rows">
      <template v-if="todays.length">
        <div v-for="o in todays" :key="o.id" class="row" @click="emit('openDetail', o.id)">
          <div class="rside" style="width:52px">
            <div class="rprice" style="color:var(--brand)">{{ o.appt_local.slice(11, 16) }}</div>
            <div class="rsub">预约</div>
          </div>
          <div class="rmain">
            <div class="rname">{{ o.store }}</div>
            <div class="chiprow">
              <span class="chip c-blue">{{ workStage(o as never) }}</span>
              <span class="chip c-gray">{{ o.category }}</span>
              <span v-if="o.dirty" class="chip c-orange">待同步</span>
            </div>
          </div>
          <div class="rside"><div class="rprice">{{ money(o.price_cents) }}</div></div>
        </div>
      </template>
      <div v-else class="empty"><div class="e-ic">🌙</div>今日无拍摄安排<br>去「行程」页看看接下来的档期</div>
    </div>

    <div class="sec-title">待发片 <span class="more" @click="emit('goto', 'orders')">全部 ›</span></div>
    <div class="card rows">
      <template v-if="sending.length">
        <div v-for="o in sending.slice(0, 4)" :key="o.id" class="row" @click="emit('openDetail', o.id)">
          <div class="rmain">
            <div class="rname">{{ o.store }}</div>
            <div class="rsub">拍摄于 {{ (o.shot_at ?? '').slice(0, 10) }} · {{ money(o.price_cents) }}</div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0">
            <span v-if="!o.submitted_at" class="chip c-orange">待提审</span>
            <span v-if="!o.short_sent_at" class="chip c-orange">待短片</span>
            <span v-if="!o.long_sent_at" class="chip c-orange">待长片</span>
          </div>
        </div>
      </template>
      <div v-else class="empty">没有待发片的订单 🎉</div>
    </div>

    <div class="sec-title">本月速览 <span class="more" @click="emit('goto', 'stats')">统计 ›</span></div>
    <div class="mini-grid">
      <div class="mini"><div class="mv" style="color:#239648">{{ money(monthPaid.sum) }}</div><div class="ml">本月实收 · {{ monthPaid.count }} 笔</div></div>
      <div class="mini"><div class="mv">{{ money(monthDeals.sum) }}</div><div class="ml">本月成交 · {{ monthDeals.count }} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--red)">{{ money(totOwed) }}</div><div class="ml">当前待收款</div></div>
      <div class="mini"><div class="mv" style="color:var(--orange)">{{ sending.length }}</div><div class="ml">待发片订单</div></div>
    </div>
  </div>
</template>
