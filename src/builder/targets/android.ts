/**
 * The Android App Target.
 *
 * Kotlin and Jetpack Compose, generated from the same IR every other
 * target reads. Nothing here knows what a block is: it sees events,
 * statements, components and screens, which is the only reason adding a
 * seventh platform does not mean touching the canvas.
 *
 * The output is a Gradle project, not a wrapper around a web view. A
 * generated app that is secretly a browser is a worse app and a worse
 * demonstration -- the point of compiling to a target is that the result
 * belongs on the platform.
 */

import { headingLevelOf, optionsOf, type ComponentSchema } from '../uiSchema'
import { uiThemeKotlin } from '../uiTokens'
import type { CompiledFile, Ir, IrEvent, IrStatement, IrValue } from '../compile'
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, objectIn, operatorOf, parseObjectLiteral, rowFields } from './expressions'
import { appIdFor, type Project } from '../../project/targets'
import { DEFAULT_API_URL } from './server'
import { renderPath, wirePlan, type WirePlan } from './wire'
import type { RuntimeProfile } from '../../backend/runtimeProfile'


/** `com.acme.timer` → `com/acme/timer`, where Gradle expects the sources. */
export function packagePath(identifier: string): string {
  return identifier.split('.').join('/')
}

function handlerName(nodeId: string): string {
  return `handle_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function literal(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

/** One IR statement, as Kotlin. Mirrors the Dart lowering case for case. */
/**
 * A value, as Kotlin.
 *
 * The three arms that matter: a literal is written out, a statement's
 * result is the variable it was bound to, and a pure expression block is
 * lowered in place -- which is how reading a text field or comparing two
 * things reaches the phone at all.
 */
function kotlinValue(value: IrValue | undefined, names: Map<string, string>): string {
  if (!value || value.kind === 'empty') return 'null'
  if (value.kind === 'literal') return literal(value.value)
  if (value.kind === 'reference') return names.get(value.node) ?? 'null'

  const input = (id: string) => kotlinValue(value.inputs[id], names)
  const key = (id: string) => (isTextual(value.inputs[id]) ? input(id) : `toText(${input(id)})`)
  switch (value.type) {
    case 'ui.value':
      return `(app.fields[${key('id')}] ?: "")`
    case 'state.get':
      return `app.state[${key('name')}]`
    case 'nav.current':
      return 'app.screen'
    case 'data.text':
    case 'data.number':
      return input('value')
    case 'data.row':
      return objectIn('kotlin', rowFields(value, (field) => kotlinValue(field, names)))
    case 'logic.exists':
      return `(${input('value')} != null)`
    case 'logic.compare': {
      const operator = operatorOf(value, COMPARISONS, '===')
      if (isEquality(operator)) {
        return `(toText(${input('left')}) ${operator === '===' ? '==' : '!='} toText(${input('right')}))`
      }
      return `(toNumber(${input('left')}) ${operator} toNumber(${input('right')}))`
    }
    case 'logic.math':
      return `(toNumber(${input('left')}) ${operatorOf(value, ARITHMETIC, '+')} toNumber(${input('right')}))`
    default:
      // A plugin block, or something newer than this emitter. Null is the
      // honest answer, and the comment says whose fault it is.
      return `null /* ${value.type} has no Android mapping yet */`
  }
}

export function kotlinStatement(
  statement: IrStatement,
  indent: string,
  names: Map<string, string>,
): string[] {
  const value = (id: string): string => kotlinValue(statement.inputs[id], names)
  /** The same value where a String is wanted, without a pointless cast. */
  const text = (id: string): string => (
    isTextual(statement.inputs[id]) ? value(id) : `toText(${value(id)})`
  )

  /**
   * The same value where an object is wanted.
   *
   * A typed-in `{ title: "Hello" }` is text on the canvas and has to be
   * a map by the time it reaches the backend; anything this cannot read
   * as a flat object literal is left exactly as it was.
   */
  const object = (id: string): string => {
    const input = statement.inputs[id]
    if (input && input.kind === 'literal' && typeof input.value === 'string') {
      const entries = parseObjectLiteral(input.value)
      if (entries) return objectIn('kotlin', entries)
    }
    return value(id)
  }

  const name = () => {
    const existing = names.get(statement.node)
    if (existing) return existing
    const base = statement.type.split('.').pop() ?? 'value'
    const assigned = `${base}${names.size + 1}`
    names.set(statement.node, assigned)
    return assigned
  }

  const body = (slot: string): string[] => (statement.bodies[slot] ?? [])
    .flatMap((child) => kotlinStatement(child, `${indent}  `, names))

  switch (statement.type) {
    case 'logic.log':
      return [`${indent}println(${text('value')})`]
    case 'nav.go':
      return [`${indent}app.goTo(${text('screen')})`]
    case 'nav.back':
      return [`${indent}app.back()`]
    case 'ui.text':
      return [`${indent}app.output.add(${text('value')})`]
    case 'ui.button':
      return [`${indent}// Button ${value('text')} is declared in the composable.`]
    case 'ui.input':
      return [`${indent}// Input ${value('id')} is declared in the composable.`]
    case 'logic.if': {
      const inner = body('body')
      const otherwise = body('else')
      const lines = [`${indent}if (${value('condition')} == true) {`, ...inner, `${indent}}`]
      return otherwise.length
        ? [...lines.slice(0, -1), `${indent}} else {`, ...otherwise, `${indent}}`]
        : lines
    }
    case 'logic.forEach':
      return [
        `${indent}for (item in (${value('list')} as? List<Any?> ?: emptyList())) {`,
        ...body('body'),
        `${indent}}`,
      ]
    case 'data.query':
      return [`${indent}val ${name()} = Api.select(${text('table')})`]
    case 'data.insert':
      return [`${indent}val ${name()} = Api.insert(${text('table')}, ${object('row')})`]
    case 'data.update':
      return [`${indent}val ${name()} = Api.update(${text('table')}, ${text('id')}, ${object('changes')})`]
    case 'data.remove':
      return [`${indent}Api.remove(${text('table')}, ${text('id')})`]
    case 'network.fetch':
      return [`${indent}val ${name()} = Api.request(${text('url')}, ${text('method')})`]
    case 'auth.signUp':
      return [`${indent}val ${name()} = Auth.signUp(${text('email')}, ${text('password')})`]
    case 'auth.signIn':
      return [`${indent}val ${name()} = Auth.signIn(${text('email')}, ${text('password')})`]
    case 'auth.signOut':
      return [`${indent}Auth.signOut()`]
    case 'auth.oauth':
      return [`${indent}val ${name()} = Auth.oauth(${text('provider')})`]
    case 'auth.session':
      return [`${indent}val ${name()} = Auth.session()`]
    case 'storage.upload':
      return [`${indent}val ${name()} = Storage.upload(${text('bucket')}, ${value('file')})`]
    case 'state.set':
      return [`${indent}app.state[${text('name')}] = ${value('value')}`]
    default:
      return [`${indent}// ${statement.type} has no Android mapping yet.`]
  }
}

