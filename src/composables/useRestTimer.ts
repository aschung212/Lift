import { ref, watch, type Ref } from 'vue'

const isBrowser = typeof localStorage !== 'undefined'

const restTimerEnabled: Ref<boolean> = ref(
  isBrowser ? localStorage.getItem('rest-timer') !== 'off' : true
)
const restTimerAutoStart: Ref<boolean> = ref(
  isBrowser ? localStorage.getItem('rest-timer-autostart') !== 'off' : true
)

if (isBrowser) {
  watch(restTimerEnabled, (v) => localStorage.setItem('rest-timer', v ? 'on' : 'off'))
  watch(restTimerAutoStart, (v) => localStorage.setItem('rest-timer-autostart', v ? 'on' : 'off'))
}

export function useRestTimer() {
  function setRestTimerEnabled(enabled: boolean): void {
    restTimerEnabled.value = enabled
  }

  return { restTimerEnabled, restTimerAutoStart, setRestTimerEnabled }
}
