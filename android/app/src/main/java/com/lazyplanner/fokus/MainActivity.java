package com.lazyplanner.fokus;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        // Dark page -> black bar with light icons; light page -> light bar with dark icons.
        int barColor = night ? Color.parseColor("#0F0F0E") : Color.parseColor("#F7F7F5");
        getWindow().setStatusBarColor(barColor);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .setAppearanceLightStatusBars(!night);
    }
}