/**
 * One component, as a composable call.
 *
 * Recursive: a stack is a Column or a Row with the same children the
 * preview nests inside it, so the phone shows the layout that was drawn
 * rather than a flat list in the same order.
 */
function composable(component: ComponentSchema, indent = BRANCH_BODY): string {
  const text = (key: string, fallback: string) => JSON.stringify(String(component.properties[key] ?? fallback))
  const id = JSON.stringify(component.id)

  if (component.type === 'button') {
    const handler = component.events.click
      ? `{ scope.launch { ${handlerName(component.events.click)}(app) } }`
      : '{}'
    return `${indent}AppButton(text = ${text('text', 'Submit')}, onClick = ${handler})`
  }
  if (component.type === 'input') {
    return `${indent}AppInput(
${indent}    value = app.fields[${id}] ?: "",
${indent}    placeholder = ${text('placeholder', '')},
${indent}    onChange = { app.fields[${id}] = it },
${indent})`
  }
  if (component.type === 'heading') {
    return `${indent}AppHeading(text = ${text('text', '')}, level = ${headingLevelOf(component)})`
  }
  if (component.type === 'image') {
    return `${indent}AppImage(url = ${text('src', '')}, alt = ${text('alt', 'Image')})`
  }
  if (component.type === 'checkbox') {
    return `${indent}AppCheckbox(
${indent}    label = ${text('label', '')},
${indent}    checked = app.fields[${id}] == "true",
${indent}    onChange = { app.fields[${id}] = it.toString() },
${indent})`
  }
  if (component.type === 'select') {
    const choices = optionsOf(component)
    const initial = String(component.properties.value ?? '') || choices[0] || ''
    return `${indent}AppSelect(
${indent}    options = listOf(${choices.map((choice) => JSON.stringify(choice)).join(', ')}),
${indent}    selected = app.fields[${id}] ?: ${JSON.stringify(initial)},
${indent}    onChange = { app.fields[${id}] = it },
${indent})`
  }
  if (component.type === 'link') {
    return `${indent}AppLink(text = ${text('text', '')}, url = ${text('href', '')})`
  }
  if (component.type === 'divider') {
    return `${indent}HorizontalDivider(color = AppTheme.border)`
  }
  if (component.type === 'stack') {
    const row = String(component.properties.direction ?? 'column') === 'row'
    const gap = Number(component.properties.gap ?? 10)
    const children = (component.children ?? []).map((child) => composable(child, `${indent}    `))
    const arrangement = row
      ? `horizontalArrangement = Arrangement.spacedBy(${gap}.dp),\n${indent}    verticalAlignment = Alignment.CenterVertically,`
      : `verticalArrangement = Arrangement.spacedBy(${gap}.dp),`
    return `${indent}${row ? 'Row' : 'Column'}(
${indent}    ${arrangement}
${indent}) {
${children.join('\n') || `${indent}    // Nothing inside this stack yet.`}
${indent}}`
  }
  return `${indent}AppText(text = ${text('value', '')})`
}

/** Where a `when (app.screen)` branch and its body sit, in the file. */
const BRANCH = ' '.repeat(20)
const BRANCH_BODY = ' '.repeat(24)

function screenBranch(screen: { name: string; components: ComponentSchema[] }): string {
  const body = screen.components.length
    ? screen.components.map((component) => composable(component, BRANCH_BODY)).join('\n')
    : `${BRANCH_BODY}AppText(text = "This screen has nothing on it yet.")`
  return `${BRANCH}${JSON.stringify(screen.name)} -> {\n${body}\n${BRANCH}}`
}

function startBranch(screen: { name: string; events: IrEvent[] }): string {
  const starts = screen.events
    .filter((event) => event.type === 'event.start')
    .map((event) => `            ${handlerName(event.node)}(app)`)
  // The start branch is in LaunchedEffect, two levels shallower than the
  // one that draws the screen.
  return `        ${JSON.stringify(screen.name)} -> {\n${
    starts.length ? starts.join('\n') : '            // No start event on this screen.'
  }\n        }`
}

function mainActivity(ir: Ir, project: Project, identifier: string): string {
  const names = new Map<string, string>()
  const handlers = ir.events.map((event) => {
    const body = event.body.flatMap((statement) => kotlinStatement(statement, '    ', names))
    return `suspend fun ${handlerName(event.node)}(app: AppState) {\n${
      body.join('\n') || '    // Nothing connected yet.'
    }\n}`
  })

  return `// Generated by the Tungsten builder for ${project.name}.
// Kotlin and Compose, from the same graph the other targets are built from.

package ${identifier}

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

/** Graphene, from src/theme/tokens.json. One palette, every target. */
object AppTheme {
${uiThemeKotlin()}
}

/**
 * Everything the app remembers.
 *
 * Navigation is state rather than a NavHost: the whole app is one
 * composable tree, so going back is popping a string instead of unwinding
 * a back stack. It keeps the generated code readable, which matters more
 * here than matching a framework convention nobody asked for.
 */
class AppState {
    val output = mutableStateListOf<String>()
    val fields = mutableStateMapOf<String, String>()

    /** The app's variables. The web target calls the same thing state. */
    val state = mutableStateMapOf<String, Any?>()
    var screen by mutableStateOf(${JSON.stringify(ir.home)})
        private set
    private val trail = mutableListOf<String>()

    fun goTo(next: String) {
        if (next == screen) return
        trail.add(screen)
        output.clear()
        screen = next
    }

    fun back() {
        if (trail.isEmpty()) return
        output.clear()
        screen = trail.removeAt(trail.lastIndex)
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AppRoot() }
    }
}

