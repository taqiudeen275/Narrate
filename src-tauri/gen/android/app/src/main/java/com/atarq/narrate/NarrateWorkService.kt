package com.atarq.narrate

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/** Keeps user-requested work eligible while the screen is idle, until completion. */
class NarrateWorkService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private val renewLock = object : Runnable {
        override fun run() {
            // Slow devices can render a book for longer than one lock timeout.
            // Renewal belongs to the service, independent of WebView timers.
            wakeLock?.acquire(6 * 60 * 60 * 1000L)
            handler.postDelayed(this, 30 * 60 * 1000L)
        }
    }
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel("narrate-work", "Narration and downloads", NotificationManager.IMPORTANCE_LOW))
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, "narrate-work")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Narrate is working")
            .setContentText(intent?.getStringExtra("label") ?: "Preparing offline audio")
            .setContentIntent(open).setOngoing(true).setSilent(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(731, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(731, notification)
        if (wakeLock?.isHeld != true) {
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Narrate:offline-work").apply {
                    setReferenceCounted(false)
                    acquire(6 * 60 * 60 * 1000L)
                }
        }
        handler.removeCallbacks(renewLock)
        handler.postDelayed(renewLock, 30 * 60 * 1000L)
        // Work is owned by the current WebView. Saved checkpoints recover if
        // Android destroys it; restarting an empty service would waste battery.
        return START_NOT_STICKY
    }
    override fun onDestroy() {
        handler.removeCallbacks(renewLock)
        if (wakeLock?.isHeld == true) wakeLock?.release()
        wakeLock = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
