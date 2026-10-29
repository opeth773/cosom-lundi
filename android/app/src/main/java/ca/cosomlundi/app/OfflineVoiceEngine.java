package ca.cosomlundi.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import org.vosk.Model;
import org.vosk.Recognizer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Local French ASR fed by a single AudioRecord stream until explicit close. */
final class OfflineVoiceEngine implements NativeSpeech.Factory {
    private static final int RATE = 16000;
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    // Serializing model loading, recording and cleanup prevents overlapping mics
    // and prevents freeing a model while the recording thread is decoding it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Model model;
    private volatile boolean closed;

    OfflineVoiceEngine(Context context) { this.context = context.getApplicationContext(); }

    @Override public void prepare(org.json.JSONObject options, NativeSpeech.Prepared callback) {
        if (closed) { callback.error("Moteur vocal fermé."); return; }
        worker.execute(() -> {
            try {
                if (model == null) {
                    File directory = new File(context.getFilesDir(), "voice-model-fr-0.22");
                    String expected;
                    try (InputStream stream = context.getAssets().open("voice-model-fr/uuid")) {
                        expected = readText(stream);
                    }
                    File marker = new File(directory, "uuid");
                    boolean installed = false;
                    if (marker.isFile()) try (InputStream in = new FileInputStream(marker)) { installed = readText(in).equals(expected); }
                    if (!installed) {
                        copyAssets("voice-model-fr", directory);
                        // Write the installation marker last, after every model file.
                        try (FileOutputStream out = new FileOutputStream(marker)) { out.write(expected.getBytes(StandardCharsets.UTF_8)); }
                    }
                    model = new Model(directory.getAbsolutePath());
                }
                if (closed) return;
                NativeSpeech.Engine engine = new Recorder();
                main.post(() -> { if (!closed) callback.ready(engine); else engine.close(); });
            } catch (Exception | LinkageError error) {
                main.post(() -> callback.error("Impossible de préparer le modèle vocal français. Réinstalle la dernière APK puis réessaie."));
            }
        });
    }
    private static String readText(InputStream in) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        for (int n; (n = in.read(buffer)) != -1;) bytes.write(buffer, 0, n);
        return bytes.toString("UTF-8");
    }
    private void copyAssets(String source, File target) throws Exception {
        if (!target.isDirectory() && !target.mkdirs()) throw new java.io.IOException("Model directory unavailable");
        for (String name : context.getAssets().list(source)) {
            if (name.equals("uuid")) continue;
            String path = source + "/" + name;
            File output = new File(target, name);
            if (context.getAssets().list(path).length > 0) copyAssets(path, output);
            else try (InputStream in = context.getAssets().open(path); FileOutputStream out = new FileOutputStream(output)) {
                byte[] buffer = new byte[32768];
                for (int read; (read = in.read(buffer)) != -1;) out.write(buffer, 0, read);
            }
        }
    }
    @Override public void close() {
        closed = true;
        worker.execute(() -> { if (model != null) { model.close(); model = null; } });
        worker.shutdown();
    }
    private final class Recorder implements NativeSpeech.Engine {
        private volatile boolean active;
        private volatile AudioRecord microphone;
        @Override public void start(NativeSpeech.Listener listener) {
            if (active || closed) return;
            active = true;
            worker.execute(() -> record(listener));
        }
        private void record(NativeSpeech.Listener listener) {
            AudioRecord capture = null;
            Recognizer recognizer = null;
            try {
                if (!active || closed) return;
                if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw new SecurityException();
                int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new java.io.IOException("Unsupported audio format");
                capture = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum * 2, 8192));
                microphone = capture;
                if (capture.getState() != AudioRecord.STATE_INITIALIZED) throw new java.io.IOException("Microphone unavailable");
                recognizer = new Recognizer(model, RATE);
                recognizer.setMaxAlternatives(3);
                if (!active || closed) return;
                capture.startRecording();
                if (capture.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new java.io.IOException("Microphone not recording");
                main.post(() -> { if (active && !closed) listener.ready(); });
                short[] buffer = new short[2048];
                while (active && !closed) {
                    int count = capture.read(buffer, 0, buffer.length);
                    if (!active || closed) break;
                    if (count <= 0) throw new java.io.IOException("Audio capture interrupted");
                    boolean complete = recognizer.acceptWaveForm(buffer, count);
                    String text = complete ? recognizer.getResult() : recognizer.getPartialResult();
                    main.post(() -> { if (active && !closed) listener.transcript(text, complete); });
                }
            } catch (Exception | LinkageError error) {
                if (active && !closed) main.post(() -> { if (active && !closed) listener.error("Microphone indisponible ou utilisé par une autre application. Arrête puis réactive le test."); });
            } finally {
                microphone = null;
                if (capture != null) {
                    try { if (capture.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) capture.stop(); } catch (RuntimeException ignored) {}
                    capture.release();
                }
                if (recognizer != null) recognizer.close();
            }
        }
        @Override public void close() {
            active = false;
            AudioRecord capture = microphone;
            if (capture != null) try { capture.stop(); } catch (RuntimeException ignored) {}
        }
    }
}
