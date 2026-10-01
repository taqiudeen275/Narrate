package com.atarq.narrate

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class BackgroundArgs { var label: String = "Preparing narration" }

@TauriPlugin
class BackgroundPlugin(private val activity: Activity) : Plugin(activity) {
    private var view: WebView? = null
    private var working = false
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

    override fun onPause(activity: AppCompatActivity) { keepRunning() }
    override fun onStop(activity: AppCompatActivity) { keepRunning() }
    private fun keepRunning() {
        if (working) view?.post { if (working) { view?.onResume(); view?.resumeTimers() } }
    }
    override fun onDestroy(activity: AppCompatActivity) {
        working = false
        activity.stopService(Intent(activity, NarrateWorkService::class.java))
        view = null
    }
}
