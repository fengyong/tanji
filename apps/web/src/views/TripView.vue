<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { work, refreshOrders } from '../lib/session';
import { workStage, payStage, dueCents, formatMoney, todayISO, dayBadge, type PaymentEntry } from '@tanji/domain';

const props = defineProps<{ privacy: boolean }>();
const emit = defineEmits<{ openDetail: [id: string]; newOrder: [] }>();

const tz = computed(() => (work.settings.timezone as string) || 'Asia/Shanghai');
const today = todayISO(tz.value);
const selDay = ref(today);
const viewMon = ref({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });

const rows = computed(() => work.orders as unknown as Row[]);
interface Row { id: string; store: string; appt_local: string; price_cents: number; status: string; payments: PaymentEntry[]; dirty: number; category: string; channel: string; shot_at: string | null; deposit_cents: number; settle_via: string }

const monthOrders = computed(() =>
  rows.value.filter((o) => {
    const local = o.appt_local ?? '';
    return Number(local.slice(0, 4)) === viewMon.value.y && Number(local.slice(5, 7)) === viewMon.value.m;
  }));

const byDay = computed(() => {
  const map: Record<string, { n: number; s: number }> = {};
  for (const o of monthOrders.value) {
    const k = o.appt_local.slice(0, 10);
    map[k] ??= { n: 0, s: 0 };
    map[k].n++;
    map[k].s += o.price_cents;
  }
  return map;
});

const cells = computed(() => {
  const { y, m } = viewMon.value;
  const first = new Date(y, m - 1, 1);
  const off = (first.getDay() + 6) % 7;
  const dim = new Date(y, m, 0).getDate();
  const arr: (null | { iso: string; d: number })[] = [];
  for (let i = 0; i < off; i++) arr.push(null);
  for (let d = 1; d <= dim; d++) arr.push({ iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, d });
  return arr;
});

const dayList = computed(() =>
  rows.value.filter((o) => o.appt_local?.slice(0, 10) === selDay.value && o.status !== 'deleted')
    .sort((a, b) => a.appt_local.localeCompare(b.appt_local)));

const timeline = computed(() => {
  const days = [...new Set(monthOrders.value.filter((o) => o.status !== 'deleted').map((o) => o.appt_local.slice(0, 10)))].sort();
  return days.map((iso) => ({
    iso,
    orders: monthOrders.value.filter((o) => o.appt_local.slice(0, 10) === iso && o.status !== 'deleted')
      .sort((a, b) => a.appt_local.localeCompare(b.appt_local)),
  }));
});

const badgeFor = (iso: string) => dayBadge(byDay.value[iso]?.n ?? 0, byDay.value[iso]?.s ?? 0);
const monthBadgeText = computed(() => {
  let fire = 0; let money = 0;
  for (const iso of Object.keys(byDay.value)) {
    const b = badgeFor(iso);
    if (b?.e === '🔥') fire++;
    if (b?.e === '💰') money++;
  }
  return (fire ? ` 🔥${fire}` : '') + (money ? ` 💰${money}` : '');
});

function shiftMonth(d: number) {
  let { y, m } = viewMon.value;
  m += d;
  if (m > 12) { m = 1; y++; }
  if (m < 1) { m = 12; y--; }
  viewMon.value = { y, m };
}
async function gotoDay(iso: string) {
  selDay.value = iso;
  await refreshOrders({ month: iso.slice(0, 7) });
}
watch(() => viewMon.value, async ({ y, m }) => {
  await refreshOrders({ month: `${y}-${String(m).padStart(2, '0')}` });
}, { deep: true });

