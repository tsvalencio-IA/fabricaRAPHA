package br.com.smartsatrastreadores.smartsat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private ActivityResultLauncher<String> notificationPermissionLauncher;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        NotificationHelper.createChannel(this);

        notificationPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            granted -> {
                dispatchPermission(granted);
                if (granted) deliverCurrentFcmToken();
            }
        );

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new SmartSatNativeBridge(), "SmartSatNative");
        }
        capturePushIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        capturePushIntent(intent);
        dispatchPendingPush();
    }

    private void ensureNotificationPermissionAndToken() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            dispatchPermission(false);
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
            return;
        }
        dispatchPermission(true);
        deliverCurrentFcmToken();
    }

    private void deliverCurrentFcmToken() {
        SharedPreferences prefs = getSharedPreferences(SmartSatMessagingService.PREFS, Context.MODE_PRIVATE);
        String cached = prefs.getString(SmartSatMessagingService.TOKEN_KEY, "");
        if (cached != null && !cached.isBlank()) dispatchToken(cached);

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null || task.getResult().isBlank()) return;
            String token = task.getResult();
            prefs.edit().putString(SmartSatMessagingService.TOKEN_KEY, token).apply();
            dispatchToken(token);
        });
    }

    private void dispatchPermission(boolean granted) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("granted", granted);
            dispatchEvent("smartsat:native-push-permission", detail);
        } catch (Exception ignored) {}
    }

    private void dispatchToken(String token) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("token", token);
            dispatchEvent("smartsat:native-push-token", detail);
        } catch (Exception ignored) {}
    }

    private void dispatchEvent(String name, JSONObject detail) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String js = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(name) + ",{detail:" + detail.toString() + "}));";
        runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private void capturePushIntent(Intent intent) {
        if (intent == null) return;
        boolean isPush = intent.getBooleanExtra("smartsat_push", false) || intent.hasExtra("eventType") || intent.hasExtra("deviceId") || intent.hasExtra("tab");
        if (!isPush) return;
        try {
            JSONObject detail = new JSONObject();
            detail.put("tab", safeExtra(intent, "tab", "eventos"));
            detail.put("deviceId", safeExtra(intent, "deviceId", ""));
            detail.put("eventType", safeExtra(intent, "eventType", ""));
            detail.put("eventTime", safeExtra(intent, "eventTime", ""));
            getSharedPreferences(SmartSatMessagingService.PREFS, Context.MODE_PRIVATE)
                .edit().putString("pending_push", detail.toString()).apply();
        } catch (Exception ignored) {}
    }

    private String safeExtra(Intent intent, String key, String fallback) {
        String value = intent.getStringExtra(key);
        return value == null ? fallback : value;
    }

    private String consumePendingPush() {
        SharedPreferences prefs = getSharedPreferences(SmartSatMessagingService.PREFS, Context.MODE_PRIVATE);
        String payload = prefs.getString("pending_push", "");
        if (payload != null && !payload.isBlank()) prefs.edit().remove("pending_push").apply();
        return payload == null ? "" : payload;
    }

    private void dispatchPendingPush() {
        String raw = consumePendingPush();
        if (raw.isBlank()) return;
        try { dispatchEvent("smartsat:native-push-open", new JSONObject(raw)); }
        catch (Exception ignored) {}
    }

    public final class SmartSatNativeBridge {
        @JavascriptInterface
        public void requestPushRegistration() {
            runOnUiThread(() -> ensureNotificationPermissionAndToken());
        }

        @JavascriptInterface
        public String consumePendingPush() {
            return MainActivity.this.consumePendingPush();
        }

        @JavascriptInterface
        public boolean isNativeAndroid() {
            return true;
        }
    }
}
