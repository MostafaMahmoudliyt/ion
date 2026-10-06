// Fixed Kotlin sources of the Android renderer. They interpret assets/ui_spec.json at run time,
// so the generated code never changes shape with the spec (only the JSON asset does).
// Kotlin string templates are written as $name (never ${...}) so these stay plain TS strings.

export const SPEC_KT = String.raw`package PKG

import org.json.JSONArray
import org.json.JSONObject

// Thin typed view over ui_spec.json (the single source of truth).
class Field(val name: String, val widget: String, val required: Boolean, val auto: Boolean, val labels: JSONObject, val values: List<String>, val scale: Int = 2)

class Source(val raw: JSONObject) {
    val id: String = raw.getString("id")
    val entity: String = raw.getString("entity")
    val display: String? = raw.optString("display").ifEmpty { null }
    val searchFields: List<String> = raw.getJSONArray("search_fields").strings()
    val fields: List<Field> = raw.getJSONArray("fields").objects().map {
        Field(it.getString("name"), it.getString("widget"), it.optBoolean("required"), it.optBoolean("auto"), it.getJSONObject("labels"),
            it.optJSONArray("values")?.strings() ?: emptyList(), it.optInt("scale", 2))
    }
    fun field(name: String): Field? = fields.firstOrNull { it.name == name }
    fun api(op: String): String = raw.getJSONObject("api").getJSONObject(op).getString("path")
    fun title(locale: String, plural: Boolean): String {
        val l = raw.getJSONObject("labels")
        val o = if (l.has(locale)) l.getJSONObject(locale) else l.getJSONObject("en")
        return o.getString(if (plural) "plural" else "singular")
    }
}

class Page(val raw: JSONObject) {
    val type: String = raw.getString("type")
    val mode: String? = raw.optString("mode").ifEmpty { null }
    val source: String = raw.getString("data_source")
    val permission: String = raw.getString("permission")
    val columns: List<String> = raw.optJSONArray("columns")?.strings() ?: emptyList()
    val fields: List<String> = raw.optJSONArray("fields")?.strings() ?: emptyList()
    val pageSize: Int = raw.optJSONObject("pagination")?.optInt("size", 20) ?: 20
    fun label(locale: String): String {
        val l = raw.getJSONObject("labels")
        return if (l.has(locale)) l.getString(locale) else l.getString("en")
    }
}

class Spec(text: String) {
    private val root = JSONObject(text)
    val locales: List<String> = root.getJSONArray("locales").strings()
    val defaultLocale: String = root.getString("default_locale")
    val primaryColor: String = root.getJSONObject("theme").getString("primary_color")
    val sources: List<Source> = root.getJSONArray("data_sources").objects().map { Source(it) }
    val pages: List<Page> = root.getJSONArray("pages").objects().map { Page(it) }
    val navigation: List<String> = root.getJSONObject("navigation").getJSONArray("items").strings()
    fun source(id: String): Source? = sources.firstOrNull { it.id == id }
    fun page(src: Source, type: String, mode: String? = null): Page? =
        pages.firstOrNull { it.source == src.id && it.type == type && (mode == null || it.mode == mode) }
}

fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
`;

