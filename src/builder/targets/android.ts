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
import { ARITHMETIC, COMPARISONS, isEquality, isTextual, objectIn, operatorOf, parseObjectLiteral } from './expressions'
import { appIdFor, type Project } from '../../project/targets'
import { DEFAULT_API_PORT } from './server'

/**
 * The backend, as seen from an Android emulator.
 *
 * 10.0.2.2 is the loopback of the machine running the emulator; the
 * phone's own localhost has nothing listening on it. Getting this wrong
 * is the single most common reason a first run shows an empty list.
 */
const ANDROID_API_URL = `http://10.0.2.2:${DEFAULT_API_PORT}`

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

/** The stubs the handlers call, kept apart so they are easy to replace. */
function runtime(identifier: string, baseUrl: string): string {
  return `// The services a generated app talks to.
//
// These are not stubs. They call the backend the builder writes alongside
// this app -- build the Backend Service target, run \`node main.js\` in it,
// and sign-up, the drawn tables and file uploads all work from here.
//
// JSON is handled with org.json, which Android ships: a generated app
// should not need a dependency to parse its own backend's replies.

package ${identifier}

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

/**
 * Where the backend lives.
 *
 * 10.0.2.2 is the host machine as seen from the Android emulator;
 * localhost there is the phone itself, which is running nothing. Change
 * this one line when you deploy -- it is the only place the address
 * appears.
 */
object Backend {
    var baseUrl: String = "${baseUrl}"
    /** Set by the sign-in blocks; sent on every later request. */
    var token: String? = null
}

/** One HTTP call, off the main thread, as JSON in and JSON out. */
private suspend fun call(
    path: String,
    method: String = "GET",
    body: JSONObject? = null,
    bytes: ByteArray? = null,
    contentType: String = "application/json",
    extraHeaders: Map<String, String> = emptyMap(),
): String = withContext(Dispatchers.IO) {
    val connection = URL(Backend.baseUrl + path).openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 10_000
    connection.readTimeout = 30_000
    connection.setRequestProperty("accept", "application/json")
    Backend.token?.let { connection.setRequestProperty("authorization", "Bearer " + it) }
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
        // The service answers errors as {"error": "..."}, so the message a
        // user sees is the one the backend chose, not a status code.
        val message = runCatching { JSONObject(text).optString("error") }.getOrNull()
        throw RuntimeException(if (message.isNullOrBlank()) "Request failed: " + connection.responseCode else message)
    }
    text
}

/** org.json values, as the plain Kotlin the generated handlers expect. */
private fun unwrap(value: Any?): Any? = when (value) {
    JSONObject.NULL, null -> null
    is JSONObject -> value.keys().asSequence().associateWith { unwrap(value.get(it)) }
    is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
    else -> value
}

private fun asMap(text: String): Map<String, Any?> {
    if (text.isBlank()) return emptyMap()
    @Suppress("UNCHECKED_CAST")
    return (unwrap(JSONObject(text)) as? Map<String, Any?>) ?: emptyMap()
}

private fun encode(value: Any?): String = URLEncoder.encode(toText(value), "UTF-8")

object Api {
    /** Rows of a table you drew in the schema editor. */
    suspend fun select(table: String, where: Map<String, Any?> = emptyMap()): List<Map<String, Any?>> {
        val queryString = if (where.isEmpty()) "" else "?" + where.entries.joinToString("&") {
            encode(it.key) + "=" + encode(it.value)
        }
        val rows = asMap(call("/data/" + table + queryString))["rows"]
        @Suppress("UNCHECKED_CAST")
        return (rows as? List<Map<String, Any?>>) ?: emptyList()
    }

    suspend fun insert(table: String, row: Any?): Map<String, Any?> {
        val body = when (row) {
            is Map<*, *> -> JSONObject(row.entries.associate { toText(it.key) to it.value })
            is String -> runCatching { JSONObject(row) }.getOrElse { JSONObject().put("value", row) }
            else -> JSONObject().put("value", row)
        }
        @Suppress("UNCHECKED_CAST")
        return (asMap(call("/data/" + table, "POST", body))["row"] as? Map<String, Any?>) ?: emptyMap()
    }

    suspend fun update(table: String, id: String, changes: Any?): Map<String, Any?> {
        val body = when (changes) {
            is Map<*, *> -> JSONObject(changes.entries.associate { toText(it.key) to it.value })
            else -> JSONObject().put("value", changes)
        }
        @Suppress("UNCHECKED_CAST")
        return (asMap(call("/data/" + table + "/" + id, "PATCH", body))["row"] as? Map<String, Any?>) ?: emptyMap()
    }

    suspend fun remove(table: String, id: String) {
        call("/data/" + table + "/" + id, "DELETE")
    }

    /** Anything else, including URLs that are not this backend. */
    suspend fun request(url: String, method: String): String = withContext(Dispatchers.IO) {
        if (url.startsWith("/")) call(url, method) else {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = method
            val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            connection.disconnect()
            text
        }
    }
}

object Auth {
    suspend fun signUp(email: String, password: String): Map<String, Any?> {
        val reply = asMap(call("/auth/sign-up", "POST", JSONObject().put("email", email).put("password", password)))
        (reply["token"] as? String)?.let { Backend.token = it }
        @Suppress("UNCHECKED_CAST")
        return (reply["user"] as? Map<String, Any?>) ?: reply
    }

    suspend fun signIn(email: String, password: String): Map<String, Any?> {
        val reply = asMap(call("/auth/sign-in", "POST", JSONObject().put("email", email).put("password", password)))
        (reply["token"] as? String)?.let { Backend.token = it }
        @Suppress("UNCHECKED_CAST")
        return (reply["user"] as? Map<String, Any?>) ?: reply
    }

    /**
     * Starts a provider round trip.
     *
     * The backend hands back the authorize URL; opening it is the app's
     * job, because only the app knows whether that is a browser tab, a
     * custom tab or a web view.
     */
    suspend fun oauth(provider: String): Map<String, Any?> =
        asMap(call("/auth/oauth", "POST", JSONObject().put("provider", provider)))

    suspend fun session(): Map<String, Any?>? {
        if (Backend.token == null) return null
        @Suppress("UNCHECKED_CAST")
        return asMap(call("/auth/session"))["user"] as? Map<String, Any?>
    }

    suspend fun signOut() {
        if (Backend.token != null) call("/auth/sign-out", "POST")
        Backend.token = null
    }
}

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
        val reply = asMap(call(
            "/storage/" + bucket,
            "POST",
            bytes = bytes,
            contentType = "application/octet-stream",
            extraHeaders = mapOf("x-file-name" to name),
        ))
        return toText(reply["url"])
    }
}
`
}

export function androidFiles(ir: Ir, project: Project): CompiledFile[] {
  const identifier = appIdFor(project, 'android')
  const path = packagePath(identifier)

  return [
    {
      path: `app/src/main/java/${path}/MainActivity.kt`,
      contents: mainActivity(ir, project, identifier),
    },
    {
      path: `app/src/main/java/${path}/Runtime.kt`,
      contents: runtime(identifier, ANDROID_API_URL),
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
- \`Runtime.kt\` holds the backend stubs. Replace the bodies, keep the
  signatures, and everything else keeps compiling.

Application id \`${identifier}\`, version ${project.version}. Both come from
the project in the Targets panel; change them there rather than here, or the
next build will write over you.
`,
    },
  ]
}
