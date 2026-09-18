import { resolve, isAbsolute } from 'path'
import { spawn } from 'child_process'

export interface OpenInEditorResult {
  success: boolean
  targetPath: string
  command?: string
  error?: string
}

export function openInEditor(
  file: string,
  line: number = 1,
  column: number = 1,
  root?: string,
  preferredEditor?: string
): OpenInEditorResult {
  const targetPath = root && !isAbsolute(file) ? resolve(root, file) : file
  const editor = preferredEditor || process.env.EDITOR || process.env.VISUAL

  let cmd = ''
  let args: string[] = []

  if (editor === 'cursor' || editor?.includes('cursor')) {
    cmd = 'cursor'
    args = ['-g', `${targetPath}:${line}:${column}`]
  } else if (editor === 'webstorm' || editor?.includes('webstorm')) {
    cmd = 'webstorm'
    args = ['--line', String(line), '--column', String(column), targetPath]
  } else if (editor === 'code' || editor?.includes('code') || !editor) {
    // Default to VS Code
    cmd = 'code'
    args = ['-g', `${targetPath}:${line}:${column}`]
  } else {
    cmd = editor
    args = [`${targetPath}:${line}:${column}`]
  }

  try {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true
    })
    child.on('error', () => {
      // Gracefully catch when editor executable is not in PATH
    })
    child.unref()
    return {
      success: true,
      targetPath,
      command: `${cmd} ${args.join(' ')}`
    }
  } catch (err: any) {
    return {
      success: false,
      targetPath,
      command: `${cmd} ${args.join(' ')}`,
      error: err.message
    }
  }
}

export function handleOpenSourceEndpoint(
  req: any,
  res: any,
  root?: string,
  preferredEditor?: string
): boolean {
  try {
    const urlObj = new URL(req.url, 'http://localhost')
    const file = urlObj.searchParams.get('file')
    const line = Number(urlObj.searchParams.get('line')) || 1
    const column = Number(urlObj.searchParams.get('column')) || 1
    const editor = urlObj.searchParams.get('editor') || preferredEditor

    if (!file) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Missing file parameter' }))
      return true
    }

    const result = openInEditor(file, line, column, root, editor)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify(result))
    return true
  } catch (e: any) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e.message }))
    return true
  }
}
