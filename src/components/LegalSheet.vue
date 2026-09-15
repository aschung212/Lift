<template>
  <Teleport to="body">
    <Transition name="undoToast">
      <div v-if="view" class="kbOverlay" @click.self="emit('close')" @keydown.escape="emit('close')">
        <div class="legalSheet" role="dialog" aria-modal="true" :aria-labelledby="'legal-title'">
          <div class="legalHeader">
            <h3 id="legal-title" class="kbTitle">{{ legalDocument.title }}</h3>
            <button class="kbClose legalClose" @click="emit('close')">Close</button>
          </div>
          <div class="legalBody">
            <!-- Both documents render src/lib/legalCopy.ts, the same source the
                 build emits as /legal/privacy.html and /legal/terms.html (#537). -->
            <p class="legalUpdated">Last updated {{ LEGAL_UPDATED }}</p>
            <template v-for="section in legalDocument.sections" :key="section.heading">
              <h4 class="legalH4">{{ section.heading }}</h4>
              <p v-for="(paragraph, i) in section.paragraphs" :key="i">{{ paragraph }}</p>
              <ul v-if="section.items" class="legalList">
                <li v-for="item in section.items" :key="item.term"><strong>{{ item.term }}</strong> — {{ item.text }}</li>
              </ul>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, nextTick, computed } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap'
import { LEGAL_DOCUMENTS, LEGAL_UPDATED } from '../lib/legalCopy'

const props = defineProps<{
  /** Which document to show; null renders nothing (sheet closed). */
  view: 'privacy' | 'terms' | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const focusTrap = useFocusTrap()

// `view` is null while closed; the template is v-if'd on it, so this only
// resolves once there is something to show.
const legalDocument = computed(() => LEGAL_DOCUMENTS[props.view ?? 'privacy'])

watch(() => props.view, async (view) => {
  if (view) {
    await nextTick()
    const el = document.querySelector<HTMLElement>('.legalSheet')
    if (el) focusTrap.activate(el)
  } else {
    focusTrap.deactivate()
  }
})
</script>
