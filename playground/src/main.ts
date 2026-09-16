import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { reactiveTraceVueAdapter } from '@vue-reactive-trace/vue-adapter'
import { initDevTools } from '@vue-reactive-trace/devtools-ui'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(reactiveTraceVueAdapter)
app.mount('#app')

initDevTools()