export const DATA_KT = String.raw`package PKG

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

class ListResult(val items: List<JSONObject>, val total: Int)

// Same interface for the REST backend (api-rest routes) and the in-memory demo. Call from a background dispatcher.
interface Data {
    fun list(src: Source, q: String, page: Int, size: Int): ListResult
    fun get(src: Source, id: String): JSONObject
    fun create(src: Source, v: JSONObject): JSONObject
    fun update(src: Source, id: String, v: JSONObject): JSONObject
    fun archive(src: Source, id: String)
}

class RestData(private val base: String, private val token: String?) : Data {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun call(method: String, path: String, body: JSONObject? = null): String {
        val c = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 15000
        c.readTimeout = 15000
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token)
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) {
            val msg = try { JSONObject(text).optString("error") } catch (e: Exception) { "" }
            throw Exception(if (msg.isNotEmpty()) msg else "HTTP " + code)
        }
        return text
    }
    private fun fill(tpl: String, id: String) = tpl.replace(":id", enc(id))
    override fun list(src: Source, q: String, page: Int, size: Int): ListResult {
        var path = src.api("list") + "?page=" + page + "&pageSize=" + size
        if (q.isNotEmpty()) path += "&q=" + enc(q)
        val o = JSONObject(call("GET", path))
        val a: JSONArray = o.getJSONArray("items")
        return ListResult((0 until a.length()).map { a.getJSONObject(it) }, o.optInt("total", a.length()))
    }
    override fun get(src: Source, id: String) = JSONObject(call("GET", fill(src.api("read"), id)))
    override fun create(src: Source, v: JSONObject) = JSONObject(call("POST", src.api("create"), v))
    override fun update(src: Source, id: String, v: JSONObject) = JSONObject(call("PATCH", fill(src.api("update"), id), v))
    override fun archive(src: Source, id: String) { call("DELETE", fill(src.api("archive"), id)) }
}

class MemoryData : Data {
    private val rows = HashMap<String, MutableList<JSONObject>>()
    private var n = 0
    private fun live(src: Source) = rows.getOrPut(src.id) { mutableListOf() }.filter { !it.has("archived_at") || it.isNull("archived_at") }
    private fun find(src: Source, id: String) = live(src).firstOrNull { it.getString("id") == id } ?: throw Exception("Not found")
    override fun list(src: Source, q: String, page: Int, size: Int): ListResult {
        var items = live(src)
        if (q.isNotEmpty()) items = items.filter { r -> src.searchFields.any { r.optString(it).contains(q, ignoreCase = true) } }
        return ListResult(items.drop((page - 1) * size).take(size), items.size)
    }
    override fun get(src: Source, id: String) = find(src, id)
    override fun create(src: Source, v: JSONObject): JSONObject {
        n++
        val row = JSONObject(v.toString())
        row.put("id", "m" + n)
        row.put("archived_at", JSONObject.NULL)
        rows.getOrPut(src.id) { mutableListOf() }.add(row)
        return row
    }
    override fun update(src: Source, id: String, v: JSONObject): JSONObject {
        val r = find(src, id)
        for (k in v.keys()) r.put(k, v.get(k))
        return r
    }
    override fun archive(src: Source, id: String) { find(src, id).put("archived_at", "archived") }
}
`;

