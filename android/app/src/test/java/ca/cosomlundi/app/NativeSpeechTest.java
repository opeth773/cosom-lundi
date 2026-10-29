package ca.cosomlundi.app;

import android.Manifest;
import android.os.Looper;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import java.time.Duration;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NativeSpeechTest {
    private NativeSpeech speech;
    private FakeFactory factory;
    private MainActivity activity;
    @Before public void setup() {
        activity = Robolectric.buildActivity(MainActivity.class).get();
        ReflectionHelpers.setField(activity, "foreground", true);
        shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO);
        factory = new FakeFactory();
        speech = new NativeSpeech(activity, factory);
    }
    @After public void cleanup() { speech.destroy(); }
    private void start() throws Exception { speech.start(new JSONObject().put("id", "test")); }
    private String id() { return ReflectionHelpers.getField(speech, "id"); }
    @Test public void hundredsOfFinalPhrasesKeepTheSameRecorderOpen() throws Exception {
        start();
        for (int i=0;i<200;i++) {
            factory.engine.listener.transcript("{\"partial\":\"ajouter un\"}",false);
            factory.engine.listener.transcript("{\"alternatives\":[{\"text\":\"ajouter un but\"}]}",true);
        }
        assertEquals("test",id());
        assertEquals(1,factory.prepares);
        assertEquals(1,factory.engine.starts);
        assertEquals(0,factory.engine.closes);
    }
    @Test public void longSilenceHasNoTimerWhichStopsOrRestartsCapture() throws Exception {
        start();
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofHours(8));
        factory.engine.listener.transcript("{\"partial\":\"\"}",false);
        factory.engine.listener.transcript("{\"text\":\"\"}",true);
        assertEquals("test",id());
        assertEquals(1,factory.engine.starts);
        assertEquals(0,factory.engine.closes);
    }
    @Test public void explicitStopClosesOnceAndLateResultsCannotRestart() throws Exception {
        start();
        speech.stop("test");
        factory.engine.listener.transcript("{\"text\":\"ajouter un but\"}",true);
        factory.engine.listener.ready();
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5));
        assertNull(id());
        assertEquals(1,factory.engine.starts);
        assertEquals(1,factory.engine.closes);
    }
    @Test public void cancelledModelLoadingNeverStartsTheMicrophone() throws Exception {
        factory.deferred=true;
        start();
        speech.abort();
        factory.pending.ready(factory.engine);
        assertEquals(0,factory.engine.starts);
        assertEquals(1,factory.engine.closes);
    }
    @Test public void realCaptureErrorIsReportedWithoutAnOnOffRetryLoop() throws Exception {
        start();
        factory.engine.listener.error("Microphone unavailable");
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMinutes(5));
        assertNull(id());
        assertEquals(1,factory.engine.starts);
        assertEquals(1,factory.engine.closes);
    }
    private static final class FakeFactory implements NativeSpeech.Factory {
        final FakeEngine engine=new FakeEngine();
        NativeSpeech.Prepared pending;
        int prepares;
        boolean deferred;
        public void prepare(JSONObject options, NativeSpeech.Prepared callback) {
            prepares++; pending=callback;
            if(!deferred)callback.ready(engine);
        }
        public void close() {}
    }
    private static final class FakeEngine implements NativeSpeech.Engine {
        int starts,closes;
        NativeSpeech.Listener listener;
        public void start(NativeSpeech.Listener value) { starts++;listener=value;listener.ready(); }
        public void close() { closes++; }
    }
}