@Composable
fun AppRoot() {
    val app = remember { AppState() }
    val scope = rememberCoroutineScope()

    // Entering a screen runs that screen's start handlers, exactly as the
    // web and mobile targets do.
    LaunchedEffect(app.screen) {
        when (app.screen) {
${ir.screens.map(startBranch).join('\n')}
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = AppTheme.surface) {
            Column(
                modifier = Modifier.padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                when (app.screen) {
${ir.screens.map(screenBranch).join('\n')}
                }
                app.output.forEach { line -> AppText(text = line) }
            }
        }
    }
}

@Composable
fun AppText(text: String) = Text(text = text, color = AppTheme.text)

@Composable
fun AppButton(text: String, onClick: () -> Unit) = Button(onClick = onClick) { Text(text) }

@Composable
fun AppInput(value: String, placeholder: String, onChange: (String) -> Unit) = OutlinedTextField(
    value = value,
    onValueChange = onChange,
    placeholder = { Text(placeholder) },
)

/** A heading. The level is semantic, so it picks a type role, not a size. */
@Composable
fun AppHeading(text: String, level: Int) = Text(
    text = text,
    color = AppTheme.text,
    fontWeight = FontWeight.SemiBold,
    fontSize = when (level) {
        1 -> 30.sp
        2 -> 24.sp
        3 -> 20.sp
        else -> 17.sp
    },
)

/** A remote image, or a labelled box while there is no URL to load. */
@Composable
fun AppImage(url: String, alt: String) {
    if (url.isEmpty()) {
        Box(modifier = Modifier.padding(12.dp)) { Text(text = alt, color = AppTheme.textMuted) }
    } else {
        AsyncImage(model = url, contentDescription = alt)
    }
}

