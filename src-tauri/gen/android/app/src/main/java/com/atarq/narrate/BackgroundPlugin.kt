package com.atarq.narrate

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors

@InvokeArg
class BackgroundArgs { var label: String = "Preparing narration" }

@InvokeArg
class AudioExportArgs {
    var filename: String = "narrate.wav"
    var mimeType: String = "audio/wav"
    var expectedBytes: Long = 0
}

@InvokeArg
class AudioExportChunkArgs {
    var session: String = ""
    var data: String = ""
}

@InvokeArg
class AudioExportSessionArgs { var session: String = "" }

private class AudioExportSession(
    val id: String,
    val uri: Uri,
    val output: OutputStream,
    val expectedBytes: Long,
    var writtenBytes: Long = 0,
)

@TauriPlugin
class BackgroundPlugin(private val activity: Activity) : Plugin(activity) {
    private var view: WebView? = null
    private var working = false
    private val exportWorker = Executors.newSingleThreadExecutor()
    // Picker state belongs to the UI thread; the worker alone owns stream I/O.
    private var exportPicker: Invoke? = null
    private var exportArgs: AudioExportArgs? = null
    @Volatile private var exportOpening = false
    @Volatile private var exportSession: AudioExportSession? = null
    @Volatile private var destroyed = false
    override fun load(webView: WebView) { view = webView }

    @Command
    fun begin(invoke: Invoke) {
        val args = invoke.parseArgs(BackgroundArgs::class.java)
        activity.runOnUiThread {
            try {
                ContextCompat.startForegroundService(activity,
                    Intent(activity, NarrateWorkService::class.java).putExtra("label", args.label))
                working = true
                view?.onResume()
                view?.resumeTimers()
                invoke.resolve(JSObject())
            } catch (error: Exception) { invoke.reject(error.message ?: "Unable to start background work") }
        }
    }

    @Command
    fun end(invoke: Invoke) {
        activity.runOnUiThread {
            working = false
            activity.stopService(Intent(activity, NarrateWorkService::class.java))
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun audioExportBegin(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AudioExportArgs::class.java)
            require(args.filename.isNotBlank() && args.filename.length <= 128) { "Invalid audio filename" }
            require(args.mimeType == "audio/wav" || args.mimeType == "audio/mpeg") { "Unsupported audio type" }
            require(args.expectedBytes >= 0) { "Invalid audio size" }
            activity.runOnUiThread {
                if (destroyed || exportPicker != null || exportOpening || exportSession != null) {
                    invoke.reject("Another audio export is active")
                    return@runOnUiThread
                }
                exportPicker = invoke
                exportArgs = args
                try {
                    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = args.mimeType
                        putExtra(Intent.EXTRA_TITLE, args.filename)
                    }
                    startActivityForResult(invoke, intent, "audioExportPicked")
                } catch (error: Exception) {
                    exportPicker = null
                    exportArgs = null
                    invoke.reject(error.message ?: "Unable to open audio save picker")
                }
            }
        } catch (error: Exception) { invoke.reject(error.message ?: "Invalid audio export") }
    }

    @ActivityCallback
    fun audioExportPicked(invoke: Invoke, result: ActivityResult) {
        if (exportPicker?.id != invoke.id) return
        exportPicker = null
        val args = exportArgs
        exportArgs = null
        if (args == null) {
            invoke.reject("Audio export interrupted")
            return
        }
        if (result.resultCode == Activity.RESULT_CANCELED) {
            val response = JSObject()
            response.put("native", true)
            response.put("session", JSONObject.NULL)
            invoke.resolve(response)
            return
        }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("No audio save location was selected")
            return
        }
        exportOpening = true
        try {
            exportWorker.execute {
                try {
                    check(!destroyed) { "Audio export interrupted" }
                    val output = activity.contentResolver.openOutputStream(uri, "wt")
                        ?: throw IllegalStateException("Unable to open audio save location")
                    val session = AudioExportSession(UUID.randomUUID().toString(), uri, output, args.expectedBytes)
                    exportSession = session
                    check(!destroyed) { "Audio export interrupted" }
                    val response = JSObject()
                    response.put("native", true)
                    response.put("session", session.id)
                    invoke.resolve(response)
                } catch (error: Exception) {
                    discardExport()
                    deleteExport(uri)
                    invoke.reject(error.message ?: "Unable to create audio file")
                } finally { exportOpening = false }
            }
        } catch (error: Exception) {
            exportOpening = false
            invoke.reject(error.message ?: "Audio export interrupted")
        }
    }

    @Command
    fun audioExportWrite(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AudioExportChunkArgs::class.java)
            require(args.data.length <= 120 * 1024) { "Audio export chunk is too large" }
            exportWorker.execute {
                val session = exportSession
                if (session == null || session.id != args.session) {
                    invoke.reject("Invalid audio export session")
                    return@execute
                }
                try {
                    check(!destroyed) { "Audio export interrupted" }
                    val bytes = Base64.decode(args.data, Base64.NO_WRAP)
                    require(bytes.size <= 90 * 1024) { "Audio export chunk is too large" }
                    require(bytes.size.toLong() <= session.expectedBytes - session.writtenBytes) { "Audio export exceeds expected size" }
                    session.output.write(bytes)
                    session.writtenBytes += bytes.size
                    check(!destroyed) { "Audio export interrupted" }
                    invoke.resolve(JSObject())
                } catch (error: Exception) {
                    discardExport()
                    invoke.reject(error.message ?: "Unable to write audio file")
                }
            }
        } catch (error: Exception) { invoke.reject(error.message ?: "Invalid audio export chunk") }
    }

    @Command
    fun audioExportFinish(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AudioExportSessionArgs::class.java)
            exportWorker.execute {
                val session = exportSession
                if (session == null || session.id != args.session) {
                    invoke.reject("Invalid audio export session")
                    return@execute
                }
                try {
                    check(!destroyed) { "Audio export interrupted" }
                    check(session.writtenBytes == session.expectedBytes) { "Audio export is incomplete" }
                    session.output.flush()
                    session.output.close()
                    check(!destroyed) { "Audio export interrupted" }
                    exportSession = null
                    invoke.resolve(JSObject())
                } catch (error: Exception) {
                    discardExport()
                    invoke.reject(error.message ?: "Unable to finish audio file")
                }
            }
        } catch (error: Exception) { invoke.reject(error.message ?: "Invalid audio export session") }
    }

    @Command
    fun audioExportAbort(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(AudioExportSessionArgs::class.java)
            exportWorker.execute {
                if (exportSession?.id == args.session) discardExport()
                invoke.resolve(JSObject())
            }
        } catch (error: Exception) { invoke.reject(error.message ?: "Unable to cancel audio export") }
    }

    private fun discardExport() {
        val session = exportSession ?: return
        exportSession = null
        try { session.output.close() } catch (_: Exception) { }
        deleteExport(session.uri)
    }

    private fun deleteExport(uri: Uri) {
        try { DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) { }
    }

    override fun onPause(activity: AppCompatActivity) { keepRunning() }
    override fun onStop(activity: AppCompatActivity) { keepRunning() }
    private fun keepRunning() {
        if (working) view?.post { if (working) { view?.onResume(); view?.resumeTimers() } }
    }
    override fun onDestroy(activity: AppCompatActivity) {
        if (!destroyed) {
            destroyed = true
            val pending = exportPicker
            exportPicker = null
            exportArgs = null
            pending?.reject("Audio export interrupted")
            exportWorker.execute { discardExport() }
            exportWorker.shutdown()
        }
        working = false
        activity.stopService(Intent(activity, NarrateWorkService::class.java))
        view = null
    }
}
