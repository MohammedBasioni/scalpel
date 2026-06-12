import { writeFileSync } from 'node:fs'
const lines: string[] = []
let ts = Date.parse('2026-06-11T09:00:00Z')
const push = (o: object) => lines.push(JSON.stringify({ timestamp: new Date((ts += 30_000)).toISOString(), ...o }))
push({ type: 'user', message: { role: 'user', content: 'fix the failing test in parser.ts' } })
let id = 0
const tool = (name: string, input: object, result: string, isError = false) => {
  const tid = `toolu_fix_${++id}`
  push({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: tid, name, input }], usage: { input_tokens: 50, output_tokens: 80, cache_read_input_tokens: 5000 * id, cache_creation_input_tokens: 500 } } })
  push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: result, ...(isError ? { is_error: true } : {}) }] } })
}
// the superseded read and the failed test run are deliberately huge (~11k tokens each):
// they must clear the economist's warm-cache inequality so the bench test sees surgery
tool('Read', { file_path: '/src/parser.ts' }, 'export function parse() {/* v1 */}'.padEnd(40_000, 'x'))
tool('Bash', { command: 'npm test' }, 'FAIL parser.test.ts\n  expected 3 got 2\n'.padEnd(40_000, 'e'), true)
tool('Edit', { file_path: '/src/parser.ts', old_string: 'v1', new_string: 'v2' }, 'edited ok')
tool('Read', { file_path: '/src/parser.ts' }, 'export function parse() {/* v2 */}'.padEnd(4000, 'y'))
for (let i = 0; i < 8; i++) tool('Bash', { command: `echo step ${i}` }, `step ${i} ok`.padEnd(1500, 'z'))
tool('Bash', { command: 'npm test' }, 'PASS parser.test.ts'.padEnd(2000, 'p'))
push({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'Fixed and verified.' }], usage: { input_tokens: 50, output_tokens: 60, cache_read_input_tokens: 80000, cache_creation_input_tokens: 200 } } })
writeFileSync('test/fixtures/synthetic-session.jsonl', lines.join('\n') + '\n')
console.log(`wrote ${lines.length} lines`)
