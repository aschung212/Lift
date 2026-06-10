<template>
  <div class="bodyView">
    <BodyweightTracker />
    <BodyMeasurements />
  </div>
</template>

<script setup lang="ts">
// Container for the "Body" tab: scale weight (BodyweightTracker) plus
// circumference measurements (BodyMeasurements). Kept as a thin wrapper so each
// card stays independently testable and the tab has a single KeepAlive root.
import BodyweightTracker from './BodyweightTracker.vue'
import BodyMeasurements from './BodyMeasurements.vue'
</script>
