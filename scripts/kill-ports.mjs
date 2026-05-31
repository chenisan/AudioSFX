import { execSync } from 'child_process'

const ports = process.argv.slice(2).map(Number).filter(Boolean)
if (!ports.length) process.exit(0)

const isWin = process.platform === 'win32'

for (const port of ports) {
  try {
    if (isWin) {
      const out = execSync('netstat -ano').toString()
      const m = out.match(new RegExp(':' + port + '\\s+.*LISTENING\\s+(\\d+)'))
      if (m) {
        execSync('taskkill /F /PID ' + m[1])
        console.log('Killed stale PID', m[1], 'on port', port)
      }
    } else {
      const pids = execSync(`lsof -ti :${port}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().split('\n').filter(Boolean)
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`)
        console.log('Killed stale PID', pid, 'on port', port)
      }
    }
  } catch { /* not found = ok */ }
}
