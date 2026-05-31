import { EventEmitter } from 'events'

export interface ProjectChangedEvent {
  projectId: string
  updatedAt: string
}

const bus = new EventEmitter()
// Multiple SSE clients may subscribe to the same project simultaneously.
bus.setMaxListeners(0)

export function emitProjectChanged(ev: ProjectChangedEvent): void {
  bus.emit('changed', ev)
}

export function onProjectChanged(handler: (ev: ProjectChangedEvent) => void): () => void {
  bus.on('changed', handler)
  return () => bus.off('changed', handler)
}
