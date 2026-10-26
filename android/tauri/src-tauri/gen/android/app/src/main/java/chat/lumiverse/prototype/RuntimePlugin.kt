package chat.lumiverse.prototype

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.view.MotionEvent
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class ConnectionArgs {
    var action: String = "info"
    var server: String? = null
}

@TauriPlugin
class RuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private var runtimeMessenger: Messenger? = null
    private var runtimeClient: Messenger? = null
    private var serviceConnection: ServiceConnection? = null
    private var webView: WebView? = null
    private var downloads: NativeDownloads? = null
    private var browserWindows: NativeBrowserWindows? = null
    private var connectionHistory: NativeConnectionHistory? = null
    private var launcherUrl = "http://tauri.localhost/index.html"
    private var entryHistoryIndex = 0
    private var localAttempt = 0
    private var pendingLocal: Invoke? = null
    private var openingRestore = false
    private var controls: AlertDialog? = null
    private val handler = Handler(Looper.getMainLooper())
    private val preferences get() = activity.getSharedPreferences("lumiverse-connection", Context.MODE_PRIVATE)

    override fun load(webView: WebView) {
        this.webView = webView
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        CookieManager.getInstance().setAcceptCookie(true)
        browserWindows = NativeBrowserWindows(activity, webView)
        connectionHistory = NativeConnectionHistory(activity, webView)
        installControls(webView)
        downloads = NativeDownloads(activity, webView)
        (activity as? MainActivity)?.let {
            it.notificationBridge = NativeNotificationBridge(it, webView)
            it.notificationNavigation = { openPendingNotification() }
        }
    }

    @Command
    fun connection(invoke: Invoke) {
        val args = invoke.parseArgs(ConnectionArgs::class.java)
        activity.runOnUiThread {
            try {
                val view = webView ?: throw IllegalStateException("The app is closing.")
                // This command is only exposed to the packaged connection page.
                launcherUrl = view.url?.substringBefore('?') ?: launcherUrl
                when (args.action) {
                    "info" -> invoke.resolve(JSObject().apply {
                        openingRestore = activity.intent.getBooleanExtra(RuntimeService.OPEN_RESTORE, false)
                        if (openingRestore) activity.intent.removeExtra(RuntimeService.OPEN_RESTORE)
                        put("mode", if (openingRestore) "local" else preferences.getString("mode", null))
                        put("server", preferences.getString("server", null))
                        put("history", connectionHistory?.entries())
                    })
                    "forget" -> {
                        connectionHistory?.forget(ServerAddress.normalize(args.server))
                        invoke.resolve(JSObject().apply { put("history", connectionHistory?.entries()) })
                    }
                    "remote" -> {
                        val server = ServerAddress.normalize(args.server)
                        stopLocal()
                        preferences.edit().putString("mode", "remote").putString("server", server).apply()
                        invoke.resolve()
                        navigate(server, remote = true)
                    }
                    "local" -> startLocal(invoke)
                    else -> invoke.reject("Unknown connection action.")
                }
            } catch (error: Exception) { invoke.reject(error.message ?: "Could not connect.") }
        }
    }

    private fun navigate(url: String, remote: Boolean = false) {
        val view = webView ?: return
        val native = activity as? MainActivity
        val local = !remote && preferences.getString("mode", null) == "local"
        connectionHistory?.select(if (remote) url else null)
        val origin = NativeNotifications.origin(url)
        // Consume before selecting: a restarted embedded backend has a new port.
        // Selection still clears its obsolete credential; the authenticated page reconciles it.
        val target = origin?.let { selected -> NativeNotifications.consumeTap(activity, activity.intent, selected, local)?.let { selected + it } } ?: url
        native?.notificationBridge?.select(url, local)
        downloads?.select(url)
        browserWindows?.select(url)
        entryHistoryIndex = view.copyBackForwardList().currentIndex + 1
        view.loadUrl(target)
    }

    private fun openPendingNotification() {
        val view = webView ?: return
        if (activity.intent.getBooleanExtra(RuntimeService.OPEN_RESTORE, false)) {
            // A cold launch first needs the packaged connection page's command.
            if (view.url?.startsWith(launcherUrl) == true) return
            activity.intent.removeExtra(RuntimeService.OPEN_RESTORE)
            openingRestore = true
            startLocal(null)
            return
        }
        val origin = NativeNotifications.origin(view.url) ?: return
        val path = NativeNotifications.consumeTap(activity, activity.intent, origin) ?: return
        val target = origin + path
        if (!NotificationPolicy.isCurrentChat(view.url, target)) view.loadUrl(target)
    }

    private fun startLocal(invoke: Invoke?) {
        stopLocal()
        pendingLocal = invoke
        val attempt = localAttempt
        val listener = object : RuntimeHost.Listener {
            override fun importActivity(activity: JSONObject) {
                val native = this@RuntimePlugin.activity as? MainActivity ?: return
                if (native.nativeActive && NativeNotifications.permission(native) == "default") native.requestNotificationPermission { }
            }
            override fun ready(url: String) { activity.runOnUiThread {
                if (attempt != localAttempt) return@runOnUiThread
                preferences.edit().putString("mode", "local").apply()
                pendingLocal?.resolve(); pendingLocal = null
                // This is the setup server, not the authenticated backend.
                // Preserve pending notification taps until backendReady selects it.
                val view = webView ?: return@runOnUiThread
                browserWindows?.select(null)
                entryHistoryIndex = view.copyBackForwardList().currentIndex + 1
                view.loadUrl(url)
            } }
            override fun backendReady(url: String) { activity.runOnUiThread {
                if (attempt != localAttempt) return@runOnUiThread
                preferences.edit().putString("mode", "local").apply()
                pendingLocal?.resolve(); pendingLocal = null
                val target = if (openingRestore) "$url?restoreImport=1" else url
                openingRestore = false
                navigate(target)
            } }
            override fun failed(message: String) { activity.runOnUiThread {
                if (attempt != localAttempt) return@runOnUiThread
                pendingLocal?.reject(message); pendingLocal = null
                // A crash on the runtime page must leave a way to recover.
                if (webView?.url?.startsWith(launcherUrl) == true) {
                    webView?.evaluateJavascript("document.getElementById('status')?.replaceChildren(document.createTextNode(${JSONObject.quote(message)}))", null)
                } else {
                    showConnectionPage()
                    AlertDialog.Builder(activity).setTitle("Local server stopped").setMessage(message)
                        .setPositiveButton("OK", null).show()
                }
            } }
        }
        val client = Messenger(object : Handler(Looper.getMainLooper()) {
            override fun handleMessage(message: Message) {
                if (attempt != localAttempt) return
                when (message.what) {
                    RuntimeService.READY -> message.data.getString("url")?.let { listener.ready(it) }
                    RuntimeService.BACKEND_READY -> message.data.getString("url")?.let { listener.backendReady(it) }
                    RuntimeService.FAILED -> message.data.getString("message")?.let { listener.failed(it) }
                    RuntimeService.IMPORT_STARTED -> message.data.getString("activity")?.let { listener.importActivity(JSONObject(it)) }
                }
            }
        })
        runtimeClient = client
        val context = activity.applicationContext
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                if (attempt != localAttempt) return
                runtimeMessenger = Messenger(binder)
                try { runtimeMessenger?.send(Message.obtain(null, RuntimeService.ATTACH).apply { replyTo = client }) }
                catch (_: RemoteException) { listener.failed("Could not attach to the local server service.") }
            }
            override fun onServiceDisconnected(name: ComponentName) {
                if (attempt != localAttempt) return
                runtimeMessenger = null
                listener.failed("The local server stopped. Open Lumiverse again to recover the restore.")
            }
        }
        try {
            // A started service can outlive its activity. Foreground promotion
            // is limited to actual restore work reported by the backend.
            context.startService(Intent(context, RuntimeService::class.java))
            check(context.bindService(Intent(context, RuntimeService::class.java), connection, Context.BIND_AUTO_CREATE)) { "Could not connect to the local server service." }
            serviceConnection = connection
        } catch (error: Exception) { listener.failed(error.message ?: "Could not start the local server.") }
    }

    private fun stopLocal() {
        if (NativeNotifications.isLocal(activity)) LocalNotificationTransport.stop()
        localAttempt += 1
        runtimeClient?.let { client ->
            try { runtimeMessenger?.send(Message.obtain(null, RuntimeService.DETACH).apply { replyTo = client }) }
            catch (_: RemoteException) { /* the service has already stopped */ }
        }
        serviceConnection?.let { activity.applicationContext.unbindService(it) }
        runtimeMessenger = null; runtimeClient = null; serviceConnection = null
        pendingLocal?.reject("Connection changed."); pendingLocal = null
    }

    private fun showConnectionPage(history: Boolean = false) {
        stopLocal()
        NativeNotifications.clear(activity)
        navigate("$launcherUrl?changeServer=1" + if (history) "&history=1" else "")
    }

    private fun showControls() {
        if (controls?.isShowing == true || activity.isFinishing) return
        controls = AlertDialog.Builder(activity).setTitle("Lumiverse")
            .setItems(arrayOf("Reload", "Change server", "Connection history", "Close app")) { _, which ->
                when (which) {
                    0 -> webView?.reload()
                    1 -> showConnectionPage()
                    2 -> showConnectionPage(history = true)
                    3 -> activity.finish()
                }
            }.setNegativeButton("Cancel", null).show()
    }

    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private fun installControls(view: WebView) {
        // Native controls also work on a failed/offline page. Android Back is
        // the accessible alternative to the optional two-finger gesture.
        val owner = activity as? AppCompatActivity
        owner?.onBackPressedDispatcher?.addCallback(owner,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (view.canGoBack() && view.copyBackForwardList().currentIndex > entryHistoryIndex) view.goBack()
                    else showControls()
                }
            })
        var startX = 0f
        var startY = 0f
        var secondX = 0f
        var secondY = 0f
        val hold = Runnable { showControls() }
        view.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN && event.pointerCount == 2) {
                startX = event.getX(0); startY = event.getY(0)
                secondX = event.getX(1); secondY = event.getY(1)
                handler.removeCallbacks(hold)
                handler.postDelayed(hold, 650)
            } else if (event.pointerCount != 2 || event.actionMasked != MotionEvent.ACTION_MOVE
                || kotlin.math.abs(event.getX(0) - startX) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getY(0) - startY) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getX(1) - secondX) > 18 * activity.resources.displayMetrics.density
                || kotlin.math.abs(event.getY(1) - secondY) > 18 * activity.resources.displayMetrics.density) {
                handler.removeCallbacks(hold)
            }
            false
        }
    }

    override fun onPause() { handler.removeCallbacksAndMessages(null) }

    override fun onDestroy(activity: AppCompatActivity) {
        handler.removeCallbacksAndMessages(null)
        controls?.dismiss()
        browserWindows?.destroy(); browserWindows = null
        connectionHistory?.destroy(); connectionHistory = null
        downloads?.destroy(); downloads = null
        stopLocal()
        (activity as? MainActivity)?.let { it.notificationBridge?.destroy(); it.notificationBridge = null; it.notificationNavigation = null }
        webView = null
    }
}
