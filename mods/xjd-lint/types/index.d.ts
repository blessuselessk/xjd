export type Severity = 'error' | 'warning'

/** One problem, in the shape SPEC.md defines. */
export type Finding = {
  id: string
  alias?: string
  source: string
  code: string
  path: string
  message: string
  severity: Severity
}

/** Where the system is and how to check it. Null in state means out of scope. */
export type Home = {
  dir: string
  config: string
  watch: string[]
  ignore: string[]
}

export type Run = 'idle' | 'checking' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    'xjd-lint': {
      home: Home | null
      findings: Finding[]
      baseline: string[]
      run: Run
      asOf: number
      isOpen: boolean
    }
  }
}
