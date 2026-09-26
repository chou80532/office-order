<template>
  <div class="notes-panel ops-surface">
    <div class="notes-layout">
      <!-- 左欄：新增與備註清單 -->
      <div class="notes-main">
        <div class="note-add-card">
          <i class="fas fa-plus add-plus" aria-hidden="true"></i>
          <input
            v-model="newGroupName"
            type="text"
            class="note-add-input"
            placeholder="新增一個備註群組，例如「冰量」…"
            maxlength="10"
            @keydown.enter="addGroup"
          >
          <button class="note-add-btn" @click="addGroup" :disabled="!newGroupName.trim()">新增群組</button>
        </div>

        <StatusNotice v-if="noteGroups.length === 0" title="尚無快捷備註群組" description="可先新增甜度、冰量或其他常用備註群組。" />

        <section v-for="(group, gIdx) in noteGroups" :key="gIdx" class="note-group-block">
          <div class="note-group-header">
            <i :class="'fas fa-' + group.icon" aria-hidden="true"></i>
            <span class="note-group-label">{{ group.label }}</span>
            <span class="note-group-count">{{ group.notes.length }} 則</span>
            <button class="btn-remove-group" @click="removeGroup(gIdx)" title="刪除群組" aria-label="刪除群組">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>

          <div class="note-rows">
            <div
              v-for="(note, nIdx) in group.notes"
              :key="note"
              class="note-row"
              :class="{
                'is-dragging': draggedNote?.groupIndex === gIdx && draggedNote?.noteIndex === nIdx,
                'is-drop-target': dropTarget?.groupIndex === gIdx && dropTarget?.noteIndex === nIdx
              }"
              draggable="true"
              @dragstart="handleNoteDragStart(gIdx, nIdx)"
              @dragenter.prevent="handleNoteDragEnter(gIdx, nIdx)"
              @dragover.prevent
              @drop.prevent="handleNoteDrop(gIdx, nIdx)"
              @dragend="handleNoteDragEnd"
            >
              <span class="drag-handle" aria-hidden="true" title="拖曳調整順序">
                <i class="fas fa-grip-vertical"></i>
              </span>
              <span class="note-text">{{ note }}</span>
              <button class="row-icon-btn" @click="editNote(gIdx, nIdx)" :title="`編輯「${note}」`" :aria-label="`編輯「${note}」`">
                <i class="fas fa-pen"></i>
              </button>
              <button class="row-icon-btn danger" @click="removeNoteFromGroup(gIdx, nIdx)" :title="`刪除「${note}」`" :aria-label="`刪除「${note}」`">
                <i class="fas fa-times"></i>
              </button>
            </div>

            <div class="note-row inline-add-row">
              <span class="drag-handle placeholder" aria-hidden="true"><i class="fas fa-plus"></i></span>
              <input
                v-model="groupInputs[gIdx]"
                type="text"
                class="inline-add-input"
                :placeholder="`新增一則「${group.label}」備註…`"
                maxlength="20"
                @keydown.enter="addNoteToGroup(gIdx)"
              >
              <button
                class="inline-add-btn"
                :disabled="!groupInputs[gIdx]?.trim()"
                @click="addNoteToGroup(gIdx)"
              >新增</button>
            </div>
          </div>
        </section>

        <div class="panel-footer">
          <button class="btn btn-primary footer-btn" @click="saveQuickNotes" :disabled="isSavingQuickNotes">
            <span v-if="isSavingQuickNotes" class="mini-spinner"></span>
            <template v-else><i class="fas fa-save"></i></template>
            {{ isSavingQuickNotes ? '儲存中...' : `儲存備註（${totalNoteCount} 則）` }}
          </button>
        </div>
      </div>

      <!-- 右欄：套用預覽與說明 -->
      <aside class="notes-aside">
        <div class="aside-card">
          <h3 class="aside-title">套用預覽</h3>
          <div class="preview-dish">
            <p class="preview-dish-name">範例餐點 <span class="preview-price">{{ formatMoney(95) }}</span></p>
            <template v-if="previewGroups.length">
              <div v-for="group in previewGroups" :key="group.label" class="preview-group">
                <p class="preview-group-label">
                  <i :class="'fas fa-' + group.icon" aria-hidden="true"></i>{{ group.label }}
                </p>
                <div class="preview-chips">
                  <button
                    v-for="note in group.notes"
                    :key="note"
                    type="button"
                    class="preview-chip"
                    :class="{ selected: previewSelected.includes(note) }"
                    @click="togglePreviewNote(note)"
                  >{{ note }}</button>
                </div>
              </div>
              <p class="preview-note-line">
                <span class="preview-note-label">備註欄</span>
                <span class="preview-note-text">{{ previewSelected.length ? previewSelected.join('、') : '點上面的標籤試試看' }}</span>
              </p>
            </template>
            <span v-else class="preview-empty">先在左邊新增備註</span>
          </div>
          <p class="aside-desc">成員點餐時，備註會照群組以標籤呈現，點一下即可加進餐點的備註欄（上面可以實際點看看）。</p>
        </div>

        <div class="aside-card">
          <h3 class="aside-title">共 {{ totalNoteCount }} 則備註</h3>
          <p class="aside-desc">
            拖曳可調整順序，愈上面的備註在點餐頁愈前面顯示。飲料店會多出「冰量／甜度／溫度」群組；記得按下方「儲存備註」才會生效。
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import StatusNotice from "../ui/StatusNotice.vue"
import { formatMoney } from '../../utils/format'
import { ref, reactive, computed, onMounted } from 'vue'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { db } from '../../firestore'
import { useToast } from '../../composables/useToast'
import { confirmDialog, promptDialog } from '../../composables/useDialog'

