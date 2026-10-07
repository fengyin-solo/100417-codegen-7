import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FuelingConclusion,
  FuelingFilters,
  FuelingOrder,
  FuelingPageResult,
  FuelingQuery,
  FuelingReviewInput,
  FuelingStats,
  FuelingStatusStat,
  FuelingTodo,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// —— 航空加油复核队列：本模块新增的复核队列能力集中在这里，页面只负责渲染 ——

const FUELING_KEY = 'fueling'

// 加油量等文本数值排序时，截取串内第一段数字做数值序，保证 10 不会排到 2 前面
const NUMERIC_RUN = /\d+(?:\.\d+)?/

// 复核队列默认按编号正序，翻页/定位时顺序稳定
const DEFAULT_FUELING_ORDER: FuelingOrder = { field: '加油编号', direction: 'asc' }
const DEFAULT_FUELING_PAGE_SIZE = 5

function fuelingMeta(): ModuleMeta {
  return moduleMeta(FUELING_KEY)
}

// 五个检索字段直接取元数据前五项（加油编号、关联航班、燃油型号、加油量、加油车号），不另立清单
function fuelingTextFilterFields(): string[] {
  return fuelingMeta().fields.slice(0, 5)
}

// 复核队列纳入的记录状态：已完成（待复核）与已复核，均取自元数据状态机
function reviewStatusSet(meta: ModuleMeta): Set<string> {
  return new Set(meta.statuses.slice(2))
}

// 过滤条件里的状态选项与记录状态同源：全部状态 + 元数据状态
export function fuelingStatusOptions(scope: FuelingQuery['scope']): string[] {
  const meta = fuelingMeta()
  return ['全部状态', ...(scope === 'review' ? [...reviewStatusSet(meta)] : meta.statuses)]
}

export function emptyFuelingFilters(): FuelingFilters {
  return {
    加油编号: '',
    关联航班: '',
    燃油型号: '',
    加油量: '',
    加油车号: '',
    status: '全部状态',
    diffOnly: false,
  }
}

// 差异记录：异常标记、复核存疑，或「记录状态」文本与流转状态不一致
export function isFuelingDiff(row: EntryRow): boolean {
  if (row.abnormal) {
    return true
  }
  if (String(row['复核结论'] ?? '') === '复核存疑') {
    return true
  }
  const written = String(row['记录状态'] ?? '').trim()
  return Boolean(written) && written !== String(row.status)
}

function createFuelingFilters(partial?: Partial<FuelingFilters>): FuelingFilters {
  return { ...emptyFuelingFilters(), ...partial }
}

function matchesFuelingFilters(row: EntryRow, filters: FuelingFilters): boolean {
  for (const field of fuelingTextFilterFields()) {
    const keyword = String(filters[field as keyof FuelingFilters] ?? '').trim()
    if (keyword && !String(row[field] ?? '').includes(keyword)) {
      return false
    }
  }
  if (filters.status && filters.status !== '全部状态' && String(row.status) !== filters.status) {
    return false
  }
  if (filters.diffOnly && !isFuelingDiff(row)) {
    return false
  }
  return true
}

function compareFuelingValues(a: EntryRow, b: EntryRow, order: FuelingOrder): number {
  const rawA = a[order.field]
  const rawB = b[order.field]
  const textA = String(rawA ?? '')
  const textB = String(rawB ?? '')
  const numA = textA.match(NUMERIC_RUN)
  const numB = textB.match(NUMERIC_RUN)
  let result: number
  if (numA && numB) {
    result = Number(numA[0]) - Number(numB[0]) || textA.localeCompare(textB, 'zh-Hans-CN')
  } else if (numA || numB) {
    result = numA ? -1 : 1
  } else {
    result = textA.localeCompare(textB, 'zh-Hans-CN')
  }
  if (result === 0) {
    result = Number(a.id) - Number(b.id)
  }
  return order.direction === 'desc' ? -result : result
}

// 翻页越界：夹紧到 [1, 最后一页]，并在结果里回报原本请求的页码
function paginateFueling(rows: EntryRow[], page: number, size: number): {
  items: EntryRow[]
  page: number
  totalPages: number
  adjustedFromPage: number | null
} {
  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  let adjustedFromPage: number | null = null
  let target = page
  if (target < 1) {
    adjustedFromPage = target
    target = 1
  } else if (target > totalPages) {
    adjustedFromPage = target
    target = totalPages
  }
  const start = (target - 1) * size
  return {
    items: rows.slice(start, start + size),
    page: target,
    totalPages,
    adjustedFromPage,
  }
}

// 复核队列列表：筛选 → 排序 → 分页；过滤条件与记录状态同源，旧加油量记录仍按原口径包含匹配
export function listFuelingEntries(query: Partial<FuelingQuery>): FuelingPageResult {
  const meta = fuelingMeta()
  const scope = query.scope ?? 'all'
  const filters = createFuelingFilters(query.filters)
  const order: FuelingOrder = query.order ?? DEFAULT_FUELING_ORDER
  const size = query.size && query.size > 0 ? query.size : DEFAULT_FUELING_PAGE_SIZE
  const reviewStatuses = reviewStatusSet(meta)

  const source = listRows(FUELING_KEY).filter(
    (row) => scope === 'all' || reviewStatuses.has(String(row.status)),
  )
  const matched = source.filter((row) => matchesFuelingFilters(row, filters))
  const diffIds = matched.filter(isFuelingDiff).map((row) => Number(row.id))
  const sorted = [...matched].sort((a, b) => compareFuelingValues(a, b, order))
  const { items, page, totalPages, adjustedFromPage } = paginateFueling(
    sorted,
    query.page ?? 1,
    size,
  )

  return {
    items,
    total: matched.length,
    page,
    size,
    scope,
    totalPages,
    adjustedFromPage,
    order,
    diffIds,
  }
}

