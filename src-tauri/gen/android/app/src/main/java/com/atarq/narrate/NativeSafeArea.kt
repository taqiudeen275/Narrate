package com.atarq.narrate

import android.app.Activity
import android.provider.Settings
import android.view.View
import android.view.ViewTreeObserver
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Reads geometry without replacing Wry's inset listener, WebViewClient, or IME handling. */
internal class NativeSafeArea(
  private val activity: Activity,
  private val webView: WebView,
) : ViewTreeObserver.OnPreDrawListener, View.OnAttachStateChangeListener {
  private var safeArea: Insets? = null
  private var density = 1f
  private var reduceMotion = false
  private var disposed = false
  private var publishing = false
  private var publishedJson: String? = null

  // JavascriptInterface methods run on WebView's background thread. Publish a
  // complete immutable snapshot there instead of touching Android views.
  @Volatile private var snapshotJson = "{\"safeArea\":null,\"reduceMotion\":false}"

  init {
    refreshPreferences()
    webView.addJavascriptInterface(this, "NarrateInsets")
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      WebViewCompat.addDocumentStartJavaScript(webView, NATIVE_INSETS_SCRIPT, setOf("*"))
    }
    webView.addOnAttachStateChangeListener(this)
    if (webView.isAttachedToWindow) onViewAttachedToWindow(webView)
  }

  @JavascriptInterface
  fun read(): String = snapshotJson

  fun refreshPreferences() {
    reduceMotion = Settings.Global.getFloat(
      activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
    ) == 0f
    updateSnapshot()
    if (webView.isAttachedToWindow) {
      ViewCompat.requestApplyInsets(webView)
      webView.post { if (!disposed) refreshInsets() }
    }
  }

  override fun onViewAttachedToWindow(view: View) {
    webView.viewTreeObserver.addOnPreDrawListener(this)
    ViewCompat.requestApplyInsets(webView)
    webView.post { if (!disposed) refreshInsets() }
  }

  override fun onViewDetachedFromWindow(view: View) {
    removeDrawObserver()
  }

  override fun onPreDraw(): Boolean {
    refreshInsets()
    return true
  }

  private fun refreshInsets() {
    if (disposed) return
    ViewCompat.getRootWindowInsets(webView)?.let { insets ->
      // The keyboard remains a visual-viewport concern; treating IME height as
      // a safe area would reserve the keyboard's space a second time.
      val nextInsets = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val nextDensity = webView.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
      if (nextInsets != safeArea || nextDensity != density) {
        safeArea = nextInsets
        density = nextDensity
        updateSnapshot()
      }
    }
    publishIfChanged()
  }

  private fun updateSnapshot() {
    val areas = safeArea?.let { insets ->
      // Android measures physical pixels. With the device-width/initial-scale
      // viewport, CSS pixels match Android density-independent pixels.
      JSONObject().apply {
        put("top", insets.top / density.toDouble())
        put("right", insets.right / density.toDouble())
        put("bottom", insets.bottom / density.toDouble())
        put("left", insets.left / density.toDouble())
      }
    }
    snapshotJson = JSONObject().apply {
      put("safeArea", areas ?: JSONObject.NULL)
      put("reduceMotion", reduceMotion)
    }.toString()
  }

  private fun publishIfChanged() {
    val nextJson = snapshotJson
    if (publishing || nextJson == publishedJson) return
    publishing = true
    webView.evaluateJavascript(NATIVE_INSETS_SCRIPT) { applied ->
      publishing = false
      if (!disposed && applied == "true") publishedJson = nextJson
    }
  }

  private fun removeDrawObserver() {
    val observer = webView.viewTreeObserver
    if (observer.isAlive) observer.removeOnPreDrawListener(this)
  }

  fun dispose() {
    disposed = true
    removeDrawObserver()
    webView.removeOnAttachStateChangeListener(this)
    webView.removeJavascriptInterface("NarrateInsets")
  }
}

// This also runs at document start so a full page reload restores the safe
// area even when native geometry is unchanged. Frontend startup uses read()
// directly as the fallback for WebViews without document-start support.
internal val NATIVE_INSETS_SCRIPT = """
(function () {
  function apply() {
    var root = document.documentElement;
    if (!root) return false;
    try {
      var data = JSON.parse(window.NarrateInsets.read());
      if (data.safeArea) {
        ['top', 'right', 'bottom', 'left'].forEach(function (side) {
          root.style.setProperty('--native-safe-area-' + side, data.safeArea[side] + 'px');
        });
      }
      root.dataset.reduceMotion = String(data.reduceMotion);
      window.dispatchEvent(new window.CustomEvent('narrate-safe-area', { detail: data.safeArea }));
      return true;
    } catch (error) {
      return false;
    }
  }
  if (apply()) return true;
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  return false;
})()
""".trimIndent()
