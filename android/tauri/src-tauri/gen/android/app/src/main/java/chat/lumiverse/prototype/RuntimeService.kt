package chat.lumiverse.prototype

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.os.PowerManager
import org.json.JSONObject

/** Owns the local Bun process independently of any activity or WebView. */
class RuntimeService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val listeners = linkedSetOf<RuntimeHost.Listener>()
    private val clients = mutableMapOf<IBinder, Pair<RuntimeHost.Listener, IBinder.DeathRecipient>>()
    private val inbox = Messenger(object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(message: Message) {
            if (message.sendingUid != applicationInfo.uid) return
            val client = message.replyTo ?: return
            when (message.what) {
                ATTACH -> attachClient(client)
                DETACH -> detachClient(client.binder)
            }
        }
    })
    private var runtime: RuntimeHost? = null
    private var setupUrl: String? = null
    private var backendUrl: String? = null
    private var task: JSONObject? = null
    private var foreground = false
    private var timedOut = false
    private var destroyed = false
    private var generation = 0
    private lateinit var wakeLock: PowerManager.WakeLock
    private val notifications get() = getSystemService(NotificationManager::class.java)
    private val stopIdle = Runnable { if (listeners.isEmpty() && !busy()) stopSelf() }
    private val renewWake = object : Runnable {
        override fun run() {
            if (working() && !destroyed && !timedOut) {
                wakeLock.acquire(10 * 60 * 1000L)
                handler.postDelayed(this, 5 * 60 * 1000L)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Backup restores", NotificationManager.IMPORTANCE_LOW))
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Lumiverse::BackupRestore")
        wakeLock.setReferenceCounted(false)
    }

    override fun onBind(intent: Intent): IBinder = inbox.binder

    private fun attachClient(client: Messenger) {
        if (clients.containsKey(client.binder)) return
        fun send(what: Int, key: String, value: String) {
            try { client.send(Message.obtain(null, what).apply { data = Bundle().apply { putString(key, value) } }) }
            catch (_: RemoteException) { detachClient(client.binder) }
        }
        val listener = object : RuntimeHost.Listener {
            override fun ready(url: String) { send(READY, "url", url) }
            override fun backendReady(url: String) { send(BACKEND_READY, "url", url) }
            override fun failed(message: String) { send(FAILED, "message", message) }
            override fun importActivity(activity: JSONObject) { send(IMPORT_STARTED, "activity", activity.toString()) }
        }
        val death = IBinder.DeathRecipient { handler.post { detachClient(client.binder) } }
        try { client.binder.linkToDeath(death, 0) } catch (_: RemoteException) { return }
        clients[client.binder] = listener to death
        attach(listener)
    }

    private fun detachClient(binder: IBinder) {
        val client = clients.remove(binder) ?: return
        binder.unlinkToDeath(client.second, 0)
        detach(client.first)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == CANCEL) {
            val requested = intent.getStringExtra("jobId")
            if (requested != null && requested == task?.optString("jobId") && busy()) runtime?.cancelImport(requested)
        }
        // Process death is recovered from the saved backend job when the user
        // opens the app. Do not silently restart an idle server in the background.
        return START_NOT_STICKY
    }

    private fun attach(listener: RuntimeHost.Listener) {
        handler.removeCallbacks(stopIdle)
        listeners.add(listener)
        if (runtime == null) {
            timedOut = false
            task = null
            val attempt = ++generation
            runtime = RuntimeHost(applicationContext, "tauri", object : RuntimeHost.Listener {
                override fun ready(url: String) { handler.post {
                    if (!destroyed && attempt == generation) { setupUrl = url; listeners.toList().forEach { it.ready(url) } }
                } }
                override fun backendReady(url: String) { handler.post {
                    if (!destroyed && attempt == generation) { backendUrl = url; listeners.toList().forEach { it.backendReady(url) } }
                } }
                override fun importActivity(activity: JSONObject) { handler.post { if (!destroyed && attempt == generation) updateTask(activity) } }
                override fun failed(message: String) { handler.post {
                    if (!destroyed && attempt == generation) {
                        generation++
                        finishWork()
                        runtime?.stop(); runtime = null; setupUrl = null; backendUrl = null
                        task?.let {
                            task = JSONObject(it.toString()).put("status", "interrupted")
                            notifications.notify(NOTIFICATION, notification(task!!))
                        }
                        listeners.toList().forEach { it.failed(message) }
                    }
                } }
            }).also { it.start() }
        } else if (backendUrl != null) listener.backendReady(backendUrl!!)
        else if (setupUrl != null) listener.ready(setupUrl!!)
    }

    private fun detach(listener: RuntimeHost.Listener) {
        listeners.remove(listener)
        if (listeners.isEmpty() && !busy()) handler.postDelayed(stopIdle, 30_000)
    }

    private fun busy(): Boolean = task?.optString("status") in setOf("uploading", "queued", "running", "awaiting_ticket")
    private fun working(): Boolean = busy() && task?.optString("status") != "awaiting_ticket"

    private fun notification(activity: JSONObject): Notification {
        val status = activity.optString("status")
        val active = status in setOf("uploading", "queued", "running", "awaiting_ticket")
        val phase = activity.optString("phase")
        val title = when (status) {
            "complete" -> "Backup restored"
            "failed", "interrupted" -> "Backup restore interrupted"
            "cancelled" -> "Backup restore cancelled"
            "awaiting_ticket" -> "Backup restore needs your ticket"
            else -> "Restoring backup"
        }
        val text = when {
            timedOut -> "Android's background time limit was reached. Open Lumiverse to resume."
            status == "complete" -> "Your restored data is ready."
            status == "cancelled" -> "Already restored data has been kept."
            status == "failed" || status == "interrupted" -> "Open Lumiverse to check the restore."
            status == "awaiting_ticket" -> "Open Lumiverse to provide the decryption ticket or skip API keys."
            phase == "uploading" -> "Receiving backup archive…"
            phase == "extracting" -> "Extracting archive…"
            phase == "files" -> "Restoring files…"
            phase == "table" || phase == "table_done" -> "Restoring account data…"
            else -> "Processing archive…"
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .putExtra(OPEN_RESTORE, true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val builder = Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title).setContentText(text).setContentIntent(open).setOnlyAlertOnce(true)
            .setOngoing(active).setAutoCancel(!active).setCategory(Notification.CATEGORY_PROGRESS)
        if (active) {
            val bytesTotal = activity.optDouble("bytesTotal", 0.0)
            val total = if (bytesTotal > 0) bytesTotal else activity.optDouble("total", 0.0)
            val done = activity.optDouble(if (bytesTotal > 0) "bytesProcessed" else "processed", 0.0)
            if (status != "awaiting_ticket") builder.setProgress(100, if (total > 0) (100 * done / total).toInt().coerceIn(0, 100) else 0, total <= 0)
            val cancel = PendingIntent.getService(this, 1, Intent(this, RuntimeService::class.java).setAction(CANCEL)
                .putExtra("jobId", activity.optString("jobId")), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            builder.addAction(Notification.Action.Builder(null, "Cancel restore", cancel).build())
        }
        return builder.build()
    }

    private fun updateTask(activity: JSONObject) {
        if (timedOut) return
        val starting = !busy()
        task = activity
        if (busy()) {
            handler.removeCallbacks(stopIdle)
            try {
                val notice = notification(activity)
                if (!foreground) {
                    startForeground(NOTIFICATION, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                    foreground = true
                } else notifications.notify(NOTIFICATION, notice)
                if (working()) { if (!wakeLock.isHeld) renewWake.run() } else releaseWake()
                if (starting) listeners.toList().forEach { it.importActivity(activity) }
            } catch (error: RuntimeException) {
                // If Android declines foreground execution, stop this work
                // cleanly instead of claiming it is protected in the background.
                runtime?.cancelImport(activity.optString("jobId"))
                finishWork()
                listeners.toList().forEach { it.failed("Android could not keep the restore running: ${error.message}") }
            }
        } else {
            finishWork()
            notifications.notify(NOTIFICATION, notification(activity))
        }
    }

    private fun releaseWake() {
        handler.removeCallbacks(renewWake)
        if (wakeLock.isHeld) wakeLock.release()
    }
    private fun finishWork() {
        releaseWake()
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false }
        if (listeners.isEmpty()) handler.postDelayed(stopIdle, 30_000)
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        timedOut = true
        generation++
        // The saved active job becomes resumable after this process stops.
        runtime?.stop(); runtime = null; setupUrl = null; backendUrl = null
        finishWork()
        task?.let {
            task = JSONObject(it.toString()).put("status", "interrupted")
            notifications.notify(NOTIFICATION, notification(task!!))
        }
        listeners.toList().forEach { it.failed("Android paused the restore after its background time limit. Reopen Lumiverse to resume.") }
        stopSelf()
    }

    override fun onDestroy() {
        destroyed = true
        generation++
        handler.removeCallbacksAndMessages(null)
        releaseWake()
        runtime?.stop(); runtime = null
        clients.forEach { (binder, client) -> binder.unlinkToDeath(client.second, 0) }
        clients.clear()
        listeners.clear()
        super.onDestroy()
    }

    companion object {
        const val ATTACH = 1
        const val DETACH = 2
        const val READY = 3
        const val BACKEND_READY = 4
        const val FAILED = 5
        const val IMPORT_STARTED = 6
        const val OPEN_RESTORE = "chat.lumiverse.prototype.OPEN_RESTORE"
        private const val CHANNEL = "lumiverse-backup-restores"
        private const val NOTIFICATION = 23017
        private const val CANCEL = "chat.lumiverse.prototype.CANCEL_RESTORE"
    }
}
