<template>
  <Teleport to="body">
    <div
      class="repMaxOverlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progressPhotosTitle"
      @click.self="close"
    >
      <div class="repMaxModal ppModal">
        <header class="ppHeader">
          <div>
            <h2 id="progressPhotosTitle" class="ppTitle">Progress Photos</h2>
            <p class="ppSub">Private &amp; on your device only.</p>
          </div>
          <button class="ppClose" @click="close" aria-label="Close progress photos">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <!-- Side-by-side comparison panel -->
        <div v-if="comparePair" class="ppCompareWrap">
          <div class="ppCompare">
            <div v-for="p in comparePair" :key="p.id" class="ppCompareCol">
              <img v-if="urls.get(p.id)" :src="urls.get(p.id)" class="ppCompareImg" :alt="`Progress photo from ${formatDay(p.date)}`" />
              <span class="ppCompareDate">{{ formatDay(p.date) }}</span>
            </div>
          </div>
          <p v-if="compareSpanDays != null" class="ppCompareSpan">
            {{ compareSpanDays }} {{ compareSpanDays === 1 ? 'day' : 'days' }} apart
          </p>
          <button class="ppBtn ppBtnSecondary" @click="selectedIds = []">Choose different photos</button>
        </div>

        <!-- Detail view for a single tapped photo -->
        <div v-else-if="activePhoto" class="ppDetail">
          <img v-if="urls.get(activePhoto.id)" :src="urls.get(activePhoto.id)" class="ppDetailImg" :alt="`Progress photo from ${formatDay(activePhoto.date)}`" />
          <span class="ppDetailDate">{{ formatDay(activePhoto.date) }}</span>
          <input
            v-model="captionDraft"
            class="ppCaptionInput"
            type="text"
            maxlength="80"
            placeholder="Add a note (optional)"
            aria-label="Photo caption"
            @change="saveCaption"
          />
          <div class="ppDetailActions">
            <button class="ppBtn ppBtnSecondary" @click="activeId = null">Back</button>
            <button class="ppBtn ppBtnDanger" @click="remove(activePhoto.id)">Delete</button>
          </div>
        </div>

        <!-- Timeline grid -->
        <template v-else>
          <p v-if="store.count === 0" class="ppEmpty">
            Capture a photo every week or two. Seeing change over time is one of the
            strongest ways to stay motivated.
          </p>

          <div v-else class="ppGrid">
            <button
              v-for="p in store.sortedPhotos"
              :key="p.id"
              type="button"
              :class="['ppThumb', { ppThumbSelected: selectedIds.includes(p.id) }]"
              :aria-pressed="compareMode ? selectedIds.includes(p.id) : undefined"
              :aria-label="compareMode ? `Select photo from ${formatDay(p.date)} to compare` : `View photo from ${formatDay(p.date)}`"
              @click="onThumbClick(p.id)"
            >
              <img v-if="urls.get(p.id)" :src="urls.get(p.id)" class="ppThumbImg" alt="" />
              <span v-else class="ppThumbPlaceholder" aria-hidden="true"></span>
              <span class="ppThumbDate">{{ formatDay(p.date) }}</span>
              <span v-if="compareMode && selectedIds.includes(p.id)" class="ppThumbCheck" aria-hidden="true">
                {{ selectedIds.indexOf(p.id) + 1 }}
              </span>
            </button>
          </div>

          <p v-if="compareMode" class="ppCompareHint">
            {{ selectedIds.length === 0 ? 'Pick two photos to compare.' : selectedIds.length === 1 ? 'Pick one more.' : '' }}
          </p>

          <div class="ppActions">
            <label class="ppBtn ppBtnPrimary ppAddBtn">
              + Add Photo
              <input
                type="file"
                accept="image/*"
                class="srOnly"
                @change="onFilePicked"
              />
            </label>
            <button
              v-if="store.count >= 2"
              class="ppBtn ppBtnSecondary"
              :aria-pressed="compareMode"
              @click="toggleCompare"
            >{{ compareMode ? 'Cancel' : 'Compare' }}</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useModal } from '../composables/useModal'
import { useProgressPhotosStore } from '../stores/progressPhotos'
import { useAnalytics } from '../composables/useAnalytics'
import { todayISO, formatShortDate, daysBetweenISO } from '../lib/dates'
import type { ProgressPhotoMeta } from '../lib/progressPhotos'

const emit = defineEmits<{ (e: 'close'): void }>()

// Top-anchored scrollable sheet; useModal owns the scroll lock + focus trap.
const { open: activateModal, close: deactivateModal } = useModal({
  selector: '.ppModal',
  focusContainer: true,
  onEscape: () => close(),
})

const store = useProgressPhotosStore()
const { logEvent } = useAnalytics()

// Object URLs for the currently-known photos, revoked on unmount so decoded
// image memory is released when the sheet closes.
const urls = ref(new Map<string, string>())

const activeId = ref<string | null>(null)
const captionDraft = ref('')
const compareMode = ref(false)
const selectedIds = ref<string[]>([])

