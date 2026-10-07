import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  REVIEW_SORT_FIELDS,
  type ActionResult,
  type EntryRow,
  type ModuleMeta,
  type OverviewResult,
  type PageResult,
  type ReviewPageResult,
  type ReviewQuery,
  type ReviewSubmit,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 航空加油的模块键与状态口径：页面、复核队列、机坪待办都从这里取，保证同源。
export const FUELING_KEY = 'fueling'
export const FUELING_REVIEWED_STATUS = '已复核'
export const FUELING_DONE_STATUS = '已完成'
export const FUELING_REVIEW_SIZE = 5

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

// 加油记录是否存在待核对差异：差异说明非空即视为差异记录。
export function isFuelingDiff(row: EntryRow): boolean {
  return String(row['差异说明'] ?? '').trim() !== ''
}

function fieldText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

// 加油量排序口径：能解析成数值的按数值排（旧口径文本无法解析），
// 不能解析的按字符串排；无论升降序，两种口径都不混排且字符串始终沉底。
function compareByField(rows: EntryRow[], field: string, order: 'asc' | 'desc' = 'asc'): EntryRow[] {
  const dir = order === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = fieldText(a, field)
    const right = fieldText(b, field)
    if (field === '加油量') {
      const leftNum = numericAmount(a)
      const rightNum = numericAmount(b)
      if (leftNum !== null && rightNum !== null) {
        return (leftNum - rightNum) * dir
      }
      if (leftNum === null && rightNum === null) {
        return left.localeCompare(right, 'zh-Hans-CN') * dir
      }
      // 旧口径文本无论升降序都沉底，避免与数值记录混排产生歧义
      return leftNum === null ? 1 : -1
    }
    return left.localeCompare(right, 'zh-Hans-CN') * dir
  })
}

// 旧加油量记录仍按原口径查询：这里只在排序场景尝试「整串即数值」，
// 「约 4300 升」「三千七百升」等旧口径文本解析不出来，按字符串排序，不与数值混排。
function numericAmount(row: EntryRow): number | null {
  const raw = fieldText(row, '加油量')
  if (raw === '') {
    return null
  }
  const compact = raw.replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(compact)) {
    return null
  }
  return Number(compact)
}

