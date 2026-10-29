package ca.cosomlundi.app;

import android.os.Build;
import org.json.JSONObject;

/** A selected online engine never silently falls back to a different language/model. */
final class AdaptiveVoiceFactory implements NativeSpeech.Factory {
    private final MainActivity activity;
    private final OfflineVoiceEngine offline;
    AdaptiveVoiceFactory(MainActivity activity) { this.activity=activity; offline=new OfflineVoiceEngine(activity); }
    @Override public void prepare(JSONObject options, NativeSpeech.Prepared callback) {
        if ("google-fr-ca".equals(options.optString("engine"))) {
            if (Build.VERSION.SDK_INT < 33) { callback.error("Le mode Google en flux continu nécessite Android 13 ou plus récent."); return; }
            callback.ready(new GoogleStreamingVoiceEngine(activity, options));
        } else offline.prepare(options, callback);
    }
    @Override public void close() { offline.close(); }
}