@Composable
fun AppCheckbox(label: String, checked: Boolean, onChange: (Boolean) -> Unit) = Row(
    verticalAlignment = Alignment.CenterVertically,
) {
    Checkbox(checked = checked, onCheckedChange = onChange)
    Text(text = label, color = AppTheme.text)
}

/**
 * A dropdown.
 *
 * A button that opens a menu rather than ExposedDropdownMenuBox: this is
 * half the code, needs no experimental opt-in, and is the same control
 * from the user's side.
 */
@Composable
fun AppSelect(options: List<String>, selected: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        AppButton(text = if (selected.isEmpty()) "Choose" else selected, onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        open = false
                        onChange(option)
                    },
                )
            }
        }
    }
}

/** A link out of the app, opened by the system browser. */
@Composable
fun AppLink(text: String, url: String) {
    val uriHandler = LocalUriHandler.current
    TextButton(onClick = { uriHandler.openUri(url) }) {
        Text(text = text, color = AppTheme.accent)
    }
}

${handlers.join('\n\n') || '// No handlers yet.'}
`
}

/* ------------------------------------------------------------- the backend */

/** `"text"` as a Kotlin string literal. */
function kotlinString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`
}

const KOTLIN = {
  quote: kotlinString,
  escape: (expression: string) => `encode(${expression})`,
  join: ' + ',
}

/** A wire path as a Kotlin expression, with the placeholders filled in. */
function kotlinPath(path: string, values: Record<string, string>): string {
  return renderPath(path, values, KOTLIN)
}

/**
 * Where a generated app looks for its backend.
 *
 * 10.0.2.2 is the host machine as seen from the Android emulator;
 * localhost there is the phone itself, which is running nothing. This
 * is the most common first-run failure on Android, so an address on
 * the developer's own machine is translated rather than copied.
 */
function kotlinBaseUrl(plan: WirePlan): string {
  const base = plan.base || DEFAULT_API_URL
  return base.replace(/\/\/(localhost|127\.0\.0\.1)/, '//10.0.2.2')
}

/** The rows of a reply, wherever this backend keeps them. */
function kotlinRows(plan: WirePlan): string {
  const found = plan.list.envelope === 'array'
    ? 'rowsOf(reply)'
    : `rowsOf(asMap(reply)[${kotlinString(plan.list.envelope)}])`
  return plan.renames.length ? `${found}.map(::document)` : found
}

/** One row of a reply, wherever this backend keeps it. */
function kotlinRow(plan: WirePlan, step: WirePlan['create'] | WirePlan['modify']): string {
  const found = step.envelope === 'self'
    ? 'asMap(reply)'
    : step.envelope === 'row'
      ? 'asMap(asMap(reply)["row"])'
      : 'rowsOf(reply).firstOrNull() ?: emptyMap()'
  return plan.renames.length ? `document(${found})` : found
}

/** The arguments a write needs: the body, wrapped, and any extra header. */
function kotlinWrite(step: WirePlan['create'] | WirePlan['modify'], body: string): string {
  let wrapped = step.wrap ? `JSONObject().put(${kotlinString(step.wrap)}, ${body})` : body
  if (step.idField) {
    const id = `JSONObject().put(${kotlinString(step.idField.key)}, ${kotlinString(step.idField.value)})`
    wrapped = step.wrap
      ? `${id}.put(${kotlinString(step.wrap)}, ${body})`
      : `${id}.also { for (key in ${body}.keys()) it.put(key, ${body}.get(key)) }`
  }
  const prefer = step.prefer ? `, extraHeaders = mapOf("prefer" to ${kotlinString(step.prefer)})` : ''
  return `${kotlinString(step.method)}, ${wrapped}${prefer}`
}

/**
 * Translating this backend's own field names, where it has them.
 *
 * Nothing at all for most backends: the generated file does not carry
 * a function it would never call.
 */
function kotlinRenames(plan: WirePlan): string {
  if (!plan.renames.length) return ''
  const copies = plan.renames
    .map(([wire, local]) => `    if (document.containsKey(${kotlinString(wire)})) row[${kotlinString(local)}] = document[${kotlinString(wire)}]`)
    .join('\n')
  const owned = plan.renames.map(([, local]) => kotlinString(local)).join(', ')
  return `
/**
 * This backend's own fields, under the names the blocks use.
 *
 * A block drawn against a table says row.id whatever is underneath it,
 * so the fields this backend prefixes are copied across and the
 * prefixed originals left behind.
 */
private fun document(document: Map<String, Any?>): Map<String, Any?> {
    val row = LinkedHashMap<String, Any?>()
    for ((key, value) in document) if (!key.startsWith("\\$")) row[key] = value
${copies}
    return row
}

/**
 * The other direction. The fields the backend owns cannot be written
 * back to it: sending them is an error, not a no-op.
 */
private fun data(body: JSONObject): JSONObject {
    val owned = setOf(${owned})
    val kept = JSONObject()
    for (key in body.keys()) if (!key.startsWith("\\$") && key !in owned) kept.put(key, body.get(key))
    return kept
}
`
}

