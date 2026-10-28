import { WebSocketClient } from '../../frontend/src/ws/client'

const client = new WebSocketClient(`ws://${location.host}/ws`)
Object.assign(window, { sessionClient: client, framesReceived: 0 })
client.on('STREAM_TOKEN_RECEIVED', () => {
  ;(window as any).framesReceived++
  client.send({ type: 'probe_ack' })
})
client.setFocusedChat('background-probe')
client.connect()
