import assert from 'node:assert/strict'
import {
  emptyFuelingFilters,
  fuelingStats,
  isFuelingDiff,
  listFuelingConfirmTodos,
  listFuelingEntries,
  locateNextFuelingDiff,
  reviewFuelingEntry,
} from '../src/api/local-service'
import { listRows, resetRows } from '../src/data/local-store'

let passed = 0
function check(name: string, fn: () => void) {
  resetRows('fueling')
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const baseFilters = () => ({ ...emptyFuelingFilters() })

check('复核队列只纳入已完成/已复核状态', () => {
  const res = listFuelingEntries({ scope: 'review', filters: baseFilters(), page: 1, size: 50 })
  // 已完成 = id 4,5,6,7,8,9,11,12 共 8；已复核 = id 10 共 1
  assert.equal(res.total, 9)
  assert.ok(res.items.every((r) => ['已完成', '已复核'].includes(String(r.status))))
})

check('按加油编号检索', () => {
  const res = listFuelingEntries({
    scope: 'all',
    filters: { ...baseFilters(), 加油编号: '1003' },
    page: 1,
    size: 50,
  })
  assert.equal(res.total, 1)
  assert.equal(res.items[0]['加油编号'], 'FUEL-1003')
})

check('按关联航班/燃油型号/加油车号组合检索', () => {
  const res = listFuelingEntries({
    scope: 'review',
    filters: { ...baseFilters(), 关联航班: 'MU', 燃油型号: 'JET A-1', 加油车号: 'FY-207' },
    page: 1,
    size: 50,
  })
  assert.deepEqual(
    res.items.map((r) => r['加油编号']),
    ['FUEL-1008'],
  )
})

check('旧加油量文本记录仍按原口径包含匹配', () => {
  const res = listFuelingEntries({
    scope: 'review',
    filters: { ...baseFilters(), 加油量: '8200 升' },
    page: 1,
    size: 50,
  })
  assert.equal(res.total, 1)
  assert.equal(res.items[0]['加油编号'], 'FUEL-1009')
  // 只输入数字也能按原包含口径命中文本记录
  const partial = listFuelingEntries({
    scope: 'review',
    filters: { ...baseFilters(), 加油量: '8200' },
    page: 1,
    size: 50,
  })
  assert.equal(partial.total, 1)
})

check('加油量数值感知排序：15300 不排到 7600 前面（升序）', () => {
  const res = listFuelingEntries({
    scope: 'review',
    filters: baseFilters(),
    order: { field: '加油量', direction: 'asc' },
    page: 1,
    size: 50,
  })
  const volumes = res.items.map((r) => String(r['加油量']).match(/\d+/)?.[0] ?? '')
  const nums = volumes.map(Number)
  for (let i = 1; i < nums.length; i++) {
    assert.ok(nums[i] >= nums[i - 1], `位置 ${i}: ${nums[i - 1]} -> ${nums[i]}`)
  }
})

check('降序排序与编号排序', () => {
  const res = listFuelingEntries({
    scope: 'review',
    filters: baseFilters(),
    order: { field: '加油编号', direction: 'desc' },
    page: 1,
    size: 50,
  })
  assert.deepEqual(
    res.items.map((r) => r['加油编号']),
    ['FUEL-1012', 'FUEL-1011', 'FUEL-1010', 'FUEL-1009', 'FUEL-1008', 'FUEL-1007', 'FUEL-1006', 'FUEL-1005', 'FUEL-1004'],
  )
})

check('分页与翻页越界回到最后一页', () => {
  const res = listFuelingEntries({ scope: 'review', filters: baseFilters(), page: 99, size: 5 })
  assert.equal(res.totalPages, 2)
  assert.equal(res.page, 2)
  assert.equal(res.adjustedFromPage, 99)
  assert.equal(res.items.length, 4)
  const low = listFuelingEntries({ scope: 'review', filters: baseFilters(), page: 0, size: 5 })
  assert.equal(low.page, 1)
  assert.equal(low.adjustedFromPage, 0)
})

check('差异判定：异常/状态文本不一致/复核存疑', () => {
  const rows = listRows('fueling')
  const byId = new Map(rows.map((r) => [Number(r.id), r]))
  assert.equal(isFuelingDiff(byId.get(3)!), true) // abnormal
  assert.equal(isFuelingDiff(byId.get(5)!), true) // 记录状态=加油中 vs status=已完成
  assert.equal(isFuelingDiff(byId.get(11)!), true) // 记录状态=已复核 vs status=已完成
  assert.equal(isFuelingDiff(byId.get(4)!), false)
})

check('仅看差异记录过滤', () => {
  const res = listFuelingEntries({
    scope: 'review',
    filters: { ...baseFilters(), diffOnly: true },
    page: 1,
    size: 50,
  })
  assert.deepEqual(res.items.map((r) => r['加油编号']).sort(), ['FUEL-1005', 'FUEL-1011'])
})

check('定位下一差异：循环定位并给出所在页', () => {
  const q = { scope: 'review' as const, filters: baseFilters(), size: 5 }
  const first = locateNextFuelingDiff(q, null)!
  assert.equal(first.id, 5)
  assert.equal(first.page, 1)
  const second = locateNextFuelingDiff(q, 5)!
  assert.equal(second.id, 11)
  assert.equal(second.page, 2)
  const wrap = locateNextFuelingDiff(q, 11)!
  assert.equal(wrap.id, 5) // 回到第一条
})

check('并发复核只留首个结论，第二次被拒', () => {
  const r1 = reviewFuelingEntry({ id: 4, conclusion: '复核通过', note: '泵码一致', operator: '甲' })
  assert.equal(r1.ok, true)
  const rows1 = listRows('fueling').find((r) => Number(r.id) === 4)!
  assert.equal(rows1.status, '已复核')
  assert.equal(rows1['复核结论'], '复核通过')
  assert.equal(rows1['记录状态'], '已复核')

  const r2 = reviewFuelingEntry({ id: 4, conclusion: '复核存疑', note: '乙认为有问题', operator: '乙' })
  assert.equal(r2.ok, false)
  assert.match(r2.message, /首个复核结论/)
  const rows2 = listRows('fueling').find((r) => Number(r.id) === 4)!
  assert.equal(rows2['复核结论'], '复核通过')
  assert.equal(rows2['复核人'], '甲')
})

check('复核存疑：状态保留已完成、标记异常与差异', () => {
  const r = reviewFuelingEntry({ id: 6, conclusion: '复核存疑', note: '油量与加油单不符', operator: '甲' })
  assert.equal(r.ok, true)
  const row = listRows('fueling').find((x) => Number(x.id) === 6)!
  assert.equal(row.status, '已完成')
  assert.equal(row.abnormal, true)
  assert.equal(row['复核结论'], '复核存疑')
  assert.equal(isFuelingDiff(row), true)
})

check('复核前置校验：非已完成不可复核、说明必填、结论合法', () => {
  assert.equal(reviewFuelingEntry({ id: 1, conclusion: '复核通过', note: 'x', operator: '甲' }).ok, false)
  assert.equal(reviewFuelingEntry({ id: 10, conclusion: '复核通过', note: 'x', operator: '甲' }).ok, false) // 已复核
  assert.equal(reviewFuelingEntry({ id: 4, conclusion: '复核通过', note: '', operator: '甲' }).ok, false)
  assert.equal(reviewFuelingEntry({ id: 4, conclusion: '随便', note: 'x', operator: '甲' }).ok, false)
})

check('燃油确认待办只含已完成且无复核结论的记录，复核后即移除', () => {
  const before = listFuelingConfirmTodos().map((t) => t.id)
  assert.ok(before.includes(4))
  assert.ok(!before.includes(10)) // 已复核
  assert.ok(!before.includes(2)) // 加油中
  reviewFuelingEntry({ id: 4, conclusion: '复核通过', note: '泵码一致', operator: '甲' })
  const after = listFuelingConfirmTodos().map((t) => t.id)
  assert.ok(!after.includes(4))
})

check('统计：待复核数量与差异数量', () => {
  const s = fuelingStats()
  assert.equal(s.waiting, 1)
  assert.equal(s.fueling, 2)
  assert.equal(s.completed, 8)
  assert.equal(s.reviewed, 1)
  assert.equal(s.pendingReview, 8)
  assert.ok(s.diff >= 3) // id3(异常,不在复核队列) + id5 + id11
})

console.log(`\n全部 ${passed} 项冒烟测试通过`)