/** The filter encoder for this dialect, and nothing else. */
function kotlinFilter(plan: WirePlan): string {
  switch (plan.list.filter) {
    case 'postgrest':
      return `/** A filter as PostgREST parameters: column=eq.value. */
private fun query(where: Map<String, Any?>): String =
    "?select=*" + where.entries.joinToString("") { "&" + encode(it.key) + "=eq." + encode(toText(it.value)) }`
    case 'pocketbase':
      return `/**
 * A filter as a PocketBase expression.
 *
 * There is no parameter binding on the wire here: the value is quoted
 * into the expression, so a quote inside it has to be escaped or it
 * ends the string early.
 */
private fun query(where: Map<String, Any?>): String {
    if (where.isEmpty()) return ""
    val tests = where.entries.joinToString(" && ") {
        it.key + "='" + toText(it.value).replace("'", "\\\\'") + "'"
    }
    return "?filter=" + encode(tests)
}`
    case 'queries':
      return `/**
 * A filter as Appwrite queries.
 *
 * Each test is a JSON document of its own, in its own queries[]
 * parameter: there is no column=value form to fall back on.
 */
private fun query(where: Map<String, Any?>): String {
    if (where.isEmpty()) return ""
    val parts = where.entries.mapIndexed { index, entry ->
        val test = JSONObject()
            .put("method", "equal")
            .put("attribute", entry.key)
            .put("values", JSONArray().put(entry.value))
        "queries[" + index + "]=" + encode(test.toString())
    }
    return "?" + parts.joinToString("&")
}`
    case 'tree':
      return `/** A filter as the tree this backend takes in the body of a query. */
private fun whereBody(where: Map<String, Any?>): JSONObject {
    if (where.isEmpty()) return JSONObject()
    val tests = JSONArray()
    for ((column, value) in where) {
        tests.put(JSONObject().put("column", column).put("op", "eq").put("value", value))
    }
    return JSONObject().put("where", JSONObject().put("all", tests))
}`
    default:
      return `/** A filter as the query string the generated service reads. */
private fun query(where: Map<String, Any?>): String {
    if (where.isEmpty()) return ""
    return "?" + where.entries.joinToString("&") { encode(it.key) + "=" + encode(toText(it.value)) }
}`
  }
}

/** Sign-up, sign-in, session and sign-out, as this backend spells them. */
function kotlinAuth(plan: WirePlan): string {
  const credentials = plan.signUp.body === 'record'
    ? 'JSONObject().put("email", email).put("password", password).put("passwordConfirm", password)'
    : plan.signUp.body === 'account'
      // "unique()" is this backend's way of saying the server picks.
      ? 'JSONObject().put("userId", "unique()").put("email", email).put("password", password)'
      : 'JSONObject().put("email", email).put("password", password)'

  const signUp = plan.signUp.thenSignIn
    ? `        // Creating the account does not start a session here, so the app
        // signs in straight afterwards rather than handing back a user who
        // cannot read anything.
        call(${kotlinString(plan.signUp.path)}, "POST", ${credentials})
        return signIn(email, password)`
    : `        return accept(call(${kotlinString(plan.signUp.path)}, "POST", ${credentials}))`

  const identity = plan.signIn.identity === 'identity'
    ? 'JSONObject().put("identity", email).put("password", password)'
    : 'JSONObject().put("email", email).put("password", password)'

  const suffix = plan.oauth.suffix ? ` + ${kotlinString(plan.oauth.suffix)}` : ''
  const oauth = plan.oauth.kind === 'url'
    ? `    /**
     * The provider's address, built from the backend's own.
     *
     * Opening it is the app's job, because only the app knows whether
     * that is a browser tab, a custom tab or a web view.
     */
    fun oauth(provider: String): Map<String, Any?> = mapOf(
        "url" to Backend.baseUrl + ${kotlinString(plan.oauth.path)} + encode(provider)${suffix},
        "provider" to provider,
    )`
    : `    /** Starts a provider round trip. The reply carries the URL to open. */
    suspend fun oauth(provider: String): Map<String, Any?> =
        asMap(call(${kotlinString(plan.oauth.path)}, "POST", JSONObject().put("provider", provider)))`

  const signOut = plan.signOut
    ? `        if (Backend.token != null) call(${kotlinString(plan.signOut.path)}, ${kotlinString(plan.signOut.method)})
        Backend.token = null`
    : `        // Signing out is local here: the backend keeps no session to end.
        Backend.token = null`

  return `object Auth {
    suspend fun signUp(email: String, password: String): Map<String, Any?> {
${signUp}
    }

    suspend fun signIn(email: String, password: String): Map<String, Any?> {
${plan.signIn.then === 'session'
    ? `        // The reply to this is a session: it carries the secret and
        // nothing a screen can show, so the account is read next.
        accept(call(${kotlinString(plan.signIn.path)}, "POST", ${identity}))
        return accept(call(${kotlinString(plan.session.path)}, ${kotlinString(plan.session.method)}))`
    : `        return accept(call(${kotlinString(plan.signIn.path)}, "POST", ${identity}))`}
    }

${oauth}

    suspend fun session(): Map<String, Any?>? {
        if (Backend.token == null) return null
        return try {
            accept(call(${kotlinString(plan.session.path)}, ${kotlinString(plan.session.method)}))
        } catch (error: RuntimeException) {
            // An expired token is nobody being signed in, not a failure
            // the app has to handle.
            Backend.token = null
            null
        }
    }

    suspend fun signOut() {
${signOut}
    }
}`
}