function formatNow(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 复核队列：检索字段、状态选项都来自模块元数据（过滤条件与记录状态同源），
// 支持排序、分页（越界回到最后一页）与差异记录定位。
export function listReviewQueue(query: ReviewQuery = {}): ReviewPageResult {
  const meta = moduleMeta(FUELING_KEY)
  const rawFilters = query.filters ?? {}
  // 检索只认加油编号、关联航班、燃油型号、加油量、加油车号五个字段，与页面一一对应。
  const filters: Record<string, string> = {}
  for (const field of REVIEW_SORT_FIELDS) {
    const value = (rawFilters[field] ?? '').trim()
    if (value !== '') {
      filters[field] = value
    }
  }

  let matched = filterRows(listRows(FUELING_KEY), filters)

  // 状态过滤：选项来自 meta.statuses，不写死；不传或「全部」时不限状态。
  const status = (query.status ?? '').trim()
  if (status !== '' && status !== '全部') {
    if (!meta.statuses.includes(status)) {
      throw new Error(`「${status}」不是有效的加油记录状态`)
    }
    matched = matched.filter((row) => String(row.status) === status)
  }
  if (query.onlyDiff) {
    matched = matched.filter((row) => isFuelingDiff(row))
  }

  const sortField = query.sortField ?? '加油编号'
  const order = query.order ?? 'asc'
  if (!REVIEW_SORT_FIELDS.includes(sortField)) {
    throw new Error(`复核队列暂不支持按「${sortField}」排序`)
  }
  matched = compareByField(matched, sortField, order)

  const size = Math.max(1, query.size ?? FUELING_REVIEW_SIZE)
  const totalPages = Math.max(1, Math.ceil(matched.length / size))
  const requestedPage = Math.max(1, Math.trunc(query.page ?? 1))
  // 翻页越界（例如筛选后结果变少）回到最后一页，并通过 pageClamped 告知页面。
  const pageClamped = requestedPage > totalPages
  const page = Math.min(requestedPage, totalPages)
  const start = (page - 1) * size
  const items = matched.slice(start, start + size)

  const fieldLabels: Record<string, string> = {
    加油编号: '加油编号',
    关联航班: '关联航班',
    燃油型号: '燃油型号',
    加油量: '加油量',
    加油车号: '加油车号',
  }
  const conditions = Object.entries(filters).map(([field, value]) => ({
    label: fieldLabels[field] ?? field,
    value,
  }))
  if (status !== '' && status !== '全部') {
    conditions.push({ label: '记录状态', value: status })
  }
  if (query.onlyDiff) {
    conditions.push({ label: '差异记录', value: '仅看差异' })
  }

  const diffCount = matched.filter((row) => isFuelingDiff(row)).length
  const emptyReason = buildEmptyReason(matched.length === 0, filters, status, query.onlyDiff ?? false)

  return {
    items,
    total: matched.length,
    page,
    size,
    totalPages,
    requestedPage,
    pageClamped,
    diffCount,
    conditions,
    emptyReason,
  }
}

// 查无结果时保留条件并说明原因：逐段拼出命中不到的具体口径。
function buildEmptyReason(
  isEmpty: boolean,
  filters: Record<string, string>,
  status: string,
  onlyDiff: boolean,
): string {
  if (!isEmpty) {
    return ''
  }
  const reasons: string[] = []
  for (const [field, value] of Object.entries(filters)) {
    reasons.push(`「${field}」包含「${value}」`)
  }
  if (status !== '' && status !== '全部') {
    reasons.push(`记录状态为「${status}」`)
  }
  if (onlyDiff) {
    reasons.push('仅查看差异记录')
  }
  if (reasons.length === 0) {
    return '当前没有符合条件的加油记录'
  }
  return `没有同时满足以下条件的加油记录：${reasons.join('、')}。筛选条件已保留，可调整后重新查询。`
}

// 同一记录并发复核只留首个结论：先查内存里的最新状态再写入（CAS），
// 已经有复核结论的记录直接拒绝，并把首个结论带回给页面。
export function submitReview(id: number, payload: ReviewSubmit): ActionResult {
  const meta = moduleMeta(FUELING_KEY)
  const rows = listRows(FUELING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的加油记录` }
  }
  const current = rows[index]
  if (String(current['复核结论'] ?? '').trim() !== '') {
    return {
      ok: false,
      conflict: true,
      message:
        `加油记录 ${current['加油编号']} 已由 ${current['复核人'] || '前一位复核员'}` +
        `于 ${current['复核时间'] || '—'} 给出结论「${current['复核结论']}」，` +
        '同一记录并发复核只保留首个结论，本次提交未写入。',
    }
  }

  const conclusion = payload.conclusion.trim()
  const reviewer = payload.reviewer.trim()
  const comment = payload.comment.trim()
  if (conclusion === '') {
    return { ok: false, message: '请选择复核结论后再提交' }
  }
  if (reviewer === '') {
    return { ok: false, message: '请填写复核人' }
  }
  if (isFuelingDiff(current) && comment === '') {
    return { ok: false, message: '该记录存在差异，请填写复核备注说明处置口径' }
  }

  const finalComment =
    comment !== '' ? comment : isFuelingDiff(current) ? fieldText(current, '差异说明') : '复核一致，无补充'
  const updated: EntryRow = {
    ...current,
    status: FUELING_REVIEWED_STATUS,
    pending: FUELING_REVIEWED_STATUS !== meta.statuses[meta.statuses.length - 1],
    复核结论: conclusion,
    复核备注: finalComment,
    复核人: reviewer,
    复核时间: formatNow(),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(FUELING_KEY, next)
  return { ok: true, message: `加油记录 ${updated['加油编号']} 复核结论已记录：${conclusion}` }
}

// 其它入口（机坪安全检查）看到的燃油确认待办：直接读加油数据，状态口径同源。
// 默认取「已完成」待复核的记录，差异记录排最前，最多 5 条。
export function listFuelConfirmTodos(status: string = FUELING_DONE_STATUS): {
  items: EntryRow[]
  total: number
  diffCount: number
} {
  let items = listRows(FUELING_KEY).filter((row) => String(row.status) === status)
  const diffCount = items.filter((row) => isFuelingDiff(row)).length
  items = [...items].sort((a, b) => {
    const diffGap = Number(isFuelingDiff(b)) - Number(isFuelingDiff(a))
    if (diffGap !== 0) {
      return diffGap
    }
    return fieldText(a, '加油编号').localeCompare(fieldText(b, '加油编号'), 'zh-Hans-CN')
  })
  return { items: items.slice(0, FUELING_REVIEW_SIZE), total: items.length, diffCount }
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