const { showToast } = useToast()

const defaultGroups = [
  { label: '冰量', icon: 'snowflake', notes: ['正常冰', '少冰', '微冰', '去冰'] },
  { label: '甜度', icon: 'candy-cane', notes: ['正常糖', '半糖', '微糖', '無糖'] },
  { label: '溫度', icon: 'temperature-high', notes: ['溫的', '熱的'] },
  { label: '其他', icon: 'comment-dots', notes: ['不要豆芽菜', '不加蔥', '不加香菜'] }
]

const ICON_MAP = { '冰量': 'snowflake', '甜度': 'candy-cane', '溫度': 'temperature-high', '加料': 'plus-circle', '份量': 'weight-hanging', '其他': 'comment-dots' }

const noteGroups = ref([])
const groupInputs = reactive({})
const newGroupName = ref('')
const isSavingQuickNotes = ref(false)
const draggedNote = ref(null)
const dropTarget = ref(null)

const totalNoteCount = computed(() => noteGroups.value.reduce((sum, g) => sum + g.notes.length, 0))

// 套用預覽：照群組完整呈現（與點餐頁備註選單同結構），可實際點選試套用
const previewGroups = computed(() => noteGroups.value.filter(group => group.notes.length > 0))
const previewSelected = ref([])

function togglePreviewNote(note) {
  previewSelected.value = previewSelected.value.includes(note)
    ? previewSelected.value.filter(n => n !== note)
    : [...previewSelected.value, note]
}

const loadQuickNotes = async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'quickNotes'))
    if (snap.exists()) {
      const data = snap.data()
      if (Array.isArray(data.groups) && data.groups.length > 0) noteGroups.value = data.groups.map(g => ({ ...g, notes: [...g.notes] }))
      else if (Array.isArray(data.notes) && data.notes.length > 0) noteGroups.value = [{ label: '備註', icon: 'comment-dots', notes: [...data.notes] }]
      else noteGroups.value = defaultGroups.map(g => ({ ...g, notes: [...g.notes] }))
    } else { noteGroups.value = defaultGroups.map(g => ({ ...g, notes: [...g.notes] })) }
  } catch (e) { console.error('讀取快捷備註失敗:', e); noteGroups.value = defaultGroups.map(g => ({ ...g, notes: [...g.notes] })) }
}

const addGroup = () => {
  const label = newGroupName.value.trim()
  if (!label) return
  if (noteGroups.value.some(g => g.label === label)) { showToast(`「${label}」群組已存在`); return }
  noteGroups.value.push({ label, icon: ICON_MAP[label] || 'tag', notes: [] })
  newGroupName.value = ''
}

const removeGroup = async (gIdx) => {
  const confirmed = await confirmDialog({
    title: '刪除備註群組？',
    message: `將刪除「${noteGroups.value[gIdx].label}」群組與其中 ${noteGroups.value[gIdx].notes.length} 個備註選項。`,
    variant: 'danger',
    confirmText: '刪除群組',
  })
  if (!confirmed) return
  noteGroups.value.splice(gIdx, 1)
}

const addNoteToGroup = (gIdx) => {
  const note = (groupInputs[gIdx] || '').trim()
  if (!note) return
  if (noteGroups.value[gIdx].notes.includes(note)) { showToast(`「${note}」已存在`); return }
  noteGroups.value[gIdx].notes.push(note); groupInputs[gIdx] = ''
}

