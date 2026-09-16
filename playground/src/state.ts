import { ref } from 'vue'

/** Module-scope singleton — should be classified as `scope: 'module'` (§23). */
export const sessionUser = ref(null)
