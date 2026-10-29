package ca.cosomlundi.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;

/** Foreground microphone only; one recognizer owns the microphone at a time. */
final class NativeSpeech {
    static final int MICROPHONE_REQUEST = 40;
    private final MainActivity activity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer engine;
    private JSONObject config;
    private String id;
    private int generation;
    private int silenceCount;
    private boolean continuous;
    private boolean stopping;
    private boolean started;
    private int recoveryCount;
    private boolean awaitingPermission;
    private boolean resumeAfterPermission;

    NativeSpeech(MainActivity activity) { this.activity = activity; }

    void start(JSONObject options) {
        abort();
        id = options.optString("id");
        config = options;
        continuous = options.optBoolean("continuous");
        stopping = false;
        started = false;
        recoveryCount = 0;
        silenceCount = 0;
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            fail("service-not-allowed", "Installe ou active le service vocal Google dans les paramètres Android.");
            return;
        }
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            awaitingPermission = true;
            activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_REQUEST);
        } else begin(true);
    }

    void permissionResult(boolean granted) {
        awaitingPermission = false;
        if (id == null) return;
        if (!granted) { fail("not-allowed", "Permission microphone refusée."); return; }
        if (activity.isForeground()) begin(true); else resumeAfterPermission = true;
    }

    boolean awaitingPermission() { return awaitingPermission; }
    void onResume() {
        if (resumeAfterPermission && id != null) { resumeAfterPermission = false; begin(true); }
    }

    private void begin(boolean first) {
        if (id == null || !activity.isForeground()) { abort(); return; }
        final int token = ++generation;
        destroyEngine();
        try {
            engine = SpeechRecognizer.createSpeechRecognizer(activity);
            engine.setRecognitionListener(new RecognitionListener() {
                private boolean current() { return id != null && token == generation; }
                @Override public void onReadyForSpeech(Bundle params) {
                    if (!current()) return;
                    if (!started) { started = true; emit("start"); }
                    emit("audiostart");
                }
                @Override public void onBeginningOfSpeech() { if (current()) emit("speechstart"); }
                @Override public void onRmsChanged(float rms) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() { if (current()) emit("speechend"); }
                @Override public void onPartialResults(Bundle results) { if (current()) result(results, false); }
                @Override public void onEvent(int eventType, Bundle params) {}
                @Override public void onResults(Bundle results) {
                    if (!current()) return;
                    result(results, true);
                    silenceCount = 0;
                    recoveryCount = 0;
                    next(token, 350);
                }
                @Override public void onError(int error) {
                    if (!current()) return;
                    if (!stopping && continuous && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                        next(token, Math.min(3000, 500 + ++silenceCount * 250));
                        return;
                    }
                    if (stopping) { end(); return; }
                    if (continuous && (error == SpeechRecognizer.ERROR_CLIENT
                            || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                            || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED
                            || error == SpeechRecognizer.ERROR_NETWORK
                            || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                            || error == SpeechRecognizer.ERROR_SERVER
                            || error == SpeechRecognizer.ERROR_TOO_MANY_REQUESTS) && ++recoveryCount <= 4) {
                        next(token, Math.min(8000, recoveryCount * 1000));
                        return;
                    }
                    String code = switch (error) {
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed";
                        case SpeechRecognizer.ERROR_AUDIO -> "audio-capture";
                        case SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network";
                        case SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech";
                        case SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "aborted";
                        default -> "service-not-allowed";
                    };
                    fail(code, "Erreur de reconnaissance Android : " + error);
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, config.optString("lang", "fr-CA"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, config.optBoolean("interimResults", true));
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, Math.max(1, Math.min(5, config.optInt("maxAlternatives", 3))));
            engine.startListening(intent);
        } catch (RuntimeException e) { fail("service-not-allowed", "Service vocal indisponible."); }
    }

    private void next(int token, int delay) {
        if (stopping || !continuous) { end(); return; }
        if (token != generation) return;
        final int retired = ++generation;
        handler.postDelayed(() -> { if (id != null && retired == generation) begin(false); }, delay);
    }

    private void result(Bundle results, boolean isFinal) {
        ArrayList<String> text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (text == null || text.isEmpty()) return;
        JSONObject event = event("result");
        try {
            event.put("alternatives", new JSONArray(text));
            event.put("final", isFinal);
            JSONArray confidence = new JSONArray();
            float[] scores = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
            if (scores != null) for (float score : scores) confidence.put((double) score);
            event.put("confidences", confidence);
        } catch (Exception ignored) { return; }
        activity.send(event);
    }

    void stop(String requestedId) {
        if (id == null || !id.equals(requestedId)) return;
        stopping = true;
        handler.removeCallbacksAndMessages(null);
        if (engine != null) engine.stopListening(); else end();
        int token = generation;
        handler.postDelayed(() -> { if (id != null && token == generation) end(); }, 1500);
    }

    void abort(String requestedId) { if (id != null && id.equals(requestedId)) abort(); }
    void abort() { if (id != null) end(); else destroyEngine(); }
    private void end() {
        String endedId = id;
        id = null;
        awaitingPermission = false;
        resumeAfterPermission = false;
        ++generation;
        handler.removeCallbacksAndMessages(null);
        destroyEngine();
        if (endedId != null) {
            JSONObject ended = new JSONObject();
            try { ended.put("channel", "speech"); ended.put("id", endedId); ended.put("type", "end"); } catch (Exception ignored) {}
            activity.send(ended);
        }
    }
    private void destroyEngine() {
        SpeechRecognizer previous = engine;
        engine = null;
        if (previous != null) { previous.cancel(); previous.destroy(); }
    }
    private void fail(String code, String message) {
        JSONObject event = event("error");
        try { event.put("error", code); event.put("message", message); } catch (Exception ignored) {}
        activity.send(event);
        end();
    }
    private JSONObject event(String type) {
        JSONObject object = new JSONObject();
        try { object.put("channel", "speech"); object.put("id", id); object.put("type", type); } catch (Exception ignored) {}
        return object;
    }
    private void emit(String type) { activity.send(event(type)); }
}