const removeNoteFromGroup = (gIdx, nIdx) => { noteGroups.value[gIdx].notes.splice(nIdx, 1) }

const editNote = async (gIdx, nIdx) => {
  const current = noteGroups.value[gIdx].notes[nIdx]
  const input = await promptDialog({
    title: '編輯備註',
    message: '修改備註文字：',
    defaultValue: current,
    confirmText: '儲存',
  })
  if (input === null) return
  const next = input.trim()
  if (!next) { showToast('備註不能為空', 'error'); return }
  if (next !== current && noteGroups.value[gIdx].notes.includes(next)) { showToast(`「${next}」已存在`, 'error'); return }
  noteGroups.value[gIdx].notes[nIdx] = next
}

const handleNoteDragStart = (groupIndex, noteIndex) => {
  draggedNote.value = { groupIndex, noteIndex }
  dropTarget.value = { groupIndex, noteIndex }
}

const handleNoteDragEnter = (groupIndex, noteIndex) => {
  if (!draggedNote.value) return
  if (draggedNote.value.groupIndex === groupIndex && draggedNote.value.noteIndex === noteIndex) return

  const sourceGroup = noteGroups.value[draggedNote.value.groupIndex]
  const targetGroup = noteGroups.value[groupIndex]
  if (!sourceGroup || !targetGroup) return

  const nextNotes = [...sourceGroup.notes]
  const [movedNote] = nextNotes.splice(draggedNote.value.noteIndex, 1)
  if (!movedNote) return

  if (draggedNote.value.groupIndex === groupIndex) {
    nextNotes.splice(noteIndex, 0, movedNote)
    sourceGroup.notes = nextNotes
  } else {
    const nextTargetNotes = [...targetGroup.notes]
    nextTargetNotes.splice(noteIndex, 0, movedNote)
    sourceGroup.notes = nextNotes
    targetGroup.notes = nextTargetNotes
  }

  draggedNote.value = { groupIndex, noteIndex }
  dropTarget.value = { groupIndex, noteIndex }
}

const handleNoteDrop = (groupIndex, noteIndex) => {
  dropTarget.value = { groupIndex, noteIndex }
  handleNoteDragEnd()
}

const handleNoteDragEnd = () => {
  draggedNote.value = null
  dropTarget.value = null
}

const saveQuickNotes = async () => {
  isSavingQuickNotes.value = true
  try { await setDoc(doc(db, 'settings', 'quickNotes'), { groups: noteGroups.value }); showToast(`快捷備註已儲存（${totalNoteCount.value} 則）`) }
  catch (err) { showToast('儲存失敗: ' + err.message, 'error') }
  finally { isSavingQuickNotes.value = false }
}

onMounted(() => { loadQuickNotes() })
</script>

<style scoped>
/* .btn / .btn-primary 等共用按鈕樣式已移至 src/assets/components.css */

.notes-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
  align-items: start;
}

.notes-main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }

/* ── 新增群組列（設計稿 4 的新增列樣式） ── */
.note-add-card {
  display: flex;
  align-items: center;
  gap: 12px;
}

.add-plus { color: var(--accent); font-size: var(--text-body); flex-shrink: 0; }

.note-add-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 600;
  outline: none;
}
.note-add-input::placeholder { color: var(--text-muted); }

.note-add-btn {
  flex-shrink: 0;
  padding: 11px 22px;
  border-radius: var(--r-lg);
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-label);
  font-weight: 800;
  transition: background 0.15s, opacity 0.15s;
}
.note-add-btn:hover:not(:disabled) { background: var(--accent-hover); }
.note-add-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── 群組區塊 ── */
.note-group-block { display: flex; flex-direction: column; gap: 8px; }

.note-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
  font-weight: 800;
  color: var(--text-secondary);
}
.note-group-label { flex: 1; }
.note-group-count { font-size: var(--text-micro); }

.btn-remove-group {
  width: 26px; height: 26px; flex-shrink: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  font-size: var(--text-micro);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.btn-remove-group:hover { background: var(--paprika); color: var(--paper); border-color: transparent; }

/* ── 備註列（設計稿 4：拖曳把手＋文字＋編輯＋刪除） ── */
.note-rows { display: flex; flex-direction: column; }

.note-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: grab;
  user-select: none;
  transition: transform 0.15s, opacity 0.15s, border-color 0.15s, background 0.15s;
}
.note-row:active { cursor: grabbing; }
.note-row.is-dragging { opacity: 0.45; transform: scale(0.98); }
.note-row.is-drop-target { border-color: var(--selection); }