const money = (c: number) => (props.privacy ? '¥**' : formatMoney(c));
function payLabel(o: Row) {
  const s = payStage(o as never, o.payments ?? []);
  const threshold = Number(work.settings.collect_threshold_days ?? 15);
  const over = s === '待尾款' && o.settle_via !== 'douyin' && o.shot_at &&
    (Date.now() - Date.parse(o.shot_at)) / 86400000 >= threshold;
  return over ? '已逾期' : s;
}
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div>
        <div class="eyebrow">整月档期 · ‹ › 可翻月</div>
        <h1 class="big">行程</h1>
        <div class="hsub">点按日期查看当日</div>
      </div>
      <button class="btn-pill" @click="emit('new-order')">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>预约
      </button>
    </div>

    <div class="mgrid" style="margin-top:12px">
      <div class="mhead">
        <div class="mtitle">{{ viewMon.y }}年{{ viewMon.m }}月<span class="msum">{{ monthOrders.length }} 个档期 · {{ money(monthOrders.reduce((s, o) => s + o.price_cents, 0)) }}{{ monthBadgeText }}</span></div>
        <div class="mnav">
          <button @click="shiftMonth(-1)">‹</button>
          <button style="width:auto;padding:0 10px;font-size:12px;font-weight:700" @click="viewMon = { y: Number(today.slice(0,4)), m: Number(today.slice(5,7)) }; selDay = today">今天</button>
          <button @click="shiftMonth(1)">›</button>
        </div>
      </div>
      <div class="mgrid-dow"><span v-for="d in '一二三四五六日'.split('')" :key="d">周{{ d }}</span></div>
      <div class="mgrid-c">
        <div v-for="(c, i) in cells" :key="i" style="aspect-ratio:1" />
        <template v-for="c in cells" :key="c?.iso">
          <button v-if="c" class="mc" :class="{ sel: c.iso === selDay, today: c.iso === today }" @click="gotoDay(c.iso)">
            <span>{{ c.d }}</span>
            <span class="d"><i v-for="n in Math.min(byDay[c.iso]?.n ?? 0, 6)" :key="n" /></span>
            <span v-if="badgeFor(c.iso)" class="bdg">{{ badgeFor(c.iso)!.e }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="sec-title">{{ selDay === today ? '今日行程' : `${Number(selDay.slice(5, 7))}月${Number(selDay.slice(8, 10))}日` }}{{ badgeFor(selDay) ? ` · ${badgeFor(selDay)!.e} ${badgeFor(selDay)!.t}` : '' }}</div>
    <div class="card rows">
      <template v-if="dayList.length">
        <div v-for="o in dayList" :key="o.id" class="row" @click="emit('openDetail', o.id)">
          <div class="rside" style="width:52px">
            <div class="rprice" style="color:var(--brand)">{{ o.appt_local.slice(11, 16) }}</div>
            <div class="rsub">{{ o.category }}</div>
          </div>
          <div class="rmain">
            <div class="rname">{{ o.store }}</div>
            <div class="chiprow">
              <span class="chip c-blue">{{ workStage(o as never) }}</span>
              <span class="chip c-orange" v-if="payLabel(o) === '已逾期'">已逾期</span>
              <span class="chip c-gray" v-else>{{ payStage(o as never, o.payments ?? []) }}</span>
              <span v-if="o.dirty" class="chip c-orange">待同步</span>
              <span v-if="o.status === 'cancelled'" class="chip c-red">已取消</span>
            </div>
          </div>
          <div class="rside">
            <div class="rprice">{{ money(o.price_cents) }}</div>
            <div class="rsub">{{ dueCents(o as never, o.payments ?? [], 'deposit') + dueCents(o as never, o.payments ?? [], 'final') > 0 ? '待收款' : '已结清' }}</div>
          </div>
        </div>
      </template>
      <div v-else class="empty"><div class="e-ic">📭</div>这一天暂无拍摄安排</div>
    </div>

    <div class="sec-title">{{ viewMon.m }}月全部档期 · 往下滚看整月</div>
    <template v-if="timeline.length">
      <div v-for="g in timeline" :key="g.iso">
        <div class="sec-title">{{ Number(g.iso.slice(5, 7)) }}月{{ Number(g.iso.slice(8, 10)) }}日{{ g.iso === today ? ' · 今天' : '' }}</div>
        <div class="card rows">
          <div v-for="o in g.orders" :key="o.id" class="row" @click="emit('openDetail', o.id)">
            <div class="rside" style="width:52px">
              <div class="rprice" style="color:var(--brand)">{{ o.appt_local.slice(11, 16) }}</div>
              <div class="rsub">{{ o.category }}</div>
            </div>
            <div class="rmain">
              <div class="rname">{{ o.store }}</div>
              <div class="chiprow">
                <span class="chip c-blue">{{ workStage(o as never) }}</span>
                <span class="chip c-gray">{{ payStage(o as never, o.payments ?? []) }}</span>
                <span v-if="o.dirty" class="chip c-orange">待同步</span>
              </div>
            </div>
            <div class="rside"><div class="rprice">{{ money(o.price_cents) }}</div></div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty">{{ viewMon.m }}月暂无档期 · 点右上角「预约」新增</div>
  </div>
</template>
