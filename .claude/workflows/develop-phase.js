export const meta = {
  name: 'develop-phase',
  description: 'Implementa tareas de un plan con agentes especialistas, revisión doble, corrección y verificación. No hace commits.',
  whenToUse: 'Ejecutar un lote de tareas de un plan de docs/superpowers/plans/ de la plataforma de ciclismo',
  phases: [
    { title: 'Implementar', detail: 'agente especialista por tarea, TDD' },
    { title: 'Revisar', detail: 'cumplimiento del plan + calidad de código, en paralelo' },
    { title: 'Verificar', detail: 'pruebas, tipos y build' },
    { title: 'Cierre', detail: 'simplificar, verificación final, revisión global, propuesta de commit' },
  ],
}

// args: { plan: 'docs/superpowers/plans/....md', tasks: [{ n: 2, agent: 'cycling-frontend-dev' }, ...], maxFixRounds?: 2, ui?: true, model?: 'fable' }
const A = args || {}
const PLAN = A.plan
const TASKS = A.tasks || []
const MAX_FIX = A.maxFixRounds == null ? 2 : A.maxFixRounds
// args.reviewers (opcional): 'plan' para un solo revisor (cycling-reviewer).
// args.model (opcional): modelo para todos los agentes del lote, por ejemplo 'fable' o 'sonnet'.
const agentM = (prompt, opts) => agent(prompt, A.model ? { ...opts, model: A.model } : opts)
if (!PLAN || !TASKS.length) throw new Error('Faltan args: { plan, tasks: [{ n, agent }] }')

const SPEC = 'docs/superpowers/specs/2026-11-06-plataforma-ciclismo-design.md'

const IMPL = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    files: { type: 'array', items: { type: 'string' } },
    testsPassed: { type: 'boolean' },
    pendingUser: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    blockedReason: { type: 'string' },
  },
  required: ['status', 'files', 'testsPassed', 'notes'],
}
const REVIEW = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem', 'fix'],
      },
    },
  },
  required: ['approved', 'issues'],
}
const VERIFY = {
  type: 'object',
  properties: { passed: { type: 'boolean' }, output: { type: 'string' } },
  required: ['passed', 'output'],
}

const done = []
const implPrompt = t => `Implementa SOLO la Task ${t.n} del plan ${PLAN} (lee también la spec ${SPEC}).
Tareas ya completadas en este lote: ${done.length ? done.join(', ') : 'ninguna'}; las anteriores del plan ya están en el código.
Sigue los pasos de la tarea en orden, TDD: prueba que falla, verla fallar, implementar, verla pasar.
Omite los pasos de commit: los confirma el usuario después.
Los pasos que necesitan al usuario (crear repositorio, activar Pages, claves, archivo real de Strava, conectar el BSC200S) NO bloquean: anótalos en pendingUser y sigue.
Si falta un dato imprescindible que otra tarea debía producir (por ejemplo docs/verificaciones.md para STRAVA_COLUMNS), devuelve status "blocked" con el motivo.
Devuelve los ficheros creados o modificados y si pasan las pruebas de la tarea.`

const fixPrompt = (t, issues) => `Corrige estos problemas de la Task ${t.n} del plan ${PLAN}, sin ampliar el alcance:
${issues.map((i, k) => `${k + 1}. [${i.severity}] ${i.file || ''} ${i.problem}. Arreglo propuesto: ${i.fix}`).join('\n')}
Vuelve a ejecutar las pruebas de la tarea y devuelve el mismo formato.`

const specReview = (t, impl) => `Revisa el cumplimiento de la Task ${t.n} del plan ${PLAN} frente a la spec ${SPEC}.
Ficheros tocados: ${impl.files.join(', ')}.`

const qualityReview = (t, impl) => `Revisa la calidad del código de la Task ${t.n} (plan ${PLAN}). Busca bugs, errores de lógica, problemas de seguridad (claves, XSS en nombres de actividad importados) y código innecesario.
Mira solo estos ficheros: ${impl.files.join(', ')}.
Severidades: blocker, major o minor. Devuelve approved=true si no hay blocker ni major.`

const verifyPrompt = t => `Verifica la Task ${t.n} del plan ${PLAN}: ejecuta el comando de verificación propio de la tarea (vitest de sus ficheros y, si los hay, los de los módulos que toca, y la spec de Playwright que pida con PLAYWRIGHT_PORT=4517) y npx tsc --noEmit. La suite completa (npx vitest run) y npm run build se pasan una vez en la verificación final del lote; no los ejecutes aquí. Devuelve passed y la parte decisiva de la salida (máximo 40 líneas).`

