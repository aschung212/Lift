<template>
  <Teleport to="body">
    <div class="repMaxOverlay photoOverlay" @click.self="close">
      <div
        class="repMaxModal photoSheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-sheet-title"
      >
        <!-- Header -->
        <div class="photoHeader">
          <button
            v-if="mode !== 'grid'"
            class="photoIconBtn"
            aria-label="Back to timeline"
            @click="mode = 'grid'"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span v-else class="photoIconBtnSpacer" aria-hidden="true"></span>

          <h2 id="photo-sheet-title" class="photoTitle">Progress Photos</h2>

          <button class="photoIconBtn" aria-label="Close progress photos" @click="close">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p class="photoPrivacyNote">
          Photos stay on this device and are never uploaded.
        </p>

        <!-- ── Grid / timeline ─────────────────────────────────────── -->
        <template v-if="mode === 'grid'">
          <div class="photoActions">
            <button class="wtLogBtn photoAddBtn" @click="pickPhoto">+ Add Photo</button>
            <button
              v-if="store.count >= 2"
              class="photoCompareBtn"
              @click="openCompare"
            >Compare</button>
          </div>

          <p v-if="store.count === 0" class="wtEmpty photoEmpty">
            Capture a progress photo to start your visual timeline.<br />
            Same pose, same lighting, and a few weeks apart shows the most change.
          </p>

          <ul v-else class="photoGrid">
            <li v-for="photo in store.sorted" :key="photo.id" class="photoTileWrap">
              <button
                class="photoTile"
                :aria-label="`View progress photo from ${fullDate(photo.date)}`"
                @click="openDetail(photo.id)"
              >
                <img
                  v-if="urls[photo.id]"
                  :src="urls[photo.id]"
                  :alt="`Progress photo from ${fullDate(photo.date)}`"
                  class="photoTileImg"
                />
                <span v-else class="photoTilePlaceholder" aria-hidden="true"></span>
                <span class="photoTileDate">{{ shortDate(photo.date) }}</span>
              </button>
            </li>
          </ul>
        </template>

        <!-- ── Detail ──────────────────────────────────────────────── -->
        <template v-else-if="mode === 'detail' && detailPhoto">
          <div class="photoDetail">
            <img
              v-if="urls[detailPhoto.id]"
              :src="urls[detailPhoto.id]"
              :alt="`Progress photo from ${fullDate(detailPhoto.date)}`"
              class="photoDetailImg"
            />
            <p class="photoDetailDate">{{ fullDate(detailPhoto.date) }}</p>

            <label class="photoNoteLabel">
              Note
              <textarea
                v-model="noteDraft"
                class="photoNoteInput"
                rows="2"
                maxlength="200"
                placeholder="Bodyweight, phase, how you felt…"
                @blur="saveNote"
              ></textarea>
            </label>

            <div v-if="!confirmingDelete" class="photoDetailActions">
              <button class="photoDeleteBtn" @click="confirmingDelete = true">Delete Photo</button>
            </div>
            <div v-else class="photoConfirmRow">
              <span class="photoConfirmText">Delete this photo? This can't be undone.</span>
              <div class="photoConfirmBtns">
                <button class="photoConfirmCancel" @click="confirmingDelete = false">Cancel</button>
                <button class="photoConfirmDelete" @click="removePhoto">Delete</button>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Compare ─────────────────────────────────────────────── -->
        <template v-else-if="mode === 'compare'">
          <div class="photoCompare">
            <div class="photoCompareCol">
              <label class="photoCompareLabel">
                Before
                <select v-model="beforeId" class="photoCompareSelect">
                  <option v-for="p in store.sorted" :key="p.id" :value="p.id">{{ shortDate(p.date) }}</option>
                </select>
              </label>
              <img
                v-if="beforeId && urls[beforeId]"
                :src="urls[beforeId]"
                :alt="`Before photo from ${fullDate(beforePhoto?.date || '')}`"
                class="photoCompareImg"
              />
            </div>
            <div class="photoCompareCol">
              <label class="photoCompareLabel">
                After
                <select v-model="afterId" class="photoCompareSelect">
                  <option v-for="p in store.sorted" :key="p.id" :value="p.id">{{ shortDate(p.date) }}</option>
                </select>
              </label>
              <img
                v-if="afterId && urls[afterId]"
                :src="urls[afterId]"
                :alt="`After photo from ${fullDate(afterPhoto?.date || '')}`"
                class="photoCompareImg"
              />
            </div>
          </div>
          <p v-if="compareSpanDays > 0" class="photoCompareSpan">
            {{ compareSpanDays }} {{ compareSpanDays === 1 ? 'day' : 'days' }} apart
          </p>
        </template>

        <!-- Hidden file input drives both camera capture and library pick on iOS -->
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="photoFileInput"
          aria-label="Add progress photo"
          aria-hidden="true"
          tabindex="-1"
          @change="onFileChange"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { usePhotosStore } from '../stores/photos'
