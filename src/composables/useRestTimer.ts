import { ref, watch, type Ref } from 'vue'

const restTimerEnabled: Ref<boolean> = ref(localStorage.getItem('rest-timer') !== 'off')
const restTimerAutoStart: Ref<boolean> = ref(localStorage.getItem('rest-timer-autostart') !== 'off')

watch(restTimerEnabled, (v) => localStorage.setItem('rest-timer', v ? 'on' : 'off'))
watch(restTimerAutoStart, (v) => localStorage.setItem('rest-timer-autostart', v ? 'on' : 'off'))

export interface UseRestTimerReturn {
  restTimerEnabled: Ref<boolean>
  restTimerAutoStart: Ref<boolean>
  setRestTimerEnabled: (enabled: boolean) => void
}

export function useRestTimer(): UseRestTimerReturn {
  function setRestTimerEnabled(enabled: boolean): void {
    restTimerEnabled.value = enabled
  }

  return { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled }
}