export const SCREENS_KT = String.raw`package PKG

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private sealed class Route {
    object Menu : Route()
    class List(val src: Source) : Route()
    class Detail(val src: Source, val id: String) : Route()
    class Form(val src: Source, val row: JSONObject?) : Route()
}

fun show(v: Any?): String = if (v == null || v == JSONObject.NULL || v.toString().isEmpty()) "-" else v.toString().filter { !it.isISOControl() }

// money: the stored value is whole minor units (12050 = 120.50); text <-> units uses string math, never a float.
fun moneyShow(v: Any?, scale: Int): String {
    val n = (v as? Number)?.toLong() ?: v?.toString()?.toLongOrNull() ?: return v?.toString() ?: ""
    var s = Math.abs(n).toString()
    if (scale > 0) {
        while (s.length <= scale) s = "0" + s
        s = s.substring(0, s.length - scale) + "." + s.substring(s.length - scale)
    }
    return (if (n < 0) "-" else "") + s
}

fun moneyParse(text: String, scale: Int): Long? {
    val m = Regex("^(-?)([0-9]+)(?:[.]([0-9]*))?$").matchEntire(text.trim()) ?: return null
    val frac = m.groupValues[3]
    if (frac.length > scale) return null
    val n = (m.groupValues[2] + frac.padEnd(scale, '0')).toLongOrNull() ?: return null
    if (n > 9007199254740991L) return null
    return if (m.groupValues[1].isEmpty()) n else -n
}

fun showField(f: Field?, v: Any?): String =
    if (f != null && f.widget == "money" && v != null && v != JSONObject.NULL) moneyShow(v, f.scale) else show(v)

// Typed value from the text a person typed; null = invalid. Mirrors the web and terminal renderers.
fun coerce(f: Field, text: String): Any? = when (f.widget) {
    "number" -> text.toDoubleOrNull()?.takeIf { it.isFinite() }
    "integer" -> text.toLongOrNull()
    "money" -> moneyParse(text, f.scale)
    "checkbox" -> when (text.lowercase()) { "y", "yes", "true", "1" -> true; "n", "no", "false", "0" -> false; else -> null }
    "select" -> if (f.values.contains(text)) text else null
    "json" -> try { if (text.trim().startsWith("[")) org.json.JSONArray(text) else JSONObject(text) } catch (e: Exception) { null }
    "email" -> if (Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(text)) text else null
    "url" -> if (Regex("^https?://\\S+$").matches(text)) text else null
    else -> text
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IonApp(spec: Spec, data: Data, permissions: Set<String>, allowAll: Boolean, locale: String, onToggleLocale: () -> Unit) {
    var route by remember { mutableStateOf<Route>(Route.Menu) }
    val can = { key: String -> allowAll || permissions.contains(key) }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (locale == "ar") "القائمة" else "Menu") },
            navigationIcon = { if (route !is Route.Menu) TextButton(onClick = { route = Route.Menu }) { Text(if (locale == "ar") "رجوع" else "Back") } },
            actions = { if (spec.locales.size > 1) TextButton(onClick = onToggleLocale) { Text(if (locale == "ar") "English" else "عربي") } }
        )
    }) { pad ->
        Box(Modifier.padding(pad).padding(16.dp)) {
            when (val r = route) {
                is Route.Menu -> {
                    val items = spec.navigation.mapNotNull { spec.source(it) }.filter { can("entity:" + it.entity + ":list") }
                    if (items.isEmpty()) Text(if (locale == "ar") "لا توجد صلاحيات." else "No permissions granted.")
                    else LazyColumn { items(items) { s -> ListItem(headlineContent = { Text(s.title(locale, true)) }, modifier = Modifier.clickable { route = Route.List(s) }) } }
                }
                is Route.List -> ListScreen(spec, data, r.src, locale, can, { route = Route.Detail(r.src, it) }, { route = Route.Form(r.src, null) })
                is Route.Detail -> DetailScreen(spec, data, r.src, r.id, locale, can, { route = Route.Form(r.src, it) }, { route = Route.List(r.src) })
                is Route.Form -> FormScreen(spec, data, r.src, r.row, locale, can) { route = if (it != null) Route.Detail(r.src, it) else Route.List(r.src) }
            }
        }
    }
}

@Composable
private fun ListScreen(spec: Spec, data: Data, src: Source, locale: String, can: (String) -> Boolean, open: (String) -> Unit, create: () -> Unit) {
    val page = spec.page(src, "list")!!
    var q by remember { mutableStateOf("") }
    var n by remember { mutableStateOf(1) }
    var result by remember { mutableStateOf<ListResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(q, n) {
        try { result = withContext(Dispatchers.IO) { data.list(src, q, n, page.pageSize) }; error = null } catch (e: Exception) { error = e.message }
    }
    val pages = maxOf(1, ((result?.total ?: 0) + page.pageSize - 1) / page.pageSize)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(src.title(locale, true), style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(value = q, onValueChange = { q = it; n = 1 }, label = { Text(if (locale == "ar") "بحث" else "Search") }, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(Modifier.weight(1f)) {
            items(result?.items ?: emptyList()) { row ->
                val title = src.display?.let { showField(src.field(it), row.opt(it)) } ?: show(row.opt("id"))
                val sub = page.columns.filter { it != src.display }.take(2).joinToString(" | ") { showField(src.field(it), row.opt(it)) }
                ListItem(headlineContent = { Text(title) }, supportingContent = { Text(sub) }, modifier = Modifier.clickable { open(row.getString("id")) })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(enabled = n > 1, onClick = { n-- }) { Text("<") }
            Text("$n / $pages")
            TextButton(enabled = n < pages, onClick = { n++ }) { Text(">") }
            if (can("entity:" + src.entity + ":create")) Button(onClick = create) { Text(if (locale == "ar") "جديد" else "New") }
        }
    }
}

@Composable
private fun DetailScreen(spec: Spec, data: Data, src: Source, id: String, locale: String, can: (String) -> Boolean, edit: (JSONObject) -> Unit, back: () -> Unit) {
    val page = spec.page(src, "detail")!!
    var row by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) { try { row = withContext(Dispatchers.IO) { data.get(src, id) } } catch (e: Exception) { error = e.message } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(page.label(locale), style = MaterialTheme.typography.headlineSmall)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        row?.let { r ->
            page.fields.mapNotNull { src.field(it) }.forEach { f ->
                Text(f.labels.optString(locale, f.labels.optString("en")) + ": " + showField(f, r.opt(f.name)))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (can("entity:" + src.entity + ":update")) Button(onClick = { edit(r) }) { Text(if (locale == "ar") "تعديل" else "Edit") }
                if (can("entity:" + src.entity + ":archive")) OutlinedButton(onClick = {
                    scope.launch { try { withContext(Dispatchers.IO) { data.archive(src, id) }; back() } catch (e: Exception) { error = e.message } }
                }) { Text(if (locale == "ar") "أرشفة" else "Archive") }
            }
        }
    }
}

@Composable
private fun FormScreen(spec: Spec, data: Data, src: Source, row: JSONObject?, locale: String, can: (String) -> Boolean, done: (String?) -> Unit) {
    val mode = if (row == null) "create" else "edit"
    val page = spec.page(src, "form", mode)!!
    if (!can(page.permission)) { Text(if (locale == "ar") "ليس لديك صلاحية." else "You do not have permission."); return }
    val fields = page.fields.mapNotNull { src.field(it) }.filter { !it.auto }
    val texts = remember { fields.associate { f -> f.name to mutableStateOf(row?.opt(f.name)?.takeIf { it != JSONObject.NULL }?.let { v -> if (f.widget == "money") moneyShow(v, f.scale) else v.toString() } ?: "") } }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(page.label(locale), style = MaterialTheme.typography.headlineSmall)
        fields.forEach { f ->
            val hint = if (f.widget == "select") " (" + f.values.joinToString("/") + ")" else if (f.widget == "checkbox") " (y/n)" else ""
            OutlinedTextField(
                value = texts[f.name]!!.value, onValueChange = { texts[f.name]!!.value = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                label = { Text(f.labels.optString(locale, f.labels.optString("en")) + (if (f.required && mode == "create") " *" else "") + hint) })
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = {
            val v = JSONObject()
            for (f in fields) {
                val text = texts[f.name]!!.value.trim()
                if (text.isEmpty()) {
                    if (mode == "create" && f.required) { error = f.labels.optString(locale, f.labels.optString("en")) + (if (locale == "ar") " مطلوب" else " is required"); return@Button }
                    continue
                }
                val c = coerce(f, text)
                if (c == null) { error = f.labels.optString(locale, f.labels.optString("en")) + (if (locale == "ar") " غير صالح" else " is not valid"); return@Button }
                v.put(f.name, c)
            }
            scope.launch {
                try {
                    val saved = withContext(Dispatchers.IO) { if (row == null) data.create(src, v) else data.update(src, row.getString("id"), v) }
                    done(saved.optString("id", row?.optString("id")).ifEmpty { null })
                } catch (e: Exception) { error = e.message }
            }
        }) { Text(if (locale == "ar") "حفظ" else "Save") }
    }
}
`;