/** Uploading a file, and working out what its URL is afterwards. */
function kotlinStorage(plan: WirePlan): string {
  const { upload } = plan
  const path = kotlinPath(upload.path, { bucket: 'bucket', name: 'name' })

  // A reply nobody reads is a warning in the generated app, so the
  // binding only appears when the address below is built from it.
  const keeps = upload.idInPath || Boolean(upload.urlKey)
  const open = keeps ? 'val reply = asMap(call(' : 'call('
  const close = keeps ? '))' : ')'

  const send = upload.form
    ? `        val boundary = "tungsten-" + System.currentTimeMillis()
        ${open}
            ${path},
            "POST",
            bytes = multipart(boundary, name, bytes),
            contentType = "multipart/form-data; boundary=" + boundary,
        ${close}`
    : `        ${open}
            ${path},
            "POST",
            bytes = bytes,
            contentType = "application/octet-stream",${upload.path.includes('{name}')
        ? ''
        : `
            // The name is not in the address, so it travels in a header.
            extraHeaders = mapOf("x-file-name" to name),`}
        ${close}`

  const address = upload.idInPath
    ? `        // The stored file's address is built from what came back, not
        // from the name that went up.
${upload.nameKey
      ? `        val stored = (reply[${kotlinString(upload.nameKey)}] as? List<*>)?.firstOrNull()?.let { toText(it) } ?: toText(reply[${kotlinString(upload.nameKey)}])\n`
      : ''}        return Backend.baseUrl + ${kotlinPath(upload.publicPath ?? '', {
        bucket: 'bucket',
        id: `toText(reply[${kotlinString(upload.idKey)}])`,
        name: upload.nameKey ? 'stored' : 'name',
      })}`
    : upload.urlKey
      ? `        val url = toText(reply[${kotlinString(upload.urlKey)}])
        ${upload.publicPath
        ? `return if (url.isNotEmpty()) url else Backend.baseUrl + ${kotlinPath(upload.publicPath, { bucket: 'bucket', name: 'name' })}`
        : 'return url'}`
      : `        return Backend.baseUrl + ${kotlinPath(upload.publicPath ?? '', { bucket: 'bucket', name: 'name' })}`

  // Text parts some backends want beside the file -- an id they expect
  // the client to invent, usually.
  const parts = upload.fields
    .map(([key, value]) => `        + "--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"${key}\\"\\r\\n\\r\\n"
        + "${value}" + "\\r\\n"\n`)
    .join('')

  const multipart = upload.form
    ? `
/** A multipart body, by hand: a generated app should not need a library for one file. */
private fun multipart(boundary: String, name: String, bytes: ByteArray): ByteArray {
    val head = (""
${parts}        + "--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"file\\"; filename=\\"" + name + "\\"\\r\\n"
        + "Content-Type: application/octet-stream\\r\\n\\r\\n").toByteArray()
    val tail = ("\\r\\n--" + boundary + "--\\r\\n").toByteArray()
    return head + bytes + tail
}
`
    : ''

  return `${multipart}
object Storage {
    /** Bytes in, a URL out. Give it a ByteArray, a File, or text. */
    suspend fun upload(bucket: String, file: Any?): String {
        val bytes = when (file) {
            is ByteArray -> file
            is File -> file.readBytes()
            null -> ByteArray(0)
            else -> toText(file).toByteArray()
        }
        val name = if (file is File) file.name else "upload"
${send}
${address}
    }
}`
}

/**
 * The whole of `Runtime.kt`.
 *
 * Generated against one backend rather than carrying a dialect table:
 * an app is built for a project, and a project has one backend. The
 * result is Kotlin a person could have written for that backend, which
 * is the promise the rest of this generator makes too.
 */
