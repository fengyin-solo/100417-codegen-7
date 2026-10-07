<template>
  <section class="page" data-module="fueling">
    <header class="page-head">
      <div>
        <h2>航空加油管理</h2>
        <p class="page-desc">
          维护加油记录，围绕加油编号、关联航班、燃油型号、加油量、加油车号做登记、筛选与状态流转；
          复核队列支持排序、分页与差异记录定位。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记加油记录</button>
        <button class="btn" type="button" @click="exportRows">导出航空加油清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-warn': item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 记录状态与过滤条件同源：状态清单全部来自 fueling 模块元数据 -->
    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-diff">差异记录：{{ stats.diff }}</span>
    </p>

    <div class="tab-bar" role="tablist">
      <button
        type="button"
        class="tab-btn"
        :class="{ active: scope === 'all' }"
        @click="switchScope('all')"
      >
        全部记录
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: scope === 'review' }"
        @click="switchScope('review')"
      >
        复核队列<span v-if="stats.pendingReview" class="tab-badge">{{ stats.pendingReview }}</span>
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="submitQuery">
      <label v-for="field in textFilterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filtersDraft[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>记录状态</span>
        <select v-model="filtersDraft.status">
          <option v-for="option in statusOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="filter-item filter-check">
        <input v-model="diffOnly" type="checkbox" />
        <span>仅看差异记录</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="locateDiff()">定位下一差异</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="adjustedNotice" class="page-notice">{{ adjustedNotice }}</p>

    <table class="data-table fueling-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column"
            :class="{ sortable: sortableFields.includes(column), 'sorted-on': order.field === column }"
            @click="toggleSort(column)"
          >
            {{ column }}
            <span v-if="order.field === column" class="sort-arrow">
              {{ order.direction === 'asc' ? '▲' : '▼' }}
            </span>
          </th>
          <th>差异</th>
          <th>当前状态</th>
          <th>复核结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :id="`fueling-row-${row.id}`"
          :key="String(row.id)"
          :class="{ 'row-highlight': highlightId === Number(row.id), 'row-diff': isDiff(row) }"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span v-if="isDiff(row)" class="diff-badge">差异</span>
            <span v-else>—</span>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="abnormal-flag">（异常）</span>
          </td>
          <td>{{ row['复核结论'] ?? '—' }}</td>
          <td class="row-actions">
            <template v-if="scope === 'all'">
              <button
                v-for="action in regularActions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <template v-else>
              <button v-if="canReview(row)" class="link" type="button" @click="openReview(row)">
                复核记录
              </button>
              <span v-else-if="row['复核结论']" class="locked-text">
                已留首个结论：{{ row['复核结论'] }}
              </span>
              <span v-else class="muted-text">待完成加油</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">
            <div class="empty-title">{{ emptyReason.title }}</div>
            <div class="empty-detail">{{ emptyReason.detail }}</div>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pagination-bar">
      <span>共 {{ total }} 条记录，第 {{ page }} / {{ totalPages }} 页</span>
      <span class="pager-controls">
        <label>
          每页
          <select v-model.number="size" @change="changePageSize">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
          </select>
          条
        </label>
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button
          class="btn"
          type="button"
          :disabled="page >= totalPages"
          @click="goPage(page + 1)"
        >
          下一页
        </button>
        <label>
          跳至
          <input v-model.number="jumpPage" class="page-jump" type="number" min="1" @keyup.enter="jumpToPage" />
          页
        </label>
        <button class="btn ghost" type="button" @click="jumpToPage">跳转</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 复核结论弹窗：并发复核由服务层判定，只留首个结论 -->
    <div v-if="reviewTarget" class="modal-mask" @click.self="closeReview">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="加油记录复核">
        <h3 class="modal-title">复核 {{ reviewTarget['加油编号'] }}</h3>
        <dl class="review-meta">
          <div><dt>关联航班</dt><dd>{{ reviewTarget['关联航班'] }}</dd></div>
          <div><dt>燃油型号</dt><dd>{{ reviewTarget['燃油型号'] }}</dd></div>
          <div><dt>加油量</dt><dd>{{ reviewTarget['加油量'] }}</dd></div>
          <div><dt>加油车号</dt><dd>{{ reviewTarget['加油车号'] }}</dd></div>
        </dl>
        <label class="filter-item">
          <span>复核结论</span>
          <select v-model="reviewConclusion">
            <option v-for="item in reviewConclusions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>复核说明</span>
          <textarea
            v-model="reviewNote"
            rows="3"
            placeholder="请填写泵码、油量或状态差异等复核说明"
          ></textarea>
        </label>
        <p class="review-operator">复核人：{{ store.operator }}（提交后只保留首个结论）</p>
        <p v-if="reviewError" class="error-text">{{ reviewError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeReview">取消</button>
          <button class="btn primary" type="button" @click="submitReview">提交结论</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  downloadEntries,
  emptyFuelingFilters,
  fuelingStatusOptions,
  fuelingStatusSummary,
  fuelingStats,
  isFuelingDiff,
  listFuelingEntries,
  listFuelingConfirmTodos,
  locateNextFuelingDiff,
  moduleMeta,
  reviewFuelingEntry,
  runAction as applyAction,
} from '@/api/local-service'
import { FUELING_REVIEW_CONCLUSIONS } from '@/data/types'
import type {
  EntryRow,
  FuelingConclusion,
  FuelingFilters,
  FuelingOrder,
  FuelingScope,
  FuelingStatusStat,
  FuelingStats,
} from '@/data/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()
const meta = moduleMeta('fueling')

// 列、检索字段、状态全部从元数据派生：过滤条件与记录状态同源
const columns = meta.fields
const textFilterFields = meta.fields.slice(0, 5)
const sortableFields = meta.fields.slice(0, 5)
const regularActions = meta.actions.filter((action) => action !== '复核记录')
const reviewConclusions = FUELING_REVIEW_CONCLUSIONS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const size = ref(5)
const scope = ref<FuelingScope>('all')
const order = ref<FuelingOrder>({ field: textFilterFields[0], direction: 'asc' })
const stats = ref<FuelingStats>({
  waiting: 0,
  fueling: 0,
  completed: 0,
  reviewed: 0,
  pendingReview: 0,
  diff: 0,
})
const statusSummary = ref<FuelingStatusStat[]>([])
const errorMessage = ref('')
const adjustedNotice = ref('')
const highlightId = ref<number | null>(null)
const jumpPage = ref<number | null>(null)

// 条件在点「查询」前只是草稿；查无结果时草稿原样保留在表单里
const filtersDraft = ref<Record<string, string>>({})
const diffOnly = ref(false)

const reviewTarget = ref<EntryRow | null>(null)
const reviewConclusion = ref<FuelingConclusion>('复核通过')
const reviewNote = ref('')
const reviewError = ref('')

const statusOptions = computed(() => fuelingStatusOptions(scope.value))

const statCards = computed(() => [
  { label: '待加油航班', value: stats.value.waiting, warn: false },
  { label: '加油中航班', value: stats.value.fueling, warn: false },
  { label: '待复核记录', value: stats.value.pendingReview, warn: stats.value.pendingReview > 0 },
  { label: '已复核记录', value: stats.value.reviewed, warn: false },
  { label: '差异记录', value: stats.value.diff, warn: stats.value.diff > 0 },
])

function buildFilters(): FuelingFilters {
  return {
    ...emptyFuelingFilters(),
    加油编号: filtersDraft.value['加油编号'] ?? '',
    关联航班: filtersDraft.value['关联航班'] ?? '',
    燃油型号: filtersDraft.value['燃油型号'] ?? '',
    加油量: filtersDraft.value['加油量'] ?? '',
    加油车号: filtersDraft.value['加油车号'] ?? '',
    status: filtersDraft.value['status'] ?? '全部状态',
    diffOnly: diffOnly.value,
  }
}

function refreshStats() {
  stats.value = fuelingStats()
  statusSummary.value = fuelingStatusSummary()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listFuelingEntries({
      scope: scope.value,
      filters: buildFilters(),
      order: order.value,
      page: page.value,
      size: size.value,
    })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    totalPages.value = payload.totalPages
    if (payload.adjustedFromPage !== null) {
      adjustedNotice.value = `第 ${payload.adjustedFromPage} 页已超出范围（共 ${payload.totalPages} 页），已回到最后一页`
    } else {
      adjustedNotice.value = ''
    }
    refreshStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '航空加油列表读取失败'
  }
}

