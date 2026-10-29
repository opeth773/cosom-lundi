package ca.cosomlundi.app;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends ComponentActivity {
    static final String ORIGIN = "https://cosomlundi.web.app";
    private static final int EXPORT_REQUEST = 50;
    private WebView web;
    private NativeSpeech speech;
    private GoogleLogin google;
    private boolean foreground;
    private JSONObject pendingExport;
    private final ExecutorService files = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { handleBack(); }
        });
        speech = new NativeSpeech(this);
        google = new GoogleLogin(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(17, 43, 37));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        } else {
            root.setFitsSystemWindows(true);
        }
        web.setBackgroundColor(Color.rgb(243, 245, 248));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        // Match the browser's confirmation behavior for deletes, match endings,
        // and other existing PWA actions. A bare WebView dismisses these dialogs.
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Cosom").setMessage(message)
                    .setPositiveButton("OK", (d,w) -> result.confirm()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Cosom").setMessage(message)
                    .setPositiveButton("Confirmer", (d,w) -> result.confirm())
                    .setNegativeButton("Annuler", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsPrompt(WebView view, String url, String message, String initial, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setText(initial);
                new AlertDialog.Builder(MainActivity.this).setTitle("Cosom").setMessage(message).setView(input)
                    .setPositiveButton("Confirmer", (d,w) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("Annuler", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
        });

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().setDomain("cosomlundi.web.app")
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "cosomlundi.web.app".equals(uri.getHost())) {
                    if ("/".equals(uri.getPath())) return asset("index.html", "text/html");
                    if ("/__/firebase/init.json".equals(uri.getPath())) return asset("firebase-init.json", "application/json");
                    return loader.shouldInterceptRequest(uri);
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (ORIGIN.equals(uri.getScheme() + "://" + uri.getHost()) && ("/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()))) return false;
                if (request.hasGesture() && "https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (RuntimeException ignored) {}
                }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "CosomNative", Collections.singleton(ORIGIN),
                (view, message, source, mainFrame, reply) -> {
                    if (!mainFrame || !ORIGIN.equals(source.toString())) return;
                    String data = message.getData();
                    if (data == null || data.length() > 10 * 1024 * 1024) return;
                    try { handle(new JSONObject(data)); } catch (Exception ignored) {}
                });
        } else {
            new AlertDialog.Builder(this).setTitle("Mise à jour Android requise")
                .setMessage("Mets à jour Android System WebView dans le Play Store, puis relance Cosom.")
                .setPositiveButton("Fermer", (d, w) -> finish()).setCancelable(false).show();
            return;
        }
        web.loadUrl(ORIGIN + "/");
    }

    private WebResourceResponse asset(String path, String mime) {
        try {
            return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(path));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private void handle(JSONObject message) {
        String id = message.optString("id");
        switch (message.optString("action")) {
            case "speechStart":
                if (foreground) speech.start(message);
                break;
            case "speechStop": speech.stop(id); break;
            case "speechAbort": speech.abort(id); break;
            case "googleSignIn":
                if (foreground) google.signIn(id); else reply(id, null, "Reviens dans l'application pour te connecter.");
                break;
            case "keepScreenOn":
                if (foreground && message.optBoolean("enabled")) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                break;
            case "copyText":
                ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Cosom", message.optString("text")));
                reply(id, true, null);
                break;
            case "saveFile": exportFile(message); break;
        }
    }

    private void exportFile(JSONObject message) {
        String id = message.optString("id");
        if (pendingExport != null) { reply(id, null, "Un export est déjà en cours."); return; }
        pendingExport = message;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json").putExtra(Intent.EXTRA_TITLE, message.optString("name", "cosom.json").replaceAll("[^a-zA-Z0-9._-]", "_"));
        try { startActivityForResult(intent, EXPORT_REQUEST); }
        catch (RuntimeException e) { pendingExport = null; reply(id, null, "Aucun gestionnaire de fichiers disponible."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != EXPORT_REQUEST || pendingExport == null) return;
        JSONObject export = pendingExport;
        pendingExport = null;
        String id = export.optString("id");
        if (result != RESULT_OK || data == null || data.getData() == null) { reply(id, null, "Export annulé."); return; }
        Uri target = data.getData();
        files.execute(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                if (output == null) throw new java.io.IOException();
                output.write(export.optString("text").getBytes(StandardCharsets.UTF_8));
                runOnUiThread(() -> reply(id, true, null));
            } catch (Exception e) { runOnUiThread(() -> reply(id, null, "Impossible d'enregistrer le fichier.")); }
        });
    }

    void send(JSONObject event) {
        if (web != null && !isDestroyed()) web.evaluateJavascript("window.CosomAndroid && window.CosomAndroid._event(" + event + ")", null);
    }
    void reply(String id, Object value, String error) {
        JSONObject event = new JSONObject();
        try { event.put("id", id); if (error != null) event.put("error", error); else event.put("value", value); } catch (Exception ignored) {}
        send(event);
    }
    boolean isForeground() { return foreground; }
    @Override protected void onResume() { super.onResume(); foreground = true; if (web != null) web.onResume(); if (speech != null) speech.onResume(); }
    @Override protected void onPause() {
        foreground = false;
        // The permission dialog is part of the user's current microphone request.
        // Do not cancel that request merely because Android displays the dialog.
        if (speech.awaitingPermission()) { super.onPause(); return; }
        suspendVoice();
        if (web != null) web.onPause();
        super.onPause();
    }
    private void suspendVoice() {
        JSONObject event = new JSONObject();
        try { event.put("channel", "lifecycle"); } catch (Exception ignored) {}
        send(event);
        speech.abort();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override protected void onStop() { suspendVoice(); super.onStop(); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == NativeSpeech.MICROPHONE_REQUEST) speech.permissionResult(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED);
    }
    private void handleBack() {
        web.evaluateJavascript("(() => {const modal=document.querySelector('dialog[open]'); if(modal){modal.close(); return true;} return false;})()", value -> {
            if (!"true".equals(value)) new AlertDialog.Builder(this).setMessage("Quitter Cosom ?")
                .setPositiveButton("Quitter", (d,w) -> finish()).setNegativeButton("Rester", null).show();
        });
    }
    @Override protected void onDestroy() {
        speech.destroy();
        google.destroy();
        files.shutdown();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
