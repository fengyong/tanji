<script setup lang="ts">
import { computed, ref } from 'vue';
import { work } from '../lib/session';
import { workStage, formatMoney, todayISO, type PaymentEntry } from '@tanji/domain';

const props = defineProps<{ privacy: boolean }>();
const emit = defineEmits<{ openDetail: [id: string] }>();

const tz = computed(() => (work.settings.timezone as string) || 'Asia/Shanghai');
const period = ref<'M' | '30' | '7'>('M');
const today = todayISO(tz.value);

interface Row { id: string; store: string; appt_local: string; price_cents: number; payments: PaymentEntry[]; shot_at: string | null; submitted_at: string | null; short_sent_at: string | null; long_sent_at: string | null }

const rows = computed(() => work.orders as unknown as Row[]);
const windowStart = computed(() => {
  const now = new Date();
  if (period.value === 'M') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const days = period.value === '30' ? 29 : 6;
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
});
const inWin = (iso: string) => (iso ?? '').slice(0, 10) >= windowStart.value;

const stats = computed(() => {
  const deals = rows.value.filter((o) => inWin(o.appt_local));
  const paid = rows.value.flatMap((o) => (o.payments ?? []) as PaymentEntry[])
    .filter((p) => p.entry_type === 'receipt' && !p.reverses_id && inWin(p.paid_at));
  const done = rows.value.filter((o) => workStage(o as never) === '已交付' && inWin((o.short_sent_at > o.long_sent_at ? o.short_sent_at : o.long_sent_at) ?? ''));
  return {
    dealSum: deals.reduce((s, o) => s + o.price_cents, 0),
    dealCount: deals.length,
    paidSum: paid.reduce((s, p) => s + p.amount_cents, 0),
    paidCount: paid.length,
    doneCount: done.length,
  };
});

// 单日分布(近 30 天)
const daily = computed(() => {
  const map: Record<string, { n: number; s: number }> = {};
  for (const o of rows.value) {
    const d = o.appt_local.slice(0, 10);
    if (d >= windowStart.value) {
      map[d] ??= { n: 0, s: 0 };
      map[d].n++;
      map[d].s += o.price_cents;
    }
  }
  return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
});

const money = (c: number) => (props.privacy ? '¥**' : formatMoney(c));
const periods: [typeof period.value, string][] = [['M', '本月'], ['30', '近30天'], ['7', '近7天']];
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div><div class="eyebrow">只统计自己账本(共享档期不计入)</div><h1 class="big">统计</h1></div>
      <div class="chips" style="margin:0">
        <button v-for="[k, l] in periods" :key="k" class="fchip" :class="{ on: period === k }" @click="period = k">{{ l }}</button>
      </div>
    </div>

    <div class="mini-grid" style="margin-top:12px">
      <div class="mini"><div class="mv" style="color:#239648">{{ money(stats.paidSum) }}</div><div class="ml">实收 · {{ stats.paidCount }} 笔</div></div>
      <div class="mini"><div class="mv">{{ money(stats.dealSum) }}</div><div class="ml">成交 · {{ stats.dealCount }} 单</div></div>
      <div class="mini"><div class="mv" style="color:var(--purple)">{{ stats.doneCount }}</div><div class="ml">已交付</div></div>
      <div class="mini"><div class="mv" style="color:var(--orange)">{{ daily.reduce((s, d) => s + d[1].n, 0) }}</div><div class="ml">窗口内档期</div></div>
    </div>

    <div class="sec-title">按日档期({{ windowStart }} 起)</div>
    <div class="card rows">
      <template v-if="daily.length">
        <div v-for="[d, v] in daily" :key="d" class="row">
          <div class="rside" style="width:52px"><div class="rprice" style="color:var(--brand)">{{ d.slice(5) }}</div></div>
          <div class="rmain"><div class="rname">{{ v.n }} 个档期</div>
            <div v-if="v.n >= 3" class="chiprow"><span class="chip c-orange">{{ (dayBadgeOf(v)) }}</span></div>
          </div>
          <div class="rside"><div class="rprice">{{ money(v.s) }}</div></div>
        </div>
      </template>
      <div v-else class="empty">该窗口暂无档期</div>
    </div>
  </div>
</template>

<script lang="ts">
function dayBadgeOf(v: { n: number; s: number }): string {
  if (v.s >= 250000) return '💎 王牌日';
  if (v.n >= 5) return '🔥 爆单';
  if (v.s >= 100000) return '💰 千元日';
  if (v.n >= 3) return '⭐ 忙碌日';
  return '';
}
</script>