function runtime(identifier: string, plan: WirePlan): string {
  // Where a backend owns some of a row's fields, the body of a write
  // has to have them taken back out before it goes.
  const written = plan.renames.length ? 'data(body)' : 'body'
  const constants = plan.headers
    .map(([key, value]) => `    connection.setRequestProperty(${kotlinString(key)}, ${kotlinString(value)})`)
    .join('\n')

  return `// The services a generated app talks to.
//
// Not stubs: these call ${plan.base ? `the ${plan.dialect} API this project is configured for` : 'the backend the builder writes alongside this app'}.
${plan.base ? '// The address and the keys below came from the project\'s backend\n// settings; server-only credentials are deliberately not here, because\n// an installed app is readable by whoever has it.\n' : ''}//
// JSON is handled with org.json, which Android ships: a generated app
// should not need a dependency to parse its own backend's replies.

package ${identifier}

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Values out of a field map have no static type, so the two conversions
 * every generated comparison needs live here. Ordering compares numbers
 * and equality compares text: "3" < "20" being true is a bug that takes an
 * hour to find in code you did not write.
 */
fun toText(value: Any?): String = value?.toString() ?: ""

fun toNumber(value: Any?): Double = when (value) {
    is Number -> value.toDouble()
    is Boolean -> if (value) 1.0 else 0.0
    else -> value?.toString()?.toDoubleOrNull() ?: 0.0
}

/** Where the backend lives. One line to change when you deploy. */
object Backend {
    var baseUrl: String = ${kotlinString(kotlinBaseUrl(plan))}
    /** Set by the sign-in blocks; sent on every later request. */
    var token: String? = null
}

/** One HTTP call, off the main thread, as JSON in and parsed JSON out. */
private suspend fun call(
    path: String,
    method: String = "GET",
    body: JSONObject? = null,
    bytes: ByteArray? = null,
    contentType: String = "application/json",
    extraHeaders: Map<String, String> = emptyMap(),
): Any? = withContext(Dispatchers.IO) {
    val connection = URL(Backend.baseUrl + path).openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 10_000
    connection.readTimeout = 30_000
    connection.setRequestProperty("accept", "application/json")
${constants}
    // A signed-in user's token replaces the publishable key rather than
    // being sent beside it.
    Backend.token?.let { connection.setRequestProperty(${kotlinString(plan.token.header)}, ${plan.token.prefix ? `${kotlinString(plan.token.prefix)} + it` : 'it'}) }
    for ((key, value) in extraHeaders) connection.setRequestProperty(key, value)

    val payload = bytes ?: body?.toString()?.toByteArray()
    if (payload != null) {
        connection.doOutput = true
        connection.setRequestProperty("content-type", contentType)
        connection.outputStream.use { it.write(payload) }
    }

    val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
    val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
    connection.disconnect()
    if (connection.responseCode >= 400) {
        // Every backend puts its sentence somewhere else, and a status
        // code on its own tells the user nothing they can act on.
        val said = asMap(parse(text)).let { it["error"] ?: it["message"] ?: it["msg"] }
        throw RuntimeException(if (said is String && said.isNotBlank()) said else "Request failed: " + connection.responseCode)
    }
    parse(text)
}

/** org.json values, as the plain Kotlin the generated handlers expect. */
private fun unwrap(value: Any?): Any? = when (value) {
    JSONObject.NULL, null -> null
    is JSONObject -> value.keys().asSequence().associateWith { unwrap(value.get(it)) }
    is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
    else -> value
}

/** A reply body, which is an object on some backends and an array on others. */
private fun parse(text: String): Any? {
    if (text.isBlank()) return null
    return runCatching { unwrap(JSONTokener(text).nextValue()) }.getOrNull()
}

@Suppress("UNCHECKED_CAST")
private fun asMap(value: Any?): Map<String, Any?> = (value as? Map<String, Any?>) ?: emptyMap()

@Suppress("UNCHECKED_CAST")
private fun rowsOf(value: Any?): List<Map<String, Any?>> =
    (value as? List<*>)?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()

private fun encode(value: Any?): String = URLEncoder.encode(toText(value), "UTF-8")

${kotlinFilter(plan)}
${kotlinRenames(plan)}
/** Keeps the token from a sign-in reply, and hands back the user. */
private fun accept(reply: Any?): Map<String, Any?> {
    val map = asMap(reply)
    (map[${kotlinString(plan.tokenKey)}] as? String)?.let { if (it.isNotBlank()) Backend.token = it }
${plan.userKey
    ? `    return ${plan.renames.length ? 'document(asMap(map[' + kotlinString(plan.userKey) + ']).ifEmpty { map })' : 'asMap(map[' + kotlinString(plan.userKey) + ']).ifEmpty { map }'}`
    : `    // The reply is the account itself here: there is nothing to dig out.
    return ${plan.renames.length ? 'document(map)' : 'map'}`}
}

object Api {
    /** Rows of a table you drew in the schema editor. */
    suspend fun select(table: String, where: Map<String, Any?> = emptyMap()): List<Map<String, Any?>> {
        val reply = ${plan.list.filter === 'tree'
    ? `call(${kotlinPath(plan.list.path, { table: 'table' })}, "POST", whereBody(where))`
    : `call(${kotlinPath(plan.list.path, { table: 'table' })} + query(where))`}
        return ${kotlinRows(plan)}
    }

    suspend fun insert(table: String, row: Any?): Map<String, Any?> {
        val body = when (row) {
            is Map<*, *> -> JSONObject(row.entries.associate { toText(it.key) to it.value })
            is String -> runCatching { JSONObject(row) }.getOrElse { JSONObject().put("value", row) }
            else -> JSONObject().put("value", row)
        }
        val reply = call(${kotlinPath(plan.create.path, { table: 'table' })}, ${kotlinWrite(plan.create, written)})
        return ${kotlinRow(plan, plan.create)}
    }

    suspend fun update(table: String, id: String, changes: Any?): Map<String, Any?> {
        val body = when (changes) {
            is Map<*, *> -> JSONObject(changes.entries.associate { toText(it.key) to it.value })
            else -> JSONObject().put("value", changes)
        }
        val reply = call(${kotlinPath(plan.modify.path, { table: 'table', id: 'id' })}, ${kotlinWrite(plan.modify, written)})
        return ${kotlinRow(plan, plan.modify)}
    }

    suspend fun remove(table: String, id: String) {
        call(${kotlinPath(plan.destroy.path, { table: 'table', id: 'id' })}, ${kotlinString(plan.destroy.method)})
    }

    /** Anything else, including URLs that are not this backend. */
    suspend fun request(url: String, method: String): String = withContext(Dispatchers.IO) {
        if (url.startsWith("/")) toText(call(url, method)) else {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = method
            val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            connection.disconnect()
            text
        }
    }
}

${kotlinAuth(plan)}

${kotlinStorage(plan)}
`
}