export const MAIN_KT = String.raw`package PKG

import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.runtime.CompositionLocalProvider

// Configuration: ION_API empty = in-memory demo with every permission (for looking at the UI).
// With a backend, PERMISSIONS must come from your authentication layer; nothing is listed until it does.
object Config {
    const val API = BuildConfig.ION_API
    const val TOKEN = BuildConfig.ION_TOKEN
    val PERMISSIONS: Set<String> = BuildConfig.ION_PERMISSIONS.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val spec = Spec(assets.open("ui_spec.json").bufferedReader().use { it.readText() })
        val demo = Config.API.isEmpty()
        val data: Data = if (demo) MemoryData() else RestData(Config.API, Config.TOKEN.ifEmpty { null })
        setContent {
            var locale by remember { mutableStateOf(spec.defaultLocale) }
            val primary = Color(AndroidColor.parseColor(spec.primaryColor))
            val scheme = if (isSystemInDarkTheme()) darkColorScheme(primary = primary) else lightColorScheme(primary = primary)
            MaterialTheme(colorScheme = scheme) {
                CompositionLocalProvider(LocalLayoutDirection provides if (locale == "ar") LayoutDirection.Rtl else LayoutDirection.Ltr) {
                    IonApp(spec, data, Config.PERMISSIONS, demo, locale) { locale = if (locale == "ar") "en" else "ar" }
                }
            }
        }
    }
}
`;
