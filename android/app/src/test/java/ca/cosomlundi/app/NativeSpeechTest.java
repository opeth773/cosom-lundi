package ca.cosomlundi.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers;
import java.time.Duration;
import java.util.ArrayList;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, shadows = NativeSpeechTest.Recognizer.class)
public class NativeSpeechTest {
    private NativeSpeech speech;
    @Before public void setup() throws Exception {
        Recognizer.instances.clear();
        MainActivity activity = Robolectric.buildActivity(MainActivity.class).get();
        ReflectionHelpers.setField(activity, "foreground", true);
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO);
        speech = new NativeSpeech(activity);
        speech.start(new JSONObject().put("id", "test").put("continuous", true));
    }
    @After public void cleanup() { speech.abort(); }
    private String id() { return ReflectionHelpers.getField(speech, "id"); }
    private void advance(long millis) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(millis)); }
    @Test public void finalPhraseSurvivesSynchronousCancellationOfOldEngine() {
        Recognizer old = Recognizer.instances.get(0);
        old.listener.onReadyForSpeech(new Bundle());
        old.listener.onResults(new Bundle());
        advance(400);
        assertEquals(2, Recognizer.instances.size());
        assertEquals("test", id());
        // Late callbacks from the replaced engine must not close the new one.
        old.listener.onError(SpeechRecognizer.ERROR_CLIENT);
        old.listener.onResults(new Bundle());
        advance(500);
        assertEquals(2, Recognizer.instances.size());
        assertEquals("test", id());
    }
    @Test public void silenceKeepsListeningAcrossSeveralNativeSessions() {
        for (int i=0;i<5;i++) {
            Recognizer.instances.get(i).listener.onError(SpeechRecognizer.ERROR_SPEECH_TIMEOUT);
            advance(3000);
            assertEquals("test", id());
        }
        assertEquals(6, Recognizer.instances.size());
    }
    @Test public void stoppingCancelsPendingRestartAndCannotResurrectMicrophone() {
        Recognizer.instances.get(0).listener.onResults(new Bundle());
        speech.abort();
        advance(10000);
        assertNull(id());
        assertEquals(1, Recognizer.instances.size());
    }
    @Test public void transientClientErrorRecoversInsteadOfBecomingPermissionError() {
        Recognizer.instances.get(0).listener.onError(SpeechRecognizer.ERROR_CLIENT);
        advance(1100);
        assertEquals(2, Recognizer.instances.size());
        assertEquals("test", id());
    }

    @Implements(SpeechRecognizer.class)
    public static class Recognizer {
        static final ArrayList<Recognizer> instances = new ArrayList<>();
        RecognitionListener listener;
        @Implementation protected static boolean isRecognitionAvailable(Context context) { return true; }
        @Implementation protected static SpeechRecognizer createSpeechRecognizer(Context context) {
            SpeechRecognizer recognizer = Shadow.newInstanceOf(SpeechRecognizer.class);
            instances.add(Shadow.extract(recognizer));
            return recognizer;
        }
        @Implementation protected void setRecognitionListener(RecognitionListener value) { listener = value; }
        @Implementation protected void startListening(Intent intent) {}
        @Implementation protected void cancel() {
            // Reproduce providers which report client cancellation synchronously.
            if (listener != null) listener.onError(SpeechRecognizer.ERROR_CLIENT);
        }
        @Implementation protected void destroy() {}
    }
}
