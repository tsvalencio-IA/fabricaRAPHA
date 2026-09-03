package br.com.smartsatrastreadores.smartsat;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.HashMap;
import java.util.Map;

public class SmartSatMessagingService extends FirebaseMessagingService {
    private static final String TAG = "SmartSatFCM";
    public static final String PREFS = "smartsat_native_push";
    public static final String TOKEN_KEY = "fcm_token";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(TOKEN_KEY, token).apply();
        Log.i(TAG, "Token FCM Android atualizado.");
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        String title = "SMARTSAT RASTREADORES";
        String body = "Novo alerta de rastreamento.";
        if (remoteMessage.getNotification() != null) {
            if (remoteMessage.getNotification().getTitle() != null) title = remoteMessage.getNotification().getTitle();
            if (remoteMessage.getNotification().getBody() != null) body = remoteMessage.getNotification().getBody();
        }
        Map<String, String> data = new HashMap<>(remoteMessage.getData());
        NotificationHelper.show(this, title, body, data);
    }
}
