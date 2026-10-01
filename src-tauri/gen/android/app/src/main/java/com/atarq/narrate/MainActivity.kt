package com.atarq.narrate

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var nativeSafeArea: NativeSafeArea? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // The web UI uses a light canvas even when Android's system theme is dark.
    // Older Android versions without dark navigation icons retain a dark scrim.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.rgb(27, 29, 28)),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    nativeSafeArea?.dispose()
    nativeSafeArea = NativeSafeArea(this, webView)
  }

  override fun onResume() {
    super.onResume()
    nativeSafeArea?.refreshPreferences()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    nativeSafeArea?.refreshPreferences()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) nativeSafeArea?.refreshPreferences()
  }

  override fun onDestroy() {
    nativeSafeArea?.dispose()
    nativeSafeArea = null
    super.onDestroy()
  }
}
