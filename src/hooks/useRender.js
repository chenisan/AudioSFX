import { useState, useCallback } from 'react'

export function useRender() {
  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState(0)
  const [messages, setMessages] = useState([])
  const [outputUrl, setOutputUrl] = useState(null)
  const [error, setError] = useState(null)

  const reset = useCallback(() => {
    setProgress(0)
    setMessages([])
    setOutputUrl(null)
    setError(null)
  }, [])

  const render = useCallback(async (projectId, options = {}) => {
    reset()
    setRendering(true)

    const addMsg = (msg) => setMessages(prev => [...prev, msg])

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, ...options }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Render failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let data
          try {
            data = JSON.parse(line.slice(6))
          } catch (e) {
            // Malformed SSE line — skip it
            if (e instanceof SyntaxError) continue
            throw e
          }
          if (data.progress !== undefined) setProgress(data.progress)
          if (data.message) addMsg(data.message)
          if (data.status === 'done' && data.output) setOutputUrl(data.output)
          if (data.status === 'done' && data.outputPath) setOutputUrl(`local:${data.outputPath}`)
          if (data.status === 'error') throw new Error(data.error ?? 'Render failed')
        }
      }
    } catch (e) {
      setError(e.message)
      addMsg(`❌ ${e.message}`)
    } finally {
      setRendering(false)
    }
  }, [reset])

  return { rendering, progress, messages, outputUrl, error, render, reset }
}
