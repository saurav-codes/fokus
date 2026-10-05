package com.lazyplanner.fokus;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Edge-to-edge: the page itself paints the bar; we only flip icon contrast.
        boolean night = (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        final View root = getWindow().getDecorView();
        root.post(() -> WindowCompat.getInsetsController(getWindow(), root)
                .setAppearanceLightStatusBars(!night));
    }
}
