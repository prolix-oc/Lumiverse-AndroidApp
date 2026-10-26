package chat.lumiverse.prototype

import android.content.Intent
import android.webkit.URLUtil
import android.webkit.WebChromeClient.FileChooserParams

/** CHARX is a ZIP container with an extension Android's MIME map does not know. */
internal object NativeFileTypes {
    fun importParams(params: FileChooserParams): FileChooserParams {
        val acceptsCharx = params.acceptTypes.any { value ->
            value.split(',').any { it.trim().equals(".charx", ignoreCase = true) }
        }
        if (!acceptsCharx) return params

        // Providers classify .charx differently (ZIP, binary, or no MIME type).
        // A MIME allowlist cannot express this extension. Let the importer's
        // existing content validation decide whether the selected card is valid.
        // Wrap both paths: Wry rebuilds EXTRA_MIME_TYPES from getAcceptTypes().
        return object : FileChooserParams() {
            override fun getAcceptTypes() = arrayOf("*/*")
            override fun getMode() = params.mode
            override fun getTitle() = params.title
            override fun getFilenameHint() = params.filenameHint
            override fun isCaptureEnabled() = params.isCaptureEnabled
            override fun createIntent() = params.createIntent().apply {
                type = "*/*"
                removeExtra(Intent.EXTRA_MIME_TYPES)
            }
        }
    }

    fun downloadFilename(url: String, disposition: String?, mimeType: String?): String {
        // URLUtil may replace or append an extension based on application/zip.
        // Resolve once without a MIME hint to retain explicit CHARX filenames.
        val explicit = URLUtil.guessFileName(url, disposition, null)
        return if (explicit.endsWith(".charx", ignoreCase = true)) explicit
            else URLUtil.guessFileName(url, disposition, mimeType)
    }
}
