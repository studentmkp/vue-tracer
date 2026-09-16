<template>
  <div class="container">
    <header class="hero">
      <div class="tag">Vue Reactive Trace DevTool • MVP 3</div>
      <h1>Causality Tracing Playground</h1>
      <p>
        Observe exact causality traces from User Interaction → Async Context → Reactive Mutation → Watch / Computed → Vue Component Render.
      </p>
    </header>

    <div class="grid">
      <!-- Section 1: Ref & UpdateExpression -->
      <div class="card">
        <div class="card-title">1. Ref Counter</div>
        <div class="counter-val">{{ count }}</div>
        <div class="btn-row">
          <button id="inc-btn" class="btn btn-primary" @click="increment">count++</button>
          <button id="dec-btn" class="btn btn-secondary" @click="decrement">count--</button>
          <button id="reset-btn" class="btn btn-danger" @click="reset">reset</button>
        </div>
      </div>

      <!-- Section 2: Nested Reactive Properties -->
      <div class="card">
        <div class="card-title">2. Nested Reactive State</div>
        <div class="info-row">
          <span>user.profile.name:</span>
          <strong style="color: #c084fc;">{{ user.profile.name }}</strong>
        </div>
        <div class="info-row">
          <span>user.profile.role:</span>
          <strong style="color: #94a3b8;">{{ user.profile.role }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-purple" @click="changeName('Alice')">Set Alice</button>
          <button class="btn btn-purple" @click="changeName('Bob')">Set Bob</button>
          <button class="btn btn-purple" @click="changeName('Charlie')">Set Charlie</button>
        </div>
      </div>

      <!-- Section 3: Array Mutations & Computed -->
      <div class="card">
        <div class="card-title">3. Array Mutation & Computed</div>
        <div class="info-row">
          <span>Items in Cart:</span>
          <strong style="color: #38bdf8;">{{ cart.items.length }}</strong>
        </div>
        <div class="info-row">
          <span>Computed Total Price:</span>
          <strong style="color: #fbbf24;">${{ cartTotal }}</strong>
        </div>
        <div class="cart-items-preview">
          <span v-for="(item, idx) in cart.items" :key="idx" class="item-tag">
            {{ item.name }} (${{ item.price }})
          </span>
        </div>
        <div class="btn-row" style="margin-top: 12px;">
          <button class="btn btn-primary" @click="addCartItem">cart.items.push()</button>
          <button class="btn btn-secondary" @click="removeCartItem">cart.items.pop()</button>
        </div>
      </div>

      <!-- Section 4: Pinia Store -->
      <div class="card">
        <div class="card-title">4. Pinia Store Integration</div>
        <div class="info-row">
          <span>Pinia Store ID:</span>
          <strong style="color: #38bdf8;">favorites</strong>
        </div>
        <div class="info-row">
          <span>Favorite Items:</span>
          <strong style="color: #34d399;">{{ favStore.items.join(', ') || 'None' }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-emerald" @click="addFavorite">Add to Favorites</button>
          <button class="btn btn-secondary" @click="clearFavorites">Clear</button>
        </div>
      </div>

      <!-- Section 5: Async / Await & Promise (MVP 2) -->
      <div class="card">
        <div class="card-title">5. Async Context (async / await)</div>
        <div class="info-row">
          <span>Async Status:</span>
          <strong :style="{ color: authLoading ? '#facc15' : '#34d399' }">{{ authLoading ? 'Logging in...' : authUser ? authUser.name : 'Logged out' }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-primary" :disabled="authLoading" @click="handleAsyncLogin">Simulate Async Login</button>
          <button class="btn btn-secondary" :disabled="authLoading" @click="handleLogout">Logout</button>
        </div>
      </div>

      <!-- Section 6: Watch & WatchEffect (MVP 2) -->
      <div class="card">
        <div class="card-title">6. Watcher Tracking (watch & watchEffect)</div>
        <div class="info-row">
          <span>Observed Target:</span>
          <strong style="color: #38bdf8;">userId = {{ watchUserId }}</strong>
        </div>
        <div class="info-row">
          <span>Watcher Result:</span>
          <strong style="color: #facc15;">{{ watcherMessage }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-purple" @click="watchUserId++">Increment userId</button>
        </div>
      </div>

      <!-- Section 7: Map & Set Mutations (MVP 2) -->
      <div class="card">
        <div class="card-title">7. Reactive Map & Set</div>
        <div class="info-row">
          <span>Map Size:</span>
          <strong style="color: #38bdf8;">{{ reactiveMap.size }} entries</strong>
        </div>
        <div class="info-row">
          <span>Set Size:</span>
          <strong style="color: #34d399;">{{ reactiveSet.size }} items</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-primary" @click="addMapEntry">map.set()</button>
          <button class="btn btn-secondary" @click="clearMap">map.clear()</button>
          <button class="btn btn-emerald" @click="addSetItem">set.add()</button>
          <button class="btn btn-secondary" @click="clearSet">set.clear()</button>
        </div>
      </div>

      <!-- Section 8: Event Aggregation (MVP 2) -->
      <div class="card">
        <div class="card-title">8. Event Aggregation (Section 40)</div>
        <div class="info-row">
          <span>Batched Items:</span>
          <strong style="color: #c084fc;">{{ batchItems.length }} items</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-purple" @click="runBatchLoop(100)">Batch 100 Mutations</button>
          <button class="btn btn-purple" @click="runBatchLoop(1000)">Batch 1,000 Mutations</button>
          <button class="btn btn-secondary" @click="batchItems = []">Reset</button>
        </div>
      </div>

      <!-- Section 9: User Interaction Tracking (Input & Change) -->
      <div class="card" style="grid-column: 1 / -1;">
        <div class="card-title">9. User Interaction Capture (input / change)</div>
        <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px;">
          <input
            id="text-input"
            type="text"
            class="vrt-input"
            placeholder="Type here to test input event tracing..."
            v-model="inputText"
          />
          <span style="color: #94a3b8; font-size: 13px;">Live ref value: <strong style="color: #38bdf8;">{{ inputText }}</strong></span>
        </div>
      </div>

      <!-- Section 10: Custom Composable Tracing (MVP 3) -->
      <div class="card">
        <div class="card-title">10. Custom Composable Tracing (Section 25)</div>
        <div class="info-row">
          <span>Composable:</span>
          <strong style="color: #38bdf8;">useFeatureCounter()</strong>
        </div>
        <div class="info-row">
          <span>Feature Value:</span>
          <strong style="color: #34d399;">{{ featureCount }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-primary" @click="incrementFeature">incrementFeature()</button>
          <button class="btn btn-secondary" @click="decrementFeature">decrementFeature()</button>
        </div>
      </div>

      <!-- Section 11: External Reactive Labeling (MVP 3) -->
      <div class="card">
        <div class="card-title">11. External Reactive Labeling (Section 24, 26, 43)</div>
        <div class="info-row">
          <span>Origin:</span>
          <strong style="color: #fb7185;">@vueuse/core (simulated)</strong>
        </div>
        <div class="info-row">
          <span>External Position:</span>
          <strong style="color: #facc15;">x: {{ mousePos.x }}, y: {{ mousePos.y }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button class="btn btn-purple" @click="simulateExternalMutation">Simulate External Mutation</button>
        </div>
      </div>

      <!-- Section 12: Compound assignment semantics (%=) -->
      <div class="card">
        <div class="card-title">12. Compound Assignment (%=)</div>
        <div class="info-row">
          <span>remainder (start 7):</span>
          <strong id="remainder-val" style="color: #38bdf8;">{{ remainder }}</strong>
        </div>
        <div class="info-row">
          <span>Native 7 % 4:</span>
          <strong style="color: #34d399;">3</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button id="mod-btn" class="btn btn-primary" @click="applyMod">remainder %= 4</button>
          <button class="btn btn-secondary" @click="resetRemainder">reset</button>
        </div>
      </div>

      <!-- Section 13: Module-scope global reactive (§23) -->
      <div class="card">
        <div class="card-title">13. Global Reactive (module scope)</div>
        <div class="info-row">
          <span>sessionUser:</span>
          <strong id="session-user-val" style="color: #fbbf24;">{{ sessionUser?.name || 'null' }}</strong>
        </div>
        <div class="btn-row" style="margin-top: 14px;">
          <button id="login-session-btn" class="btn btn-primary" @click="loginSession">set session</button>
          <button class="btn btn-danger" @click="logoutSession">clear</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, watchEffect } from 'vue'
import { defineStore } from 'pinia'
import { sessionUser } from './state'

// 1. Ref
const count = ref(0)
function increment() {
  count.value++
}
function decrement() {
  count.value--
}
function reset() {
  count.value = 0
}

// 2. Nested reactive
const user = reactive({
  profile: {
    name: 'Alice',
    role: 'Engineer'
  }
})
function changeName(newName) {
  user.profile.name = newName
}

// 3. Array mutations & Computed
const cart = reactive({
  items: [
    { name: 'Keyboard', price: 89 },
    { name: 'Mouse', price: 49 }
  ]
})
const cartTotal = computed(() => {
  return cart.items.reduce((sum, item) => sum + item.price, 0)
})

let itemCounter = 1
function addCartItem() {
  cart.items.push({
    name: `Item #${itemCounter++}`,
    price: Math.floor(Math.random() * 50) + 10
  })
}
function removeCartItem() {
  cart.items.pop()
}

// 4. Pinia store
const useFavoritesStore = defineStore('favorites', {
  state: () => ({
    items: ['Vue 3', 'Vite']
  }),
  actions: {
    add(item) {
      this.items.push(item)
    },
    clear() {
      this.items = []
    }
  }
})
const favStore = useFavoritesStore()
let favIndex = 1
function addFavorite() {
  favStore.add(`Star #${favIndex++}`)
}
function clearFavorites() {
  favStore.clear()
}

// 5. Async / Await & Promise (MVP 2)
const authLoading = ref(false)
const authUser = ref(null)
async function handleAsyncLogin() {
  authLoading.value = true
  await new Promise((resolve) => setTimeout(resolve, 350))
  authUser.value = { name: 'Dr. Sarah Connor', token: 'jwt_xyz987' }
  authLoading.value = false
}
function handleLogout() {
  authUser.value = null
}

// 6. Watcher Tracking (MVP 2)
const watchUserId = ref(1)
const watcherMessage = ref('Ready')
watch(watchUserId, (newId) => {
  watcherMessage.value = `Loaded user #${newId} at ${new Date().toLocaleTimeString()}`
})

// 7. Reactive Map & Set (MVP 2)
const reactiveMap = reactive(new Map())
reactiveMap.set('defaultEnv', 'development')
let mapKeyIndex = 1
function addMapEntry() {
  reactiveMap.set(`key_${mapKeyIndex++}`, `Value ${Math.floor(Math.random() * 100)}`)
}
function clearMap() {
  reactiveMap.clear()
}

const reactiveSet = reactive(new Set(['initial-tag']))
let setTagIndex = 1
function addSetItem() {
  reactiveSet.add(`tag-${setTagIndex++}`)
}
function clearSet() {
  reactiveSet.clear()
}

// 8. Event Aggregation (MVP 2)
const batchItems = ref([])
function runBatchLoop(count) {
  for (let i = 0; i < count; i++) {
    batchItems.value.push(i)
  }
}

// 9. Input interaction
const inputText = ref('')

// 10. Custom Composable Tracing (Section 25)
function useFeatureCounter(initial = 5) {
  const featureCount = ref(initial)
  function incrementFeature() {
    featureCount.value++
  }
  function decrementFeature() {
    featureCount.value--
  }
  return { featureCount, incrementFeature, decrementFeature }
}
const { featureCount, incrementFeature, decrementFeature } = useFeatureCounter(5)

// 11. External Reactive Labeling (Section 24, 26, 43)
const mousePos = reactive({ x: 120, y: 340 })
// Register as external reactive (simulating @vueuse/core useMouse)
import { registerExternalReactive } from '@vue-reactive-trace/runtime'
registerExternalReactive(mousePos, { name: 'mousePos', origin: '@vueuse/core' })

function simulateExternalMutation() {
  mousePos.x += 10
  mousePos.y += 15
}

// 12. Compound assignment (%=) — native 7 %= 4 is 3, not a plain assignment of 4
const remainder = ref(7)
function applyMod() {
  remainder.value %= 4
}
function resetRemainder() {
  remainder.value = 7
}

function loginSession() {
  sessionUser.value = { name: 'Ada Lovelace' }
}
function logoutSession() {
  sessionUser.value = null
}
</script>

<style scoped>
.container {
  max-width: 820px;
  margin: 40px auto;
  padding: 0 20px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #f1f5f9;
}
.hero {
  text-align: center;
  margin-bottom: 32px;
}
.tag {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(56, 189, 248, 0.1);
  color: #38bdf8;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
  border: 1px solid rgba(56, 189, 248, 0.2);
}
h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.5px;
}
p {
  color: #94a3b8;
  margin: 0;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.card {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.4);
}
.card-title {
  font-size: 13px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}
.counter-val {
  font-size: 48px;
  font-weight: 800;
  color: #f8fafc;
  line-height: 1;
  margin-bottom: 16px;
  font-variant-numeric: tabular-nums;
}
.info-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
  color: #cbd5e1;
}
.cart-items-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  min-height: 28px;
}
.item-tag {
  background: #1e293b;
  border: 1px solid #334155;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: #e2e8f0;
}
.btn-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}
.btn-primary { background: #0284c7; color: #fff; }
.btn-secondary { background: #334155; color: #f1f5f9; }
.btn-purple { background: #7c3aed; color: #fff; }
.btn-emerald { background: #059669; color: #fff; }
.btn-danger { background: #dc2626; color: #fff; }
.vrt-input {
  flex: 1;
  background: #020617;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px 12px;
  color: #f8fafc;
  font-size: 13px;
  outline: none;
}
.vrt-input:focus {
  border-color: #38bdf8;
}
</style>