function submitQuery() {
  page.value = 1
  reload()
}

function resetFilters() {
  filtersDraft.value = {}
  diffOnly.value = false
  page.value = 1
  reload()
}

function switchScope(next: FuelingScope) {
  if (scope.value === next) {
    return
  }
  scope.value = next
  // 切换入口后，状态下拉只能选同源状态；越界的旧选项回到「全部状态」
  if (!statusOptions.value.includes(filtersDraft.value['status'] ?? '全部状态')) {
    filtersDraft.value = { ...filtersDraft.value, status: '全部状态' }
  }
  page.value = 1
  reload()
}

function toggleSort(field: string) {
  if (!sortableFields.includes(field)) {
    return
  }
  if (order.value.field === field) {
    order.value = { field, direction: order.value.direction === 'asc' ? 'desc' : 'asc' }
  } else {
    order.value = { field, direction: 'asc' }
  }
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function changePageSize() {
  page.value = 1
  reload()
}

function jumpToPage() {
  if (!jumpPage.value || jumpPage.value < 1) {
    errorMessage.value = '请输入要跳转的页码'
    return
  }
  page.value = jumpPage.value
  jumpPage.value = null
  reload()
}

function isDiff(row: EntryRow): boolean {
  return isFuelingDiff(row)
}

function canReview(row: EntryRow): boolean {
  return String(row.status) === meta.statuses[2] && !row['复核结论']
}

function scrollToRow(id: number) {
  highlightId.value = id
  void nextTick(() => {
    document
      .getElementById(`fueling-row-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  window.setTimeout(() => {
    if (highlightId.value === id) {
      highlightId.value = null
    }
  }, 4000)
}

// 定位差异记录：在当前筛选+排序下循环跳到下一条差异所在页并高亮
function locateDiff() {
  const fromId = highlightId.value
  const found = locateNextFuelingDiff(
    { scope: scope.value, filters: buildFilters(), order: order.value, size: size.value },
    fromId,
  )
  if (!found) {
    errorMessage.value = '当前筛选条件下没有差异记录，可重置条件后再定位'
    return
  }
  page.value = found.page
  size.value = found.size
  reload()
  scrollToRow(found.id)
}

const emptyReason = computed<{ title: string; detail: string }>(() => {
  const applied: string[] = []
  for (const field of textFilterFields) {
    const value = (filtersDraft.value[field] ?? '').trim()
    if (value) {
      applied.push(`${field} 含「${value}」`)
    }
  }
  if ((filtersDraft.value['status'] ?? '全部状态') !== '全部状态') {
    applied.push(`记录状态为「${filtersDraft.value['status']}」`)
  }
  if (diffOnly.value) {
    applied.push('仅看差异记录')
  }

  if (total.value === 0 && listFuelingConfirmTodos().length === 0 && applied.length === 0 && scope.value === 'review') {
    return {
      title: '复核队列为空',
      detail: '当前没有处于「已完成/已复核」的加油记录，待完成加油后才会进入复核队列',
    }
  }
  if (applied.length === 0) {
    return { title: '暂无航空加油数据', detail: '可先登记加油记录' }
  }
  return {
    title: '没有符合条件的加油记录',
    detail: `已保留当前筛选条件：${applied.join('、')}。请放宽关键字或检查记录状态后重试`,
  }
})

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '加油记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openReview(row: EntryRow) {
  reviewTarget.value = row
  reviewConclusion.value = '复核通过'
  reviewNote.value = ''
  reviewError.value = ''
}

function closeReview() {
  reviewTarget.value = null
}

function submitReview() {
  if (!reviewTarget.value) {
    return
  }
  const result = reviewFuelingEntry({
    id: Number(reviewTarget.value.id),
    conclusion: reviewConclusion.value,
    note: reviewNote.value,
    operator: store.operator,
  })
  if (!result.ok) {
    reviewError.value = result.message
    // 可能是另一路复核抢先落了首个结论，刷新列表把锁状态带出来
    reload()
    return
  }
  reviewTarget.value = null
  reload()
}

onMounted(() => {
  // 其它入口（机坪安全的燃油确认待办）带 tab/focus 参数直达复核队列并定位记录
  if (route.query.tab === 'review') {
    scope.value = 'review'
  }
  reload()
  if (scope.value === 'review' && route.query.focus) {
    const focusIdValue = Number(route.query.focus)
    const overview = listFuelingEntries({
      scope: 'review',
      order: order.value,
      page: 1,
      size: Number.MAX_SAFE_INTEGER,
    })
    const index = overview.items.findIndex((row) => Number(row.id) === focusIdValue)
    if (index >= 0) {
      page.value = Math.floor(index / size.value) + 1
      reload()
      scrollToRow(focusIdValue)
    } else {
      errorMessage.value = `加油记录 ${focusIdValue} 不在复核队列中`
    }
  }
})
</script>
