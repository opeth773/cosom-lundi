package ca.cosomlundi.app;

import android.Manifest;
import android.content.Intent;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ResolveInfo;
import android.speech.RecognitionService;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.annotation.RequiresApi;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Google fr-CA consumes our PCM pipe in ONE segmented session; never auto-restart. */
@RequiresApi(33)
final class GoogleStreamingVoiceEngine implements NativeSpeech.Engine {
    private static final int RATE=16000;
    private final MainActivity activity;
    private final JSONObject options;
    private final ExecutorService audio=Executors.newSingleThreadExecutor();
    private volatile boolean active;
    private volatile AudioRecord microphone;
    private SpeechRecognizer recognizer;
    private ParcelFileDescriptor reader;
    private ParcelFileDescriptor writer;
    private NativeSpeech.Listener listener;
    private boolean sessionStarted;
    GoogleStreamingVoiceEngine(MainActivity activity, JSONObject options) { this.activity=activity;this.options=options; }

    static ComponentName googleService(Context context) {
        java.util.List<ResolveInfo> services=context.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE),PackageManager.MATCH_ALL);
        for(String preferred:new String[]{"com.google.android.googlequicksearchbox","com.google.android.tts","com.google.android.as"}) {
            for(ResolveInfo info:services)if(info.serviceInfo!=null && info.serviceInfo.exported && preferred.equals(info.serviceInfo.packageName))return new ComponentName(preferred,info.serviceInfo.name);
        }
        return null;
    }
    static Intent request(ParcelFileDescriptor source, JSONArray names) {
        Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"fr-CA");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,false);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,5);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE,source);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT,1);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING,AudioFormat.ENCODING_PCM_16BIT);
        intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE,RATE);
        intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION,RecognizerIntent.EXTRA_AUDIO_SOURCE);
        ArrayList<String> bias=new ArrayList<>();
        bias.add("but pâles");bias.add("but foncés");bias.add("ajouter un but");bias.add("arrête le test");bias.add("sans aide");bias.add("assisté de");
        if(names!=null) for(int i=0;i<Math.min(names.length(),200);i++) {
            String name=names.optString(i).trim();
            if(!name.isEmpty() && name.length()<=100)bias.add(name);
        }
        intent.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS,bias);
        return intent;
    }
    @Override public void start(NativeSpeech.Listener callback) {
        if(active)return;
        active=true;listener=callback;
        try {
            ParcelFileDescriptor[] pipe=ParcelFileDescriptor.createPipe();reader=pipe[0];writer=pipe[1];
            Intent intent=request(reader,options.optJSONArray("vocabulary"));
            ComponentName service=googleService(activity);
            if(service==null){fail("Le service vocal Google est introuvable. Installe ou mets à jour Google, puis réessaie.");return;}
            recognizer=SpeechRecognizer.createSpeechRecognizer(activity,service);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { if(active)listener.ready(); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rms) {}
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {} // A phrase ending does not close our source.
                @Override public void onPartialResults(Bundle b) { transcript(b,false); }
                @Override public void onSegmentResults(Bundle b) { transcript(b,true); }
                @Override public void onResults(Bundle b) {
                    fail("Le service vocal a ignoré le flux continu. Choisis le moteur hors ligne ; aucune relance automatique n'est effectuée.");
                }
                @Override public void onEndOfSegmentedSession() { fail("Google a interrompu le flux continu. Arrête le test puis réessaie, ou choisis le moteur hors ligne."); }
                @Override public void onError(int code) { fail("Reconnaissance Google fr-CA interrompue ("+code+"). Vérifie Internet ou choisis le moteur hors ligne."); }
                @Override public void onEvent(int type,Bundle b) {}
            });
            recognizer.checkRecognitionSupport(intent,activity::runOnUiThread,new RecognitionSupportCallback() {
                @Override public void onSupportResult(RecognitionSupport support) {
                    startSession(intent);
                }
                @Override public void onError(int code) {
                    if(code==SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT) { startSession(intent); return; }
                    fail("Le service Google de ce téléphone ne confirme pas la prise en charge du flux continu ("+code+"). Mets à jour Google et les services vocaux, ou utilise le moteur hors ligne.");
                }
            });
        } catch(Exception e) { fail("Impossible de préparer le flux audio Google."); }
    }
    private void startSession(Intent intent) {
        if(!active || sessionStarted)return;
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){fail("Permission microphone requise.");return;}
        sessionStarted=true;
        try {
            recognizer.startListening(intent);
            audio.execute(this::pump);
        } catch(RuntimeException e) { fail("Google ne peut pas démarrer ce flux audio continu."); }
    }
    private void pump() {
        AudioRecord capture=null;
        try(OutputStream output=new ParcelFileDescriptor.AutoCloseOutputStream(writer)) {
            if(!active)return;
            if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException();
            int minimum=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);
            if(minimum<=0)throw new java.io.IOException();
            capture=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(8192,minimum*2));
            microphone=capture;
            if(!active)return;
            capture.startRecording();
            byte[] buffer=new byte[4096];
            while(active) {
                int count=capture.read(buffer,0,buffer.length);
                if(!active)break;
                if(count<=0)throw new java.io.IOException();
                output.write(buffer,0,count);
            }
        } catch(Exception e) { activity.runOnUiThread(()->fail("Le flux audio Google a été interrompu. Arrête le test puis réessaie.")); }
        finally {
            microphone=null;
            if(capture!=null) {
                try { if(capture.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING)capture.stop(); }catch(RuntimeException ignored){}
                capture.release();
            }
        }
    }
    private void transcript(Bundle bundle,boolean complete) {
        if(!active)return;
        ArrayList<String> texts=bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if(texts==null || texts.isEmpty())return;
        try {
            JSONObject value=new JSONObject();
            if(complete) {
                JSONArray alternatives=new JSONArray();
                for(String text:texts)alternatives.put(new JSONObject().put("text",text));
                value.put("alternatives",alternatives);
            } else value.put("partial",texts.get(0));
            listener.transcript(value.toString(),complete);
        }catch(Exception e){fail("Transcription Google invalide.");}
    }
    private void fail(String message) { if(active)listener.error(message); }
    @Override public void close() {
        if(!active)return;
        active=false;
        AudioRecord capture=microphone;
        if(capture!=null)try{capture.stop();}catch(RuntimeException ignored){}
        try{if(writer!=null)writer.close();}catch(Exception ignored){}
        try{if(reader!=null)reader.close();}catch(Exception ignored){}
        if(recognizer!=null){recognizer.cancel();recognizer.destroy();recognizer=null;}
        audio.shutdown();
    }
}
