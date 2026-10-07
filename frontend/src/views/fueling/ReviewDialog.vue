<template>
  <div v-if="row" class="modal-mask" @click.self="emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="加油记录复核">
      <header class="modal-head">
        <h3>加油记录复核</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <dl class="review-summary">
        <div v-for="item in summaryItems" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>

      <p v-if="diffText" class="diff-banner">
        差异记录：{{ diffText }}
      </p>
      <p v-else class="clean-banner">本单无登记差异。</p>

      <template v-if="existing">
        <p class="conflict-banner">
          该记录已有首个复核结论，并发复核只保留首个结论，不可再次提交。
        </p>
        <dl class="review-summary">
          <div><dt>复核结论</dt><dd>{{ existing.conclusion }}</dd></div>
          <div><dt>复核备注</dt><dd>{{ existing.comment || '—' }}</dd></div>
          <div><dt>复核人</dt><dd>{{ existing.reviewer }}</dd></div>
          <div><dt>复核时间</dt><dd>{{ existing.time }}</dd></div>
        </dl>
      </template>

      <form v-else class="review-form" @submit.prevent="submitOnce">
        <label class="form-block">
          <span>复核结论 <em>*</em></span>
          <div class="radio-row">
            <label v-for="item in conclusionOptions" :key="item">
              <input v-model="conclusion" type="radio" name="review-conclusion" :value="item" />
              {{ item }}
            </label>
          </div>
        </label>
        <label class="form-block">
          <span>复核人 <em>*</em></span>
          <input v-model="reviewer" placeholder="请输入复核人姓名" />
        </label>
        <label class="form-block">
          <span>复核备注<em v-if="diffText"> *</em></span>
          <textarea
            v-model="comment"
            rows="3"
            :placeholder="diffText ? '差异记录必须填写处置口径' : '可填写复核说明（选填）'"
          ></textarea>
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="submitConcurrent">模拟并发双提交</button>
          <button class="btn primary" type="submit">提交复核结论</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { submitReview } from '@/api/local-service'
import type { ActionResult } from '@/data/types'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ row: EntryRow | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', result: ActionResult): void
}>()

const conclusionOptions = ['复核一致', '存在差异']

const conclusion = ref('')
const reviewer = ref('值班复核员')
const comment = ref('')
const errorMessage = ref('')

watch(
  () => props.row?.id,
  () => {
    conclusion.value = ''
    comment.value = ''
    errorMessage.value = ''
  },
)

const diffText = computed(() => String(props.row?.['差异说明'] ?? '').trim())

const existing = computed(() => {
  const value = String(props.row?.['复核结论'] ?? '').trim()
  if (!value || !props.row) {
    return null
  }
  return {
    conclusion: value,
    comment: String(props.row['复核备注'] ?? ''),
    reviewer: String(props.row['复核人'] ?? ''),
    time: String(props.row['复核时间'] ?? ''),
  }
})

const summaryItems = computed(() => {
  const row = props.row
  if (!row) {
    return []
  }
  return [
    { label: '加油编号', value: row['加油编号'] },
    { label: '关联航班', value: row['关联航班'] },
    { label: '燃油型号', value: row['燃油型号'] },
    { label: '加油量', value: row['加油量'] },
    { label: '加油车号', value: row['加油车号'] },
    { label: '记录状态', value: row.status },
  ]
})

function fire(payload: { conclusion: string; comment: string; reviewer: string }): ActionResult {
  if (!props.row) {
    return { ok: false, message: '未选择加油记录' }
  }
  return submitReview(Number(props.row.id), payload)
}

function submitOnce() {
  errorMessage.value = ''
  const result = fire({
    conclusion: conclusion.value,
    comment: comment.value,
    reviewer: reviewer.value,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('done', result)
}

// 模拟同一记录被两位复核员同时提交：两个结论都写，但数据层 CAS 只留首个。
function submitConcurrent() {
  errorMessage.value = ''
  const first = fire({ conclusion: '复核一致', comment: '并发：首位复核员提交', reviewer: '甲复核员' })
  const second = fire({ conclusion: '存在差异', comment: '并发：次位复核员提交', reviewer: '乙复核员' })
  if (!first.ok) {
    errorMessage.value = first.message
    return
  }
  emit('done', {
    ok: true,
    message: `${first.message}；并发的第二笔提交${second.ok ? '意外覆盖，数据异常' : `已被拒绝（${second.message}）`}`,
  })
}
</script>
