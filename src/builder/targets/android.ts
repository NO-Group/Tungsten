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

import type { ComponentSchema } from '../uiSchema'
import { uiThemeKotlin } from '../uiTokens'
import type { CompiledFile, Ir, IrEvent, IrStatement, IrValue } from '../compile'
import { appIdFor, type Project } from '../../project/targets'

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
export function kotlinStatement(
  statement: IrStatement,
  indent: string,
  names: Map<string, string>,
): string[] {
  const value = (id: string): string => {
    const input: IrValue | undefined = statement.inputs[id]
    if (!input || input.kind === 'empty') return 'null'
    if (input.kind === 'literal') return literal(input.value)
    return names.get(input.node) ?? 'null'
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
      return [`${indent}println("\${${value('value')}}")`]
    case 'nav.go':
      return [`${indent}app.goTo(${value('screen')}.toString())`]
    case 'nav.back':
      return [`${indent}app.back()`]
    case 'ui.text':
      return [`${indent}app.output.add("\${${value('value')}}")`]
    case 'ui.button':
      return [`${indent}// Button "\${${value('text')}}" is declared in the composable.`]
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
      return [`${indent}val ${name()} = Api.select(${value('table')}.toString())`]
    case 'data.insert':
      return [`${indent}val ${name()} = Api.insert(${value('table')}.toString(), ${value('row')})`]
    case 'network.fetch':
      return [`${indent}val ${name()} = Api.request(${value('url')}.toString(), ${value('method')}.toString())`]
    case 'auth.signUp':
      return [`${indent}val ${name()} = Auth.signUp(${value('email')}.toString(), ${value('password')}.toString())`]
    case 'auth.oauth':
      return [`${indent}val ${name()} = Auth.oauth(${value('provider')}.toString())`]
    case 'auth.session':
      return [`${indent}val ${name()} = Auth.session()`]
    case 'storage.upload':
      return [`${indent}val ${name()} = Storage.upload(${value('bucket')}.toString(), ${value('file')})`]
    default:
      return [`${indent}// ${statement.type} has no Android mapping yet.`]
  }
}

/** One component, as a composable call. */
function composable(component: ComponentSchema): string {
  const text = (key: string, fallback: string) => JSON.stringify(String(component.properties[key] ?? fallback))
  if (component.type === 'button') {
    const handler = component.events.click
      ? `{ scope.launch { ${handlerName(component.events.click)}(app) } }`
      : '{}'
    return `            AppButton(text = ${text('text', 'Submit')}, onClick = ${handler})`
  }
  if (component.type === 'input') {
    return `            AppInput(
                value = app.fields[${JSON.stringify(component.id)}] ?: "",
                placeholder = ${text('placeholder', '')},
                onChange = { app.fields[${JSON.stringify(component.id)}] = it },
            )`
  }
  return `            AppText(text = ${text('value', '')})`
}

function screenBranch(screen: { name: string; components: ComponentSchema[] }): string {
  const body = screen.components.length
    ? screen.components.map(composable).join('\n')
    : '            AppText(text = "This screen has nothing on it yet.")'
  return `        ${JSON.stringify(screen.name)} -> {\n${body}\n        }`
}

function startBranch(screen: { name: string; events: IrEvent[] }): string {
  const starts = screen.events
    .filter((event) => event.type === 'event.start')
    .map((event) => `            ${handlerName(event.node)}(app)`)
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

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
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

${handlers.join('\n\n') || '// No handlers yet.'}
`
}

/** The stubs the handlers call, kept apart so they are easy to replace. */
function runtime(identifier: string): string {
  return `// The services a generated app talks to.
//
// These are stubs on purpose. The builder knows the *shape* of the calls
// your blocks make -- select, insert, request, signUp -- but not which
// backend you intend to use, and guessing would produce an app that
// pretends to work. Replace the bodies; leave the signatures, and the
// generated handlers keep compiling.

package ${identifier}

object Api {
    suspend fun select(table: String): List<Map<String, Any?>> {
        println("select from " + table)
        return emptyList()
    }

    suspend fun insert(table: String, row: Any?): Map<String, Any?> {
        println("insert into " + table + ": " + row)
        return emptyMap()
    }

    suspend fun request(url: String, method: String): String {
        println(method + " " + url)
        return ""
    }
}

object Auth {
    suspend fun signUp(email: String, password: String): Map<String, Any?> {
        println("sign up " + email + " (" + password.length + " characters)")
        return mapOf("email" to email)
    }

    suspend fun oauth(provider: String): Map<String, Any?> {
        println("oauth with " + provider)
        return mapOf("provider" to provider)
    }

    suspend fun session(): Map<String, Any?>? = null
}

object Storage {
    suspend fun upload(bucket: String, file: Any?): String {
        println("upload to " + bucket + ": " + file)
        return ""
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
      contents: runtime(identifier),
    },
    {
      path: 'app/src/main/AndroidManifest.xml',
      contents: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Declared because a generated app that cannot reach a backend is
         not much of an app; remove it if yours never makes a request. -->
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
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
