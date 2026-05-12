import { ref, watch, type Ref } from 'vue'

const restTimerEnabled: Ref<boolean> = ref(localStorage.getItem('rest-timer') !== 'off')
const restTimerAutoStart: Ref<boolean> = ref(localStorage.getItem('rest-timer-autostart') !== 'off')

watch(restTimerEnabled, (v) => localStorage.setItem('rest-timer', v ? 'on' : 'off'))
watch(restTimerAutoStart, (v) => localStorage.setItem('rest-timer-autostart', v ? 'on' : 'off'))

export function useRestTimer() {
  function setRestTimerEnabled(enabled: boolean): void {
    restTimerEnabled.value = enabled
  }

  return { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled }
}
