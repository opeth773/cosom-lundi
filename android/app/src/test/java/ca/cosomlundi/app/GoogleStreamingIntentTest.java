package ca.cosomlundi.app;

import android.content.Intent;
import android.media.AudioFormat;
import android.os.ParcelFileDescriptor;
import android.speech.RecognizerIntent;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.io.File;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class GoogleStreamingIntentTest {
    @Test public void frCaUsesOurPcmPipeAndDoesNotRequestShortMicSessions() throws Exception {
        File audio=File.createTempFile("cosom-speech-", ".pcm");
        try(ParcelFileDescriptor source=ParcelFileDescriptor.open(audio,ParcelFileDescriptor.MODE_READ_ONLY)) {
            Intent intent=GoogleStreamingVoiceEngine.request(source,new JSONArray().put("Éric Gagnon").put("Jean-François Tremblay"));
            assertEquals("fr-CA",intent.getStringExtra(RecognizerIntent.EXTRA_LANGUAGE));
            assertEquals(RecognizerIntent.EXTRA_AUDIO_SOURCE,intent.getStringExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION));
            assertSame(source,intent.getParcelableExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE,ParcelFileDescriptor.class));
            assertEquals(16000,intent.getIntExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE,0));
            assertEquals(1,intent.getIntExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT,0));
            assertEquals(AudioFormat.ENCODING_PCM_16BIT,intent.getIntExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING,0));
            assertFalse(intent.getBooleanExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true));
            assertTrue(intent.getStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS).contains("Éric Gagnon"));
            assertTrue(intent.getStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS).contains("Jean-François Tremblay"));
            assertFalse(intent.hasExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS));
        } finally { audio.delete(); }
    }
    @Test public void playerHintPayloadIsBounded() {
        JSONArray names=new JSONArray();
        for(int i=0;i<1000;i++)names.put("Joueur "+i);
        Intent request=GoogleStreamingVoiceEngine.request(null,names);
        assertEquals(206,request.getStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS).size());
    }
}