const activePhoto = computed<ProgressPhotoMeta | null>(() =>
  store.photos.find(p => p.id === activeId.value) ?? null,
)

const comparePair = computed<ProgressPhotoMeta[] | null>(() => {
  if (!compareMode.value || selectedIds.value.length !== 2) return null
  const pair = selectedIds.value
    .map(id => store.photos.find(p => p.id === id))
    .filter((p): p is ProgressPhotoMeta => !!p)
  if (pair.length !== 2) return null
  // Show older on the left, newer on the right — the natural before/after read.
  return [...pair].sort((a, b) => a.date.localeCompare(b.date))
})

const compareSpanDays = computed<number | null>(() => {
  if (!comparePair.value) return null
  return Math.abs(daysBetweenISO(comparePair.value[0].date, comparePair.value[1].date))
})

function formatDay(dateKey: string): string {
  return formatShortDate(dateKey + 'T12:00:00')
}

/** Create object URLs for any photo metadata that doesn't have one yet. */
async function ensureUrls() {
  const next = new Map(urls.value)
  for (const meta of store.photos) {
    if (next.has(meta.id)) continue
    const blob = await store.blobFor(meta.id)
    if (blob) next.set(meta.id, URL.createObjectURL(blob))
  }
  // Revoke + drop URLs whose photo was deleted.
  const liveIds = new Set(store.photos.map(p => p.id))
  for (const [id, url] of next) {
    if (!liveIds.has(id)) {
      URL.revokeObjectURL(url)
      next.delete(id)
    }
  }
  urls.value = next
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking the same file
  if (!file) return
  void addPhoto(file)
}

async function addPhoto(file: File) {
  const id = await store.addPhoto(file, todayISO())
  if (id) {
    logEvent('progress_photo_add')
    await ensureUrls()
  }
}

function onThumbClick(id: string) {
  if (compareMode.value) {
    toggleSelected(id)
  } else {
    activeId.value = id
    captionDraft.value = activePhoto.value?.caption ?? ''
  }
}

function toggleSelected(id: string) {
  const idx = selectedIds.value.indexOf(id)
  if (idx >= 0) {
    selectedIds.value = selectedIds.value.filter(x => x !== id)
  } else if (selectedIds.value.length < 2) {
    selectedIds.value = [...selectedIds.value, id]
  }
}

function toggleCompare() {
  compareMode.value = !compareMode.value
  selectedIds.value = []
  if (compareMode.value) logEvent('progress_photo_compare')
}

async function saveCaption() {
  if (activeId.value) await store.setCaption(activeId.value, captionDraft.value)
}

async function remove(id: string) {
  await store.removePhoto(id)
  activeId.value = null
  selectedIds.value = selectedIds.value.filter(x => x !== id)
  logEvent('progress_photo_delete')
  await ensureUrls()
}

function close() {
  emit('close')
}

watch(() => store.photos.length, () => { void ensureUrls() })

onMounted(async () => {
  activateModal()
  await store.hydrate()
  await ensureUrls()
})

onUnmounted(() => {
  deactivateModal()
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
})
</script>

<style scoped>
.ppModal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ppHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ppTitle {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.ppSub {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.ppClose {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 12px;
}

.ppEmpty {
  margin: 0;
  padding: 24px 8px;
  text-align: center;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

.ppGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.ppThumb {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid var(--glass-edge, var(--border-strong));
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elevated);
  cursor: pointer;
}

.ppThumbSelected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}

.ppThumbImg,
.ppThumbPlaceholder {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  background: var(--bg-elevated);
}

.ppThumbDate {
  padding: 4px 6px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  text-align: center;
}

.ppThumbCheck {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 0.75rem;
  font-weight: 700;
}

.ppCompareHint {
  margin: 0;
  font-size: 0.8rem;
  text-align: center;
  color: var(--text-secondary);
}

.ppActions {
  display: flex;
  gap: 12px;
}

.ppBtn {
  flex: 1;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid transparent;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.ppAddBtn {
  position: relative;
}

.ppBtnPrimary {
  background: var(--accent);
  color: var(--text-on-accent);
}

.ppBtnSecondary {
  background: transparent;
  border-color: var(--glass-edge, var(--border-strong));
  color: var(--text-primary);
}

.ppBtnDanger {
  background: transparent;
  border-color: var(--danger);
  color: var(--danger);
}

/* Detail view */
.ppDetail,
.ppCompareCol {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ppDetailImg {
  width: 100%;
  max-height: 55svh;
  object-fit: contain;
  border-radius: 12px;
  background: var(--bg-elevated);
}

.ppDetailDate {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.ppCaptionInput {
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid var(--glass-edge, var(--border-strong));
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.ppDetailActions {
  display: flex;
  gap: 12px;
}

/* Compare view */
.ppCompareWrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ppCompare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ppCompareImg {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 12px;
  background: var(--bg-elevated);
}

.ppCompareDate {
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
  color: var(--text-primary);
}

.ppCompareSpan {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  color: var(--accent);
}
</style>