const results = []
for (const t of TASKS) {
  phase('Implementar')
  let impl = await agentM(implPrompt(t), { label: `T${t.n} ${t.agent}`, phase: 'Implementar', agentType: t.agent, schema: IMPL })
  if (!impl || impl.status === 'blocked') {
    results.push({ task: t.n, status: 'blocked', reason: impl ? impl.blockedReason : 'el agente no respondió' })
    log(`T${t.n} bloqueada. Se detiene el lote.`)
    break
  }

  let open = []
  for (let round = 0; ; round++) {
    const reviews = await parallel([
      () => agentM(specReview(t, impl), { label: `T${t.n} plan`, phase: 'Revisar', agentType: 'cycling-reviewer', schema: REVIEW }),
      // args.reviewers: 'plan' deja solo el revisor del plan (lotes ligeros).
      ...(A.reviewers === 'plan' ? [] : [() => agentM(qualityReview(t, impl), { label: `T${t.n} calidad`, phase: 'Revisar', agentType: 'feature-dev:code-reviewer', schema: REVIEW })]),
    ])
    open = reviews.filter(Boolean).flatMap(r => r.issues.filter(i => i.severity !== 'minor'))
    if (!open.length || round >= MAX_FIX) break
    log(`T${t.n}: ${open.length} problemas, ronda de corrección ${round + 1}`)
    const fixed = await agentM(fixPrompt(t, open), { label: `T${t.n} corrección ${round + 1}`, phase: 'Implementar', agentType: t.agent, schema: IMPL })
    if (fixed) impl = { ...fixed, files: [...new Set([...impl.files, ...fixed.files])], pendingUser: [...(impl.pendingUser || []), ...(fixed.pendingUser || [])] }
  }

  const v = await agentM(verifyPrompt(t), { label: `T${t.n} verificar`, phase: 'Verificar', agentType: 'cycling-qa', schema: VERIFY })
  const ok = !!(v && v.passed) && !open.length
  results.push({ task: t.n, status: ok ? 'ok' : 'needs-attention', files: impl.files, pendingUser: impl.pendingUser || [], openIssues: open, verify: v ? v.output : 'sin verificación', notes: impl.notes })
  if (!ok) {
    log(`T${t.n}: requiere atención (verificación o problemas abiertos). Se detiene el lote.`)
    break
  }
  done.push(t.n)
}

phase('Cierre')
const touched = [...new Set(results.flatMap(r => r.files || []))]
let simplify = null, finalVerify = null, finalReview = null, uiCheck = null
if (results.length && results.every(r => r.status === 'ok')) {
  simplify = await agentM(`Simplifica sin cambiar comportamiento estos ficheros recién escritos: ${touched.join(', ')}. Después ejecuta npx tsc --noEmit y los tests vitest de los ficheros que hayas cambiado; si algo falla, deshaz tu cambio.`, { label: 'simplificar', phase: 'Cierre', agentType: 'code-simplifier:code-simplifier' })
  const tail = [
    () => agentM(`Verificación final del lote (tareas ${done.join(', ')} del plan ${PLAN}): npx vitest run (sin otros procesos en marcha; un test de jsdom que falla por timeout se repite solo antes de darlo por fallo), npx tsc --noEmit, npm run build. Devuelve passed y la salida decisiva.`, { label: 'verificación final', phase: 'Cierre', agentType: 'cycling-qa', schema: VERIFY }),
    () => agentM(`Revisión global de los cambios del lote (tareas ${done.join(', ')} del plan ${PLAN}). Ficheros: ${touched.join(', ')}. Busca problemas entre tareas: interfaces que no encajan, duplicación, seguridad. Devuelve approved=true si no hay blocker ni major.`, { label: 'revisión global', phase: 'Cierre', agentType: 'feature-dev:code-reviewer', schema: REVIEW }),
  ]
  if (A.ui) tail.push(() => agentM(`Revisa las pantallas tocadas en el lote con break-ui (datos extremos) y web-design-guidelines. Solo informa de lo que rompe el uso; lo visual queda para el plan de rediseño. Ficheros: ${touched.join(', ')}.`, { label: 'revisión UI', phase: 'Cierre', agentType: 'cycling-qa', schema: REVIEW }))
  const out = await parallel(tail)
  finalVerify = out[0]; finalReview = out[1]; uiCheck = out[2] || null
}

const commitProposal = results.length ? await agentM(`Propón uno o varios mensajes de commit (imperativo, en castellano, resumen en 1 línea + detalle de qué y por qué) agrupando por intención estos resultados: ${JSON.stringify(results.map(r => ({ task: r.task, status: r.status, files: r.files })))}. No ejecutes git: solo devuelve el texto.`, { label: 'propuesta de commit', phase: 'Cierre', effort: 'low' }) : null

return {
  plan: PLAN,
  completed: done,
  results,
  pendingUser: [...new Set(results.flatMap(r => r.pendingUser || []))],
  simplify,
  finalVerify,
  finalReview,
  uiCheck,
  commitProposal,
}
