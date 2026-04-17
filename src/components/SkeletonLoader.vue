<template>
  <div class="skeletonCard" role="status" aria-label="Loading content" aria-busy="true">
    <div class="skeletonHeader">
      <div class="skeletonBlock skeletonTitle"></div>
      <div class="skeletonBlock skeletonBtn"></div>
    </div>
    <div class="skeletonBody">
      <div v-for="i in rows" :key="i" class="skeletonRow">
        <div class="skeletonRowLeft">
          <div class="skeletonBlock skeletonLabel"></div>
          <div class="skeletonBlock skeletonSubLabel"></div>
        </div>
        <div class="skeletonBlock skeletonBadge"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  rows?: number
}>()
</script>
