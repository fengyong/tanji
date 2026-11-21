<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getLedger, getApi, toast } from '../lib/session';
import { toZonedLocalInput } from '@tanji/domain';

// 共享给我的档期:只展示白名单字段;接收者不能编辑源档期(只读)。
const shared = ref<Record<string, unknown>[]>([]);
const filter = ref<'all' | 'today' | 'tomorrow' | 'upcoming'>('all');
const tz = ref('Asia/Shanghai');

onMounted(async () => {
  const l = getLedger();
  shared.value = (await l.call('listShared')) as Record<string, unknown>[];
  // 服务端兜底(事件丢失时恢复)
  try {
    const r = await getApi().sharedList();
    for (const s of r.shares) {
      await l.call('applyPullPage', {
        events: [{ seq: '', event_type: 'share.granted', share_id: s.projection.share_id, generation: s.projection.generation, payload: s.projection }],
        cursor: '', highWater: '', epoch: 0,
      }).catch(() => {});
    }
    shared.value = (await l.call('listShared')) as Record<string, unknown>[];
  } catch { /* 离线:仅本地缓存 */ }
});

const list = computed(() => {
  const now = new Date();
  const todayStr = toZonedLocalInput(now.toISOString(), tz.value).slice(0, 10);
  const tomorrowStr = toZonedLocalInput(new Date(now.getTime() + 86400000).toISOString(), tz.value).slice(0, 10);
  let arr = [...shared.value];
  if (filter.value === 'today') arr = arr.filter((s) => (s.starts_at as string).slice(0, 10) === todayStr.slice(0, 10));
  if (filter.value === 'tomorrow') arr = arr.filter((s) => toZonedLocalInput(s.starts_at as string, tz.value).slice(0, 10) === tomorrowStr);
  if (filter.value === 'upcoming') arr = arr.filter((s) => (s.starts_at as string) >= new Date().toISOString());
  return arr.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
});

const filters: [typeof filter.value, string][] = [['all', '全部'], ['today', '今日'], ['tomorrow', '明日'], ['upcoming', '未开始的']];

function local(iso: string): string {
  return toZonedLocalInput(iso, tz.value);
}
</script>

<template>
  <div class="view">
    <div class="htop-row">
      <div>
        <div class="eyebrow">只读 · 不含金额/流水/联系方式等明细</div>
        <h1 class="big">共享给我的</h1>
        <div class="hsub">与自己的订单明确区分;撤销后缓存将在联网时清除</div>
      </div>
    </div>
    <div class="chips">
      <button v-for="[k, l] in filters" :key="k" class="fchip" :class="{ on: filter === k }" @click="filter = k">{{ l }}</button>
    </div>
    <div class="card rows">
      <template v-if="list.length">
        <div v-for="s in list" :key="String(s.share_id) + String(s.generation)" class="row" style="cursor:default">
          <div class="rside" style="width:52px">
            <div class="rprice" style="color:var(--brand)">{{ local(String(s.starts_at)).slice(11, 16) }}</div>
            <div class="rsub">{{ local(String(s.starts_at)).slice(5, 10) }}</div>
          </div>
          <div class="rmain">
            <div class="rname">{{ s.store }}</div>
            <div class="rsub">来自 {{ s.owner_display }} · 时区 {{ s.timezone }}<template v-if="s.address"> · {{ s.address }}</template></div>
            <div class="chiprow">
              <span v-if="s.schedule_status === 'cancelled'" class="chip c-red">已取消</span>
              <span class="chip c-gray">同步于 {{ String(s.synced_at).slice(5, 16).replace('T', ' ') }}</span>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="empty"><div class="e-ic">📭</div>暂无共享档期</div>
    </div>
    <div class="rsub" style="padding:12px 4px;line-height:1.7">
      这里只显示发布者明确授权的白名单信息:店名、时间、地址等。金额、收款、备注、联系人都不会出现在接口、缓存或通知里。
    </div>
  </div>
</template>
