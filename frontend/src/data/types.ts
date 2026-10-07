/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  conflict?: boolean
}

// 复核队列支持的排序字段，与检索字段保持一致。
export const REVIEW_SORT_FIELDS = ['加油编号', '关联航班', '燃油型号', '加油量', '加油车号'] as const
export type ReviewSortField = (typeof REVIEW_SORT_FIELDS)[number]
export type ReviewOrder = 'asc' | 'desc'

export type ReviewQuery = {
  filters?: Record<string, string>
  status?: string
  onlyDiff?: boolean
  sortField?: ReviewSortField
  order?: ReviewOrder
  page?: number
  size?: number
}

export type ReviewCondition = {
  label: string
  value: string
}

export type ReviewPageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  totalPages: number
  requestedPage: number
  pageClamped: boolean
  diffCount: number
  conditions: ReviewCondition[]
  emptyReason: string
}

export type ReviewSubmit = {
  conclusion: string
  comment: string
  reviewer: string
}

// 机坪安全等其它入口看到的「燃油确认待办」：与加油数据同源。
export type FuelTodoResult = {
  items: EntryRow[]
  total: number
  diffCount: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
