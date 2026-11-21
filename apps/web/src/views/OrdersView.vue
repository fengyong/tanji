<script setup lang="ts">
import { computed, ref } from 'vue';
import { work } from '../lib/session';
import { workStage, payStage, dueCents, overdueDays, daysBetween, formatMoney, type PaymentEntry } from '@tanji/domain';

const props = defineProps<{ privacy: boolean }>();
const emit = defineEmits<{ openDetail: [id: string]; newOrder: [] }>();

const search = ref('');
const chip = ref<'all' | 'wait' | 'doing' | 'unpaid' | 'over' | 'done'>('all');
const tz = computed(() => (work.settings.timezone as string) || 'Asia/Shanghai');

interface Row { id: string; store: string; appt_local: string; price_cents: number; status: string; payments: PaymentEntry[]; dirty: number; category: string; channel: string; shot_at: string | null; deposit_cents: number; settle_via: string; remind_at: string | null }

const rows = computed(() => work.orders as unknown as Row[]);
const threshold = computed(() => Number(work.settings.collect_threshold_days ?? 15));
function overdueOf(o: Row) {
  return overdueDays(o as never, o.payments ?? [], tz.value, (iso, tzv) => daysBetween(iso, tzv));
}
function owedOf(o: Row) {
  return dueCents(o as never, o.payments ?? [], 'deposit') + dueCents(o as never, o.payments ?? [], 'final');
}
function isOver(o: Row) {
  return o.settle_via !== 'douyin' && dueCents(o as never, o.payments ?? [], 'final') > 0 && overdueOf(o) >= threshold.value;
}
function chipMatch(o: Row) {
  const w = workStage(o as never);
  switch (chip.value) {
    case 'wait': return w === '待拍摄';
    case 'doing': return w === '后期中' || w === '发片中';
    case 'unpaid': return owedOf(o) > 0;
    case 'over': return isOver(o);
    case 'done': return w === '已交付';
    default: return true;
  }
}
const all = computed(() =>
  rows.value.filter(chipMatch)
    .filter((o) => !search.value.trim() || o.store.toLowerCase().includes(search.value.trim().toLowerCase()))
    .sort((a, b) => (b.shot_at ?? b.appt_local).localeCompare(a.shot_at ?? a.appt_local)));

const chipDefs: [typeof chip.value, string][] = [
  ['all', '全部'], ['wait', '待拍摄'], ['doing', '进行中'], ['unpaid', '待收款'], ['over', '逾期'], ['done', '已完结'],
];
const chipCount = (k: typeof chip.value) => {
  const cur = chip.value;
  chip.value = k;
  const n = rows.value.filter(chipMatch).length;
  chip.value = cur;
  return n;
};
const money = (c: number) => (props.privacy ? '¥**' : formatMoney(c));
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div>
        <div class="eyebrow">工作 × 收款 双轨状态</div>
        <h1 class="big">订单</h1>
      </div>
      <button class="btn-pill" @click="emit('new-order')">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约
      </button>
    </div>
    <div class="search">
      <svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input v-model="search" placeholder="搜索商家名称">
    </div>
    <div class="chips">
      <button v-for="[k, l] in chipDefs" :key="k" class="fchip" :class="{ on: chip === k }" @click="chip = k">
        {{ l }} <b>{{ chipCount(k) }}</b>
      </button>
    </div>
    <div class="card rows">
      <template v-if="all.length">
        <div v-for="o in all" :key="o.id" class="row" @click="emit('openDetail', o.id)">
          <div class="rmain">
            <div class="rname">{{ o.store }}</div>
            <div class="rsub">{{ o.shot_at ? `拍摄 ${o.shot_at.slice(0, 10)}` : `预约 ${o.appt_local.slice(0, 10)} ${o.appt_local.slice(11, 16)}` }} · {{ o.category }}<template v-if="o.channel && o.channel !== '直客'"> · {{ o.channel }}</template></div>
            <div class="chiprow">
              <span class="chip c-blue">{{ workStage(o as never) }}</span>
              <span class="chip" :class="isOver(o) ? 'c-red' : 'c-gray'">{{ isOver(o) ? '已逾期' : payStage(o as never, o.payments ?? []) }}</span>
              <span v-if="isOver(o)" class="chip c-red">欠 {{ overdueOf(o) }} 天</span>
              <span v-if="o.dirty" class="chip c-orange">待同步</span>
              <span v-if="o.status === 'cancelled'" class="chip c-red">已取消</span>
              <span v-if="o.status === 'archived'" class="chip c-gray">已归档</span>
              <span v-if="o.remind_at" class="chip c-gray">已设提醒</span>
            </div>
          </div>
          <div class="rside">
            <div class="rprice">{{ money(o.price_cents) }}</div>
            <div class="rsub" :style="owedOf(o) > 0 ? 'color:var(--red);font-weight:700' : ''">
              {{ owedOf(o) > 0 ? `待收 ${money(owedOf(o))}` : '已结清' }}
            </div>
          </div>
        </div>
      </template>
      <div v-else class="empty"><div class="e-ic">🔍</div>没有符合条件的订单</div>
    </div>
  </div>
</template>
