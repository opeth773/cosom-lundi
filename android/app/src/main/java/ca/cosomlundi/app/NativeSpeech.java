package ca.cosomlundi.app;

import android.Manifest;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** One continuous recorder. No Android dictation sessions and no restart timer. */
final class NativeSpeech {
    static final int MICROPHONE_REQUEST = 40;
    interface Listener {
        void ready();
        void transcript(String json, boolean isFinal);
        void error(String message);
    }
    interface Engine {
        void start(Listener listener);
        void close();
    }
    interface Prepared {
        void ready(Engine engine);
        void error(String message);
    }
    interface Factory {
        void prepare(JSONObject options, Prepared callback);
        void close();
    }
    private final MainActivity activity;
    private final Factory factory;
    private Engine engine;
    private String id;
    private int generation;
    private boolean awaitingPermission;
    private boolean resumeAfterPermission;
    private String lastPartial = "";
    private JSONObject options;

    NativeSpeech(MainActivity activity) { this(activity, new AdaptiveVoiceFactory(activity)); }
    NativeSpeech(MainActivity activity, Factory factory) { this.activity = activity; this.factory = factory; }

    void start(JSONObject options) {
        abort();
        id = options.optString("id");
        lastPartial = "";
        this.options = options;
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            awaitingPermission = true;
            activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_REQUEST);
        } else prepare();
    }
    void permissionResult(boolean granted) {
        awaitingPermission = false;
        if (id == null) return;
        if (!granted) { fail("not-allowed", "Permission microphone refusée."); return; }
        if (activity.isForeground()) prepare(); else resumeAfterPermission = true;
    }
    boolean awaitingPermission() { return awaitingPermission; }
    void onResume() {
        if (resumeAfterPermission && id != null) { resumeAfterPermission = false; prepare(); }
    }
    private void prepare() {
        if (id == null || !activity.isForeground()) { abort(); return; }
        final int token = ++generation;
        emit("loading");
        factory.prepare(options, new Prepared() {
            private boolean current() { return id != null && token == generation; }
            @Override public void ready(Engine prepared) {
                if (!current() || !activity.isForeground()) { prepared.close(); return; }
                engine = prepared;
                engine.start(new Listener() {
                    @Override public void ready() {
                        if (current()) { emit("start"); emit("audiostart"); }
                    }
                    @Override public void transcript(String json, boolean isFinal) {
                        if (current()) result(json, isFinal);
                    }
                    @Override public void error(String message) { if (current()) fail("audio-capture", message); }
                });
            }
            @Override public void error(String message) { if (current()) fail("service-not-allowed", message); }
        });
    }
    private void result(String json, boolean isFinal) {
        try {
            JSONObject data = new JSONObject(json);
            JSONArray alternatives = new JSONArray();
            if (!isFinal) {
                String partial = data.optString("partial").trim();
                if (partial.isEmpty() || partial.equals(lastPartial)) return;
                lastPartial = partial;
                alternatives.put(partial);
            } else {
                JSONArray candidates = data.optJSONArray("alternatives");
                if (candidates != null) {
                    for (int i = 0; i < candidates.length(); i++) {
                        String text = candidates.getJSONObject(i).optString("text").trim();
                        if (!text.isEmpty()) alternatives.put(text);
                    }
                } else {
                    String text = data.optString("text").trim();
                    if (!text.isEmpty()) alternatives.put(text);
                }
                if (alternatives.length() == 0) return;
                lastPartial = "";
            }
            JSONObject event = event("result");
            event.put("alternatives", alternatives);
            event.put("final", isFinal);
            activity.send(event);
            // An endpoint finalizes a phrase, not the microphone or its recorder.
        } catch (Exception e) { fail("service-not-allowed", "Transcription vocale invalide."); }
    }
    void stop(String requestedId) { abort(requestedId); }
    void abort(String requestedId) { if (id != null && id.equals(requestedId)) abort(); }
    void abort() {
        String endedId = id;
        id = null;
        ++generation;
        awaitingPermission = false;
        resumeAfterPermission = false;
        Engine old = engine;
        engine = null;
        if (old != null) old.close();
        if (endedId != null) {
            JSONObject ended = new JSONObject();
            try { ended.put("channel", "speech"); ended.put("id", endedId); ended.put("type", "end"); } catch (Exception ignored) {}
            activity.send(ended);
        }
    }
    void destroy() { abort(); factory.close(); }
    private void fail(String code, String message) {
        JSONObject event = event("error");
        try { event.put("error", code); event.put("message", message); } catch (Exception ignored) {}
        activity.send(event);
        abort();
    }
    private JSONObject event(String type) {
        JSONObject event = new JSONObject();
        try { event.put("channel", "speech"); event.put("id", id); event.put("type", type); } catch (Exception ignored) {}
        return event;
    }
    private void emit(String type) { activity.send(event(type)); }
}
