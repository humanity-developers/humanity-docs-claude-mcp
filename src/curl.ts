type SnippetArgs = {
  method: string
  url: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean>
  jsonBody?: unknown
}

function buildQueryString(query: Record<string, string | number | boolean>): string {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

function withContentType(headers: Record<string, string>, jsonBody: unknown): Record<string, string> {
  if (jsonBody === undefined) return headers
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  if (hasContentType) return headers
  return { ...headers, 'Content-Type': 'application/json' }
}

function toPythonLiteral(val: unknown): string {
  if (val === null) return 'None'
  if (val === true) return 'True'
  if (val === false) return 'False'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (Array.isArray(val)) return `[${val.map(toPythonLiteral).join(', ')}]`
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>).map(
      ([k, v]) => `'${k}': ${toPythonLiteral(v)}`,
    )
    return `{${entries.join(', ')}}`
  }
  return String(val)
}

function generateCurlSnippet(
  method: string,
  url: string,
  headers: Record<string, string>,
  jsonBody: unknown,
): string {
  const headerFlags = Object.entries(headers).map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
  const bodyFlag = jsonBody !== undefined ? `-d '${JSON.stringify(jsonBody)}'` : ''

  const lines = [
    `curl -sS -X ${method}`,
    ...headerFlags.map((h) => `  ${h}`),
    ...(bodyFlag ? [`  ${bodyFlag}`] : []),
    `  ${JSON.stringify(url)}`,
  ]

  return lines.join(' \\\n')
}

function generateHttpSnippet(
  method: string,
  url: string,
  headers: Record<string, string>,
  jsonBody: unknown,
): string {
  const parsed = new URL(url)
  const pathWithQuery = parsed.pathname + parsed.search

  const lines = [
    `${method} ${pathWithQuery} HTTP/1.1`,
    `Host: ${parsed.host}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ]

  if (jsonBody !== undefined) {
    lines.push('')
    lines.push(JSON.stringify(jsonBody))
  }

  return lines.join('\n')
}

function generateJsSnippet(
  method: string,
  url: string,
  headers: Record<string, string>,
  jsonBody: unknown,
): string {
  const headerEntries = Object.entries(headers)
  const lines: string[] = [
    `const response = await fetch('${url}', {`,
    `  method: '${method}',`,
  ]

  if (headerEntries.length > 0) {
    lines.push(`  headers: {`)
    for (const [k, v] of headerEntries) {
      lines.push(`    '${k}': '${v}',`)
    }
    lines.push(`  },`)
  }

  if (jsonBody !== undefined) {
    lines.push(`  body: JSON.stringify(${JSON.stringify(jsonBody)}),`)
  }

  lines.push(`})`)
  lines.push(`const data = await response.json()`)

  return lines.join('\n')
}

function generatePythonSnippet(
  method: string,
  baseUrl: string,
  allHeaders: Record<string, string>,
  jsonBody: unknown,
  query: Record<string, string | number | boolean>,
): string {
  const methodLower = method.toLowerCase()

  const headers =
    jsonBody !== undefined
      ? Object.fromEntries(
          Object.entries(allHeaders).filter(([k]) => k.toLowerCase() !== 'content-type'),
        )
      : allHeaders

  const lines: string[] = ['import requests', '']
  lines.push(`response = requests.${methodLower}(`)
  lines.push(`    '${baseUrl}',`)

  if (Object.keys(headers).length > 0) {
    const hDict = Object.entries(headers)
      .map(([k, v]) => `'${k}': '${v}'`)
      .join(', ')
    lines.push(`    headers={${hDict}},`)
  }

  if (Object.keys(query).length > 0) {
    const pDict = Object.entries(query)
      .map(([k, v]) => `'${k}': ${toPythonLiteral(v)}`)
      .join(', ')
    lines.push(`    params={${pDict}},`)
  }

  if (jsonBody !== undefined) {
    lines.push(`    json=${toPythonLiteral(jsonBody)},`)
  }

  lines.push(`)`)
  lines.push(`data = response.json()`)

  return lines.join('\n')
}

export function generateCodeSnippet(lang: string, args: SnippetArgs): string {
  const method = (args.method || 'GET').toUpperCase()
  const query = args.query || {}

  const qs = buildQueryString(query)
  const urlWithQuery = qs
    ? args.url + (args.url.includes('?') ? '&' : '?') + qs
    : args.url

  const headers = withContentType({ ...(args.headers || {}) }, args.jsonBody)

  switch (lang) {
    case 'http':
      return generateHttpSnippet(method, urlWithQuery, headers, args.jsonBody)
    case 'javascript':
      return generateJsSnippet(method, urlWithQuery, headers, args.jsonBody)
    case 'python':
        return generatePythonSnippet(method, args.url, headers, args.jsonBody, query)
    default:
      return generateCurlSnippet(method, urlWithQuery, headers, args.jsonBody)
  }
}
