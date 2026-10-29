package ca.cosomlundi.app;

import android.os.CancellationSignal;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.NoCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/** Uses Android's account chooser, never Google login inside an embedded browser. */
final class GoogleLogin {
    private final MainActivity activity;
    private CancellationSignal cancellation;
    private String pendingId;

    GoogleLogin(MainActivity activity) { this.activity = activity; }

    void signIn(String id) {
        if (pendingId != null) { activity.reply(id, null, "Une connexion Google est déjà en cours."); return; }
        pendingId = id;
        cancellation = new CancellationSignal();
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(activity).getCredentialAsync(activity, request, cancellation,
            activity::runOnUiThread, new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override public void onResult(GetCredentialResponse response) {
                    try {
                        GoogleIdTokenCredential credential = GoogleIdTokenCredential.createFrom(response.getCredential().getData());
                        activity.reply(id, credential.getIdToken(), null);
                    } catch (Exception e) { activity.reply(id, null, "Réponse Google invalide. Réessaie la connexion."); }
                    pendingId = null;
                    cancellation = null;
                }
                @Override public void onError(GetCredentialException error) {
                    String message = error instanceof GetCredentialCancellationException
                        ? "Connexion Google annulée."
                        : error instanceof NoCredentialException
                        ? "Ajoute ton compte Google dans les paramètres Android, puis réessaie. La connexion par courriel reste disponible."
                        : "Connexion Google indisponible. Vérifie les services Google Play et l'inscription Android (nom du package et empreinte SHA) dans Firebase. Tu peux aussi utiliser ton courriel et ton mot de passe.";
                    activity.reply(id, null, message);
                    pendingId = null;
                    cancellation = null;
                }
            });
    }
    void destroy() { if (cancellation != null) cancellation.cancel(); }
}