export function androidFiles(ir: Ir, project: Project, profile?: RuntimeProfile): CompiledFile[] {
  const identifier = appIdFor(project, 'android')
  const path = packagePath(identifier)
  const plan = wirePlan(profile)

  return [
    {
      path: `app/src/main/java/${path}/MainActivity.kt`,
      contents: mainActivity(ir, project, identifier),
    },
    {
      path: `app/src/main/java/${path}/Runtime.kt`,
      contents: runtime(identifier, plan),
    },
    {
      path: 'app/src/main/AndroidManifest.xml',
      contents: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Declared because a generated app that cannot reach a backend is
         not much of an app; remove it if yours never makes a request. -->
    <uses-permission android:name="android.permission.INTERNET" />

    <!-- usesCleartextTraffic is here because the generated backend runs on
         plain HTTP while it is on your machine. Delete that attribute the
         moment it is on a real host with TLS. -->
    <application
        android:allowBackup="true"
        android:usesCleartextTraffic="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Material3.DayNight.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    },
    {
      path: 'app/src/main/res/values/strings.xml',
      contents: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${project.name.replace(/[<&]/g, '')}</string>
</resources>
`,
    },
    {
      path: 'app/build.gradle.kts',
      contents: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "${identifier}"
    compileSdk = 35

    defaultConfig {
        applicationId = "${identifier}"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "${project.version}"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    // Image blocks load their URLs with Coil. Pulled in unconditionally so
    // that adding an Image block to the canvas never means editing Gradle.
    implementation("io.coil-kt:coil-compose:2.7.0")
    // The generated runtime does its HTTP off the main thread, which needs
    // a dispatcher. Compose pulls coroutines in transitively; this says so
    // out loud, because the runtime imports it directly.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
`,
    },
    {
      path: 'settings.gradle.kts',
      contents: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${project.name.replace(/"/g, '')}"
include(":app")
`,
    },
    {
      path: 'README.md',
      contents: `# ${project.name} — Android

Generated by the Tungsten builder. Kotlin and Jetpack Compose; no web view.

\`\`\`bash
./gradlew assembleDebug      # an APK in app/build/outputs/apk/debug
./gradlew bundleRelease      # an .aab for the Play Store
\`\`\`

Or open this folder in Android Studio and press run.

- \`MainActivity.kt\` is the interface and the handlers your blocks became.
- \`Runtime.kt\` is the backend this project is configured for, written
  out as Kotlin: ${plan.base
    ? `calls to \`${plan.base}\`. Server-only keys are deliberately
  absent, because an installed app can be read.`
    : `calls to the generated service. Build the Backend Service target,
  run \`node main.js\` in it, and the auth, table and upload blocks work
  against it. An emulator reaches your machine at 10.0.2.2, which is the
  address written in here.`}

Application id \`${identifier}\`, version ${project.version}. Both come from
the project in the Targets panel; change them there rather than here, or the
next build will write over you.
`,
    },
  ]
}