// 定位差异记录：在当前筛选+排序下，找出 fromId 之后的第一条差异记录及其所在页（循环定位）
export function locateNextFuelingDiff(query: Partial<FuelingQuery>, fromId: number | null): {
  page: number
  size: number
  id: number
} | null {
  const meta = fuelingMeta()
  const scope = query.scope ?? 'review'
  const filters = createFuelingFilters(query.filters)
  const order: FuelingOrder = query.order ?? DEFAULT_FUELING_ORDER
  const size = query.size && query.size > 0 ? query.size : DEFAULT_FUELING_PAGE_SIZE
  const reviewStatuses = reviewStatusSet(meta)

  const sorted = listRows(FUELING_KEY)
    .filter((row) => scope === 'all' || reviewStatuses.has(String(row.status)))
    .filter((row) => matchesFuelingFilters(row, filters))
    .sort((a, b) => compareFuelingValues(a, b, order))
  const diffIds = sorted.filter(isFuelingDiff).map((row) => Number(row.id))
  if (diffIds.length === 0) {
    return null
  }
  let nextId: number
  if (fromId === null) {
    nextId = diffIds[0]
  } else {
    const index = diffIds.findIndex((id) => id > fromId)
    nextId = index >= 0 ? diffIds[index] : diffIds[0]
  }
  const position = sorted.findIndex((row) => Number(row.id) === nextId)
  return { page: Math.floor(position / size) + 1, size, id: nextId }
}

export function fuelingStatusSummary(): FuelingStatusStat[] {
  const meta = fuelingMeta()
  const rows = listRows(FUELING_KEY)
  return meta.statuses.map((status) => ({
    status,
    count: rows.filter((row) => String(row.status) === status).length,
  }))
}

export function fuelingStats(): FuelingStats {
  const meta = fuelingMeta()
  const rows = listRows(FUELING_KEY)
  const countOf = (status: string) => rows.filter((row) => String(row.status) === status).length
  return {
    waiting: countOf(meta.statuses[0]),
    fueling: countOf(meta.statuses[1]),
    completed: countOf(meta.statuses[2]),
    reviewed: countOf(meta.statuses[3]),
    pendingReview: countOf(meta.statuses[2]),
    diff: rows.filter(isFuelingDiff).length,
  }
}

// 机坪安全等其它入口看到的「燃油确认待办」：已完成待复核、还没下过复核结论的记录
export function listFuelingConfirmTodos(): FuelingTodo[] {
  const meta = fuelingMeta()
  const pendingStatus = meta.statuses[2]
  return listRows(FUELING_KEY)
    .filter((row) => String(row.status) === pendingStatus && !row['复核结论'])
    .map((row) => ({
      id: Number(row.id),
      加油编号: String(row['加油编号'] ?? ''),
      关联航班: String(row['关联航班'] ?? ''),
      燃油型号: String(row['燃油型号'] ?? ''),
      加油量: String(row['加油量'] ?? ''),
      加油车号: String(row['加油车号'] ?? ''),
      status: String(row.status),
      abnormal: Boolean(row.abnormal),
      diff: isFuelingDiff(row),
    }))
}

function formatReviewTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// 同一记录并发复核只留首个结论：以「复核结论」字段作为首个结论的落痕，后到的复核直接拒绝
export function reviewFuelingEntry(input: FuelingReviewInput): ActionResult {
  const meta = fuelingMeta()
  const allowed = ['复核通过', '复核存疑'] as FuelingConclusion[]
  if (!allowed.includes(input.conclusion as FuelingConclusion)) {
    return { ok: false, message: '复核结论只能是「复核通过」或「复核存疑」' }
  }
  const note = input.note.trim()
  if (!note) {
    return { ok: false, message: '请先填写复核说明再提交结论' }
  }
  const rows = listRows(FUELING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === input.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${input.id} 的${meta.entity}` }
  }
  const current = rows[index]
  if (current['复核结论']) {
    return {
      ok: false,
      message: `该${meta.entity}已有首个复核结论「${current['复核结论']}」，并发复核只保留首个结论`,
    }
  }
  const pendingStatus = meta.statuses[2]
  if (String(current.status) !== pendingStatus) {
    return {
      ok: false,
      message: `只有「${pendingStatus}」的${meta.entity}才能复核，当前状态「${current.status}」`,
    }
  }

  const confirmed = input.conclusion === '复核通过'
  const targetStatus = confirmed ? meta.statuses[3] : String(current.status)
  const updated: EntryRow = {
    ...current,
    status: targetStatus,
    pending: !confirmed,
    abnormal: confirmed ? false : true,
    复核结论: input.conclusion,
    复核说明: note,
    复核人: input.operator,
    复核时间: formatReviewTime(new Date()),
    // 通过复核时，文本记录状态同步为流转状态；存疑则保留原值，让差异继续暴露
    记录状态: confirmed ? targetStatus : current['记录状态'],
  }
  const next = [...rows]
  next[index] = updated
  saveRows(FUELING_KEY, next)
  return {
    ok: true,
    message: confirmed
      ? `${meta.entity}复核通过，状态更新为「${targetStatus}」`
      : `${meta.entity}复核存疑，已保留首个结论并标记差异`,
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
