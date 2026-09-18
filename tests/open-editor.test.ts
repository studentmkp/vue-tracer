import { describe, it, expect } from 'vitest'
import { openInEditor, handleOpenSourceEndpoint } from '../packages/vite-plugin/src/open-editor.ts'

describe('open-editor module', () => {
  describe('openInEditor', () => {
    it('formats command for VS Code by default', () => {
      const res = openInEditor('src/App.vue', 10, 2, '/app', 'code')
      expect(res.success).toBe(true)
      expect(res.targetPath).toBe('/app/src/App.vue')
      expect(res.command).toBe('code -g /app/src/App.vue:10:2')
    })

    it('formats command for Cursor with -g flag', () => {
      const res = openInEditor('src/App.vue', 15, 4, '/app', 'cursor')
      expect(res.success).toBe(true)
      expect(res.targetPath).toBe('/app/src/App.vue')
      expect(res.command).toBe('cursor -g /app/src/App.vue:15:4')
    })

    it('formats command for WebStorm with --line and --column flags', () => {
      const res = openInEditor('src/App.vue', 20, 1, '/app', 'webstorm')
      expect(res.success).toBe(true)
      expect(res.targetPath).toBe('/app/src/App.vue')
      expect(res.command).toBe('webstorm --line 20 --column 1 /app/src/App.vue')
    })

    it('formats command for custom editor binary', () => {
      const res = openInEditor('src/App.vue', 5, 1, '/app', 'subl')
      expect(res.success).toBe(true)
      expect(res.targetPath).toBe('/app/src/App.vue')
      expect(res.command).toBe('subl /app/src/App.vue:5:1')
    })
  })

  describe('handleOpenSourceEndpoint', () => {
    it('returns 200 and JSON payload for valid request', () => {
      let statusCode = 0
      let body = ''
      const headers: Record<string, string> = {}
      const req = { url: '/__reactive-trace/open-source?file=src/main.ts&line=12&column=3' }
      const res = {
        set statusCode(code: number) {
          statusCode = code
        },
        setHeader(name: string, val: string) {
          headers[name] = val
        },
        end(data: string) {
          body = data
        }
      }

      const handled = handleOpenSourceEndpoint(req, res, '/root', 'cursor')
      expect(handled).toBe(true)
      expect(statusCode).toBe(200)
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Access-Control-Allow-Origin']).toBe('*')
      const parsed = JSON.parse(body)
      expect(parsed.success).toBe(true)
      expect(parsed.targetPath).toBe('/root/src/main.ts')
      expect(parsed.command).toContain('cursor -g /root/src/main.ts:12:3')
    })

    it('returns 400 when file query parameter is missing', () => {
      let statusCode = 0
      let body = ''
      const req = { url: '/__reactive-trace/open-source?line=12' }
      const res = {
        set statusCode(code: number) {
          statusCode = code
        },
        setHeader() {},
        end(data: string) {
          body = data
        }
      }

      const handled = handleOpenSourceEndpoint(req, res, '/root')
      expect(handled).toBe(true)
      expect(statusCode).toBe(400)
      const parsed = JSON.parse(body)
      expect(parsed.error).toBe('Missing file parameter')
    })
  })
})
