<template>
  <slot v-if="!error"></slot>
  <div v-else class="errorBoundary" role="alert">
    <div class="errorBoundaryIcon">!</div>
    <h2 class="errorBoundaryTitle">Something went wrong</h2>
    <p class="errorBoundaryMessage">{{ error.message }}</p>
    <button class="errorBoundaryBtn" @click="recover">Reload</button>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'

const error = ref(null)

onErrorCaptured((err) => {
  error.value = err
  console.error('[ErrorBoundary]', err)
  return false // prevent propagation
})

function recover() {
  error.value = null
}
</script>
