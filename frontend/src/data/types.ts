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
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// —— 航空加油复核队列：字段口径全部来自 fueling 模块元数据，页面不另写一份 ——

export type FuelingScope = 'all' | 'review'

// 复核队列筛选项；加油量是旧文本字段，仍按原口径（包含匹配）检索
export type FuelingFilters = {
  加油编号: string
  关联航班: string
  燃油型号: string
  加油量: string
  加油车号: string
  status: string
  diffOnly: boolean
}

export type FuelingOrder = {
  field: string
  direction: 'asc' | 'desc'
}

export type FuelingQuery = {
  scope: FuelingScope
  filters: FuelingFilters
  order: FuelingOrder
  page: number
  size: number
}

export type FuelingPageResult = PageResult & {
  scope: FuelingScope
  totalPages: number
  // 请求页码越界时，服务端会改判到最后一页，页面据此回显
  adjustedFromPage: number | null
  order: FuelingOrder
  diffIds: number[]
}

export const FUELING_REVIEW_CONCLUSIONS = ['复核通过', '复核存疑'] as const
export type FuelingConclusion = (typeof FUELING_REVIEW_CONCLUSIONS)[number]

export type FuelingReviewInput = {
  id: number
  conclusion: string
  note: string
  operator: string
}

export type FuelingTodo = {
  id: number
  加油编号: string
  关联航班: string
  燃油型号: string
  加油量: string
  加油车号: string
  status: string
  abnormal: boolean
  diff: boolean
}

export type FuelingStats = {
  waiting: number
  fueling: number
  completed: number
  reviewed: number
  pendingReview: number
  diff: number
}

export type FuelingStatusStat = {
  status: string
  count: number
}