.drag-handle {
  flex-shrink: 0;
  color: var(--border-strong);
  font-size: var(--text-label);
}
.drag-handle.placeholder { color: var(--muted); font-size: var(--text-label); }

.note-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-body);
}

.row-icon-btn {
  width: 30px; height: 30px; flex-shrink: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font-size: var(--text-label);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.row-icon-btn:hover { background: var(--bg-accent); color: var(--text-accent); }
.row-icon-btn.danger:hover { background: var(--bg-danger); color: var(--text-danger); }

/* 每組底部的內嵌新增列 */
.inline-add-row {
  cursor: default;
  border-style: dashed;
  box-shadow: none;
  background: transparent;
  padding-top: 8px;
  padding-bottom: 8px;
}

.inline-add-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 600;
  outline: none;
}
.inline-add-input::placeholder { color: var(--muted); }

.inline-add-btn {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--bg-accent);
  color: var(--text-accent);
  font-size: var(--text-label);
  font-weight: 800;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}
.inline-add-btn:hover:not(:disabled) { background: var(--accent-solid); color: var(--text-on-accent); }
.inline-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── 右欄卡片（設計稿 4） ── */
.notes-aside {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: calc(var(--header-height) + 16px);
}

.aside-title {
  margin: 0 0 12px;
  color: var(--text-primary);
  font-size: var(--text-lead);
  font-weight: 800;
}

.preview-dish-name {
  margin: 0 0 10px;
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 800;
}

.preview-group { margin-bottom: 10px; }
.preview-group:last-of-type { margin-bottom: 0; }

.preview-group-label {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 800;
}
.preview-group-label i { font-size: var(--text-micro); }

.preview-note-line {
  margin: 12px 0 0;
  padding-top: 10px;
  border-top: 1px dashed var(--border-strong);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.preview-note-label {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 800;
}
.preview-note-text {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  line-height: 1.5;
}

.preview-chips { display: flex; flex-wrap: wrap; gap: 8px; }

.preview-chip {
  color: var(--text-secondary);
  font-size: var(--text-label);
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.preview-chip:hover { border-color: var(--border-strong); }

.preview-empty { color: var(--muted); font-size: var(--text-label); }

.aside-desc {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: var(--text-label);
  line-height: 1.6;
}
.aside-card .aside-title + .aside-desc { margin-top: 0; }

.no-data {
  text-align: center;
  padding: 40px;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  font-size: var(--text-display);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--bg-card);
}
.no-data span { font-size: var(--text-label); font-weight: 700; }

.panel-footer { display: flex; gap: 10px; margin-top: 4px; }
.footer-btn { margin: 0; justify-content: center; }


@media (max-width: 900px) {
  .notes-layout { grid-template-columns: 1fr; }
  .notes-aside { position: static; }
}

.notes-layout { gap: 32px; }
.note-add-card { background: transparent; border: 0; border-radius: 0; box-shadow: none; padding: 0 0 20px; border-bottom: 1px solid var(--line); }
.note-group-block { background: transparent; border: 0; box-shadow: none; margin-bottom: 28px; }
.note-group-header { padding: 0 0 10px; }
.note-group-label { font-family: var(--font-display); font-weight: 600; color: var(--paper); }
.note-group-header > i { color: var(--ink-soft); }
.note-group-count { background: transparent; border: 0; color: var(--ink-soft); font-weight: 400; }
.note-rows { gap: 0; background: var(--ink-2); border-block: 1px solid var(--line); }
.note-row { min-height: 46px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; box-shadow: none; padding: 9px 12px; }
.note-row:last-child { border-bottom: 0; }
.note-row:hover { background: var(--ink-3); }
.note-row.is-drop-target { background: var(--ink-3); box-shadow: inset 3px 0 var(--persimmon); }
.note-text { font-weight: 500; }
.btn-remove-group { border: 0; }
.aside-card { background: transparent; padding: 0 0 24px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none; }
.preview-dish { padding: 16px 0; background: transparent; border-radius: 0; }
.preview-chip { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; padding: 6px 10px; font-weight: 400; }
.preview-chip.selected { background: var(--accent-solid); color: var(--paper); border-color: var(--persimmon); border-radius: 4px; }
.preview-price { color: var(--gold); }
.preview-group-label i { color: var(--ink-soft); }
.footer-btn { flex: 0 1 auto; }
</style>