import { useModal } from '../composables/useModal'
import { useAnalytics } from '../composables/useAnalytics'
import { getPhotoBlob } from '../lib/progressPhotos'
import { daysBetweenISO } from '../lib/dates'

const emit = defineEmits<{ close: [] }>()

const store = usePhotosStore()
const { logEvent } = useAnalytics()

// useModal owns the scroll-lock + focus-trap + Escape-close lifecycle. The
// sheet is mounted already-open (parent uses v-if), so open() runs on mount.
const { open: openModal, close: closeModal } = useModal({
  selector: '[aria-labelledby="photo-sheet-title"]',
  focusContainer: true,
  onEscape: () => close(),
})

type Mode = 'grid' | 'detail' | 'compare'
const mode = ref<Mode>('grid')

// Object URLs for loaded blobs, keyed by photo id. Revoked on unmount.
const urls = reactive<Record<string, string>>({})

async function loadUrls() {
  for (const photo of store.photos) {
    if (urls[photo.id]) continue
    const blob = await getPhotoBlob(photo.id)
    if (blob) urls[photo.id] = URL.createObjectURL(blob)
  }
}

function revokeUrls() {
  for (const id of Object.keys(urls)) {
    URL.revokeObjectURL(urls[id])
    delete urls[id]
  }
}

// Reload URLs whenever the set of photos changes (add/delete).
watch(() => store.photos.map(p => p.id).join(','), loadUrls)

// ── Detail ─────────────────────────────────────────────────────────
const detailId = ref<string | null>(null)
const noteDraft = ref('')
const confirmingDelete = ref(false)

const detailPhoto = computed(() => store.photos.find(p => p.id === detailId.value) || null)

function openDetail(id: string) {
  detailId.value = id
  noteDraft.value = detailPhoto.value?.note ?? ''
  confirmingDelete.value = false
  mode.value = 'detail'
}

function saveNote() {
  if (detailId.value) store.updateNote(detailId.value, noteDraft.value)
}

async function removePhoto() {
  if (!detailId.value) return
  const id = detailId.value
  await store.deletePhoto(id)
  if (urls[id]) {
    URL.revokeObjectURL(urls[id])
    delete urls[id]
  }
  logEvent('progress_photo_delete')
  confirmingDelete.value = false
  detailId.value = null
  mode.value = 'grid'
}

// ── Compare ────────────────────────────────────────────────────────
const beforeId = ref<string | null>(null)
const afterId = ref<string | null>(null)

const beforePhoto = computed(() => store.photos.find(p => p.id === beforeId.value) || null)
const afterPhoto = computed(() => store.photos.find(p => p.id === afterId.value) || null)

const compareSpanDays = computed(() => {
  const b = beforePhoto.value?.date
  const a = afterPhoto.value?.date
  if (!b || !a) return 0
  return Math.abs(daysBetweenISO(b, a))
})

function openCompare() {
  const pair = store.comparePair
  if (pair) {
    beforeId.value = pair.before.id
    afterId.value = pair.after.id
  }
  mode.value = 'compare'
  logEvent('progress_photo_compare')
}

// ── Add photo ──────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)

function pickPhoto() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    const id = await store.addPhoto(file)
    if (id) logEvent('progress_photo_add')
  }
  // Reset so re-picking the same file fires change again.
  input.value = ''
  await loadUrls()
}

// ── Date formatting ────────────────────────────────────────────────
function shortDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fullDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function close() {
  closeModal()
  emit('close')
}

onMounted(async () => {
  openModal()
  await loadUrls()
})

onUnmounted(revokeUrls)
</script>
