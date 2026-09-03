package br.com.smartsatrastreadores.smartsat;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.util.Map;

public final class NotificationHelper {
    public static final String CHANNEL_ID = "smartsat_alerts";

    private NotificationHelper() {}

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.smartsat_notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.smartsat_notification_channel_description));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    public static void show(Context context, String title, String body, Map<String, String> data) {
        createChannel(context);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("smartsat_push", true);
        putIfPresent(intent, "tab", data.get("tab"));
        putIfPresent(intent, "deviceId", data.get("deviceId"));
        putIfPresent(intent, "eventType", data.get("eventType"));
        putIfPresent(intent, "eventTime", data.get("eventTime"));

        int requestCode = (String.valueOf(data.get("deviceId")) + String.valueOf(data.get("eventTime"))).hashCode();
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_smartsat)
            .setContentTitle(title == null || title.isBlank() ? "SMARTSAT RASTREADORES" : title)
            .setContentText(body == null ? "Novo alerta de rastreamento." : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "Novo alerta de rastreamento." : body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE);

        int notificationId = Math.abs(requestCode == Integer.MIN_VALUE ? 1 : requestCode);
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    private static void putIfPresent(Intent intent, String key, String value) {
        if (value != null && !value.isBlank()) intent.putExtra(key, value);
    }
}
