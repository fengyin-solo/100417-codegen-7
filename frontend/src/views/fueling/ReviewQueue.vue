<template>
  <section class="review-queue">
    <header class="queue-head">
      <div>
        <h3 v-if="!embedded">加油复核队列</h3>
        <h3 v-else>燃油确认待办</h3>
        <p class="page-desc">
          <template v-if="!embedded">
            按加油编号、关联航班、燃油型号、加油量、加油车号检索，记录状态与筛选选项同源，可排序、分页并定位差异记录。
          </template>
          <template v-else>
            机坪安全检查同步的燃油确认待办，数据与航空加油模块同源，可直接在此完成确认。
          </template>
        </p>
      </div>
      <button class="btn" type="button" @click="locateDiff">定位差异记录</button>
    </header>

    <form class="filter-bar" @submit.prevent="search">
      <label v-for="field in searchFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model.trim="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>记录状态</span>
        <select v-model="status">
          <option v-for="item in statusOptions" :key="item" :value="item">
            {{ item === '全部' ? '全部状态' : item }}
          </option>
        </select>
      </label>
      <label class="filter-check">
        <input v-model="onlyDiff" type="checkbox" />
        仅看差异
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetAll">重置条件</button>
    </form>

    <p class="status-legend">
      <span class="legend-item">当前结果 {{ result?.total ?? 0 }} 条</span>
      <span class="legend-item">差异记录 {{ result?.diffCount ?? 0 }} 条</span>
      <span v-if="activeConditions.length" class="legend-item">
        已选条件：
        <template v-for="(item, index) in activeConditions" :key="item.label">
          {{ item.label }}={{ item.value }}<span v-if="index < activeConditions.length - 1">、</span>
        </template>
      </span>
    </p>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="field in sortableFields" :key="field" class="sortable-cell" @click="toggleSort(field)">
              {{ field }}
              <span class="sort-mark">{{ sortMark(field) }}</span>
            </th>
            <th>差异说明</th>
            <th>复核状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in result?.items ?? []"
            :key="String(row.id)"
            :class="{ 'diff-row': isFuelingDiff(row), 'flash-row': Number(row.id) === flashId }"
          >
            <td v-for="field in sortableFields" :key="field">{{ row[field] ?? '—' }}</td>
            <td>
              <span v-if="isFuelingDiff(row)" class="diff-tag">差异</span>
              {{ row['差异说明'] || '—' }}
            </td>
            <td>{{ reviewState(row) }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openReview(row)">
                {{ row['复核结论'] ? '查看复核结论' : '复核确认' }}
              </button>
            </td>
          </tr>
          <tr v-if="!(result?.items.length)">
            <td :colspan="sortableFields.length + 3" class="empty-state">
              {{ result?.emptyReason || '暂无待复核加油记录' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="pager-bar">
      <span class="pager-info">
        第 {{ result?.page ?? 1 }} / {{ result?.totalPages ?? 1 }} 页，
        共 {{ result?.total ?? 0 }} 条
        <span v-if="result?.pageClamped" class="error-text">
          请求的第 {{ result.requestedPage }} 页已越界，已回到最后一页（第 {{ result.page }} 页）
        </span>
      </span>
      <span class="pager-actions">
        <button class="btn" type="button" :disabled="(result?.page ?? 1) <= 1" @click="goPage((result?.page ?? 1) - 1)">
          上一页
        </button>
        <button
          class="btn"
          type="button"
          :disabled="(result?.page ?? 1) >= (result?.totalPages ?? 1)"
          @click="goPage((result?.page ?? 1) + 1)"
        >
          下一页
        </button>
        <label class="jump-item">
          跳至
          <input
            :value="jumpPage"
            class="page-input"
            type="number"
            min="1"
            @input="jumpPage = ($event.target as HTMLInputElement).value"
          />
          页
        </label>
        <button class="btn" type="button" @click="jump">跳转</button>
      </span>
    </footer>

    <p v-if="noticeMessage" class="error-text">{{ noticeMessage }}</p>

    <ReviewDialog :row="activeRow" @close="activeRow = null" @done="handleReviewed" />
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { FUELING_KEY, FUELING_REVIEW_SIZE, isFuelingDiff, listReviewQueue, moduleMeta } from '@/api/local-service'
import type { EntryRow, ReviewOrder, ReviewPageResult, ReviewSortField } from '@/data/types'
import { REVIEW_SORT_FIELDS } from '@/data/types'
import ReviewDialog from './ReviewDialog.vue'

const props = defineProps<{
  embedded?: boolean
  defaultStatus?: string
}>()

const searchFields = [...REVIEW_SORT_FIELDS]
const sortableFields = [...REVIEW_SORT_FIELDS]
// 状态选项与加油记录状态同源（模块元数据），另加一个「全部」。
const statusOptions = ['全部', ...moduleMeta(FUELING_KEY).statuses]

const filters = reactive<Record<string, string>>({
  加油编号: '',
  关联航班: '',
  燃油型号: '',
  加油量: '',
  加油车号: '',
})
const status = ref(props.defaultStatus ?? '已完成')
const onlyDiff = ref(false)
const sortField = ref<ReviewSortField>('加油编号')
const order = ref<ReviewOrder>('asc')
const currentPage = ref(1)
const jumpPage = ref('1')
const result = ref<ReviewPageResult | null>(null)
const activeRow = ref<EntryRow | null>(null)
const flashId = ref<number | null>(null)
const noticeMessage = ref('')
let flashTimer: ReturnType<typeof setTimeout> | undefined

const activeConditions = ref<{ label: string; value: string }[]>([])

function reload(requestedPage = currentPage.value) {
  noticeMessage.value = ''
  try {
    const payload = listReviewQueue({
      filters: { ...filters },
      status: status.value,
      onlyDiff: onlyDiff.value,
      sortField: sortField.value,
      order: order.value,
      page: requestedPage,
      size: FUELING_REVIEW_SIZE,
    })
    result.value = payload
    currentPage.value = payload.page
    jumpPage.value = String(payload.page)
    activeConditions.value = payload.conditions
    if (payload.pageClamped) {
      noticeMessage.value = `第 ${payload.requestedPage} 页超出范围，已为你定位到最后一页（第 ${payload.page} 页）`
    }
  } catch (error) {
    noticeMessage.value = error instanceof Error ? error.message : '复核队列读取失败'
  }
}

function search() {
  // 查询后回到第一页；筛选条件全部保留。
  reload(1)
}

function resetAll() {
  for (const field of searchFields) {
    filters[field] = ''
  }
  status.value = props.defaultStatus ?? '已完成'
  onlyDiff.value = false
  sortField.value = '加油编号'
  order.value = 'asc'
  reload(1)
}

function toggleSort(field: ReviewSortField) {
  if (sortField.value === field) {
    order.value = order.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    order.value = 'asc'
  }
  reload(1)
}

function sortMark(field: ReviewSortField): string {
  if (sortField.value !== field) {
    return '↕'
  }
  return order.value === 'asc' ? '↑' : '↓'
}

function goPage(page: number) {
  reload(page)
}

function jump() {
  const target = Number.parseInt(jumpPage.value, 10)
  if (!Number.isFinite(target) || target < 1) {
    noticeMessage.value = '请输入不小于 1 的页码'
    return
  }
  // 越界不报错丢条件，由数据层钳到最后一页并给出说明。
  reload(target)
}

// 定位差异记录：在当前过滤、排序结果里找第一条差异，跳到它所在页并高亮。
function locateDiff() {
  const payload = listReviewQueue({
    filters: { ...filters },
    status: status.value,
    onlyDiff: false,
    sortField: sortField.value,
    order: order.value,
    page: 1,
    size: Math.max(FUELING_REVIEW_SIZE, (result.value?.total ?? 0)),
  })
  const firstDiff = payload.items.find((row) => isFuelingDiff(row))
  if (!firstDiff) {
    noticeMessage.value =
      payload.total === 0
        ? payload.emptyReason
        : '当前过滤条件下没有差异记录，筛选条件已保留；可放开「仅看差异」或调整检索条件'
    onlyDiff.value = false
    reload(currentPage.value)
    return
  }
  const diffIndex = payload.items.findIndex((row) => Number(row.id) === Number(firstDiff.id))
  const targetPage = Math.floor(diffIndex / FUELING_REVIEW_SIZE) + 1
  flashId.value = Number(firstDiff.id)
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashId.value = null
  }, 2600)
  reload(targetPage)
}

function openReview(row: EntryRow) {
  activeRow.value = row
}

function reviewState(row: EntryRow): string {
  return String(row['复核结论'] ?? '') !== '' ? `已复核·${row['复核结论']}` : String(row.status)
}

function handleReviewed() {
  activeRow.value = null
  reload(currentPage.value)
}

// 多个标签页/其它入口操作了同一份加油数据时，当前队列即时同步。
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key.includes('airport-ground-handling')) {
    reload(currentPage.value)
  }
}

onMounted(() => {
  reload(1)
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => {
  clearTimeout(flashTimer)
  window.removeEventListener('storage', onStorage)
})
</script>
